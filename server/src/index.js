const crypto = require("crypto");
const WebSocket = require("ws");

const PORT = 7777;

const server = new WebSocket.Server({ port: PORT });
const clients = new Map();

function broadcast(senderId, message) {
  const data = JSON.stringify(message);

  for (const [clientId, socket] of clients.entries()) {
    if (clientId === senderId) continue;

    if (socket.readyState === WebSocket.OPEN) {
      socket.send(data);
    }
  }
}

server.on("connection", (socket) => {
  const clientId = crypto.randomUUID();

  clients.set(clientId, socket);

  console.log(`[connect] ${clientId}`);

  socket.send(JSON.stringify({
    type: "welcome",
    clientId
  }));

  socket.on("message", (raw) => {
    let message;

    try {
      message = JSON.parse(raw.toString());
    } catch {
      socket.send(JSON.stringify({
        type: "error",
        message: "Invalid JSON"
      }));
      return;
    }

    console.log(`[message] ${clientId}`, message);

    if (message.type === "chat") {
      broadcast(clientId, {
        type: "chat",
        from: clientId,
        text: message.text || ""
      });
    }

    if (message.type === "position") {
      broadcast(clientId, {
        type: "position",
        from: clientId,
        mapId: message.mapId || "unknown",
        x: Number(message.x || 0),
        y: Number(message.y || 0),
        direction: message.direction || "down"
      });
    }
  });

  socket.on("close", () => {
    clients.delete(clientId);

    console.log(`[disconnect] ${clientId}`);

    broadcast(clientId, {
      type: "player_left",
      clientId
    });
  });
});

console.log(`ClassicMMO server listening on ws://localhost:${PORT}`);