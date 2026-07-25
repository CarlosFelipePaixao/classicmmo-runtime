require("dotenv").config();
const crypto = require("crypto");
const { resolveCharacterSprite } = require("./appearance_sprite");
const http = require("http");
const WebSocket = require("ws");

const {
  loadAuthUserFromToken,
  loadCharacterByName,
  loadFirstCharacterForUser,
  loadCharacterByIdForUser,
  createCharacterForUser,
  saveCharacterPositionById,
  loadLevelRankings,
  loadSpawnForCharacter,
  loadSpawnForNewCharacter,
  loadCharacterInventory,
  moveCharacterInventoryItem
} = require("./supabase_client");

const PORT = Number(process.env.PORT || 7777);
// LUMNIA_LOGIN_SPRITE_GHOST_SERVER_FIX
const SPAWN_OVERRIDE_DELAY_MS = Number(process.env.SPAWN_OVERRIDE_DELAY_MS || 0);

const httpServer = http.createServer(handleHttpRequest);
const server = new WebSocket.Server({
  server: httpServer
});

const clients = new Map();
const players = new Map();
const characterCreationLocks = new Map();

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
      characterId: player.characterId || "",
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



function buildSafeSpawnCandidates(spawn) {
  const candidates = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
    { x: 1, y: 1 },
    { x: -1, y: 1 },
    { x: 1, y: -1 },
    { x: -1, y: -1 },
    { x: 2, y: 0 },
    { x: -2, y: 0 },
    { x: 0, y: 2 },
    { x: 0, y: -2 },
    { x: 2, y: 1 },
    { x: -2, y: 1 },
    { x: 2, y: -1 },
    { x: -2, y: -1 }
  ];

  return candidates.map((offset) => ({
    ...spawn,
    x: Number(spawn.x) + offset.x,
    y: Number(spawn.y) + offset.y
  }));
}

function chooseSafeSpawn(spawn, exceptClientId) {
  if (!spawn || !spawn.mapId) {
    return spawn;
  }

  const occupied = new Set();

  for (const [clientId, player] of players.entries()) {
    if (clientId === exceptClientId) {
      continue;
    }

    if (String(player.mapId) !== String(spawn.mapId)) {
      continue;
    }

    occupied.add(
      `${Number(player.x)},${Number(player.y)}`
    );
  }

  const candidates =
    buildSafeSpawnCandidates(spawn);

  const available = candidates.find(
    (candidate) =>
      !occupied.has(
        `${candidate.x},${candidate.y}`
      )
  );

  return {
    ...(available || spawn),
    safeSpawn:
      Boolean(available)
  };
}

function rememberAuthoritativeIdentity(
  socket,
  character,
  spawn
) {
  const resolvedSprite =
    character
      ? resolveCharacterSprite(character)
      : {
          spriteName:
            String(spawn && spawn.spriteName || ""),
          spriteIndex:
            Number.isInteger(
              spawn && spawn.spriteIndex
            )
              ? spawn.spriteIndex
              : 0
        };

  socket.classicmmoAuthoritativeSpriteName =
    resolvedSprite.spriteName;

  socket.classicmmoAuthoritativeSpriteIndex =
    resolvedSprite.spriteIndex;

  socket.classicmmoInitialSpawn =
    spawn
      ? {
          mapId: String(spawn.mapId),
          x: Number(spawn.x),
          y: Number(spawn.y),
          direction:
            normalizeDirection(spawn.direction)
        }
      : null;

  socket.classicmmoInitialSpawnPending =
    Boolean(socket.classicmmoInitialSpawn);
}

async function createCharacterSerially(
  userId,
  payload
) {
  while (characterCreationLocks.has(userId)) {
    try {
      await characterCreationLocks.get(userId);
    }
    catch (_) {
      // A próxima tentativa ainda deve consultar o banco.
    }
  }

  let releaseLock = null;

  const lock = new Promise((resolve) => {
    releaseLock = resolve;
  });

  characterCreationLocks.set(
    userId,
    lock
  );

  try {
    return await createCharacterForUser(
      userId,
      payload
    );
  }
  finally {
    if (
      characterCreationLocks.get(userId) ===
      lock
    ) {
      characterCreationLocks.delete(userId);
    }

    releaseLock();
  }
}

