const crypto = require("crypto");
const WebSocket = require("ws");

const PORT = 7777;

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
      playerName: player.playerName
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
    playerName: typeof message.playerName === "string" ? message.playerName : ""
  };
}

server.on("connection", (socket) => {
  const clientId = crypto.randomUUID();

  clients.set(clientId, socket);

  console.log(`[connect] ${clientId}`);

  send(socket, {
    type: "welcome",
    clientId
  });

  send(socket, {
    type: "state_snapshot",
    players: getStateSnapshot(clientId)
  });

  socket.on("message", (raw) => {
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

    console.log(`[message] ${clientId}`, message);

    if (message.type === "chat") {
      broadcast(clientId, {
        type: "chat",
        from: clientId,
        text: String(message.text || "")
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

      const hadPlayerState = players.has(clientId);

      const currentPlayer = {
        clientId,
        mapId: position.mapId,
        x: position.x,
        y: position.y,
        direction: position.direction,
        spriteName: position.spriteName,
        spriteIndex: position.spriteIndex,
        playerName: position.playerName
      };

      players.set(clientId, currentPlayer);

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

  socket.on("close", () => {
    const hadPlayerState = players.has(clientId);

    clients.delete(clientId);
    players.delete(clientId);

    console.log(`[disconnect] ${clientId}`);

    if (hadPlayerState) {
      broadcast(clientId, {
        type: "player_left",
        clientId
      });
    }
  });
});

console.log(`ClassicMMO server listening on ws://localhost:${PORT}`);