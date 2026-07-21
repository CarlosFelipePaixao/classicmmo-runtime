require("dotenv").config();
const crypto = require("crypto");
const WebSocket = require("ws");

const {
  loadAuthUserFromToken,
  loadCharacterByName,
  loadFirstCharacterForUser,
  loadCharacterByIdForUser,
  createCharacterForUser,
  saveCharacterPositionById,
  loadSpawnForCharacter,
  loadSpawnForNewCharacter
} = require("./supabase_client");

const PORT = Number(process.env.PORT || 7777);
const SPAWN_OVERRIDE_DELAY_MS = Number(process.env.SPAWN_OVERRIDE_DELAY_MS || 5000);

const server = new WebSocket.Server({ port: PORT });

const clients = new Map();
const players = new Map();

function send(socket, message) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

function broadcast(senderId, message) {
  const data = JSON.stringify(message);

  for (const [clientId, socket] of clients.entries()) {
    if (clientId === senderId) continue;

    if (socket.readyState === WebSocket.OPEN) {
      socket.send(data);
    }
  }
}

function sanitizeForLog(message) {
  if (!message || typeof message !== "object") {
    return message;
  }

  return {
    ...message,
    authToken: message.authToken ? "[hidden]" : undefined
  };
}

function getStateSnapshot(exceptClientId) {
  const snapshot = [];

  for (const [clientId, player] of players.entries()) {
    if (clientId === exceptClientId) continue;

    snapshot.push({
      clientId: player.clientId,
      mapId: player.mapId,
      x: player.x,
      y: player.y,
      direction: player.direction,
      spriteName: player.spriteName,
      spriteIndex: player.spriteIndex,
      playerName: player.playerName,
      chatText: player.chatText || "",
      chatTimer: player.chatTimer || 0
    });
  }

  return snapshot;
}

function normalizeDirection(direction) {
  const validDirections = ["up", "down", "left", "right"];

  if (validDirections.includes(direction)) {
    return direction;
  }

  return "down";
}

function readPositionMessage(message) {
  const mapId = String(message.mapId || "");
  const x = Number(message.x);
  const y = Number(message.y);
  const direction = normalizeDirection(message.direction);

  if (!mapId) {
    return null;
  }

  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }

  return {
    mapId,
    x,
    y,
    direction,
    spriteName: typeof message.spriteName === "string" ? message.spriteName : "",
    spriteIndex: Number.isInteger(message.spriteIndex) ? message.spriteIndex : 0,
    playerName: typeof message.playerName === "string" ? message.playerName : "",
    authToken: typeof message.authToken === "string" ? message.authToken : "",
    characterId: typeof message.characterId === "string" ? message.characterId : "",
    gameMode: typeof message.gameMode === "string" ? message.gameMode : ""
  };
}

// LUMNIA_CHARACTER_PERSISTENCE
function readCharacterCreationRequest(position) {
  const prefix = "create_character:";
  const mode = String(position && position.gameMode || "");

  if (!mode.startsWith(prefix)) {
    return null;
  }

  const values = mode
    .slice(prefix.length)
    .split(":")
    .map((value) => Number(value));

  if (
    values.length !== 4 ||
    values.some((value) => !Number.isInteger(value))
  ) {
    return {
      invalid: true
    };
  }

  return {
    invalid: false,
    skin: values[0],
    eyes: values[1],
    classId: values[2],
    hair: values[3]
  };
}

function sendCharacterCreationResult(socket, ok, position, character, errorMessage) {
  send(socket, {
    type: "spawn_override",
    spawnKey: ok ? "character_created" : "character_creation_error",
    reason: ok ? "character_created" : "character_creation_error",
    mapId: String(position.mapId),
    x: Number(position.x),
    y: Number(position.y),
    direction: String(position.direction || "down"),
    spriteName: ok
      ? String(character && character.sprite_name || position.spriteName || "")
      : "",
    spriteIndex: ok && character && Number.isInteger(character.sprite_index)
      ? character.sprite_index
      : Number(position.spriteIndex) || 0,
    characterId: ok && character ? character.id : null,
    message: ok ? "" : String(errorMessage || "Falha ao criar personagem.")
  });
}

