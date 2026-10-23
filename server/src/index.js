"use strict";

function createLumniaServer(options = {}) {
const env = options.env || process.env;
const { readMessage, consumeRate, normalizeChat, sessionExpiresAt } = require("./session_policy");
const { progressionForCharacter } = require("./progression");
const world = options.world || require("./world_catalog.json");
const crypto = require("crypto");
const { resolveCharacterSprite } = require("./appearance_sprite");
const http = require("http");
const WebSocket = require("ws");

const {
  loadAuthUserFromToken,
  loadFirstCharacterForUser,
  loadCharacterByIdForUser,
  createCharacterForUser,
  saveCharacterPositionById,
  loadLevelRankings,
  loadSpawnForCharacter,
  loadSpawnForNewCharacter,
  loadCharacterInventoryState,
  moveCharacterInventoryItem,
  claimCharacterReward
} = options.repository || require("./supabase_client");

const {
  abandonCharacterBattles,
  startCharacterBattle,
  finishCharacterBattle
} = options.battles || require("./battle_service");

const PORT = Number(env.PORT || 7777);
// LUMNIA_LOGIN_SPRITE_GHOST_SERVER_FIX
const SPAWN_OVERRIDE_DELAY_MS = Number(env.SPAWN_OVERRIDE_DELAY_MS || 0);

const httpServer = http.createServer(handleHttpRequest);
const server = new WebSocket.Server({
  server: httpServer,
  maxPayload: 8192,
  verifyClient: ({ origin }) => !origin ||
    (env.ALLOWED_ORIGINS || "https://lumnia-online.netlify.app,https://android-diagnostico-test--lumnia-online.netlify.app,http://localhost:8010,http://127.0.0.1:8010")
      .split(",").map(value => value.trim()).includes(origin)
});

const clients = new Map();
const players = new Map();
const characterCreationLocks = new Map();

function send(socket, message) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

function broadcast(senderId, message, mapId) {
  const data = JSON.stringify(message);

  for (const [clientId, socket] of clients.entries()) {
    if (clientId === senderId || !socket.classicmmoIdentityResolved) continue;
    if (mapId && String(players.get(clientId)?.mapId) !== String(mapId)) continue;

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

function getStateSnapshot(exceptClientId, mapId) {
  const snapshot = [];

  for (const [clientId, player] of players.entries()) {
    if (clientId === exceptClientId || String(player.mapId) !== String(mapId)) continue;

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

  if (!world.maps[mapId]) {
    return null;
  }

  const bounds = world.maps[mapId];
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 ||
      x >= bounds.width || y >= bounds.height) {
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

  if (!position.authToken) {
    send(socket, { type: "error", message: "Entre na sua conta para conectar ao mundo." });
    socket.close(4003, "Autenticação necessária.");
    return false;
  }

  if (position.authToken) {
    const authUser = await loadAuthUserFromToken(position.authToken);

    if (!authUser) {
      send(socket, {
        type: "error",
        message: "Invalid auth token"
      });

      socket.close(4003, "Sessão inválida ou expirada.");
      return false;
    }

    if (socket.readyState !== WebSocket.OPEN) return false;
    socket.classicmmoUserId = authUser.id;
    socket.classicmmoSessionExpiresAt = sessionExpiresAt(position.authToken);
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

      socket.classicmmoIdentityResolved = true;
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
      mode: position.gameMode,
      spawn
    });

    socket.classicmmoIdentityResolved = true;
    sendSpawnOverride(socket, spawn);
    return true;
  }

  return false;
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
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Objeto JSON necessário.");
    return value;
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
    ...progressionForCharacter(character),
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

      const state =
        await loadCharacterInventoryState(
          character
        );

      writeJson(response, 200, {
        ok: true,
        character: {
          id: character.id,
          name: character.name,
          classKey:
            character.class_key,
          ...progressionForCharacter(character)
        },
        capacities: {
          inventory: 12,
          potions: 6,
          equipment: 7
        },
        items: state.items,
        stats: state.stats
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

      const state =
        await moveCharacterInventoryItem(
          character,
          payload
        );

      writeJson(response, 200, {
        ok: true,
        character: {
          id: character.id,
          name: character.name,
          classKey:
            character.class_key,
          ...progressionForCharacter(character)
        },
        capacities: {
          inventory: 12,
          potions: 6,
          equipment: 7
        },
        items: state.items,
        stats: state.stats
      });
      return;
    }

    if (
      request.method === "POST" &&
      requestUrl.pathname ===
        "/api/rewards/claim"
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

      const result =
        await claimCharacterReward(
          character,
          payload.rewardKey,
          { player: Array.from(players.values()).find(player => player.characterId === character.id) }
        );

      writeJson(response, 200, {
        ok: true,
        character: {
          id: character.id,
          name: character.name,
          classKey:
            character.class_key,
          ...progressionForCharacter(character)
        },
        reward: result.reward,
        message:
          result.reward.message,
        capacities: {
          inventory: 12,
          potions: 6,
          equipment: 7
        },
        items: result.state.items,
        stats: result.state.stats
      });
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/battles/abandon") {
      const user = await authenticateHttpRequest(request);
      if (!user) { writeJson(response, 401, { ok: false, error: "Entre na sua conta novamente." }); return; }
      const character = await loadFirstCharacterForUser(user.id);
      if (!character) { writeJson(response, 404, { ok: false, error: "Personagem não encontrado." }); return; }
      const result = await abandonCharacterBattles(character);
      writeJson(response, 200, { ok: true, ...result });
      return;
    }

    // LUMNIA_BATTLE_SESSIONS_HTTP_V1
    if (
      request.method === "POST" &&
      requestUrl.pathname ===
        "/api/battles/start"
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

      const battle =
        await startCharacterBattle(
          character,
          payload,
          { player: Array.from(players.values()).find(player => player.characterId === character.id) }
        );

      writeJson(response, 201, {
        ok: true,
        battle
      });
      return;
    }

    if (
      request.method === "POST" &&
      requestUrl.pathname ===
        "/api/battles/finish"
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

      const battle =
        await finishCharacterBattle(
          character,
          payload
        );

      writeJson(response, 200, {
        ok: true,
        battle
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

  socket.isAlive = true;
  socket.on("pong", () => { socket.isAlive = true; });
  const authTimeout = setTimeout(() => {
    if (!socket.classicmmoIdentityResolved) socket.close(4003, "Tempo de autenticação esgotado.");
  }, 20000);
  let queue = Promise.resolve();
  let pending = 0;
  socket.on("message", raw => {
    if (!consumeRate(socket, "messages", 100, 1000) || pending >= 32) {
      socket.close(1008, "Muitas mensagens.");
      return;
    }
    pending++;
    queue = queue.then(() => processMessage(raw)).catch(error => {
      console.warn("[socket] mensagem rejeitada:", error.message);
      send(socket, { type: "error", message: "Não foi possível processar a ação. Tente novamente." });
    }).finally(() => { pending--; });
  });

  async function processMessage(raw) {
    if (socket.readyState !== WebSocket.OPEN) return;
    if (socket.classicmmoIdentityResolved && Date.now() >= socket.classicmmoSessionExpiresAt) {
      socket.close(4003, "Sua sessão expirou. Entre novamente.");
      return;
    }
    let message;

    try {
      message = readMessage(raw);
    } catch {
      send(socket, {
        type: "error",
        message: "Invalid JSON"
      });

      return;
    }

    // Não registrar tokens, conteúdo de chat ou posição a cada passo.
    if (message.type !== "position" && !socket.classicmmoIdentityResolved) {
      socket.close(4003, "Autenticação necessária.");
      return;
    }

    if (message.type === "chat") {
      if (!players.has(clientId)) throw new Error("Personagem ainda não entrou no mapa.");
      if (!consumeRate(socket, "chat", 3, 5000)) {
        send(socket, { type: "error", message: "Aguarde alguns segundos antes de enviar outra mensagem." });
        return;
      }
      const text = normalizeChat(message.text);

      if (players.has(clientId)) {
        const player = players.get(clientId);
        player.chatText = text;
        player.chatTimer = 180;
        players.set(clientId, player);
      }

      const chat = { type: "chat", from: clientId, author: socket.classicmmoPlayerName, text };
      broadcast(clientId, chat, players.get(clientId).mapId);
      send(socket, chat);

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

      if (socket.readyState !== WebSocket.OPEN) return;
      const previousPlayer = players.get(clientId);
      const hadPlayerState = Boolean(previousPlayer);

      const initialSpawn =
        socket.classicmmoInitialSpawnPending
          ? socket.classicmmoInitialSpawn
          : null;

      const currentPlayer = {
        clientId,
        characterId:
          socket.classicmmoCharacterId || "",
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
        chatText: previousPlayer?.chatText || "",
        chatTimer: previousPlayer?.chatTimer || 0
      };

      socket.classicmmoInitialSpawnPending = false;

      players.set(clientId, currentPlayer);
      socket.classicmmoLastPlayerState = currentPlayer;

      const changedMap = previousPlayer && previousPlayer.mapId !== currentPlayer.mapId;
      if (changedMap) {
        broadcast(clientId, { type: "player_left", clientId }, previousPlayer.mapId);
      }
      if (!hadPlayerState || changedMap) {
        send(socket, { type: "state_snapshot", players: getStateSnapshot(clientId, currentPlayer.mapId) });
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
        }, currentPlayer.mapId);
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
      }, currentPlayer.mapId);

      return;
    }

    send(socket, {
      type: "error",
      message: `Unknown message type: ${message.type}`
    });
  }

  socket.on("error", error => console.warn("[socket] conexão:", error.message));
  socket.on("close", async () => {
    clearTimeout(authTimeout);
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
      try { await saveCharacterPositionById(characterId, lastPlayerState); }
      catch (error) { console.error("[save] posição não salva:", error.message); }
    }

    if (hadPlayerState) {
      broadcast(clientId, {
        type: "player_left",
        clientId
      }, lastPlayerState?.mapId);
    }
  });
});

const heartbeat = setInterval(() => {
  for (const socket of clients.values()) {
    if (socket.classicmmoIdentityResolved && Date.now() >= socket.classicmmoSessionExpiresAt) {
      socket.close(4003, "Sua sessão expirou. Entre novamente."); continue;
    }
    if (!socket.isAlive) { socket.terminate(); continue; }
    socket.isAlive = false;
    socket.ping();
  }
}, 30000);
heartbeat.unref();
httpServer.on("close", () => clearInterval(heartbeat));
return { httpServer, server, players, clients, port: PORT };
}

module.exports = { createLumniaServer };
if (require.main === module) {
  require("dotenv").config();
  const app = createLumniaServer();
  app.httpServer.listen(app.port, () => console.log(`Lumnia online na porta ${app.port}`));
}