function closeOlderAuthenticatedSessions(currentSocket, userId) {
  if (!userId) {
    return;
  }

  for (const [otherClientId, otherSocket] of clients.entries()) {
    if (otherSocket === currentSocket) {
      continue;
    }

    if (otherSocket.classicmmoUserId !== userId) {
      continue;
    }

    console.log("[auth] encerrando sessão duplicada:", {
      userId,
      oldClientId: otherClientId,
      newClientId: currentSocket.classicmmoClientId
    });

    otherSocket.classicmmoReplacedByNewSession = true;
    otherSocket.close(4001, "Sessão substituída por um novo login.");
  }
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
        : 0,
      characterId: String(spawn.characterId || "")
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


    closeOlderAuthenticatedSessions(socket, authUser.id);
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

      const baseSpawn =
        await loadSpawnForCharacter(character);

      const spawn = chooseSafeSpawn(
        {
          ...baseSpawn,
          characterId: character.id
        },
        socket.classicmmoClientId
      );

      rememberAuthoritativeIdentity(
        socket,
        character,
        spawn
      );

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

    const spawn = chooseSafeSpawn(
      loadSpawnForNewCharacter(),
      socket.classicmmoClientId
    );

    rememberAuthoritativeIdentity(
      socket,
      null,
      spawn
    );

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

      const baseSpawn =
        await loadSpawnForCharacter(character);

      const spawn = chooseSafeSpawn(
        {
          ...baseSpawn,
          characterId: character.id
        },
        socket.classicmmoClientId
      );

      rememberAuthoritativeIdentity(
        socket,
        character,
        spawn
      );

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

function writeJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":
      "Authorization, Content-Type",
    "Access-Control-Allow-Methods":
      "GET, POST, OPTIONS"
  });

  response.end(JSON.stringify(payload));
}

function readBearerToken(request) {
  const header = String(
    request.headers.authorization || ""
  );

  const match = header.match(
    /^Bearer\s+(.+)$/i
  );

  return match ? match[1].trim() : "";
}