function sendSpawnOverride(socket, spawn) {
  if (!spawn) {
    return;
  }

  setTimeout(() => {
    if (socket.readyState !== WebSocket.OPEN) {
      return;
    }

    send(socket, {
      type: "spawn_override",
      spawnKey: spawn.spawnKey,
      reason: spawn.reason,
      mapId: spawn.mapId,
      x: spawn.x,
      y: spawn.y,
      direction: spawn.direction,
      spriteName: String(spawn.spriteName || ""),
      spriteIndex: Number.isInteger(spawn.spriteIndex)
        ? spawn.spriteIndex
        : 0
    });
  }, SPAWN_OVERRIDE_DELAY_MS);
}

async function resolveIdentity(socket, position) {
  if (socket.classicmmoIdentityResolved) {
    return true;
  }

  socket.classicmmoIdentityResolved = true;

  if (position.authToken) {
    const authUser = await loadAuthUserFromToken(position.authToken);

    if (!authUser) {
      send(socket, {
        type: "error",
        message: "Invalid auth token"
      });

      socket.close();
      return false;
    }

    socket.classicmmoUserId = authUser.id;
    socket.classicmmoUserEmail = authUser.email || "";

    let character = null;

    if (position.characterId) {
      character = await loadCharacterByIdForUser(position.characterId, authUser.id);
    }

    if (!character) {
      character = await loadFirstCharacterForUser(authUser.id);
    }

    if (character) {
      socket.classicmmoCharacterId = character.id;
      socket.classicmmoPlayerName = character.name;

      const spawn = await loadSpawnForCharacter(character);

      console.log("[auth] usuário autenticado com personagem:", {
        userId: authUser.id,
        characterId: character.id,
        name: character.name,
        spawn
      });

      sendSpawnOverride(socket, spawn);
      return true;
    }

    socket.classicmmoCharacterId = null;
    socket.classicmmoPlayerName = position.playerName || "NovoHeroi";

    const spawn = loadSpawnForNewCharacter();

    console.log("[auth] usuário autenticado sem personagem:", {
      userId: authUser.id,
      email: authUser.email,
      mode: position.gameMode,
      spawn
    });

    sendSpawnOverride(socket, spawn);
    return true;
  }

  if (position.playerName) {
    const character = await loadCharacterByName(position.playerName);

    if (character) {
      socket.classicmmoCharacterId = character.id;
      socket.classicmmoPlayerName = character.name;

      const spawn = await loadSpawnForCharacter(character);

      console.log("[legacy] personagem por nome:", {
        characterId: character.id,
        name: character.name,
        spawn
      });

      sendSpawnOverride(socket, spawn);
      return true;
    }
  }

  socket.classicmmoPlayerName = position.playerName || "Player";

  console.log("[legacy] conexão sem token/personagem:", {
    playerName: socket.classicmmoPlayerName
  });

  return true;
}

