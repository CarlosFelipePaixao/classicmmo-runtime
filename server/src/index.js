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

function createPlayerState(clientId) {
  return {
    clientId,
    mapId: "test_map",
    x: 0,
    y: 0,
    direction: "down"
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
      direction: player.direction
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

server.on("connection", (socket) => {
  const clientId = crypto.randomUUID();
  const player = createPlayerState(clientId);

  clients.set(clientId, socket);
  players.set(clientId, player);

  console.log(`[connect] ${clientId}`);

  send(socket, {
    type: "welcome",
    clientId
  });

  send(socket, {
    type: "state_snapshot",
    players: getStateSnapshot(clientId)
  });

  broadcast(clientId, {
    type: "player_joined",
    clientId
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
      const currentPlayer = players.get(clientId);

      if (!currentPlayer) {
        send(socket, {
          type: "error",
          message: "Player state not found"
        });

        return;
      }

      currentPlayer.mapId = String(message.mapId || "test_map");
      currentPlayer.x = Number(message.x || 0);
      currentPlayer.y = Number(message.y || 0);
      currentPlayer.direction = normalizeDirection(message.direction);

      broadcast(clientId, {
        type: "position",
        from: clientId,
        mapId: currentPlayer.mapId,
        x: currentPlayer.x,
        y: currentPlayer.y,
        direction: currentPlayer.direction
      });

      return;
    }

    send(socket, {
      type: "error",
      message: `Unknown message type: ${message.type}`
    });
  });

  socket.on("close", () => {
    clients.delete(clientId);
    players.delete(clientId);

    console.log(`[disconnect] ${clientId}`);

    broadcast(clientId, {
      type: "player_left",
      clientId
    });
  });
});

console.log(`ClassicMMO server listening on ws://localhost:${PORT}`);