async function readJsonBody(request) {
  const chunks = [];
  let total = 0;
  const maximum = 64 * 1024;

  for await (const chunk of request) {
    total += chunk.length;

    if (total > maximum) {
      throw new Error(
        "Corpo da requisição excede 64 KB."
      );
    }

    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  const raw = Buffer
    .concat(chunks)
    .toString("utf8");

  try {
    return JSON.parse(raw);
  }
  catch (_) {
    throw new Error(
      "JSON inválido na requisição."
    );
  }
}

function serializeCharacter(character) {
  if (!character) {
    return null;
  }

  const appearance =
    character.appearance &&
    typeof character.appearance === "object"
      ? character.appearance
      : {};

  const resolvedSprite = resolveCharacterSprite({
    ...character,
    appearance
  });

  return {
    id: character.id,
    name: character.name,
    class_key: character.class_key,
    level: Number(character.level) || 1,
    appearance,
    sprite_name: resolvedSprite.spriteName,
    sprite_index: resolvedSprite.spriteIndex
  };
}

async function authenticateHttpRequest(request) {
  const token = readBearerToken(request);

  if (!token) {
    return null;
  }

  return loadAuthUserFromToken(token);
}

async function handleHttpRequest(request, response) {
  if (request.method === "OPTIONS") {
    writeJson(response, 204, {});
    return;
  }

  const requestUrl = new URL(
    request.url || "/",
    "http://localhost"
  );

  try {
    if (
      request.method === "GET" &&
      requestUrl.pathname === "/health"
    ) {
      writeJson(response, 200, {
        ok: true,
        service: "lumnia-server"
      });
      return;
    }

    if (
      request.method === "GET" &&
      requestUrl.pathname === "/rankings/level"
    ) {
      const rankings = await loadLevelRankings(
        requestUrl.searchParams.get("limit")
      );

      writeJson(response, 200, {
        ok: true,
        rankings
      });
      return;
    }

    if (
      request.method === "GET" &&
      requestUrl.pathname ===
        "/api/character/status"
    ) {
      const authUser =
        await authenticateHttpRequest(request);

      if (!authUser) {
        writeJson(response, 401, {
          ok: false,
          error: "Sessão inválida ou expirada."
        });
        return;
      }

      const character =
        await loadFirstCharacterForUser(
          authUser.id
        );

      writeJson(response, 200, {
        ok: true,
        hasCharacter: Boolean(character),
        destination:
          character ? "game" : "creator",
        character:
          serializeCharacter(character)
      });
      return;
    }


    if (
      request.method === "GET" &&
      requestUrl.pathname ===
        "/api/inventory"
    ) {
      const authUser =
        await authenticateHttpRequest(
          request
        );

      if (!authUser) {
        writeJson(response, 401, {
          ok: false,
          error:
            "Sessão inválida ou expirada."
        });
        return;
      }

      const character =
        await loadFirstCharacterForUser(
          authUser.id
        );

      if (!character) {
        writeJson(response, 404, {
          ok: false,
          error:
            "Nenhum personagem foi encontrado."
        });
        return;
      }

      const items =
        await loadCharacterInventory(
          character.id
        );

      writeJson(response, 200, {
        ok: true,
        character: {
          id: character.id,
          name: character.name
        },
        capacities: {
          inventory: 12,
          potions: 6
        },
        items
      });
      return;
    }

    if (
      request.method === "POST" &&
      requestUrl.pathname ===
        "/api/inventory/move"
    ) {
      const authUser =
        await authenticateHttpRequest(
          request
        );

      if (!authUser) {
        writeJson(response, 401, {
          ok: false,
          error:
            "Sessão inválida ou expirada."
        });
        return;
      }

      const character =
        await loadFirstCharacterForUser(
          authUser.id
        );

      if (!character) {
        writeJson(response, 404, {
          ok: false,
          error:
            "Nenhum personagem foi encontrado."
        });
        return;
      }

      const payload =
        await readJsonBody(request);

      const items =
        await moveCharacterInventoryItem(
          character.id,
          payload
        );

      writeJson(response, 200, {
        ok: true,
        character: {
          id: character.id,
          name: character.name
        },
        capacities: {
          inventory: 12,
          potions: 6
        },
        items
      });
      return;
    }

    if (
      request.method === "POST" &&
      requestUrl.pathname ===
        "/api/characters"
    ) {
      const authUser =
        await authenticateHttpRequest(request);

      if (!authUser) {
        writeJson(response, 401, {
          ok: false,
          error: "Sessão inválida ou expirada."
        });
        return;
      }

      const payload =
        await readJsonBody(request);

      const result =
        await createCharacterSerially(
          authUser.id,
          payload
        );

      writeJson(
        response,
        result.created ? 201 : 200,
        {
          ok: true,
          created: result.created,
          character:
            serializeCharacter(
              result.character
            )
        }
      );
      return;
    }

    writeJson(response, 404, {
      ok: false,
      error: "Rota não encontrada."
    });
  }
  catch (error) {
    console.error(
      "[http] erro:",
      error && error.message
        ? error.message
        : error
    );

    writeJson(response, 500, {
      ok: false,
      error:
        error && error.message
          ? error.message
          : "Erro interno do servidor."
    });
  }
}

server.on("connection", (socket) => {
  const clientId = crypto.randomUUID();

  clients.set(clientId, socket);
  socket.classicmmoClientId = clientId;

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
          const result = await createCharacterSerially(
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

          const creationSprite =
            resolveCharacterSprite(character);

          socket.classicmmoAuthoritativeSpriteName =
            creationSprite.spriteName;

          socket.classicmmoAuthoritativeSpriteIndex =
            creationSprite.spriteIndex;

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

      const initialSpawn =
        socket.classicmmoInitialSpawnPending
          ? socket.classicmmoInitialSpawn
          : null;

      const currentPlayer = {
        clientId,
        characterId:
          socket.classicmmoCharacterId ||
          position.characterId ||
          "",
        mapId:
          initialSpawn
            ? initialSpawn.mapId
            : position.mapId,
        x:
          initialSpawn
            ? initialSpawn.x
            : position.x,
        y:
          initialSpawn
            ? initialSpawn.y
            : position.y,
        direction:
          initialSpawn
            ? initialSpawn.direction
            : position.direction,
        spriteName:
          socket.classicmmoAuthoritativeSpriteName ||
          position.spriteName,
        spriteIndex:
          Number.isInteger(
            socket.classicmmoAuthoritativeSpriteIndex
          )
            ? socket.classicmmoAuthoritativeSpriteIndex
            : position.spriteIndex,
        playerName:
          socket.classicmmoPlayerName ||
          position.playerName ||
          "Player",
        chatText: "",
        chatTimer: 0
      };

      socket.classicmmoInitialSpawnPending = false;

      players.set(clientId, currentPlayer);
      socket.classicmmoLastPlayerState = currentPlayer;

      if (!hadPlayerState) {
        broadcast(clientId, {
          type: "player_joined",
          clientId,
          characterId: currentPlayer.characterId,
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
        characterId: currentPlayer.characterId,
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

    if (
      !socket.classicmmoReplacedByNewSession &&
      characterId &&
      lastPlayerState
    ) {
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

httpServer.listen(PORT, () => {
  console.log(
    `Lumnia server listening on http://localhost:${PORT}`
  );
  console.log(
    `Lumnia websocket listening on ws://localhost:${PORT}`
  );
});