server.on("connection", (socket) => {
  const clientId = crypto.randomUUID();

  clients.set(clientId, socket);

  console.log("[connect]", clientId);

  send(socket, {
    type: "welcome",
    clientId
  });

  send(socket, {
    type: "state_snapshot",
    players: getStateSnapshot(clientId)
  });

  socket.on("message", async (raw) => {
    let message;

    try {
      message = JSON.parse(raw.toString());
    } catch {
      send(socket, {
        type: "error",
        message: "Invalid JSON"
      });

      return;
    }

    console.log("[message]", clientId, sanitizeForLog(message));

    if (message.type === "chat") {
      const text = String(message.text || "");

      if (players.has(clientId)) {
        const player = players.get(clientId);
        player.chatText = text;
        player.chatTimer = 180;
        players.set(clientId, player);
      }

      broadcast(clientId, {
        type: "chat",
        from: clientId,
        text
      });

      return;
    }

    if (message.type === "position") {
      const position = readPositionMessage(message);

      if (!position) {
        send(socket, {
          type: "error",
          message: "Invalid position message"
        });

        return;
      }

      const identityOk = await resolveIdentity(socket, position);

      if (!identityOk) {
        return;
      }

      const creationRequest = readCharacterCreationRequest(position);

      if (creationRequest) {
        if (creationRequest.invalid || !socket.classicmmoUserId) {
          sendCharacterCreationResult(
            socket,
            false,
            position,
            null,
            "Pedido de criação inválido."
          );
          return;
        }

        if (socket.classicmmoCharacterCreating) {
          return;
        }

        socket.classicmmoCharacterCreating = true;

        try {
          const result = await createCharacterForUser(
            socket.classicmmoUserId,
            {
              name: position.playerName,
              skin: creationRequest.skin,
              eyes: creationRequest.eyes,
              classId: creationRequest.classId,
              hair: creationRequest.hair,
              spriteName: position.spriteName,
              spriteIndex: position.spriteIndex
            }
          );

          const character = result.character;

          socket.classicmmoCharacterId = character.id;
          socket.classicmmoPlayerName = character.name;

          console.log("[auth] criação de personagem concluída:", {
            userId: socket.classicmmoUserId,
            characterId: character.id,
            name: character.name,
            created: result.created,
            appearance: character.appearance,
            spriteName: character.sprite_name,
            spriteIndex: character.sprite_index
          });

          sendCharacterCreationResult(
            socket,
            true,
            position,
            character,
            ""
          );
        } catch (error) {
          console.error(
            "[auth] erro ao criar personagem:",
            error && error.message ? error.message : error
          );

          sendCharacterCreationResult(
            socket,
            false,
            position,
            null,
            error && error.message
              ? error.message
              : "Falha ao criar personagem."
          );
          return;
        } finally {
          socket.classicmmoCharacterCreating = false;
        }
      }

      const hadPlayerState = players.has(clientId);

      const currentPlayer = {
        clientId,
        mapId: position.mapId,
        x: position.x,
        y: position.y,
        direction: position.direction,
        spriteName: position.spriteName,
        spriteIndex: position.spriteIndex,
        playerName: socket.classicmmoPlayerName || position.playerName || "Player",
        chatText: "",
        chatTimer: 0
      };

      players.set(clientId, currentPlayer);
      socket.classicmmoLastPlayerState = currentPlayer;

      if (!hadPlayerState) {
        broadcast(clientId, {
          type: "player_joined",
          clientId,
          mapId: currentPlayer.mapId,
          x: currentPlayer.x,
          y: currentPlayer.y,
          direction: currentPlayer.direction,
          spriteName: currentPlayer.spriteName,
          spriteIndex: currentPlayer.spriteIndex,
          playerName: currentPlayer.playerName
        });
      }

      broadcast(clientId, {
        type: "position",
        from: clientId,
        mapId: currentPlayer.mapId,
        x: currentPlayer.x,
        y: currentPlayer.y,
        direction: currentPlayer.direction,
        spriteName: currentPlayer.spriteName,
        spriteIndex: currentPlayer.spriteIndex,
        playerName: currentPlayer.playerName
      });

      return;
    }

    send(socket, {
      type: "error",
      message: `Unknown message type: ${message.type}`
    });
  });

  socket.on("close", async () => {
    const hadPlayerState = players.has(clientId);
    const lastPlayerState = socket.classicmmoLastPlayerState;
    const characterId = socket.classicmmoCharacterId;

    clients.delete(clientId);
    players.delete(clientId);

    console.log("[disconnect]", clientId);

    if (characterId && lastPlayerState) {
      await saveCharacterPositionById(characterId, lastPlayerState);
    }

    if (hadPlayerState) {
      broadcast(clientId, {
        type: "player_left",
        clientId
      });
    }
  });
});

console.log(`ClassicMMO server listening on ws://localhost:${PORT}`);
