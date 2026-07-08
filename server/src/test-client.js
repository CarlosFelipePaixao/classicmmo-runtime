const WebSocket = require("ws");

const name = process.argv[2] || "Client";
const socket = new WebSocket("ws://localhost:7777");

let x = 0;
let y = 0;
let direction = "right";

socket.on("open", () => {
  console.log(`[${name}] Connected to ClassicMMO server`);

  socket.send(JSON.stringify({
    type: "chat",
    text: `${name} entrou no teste.`
  }));

  setInterval(() => {
    x += 1;

    socket.send(JSON.stringify({
      type: "position",
      mapId: "test_map",
      x,
      y,
      direction
    }));
  }, 1000);

  setInterval(() => {
    socket.send(JSON.stringify({
      type: "chat",
      text: `${name} ainda está online. x=${x}, y=${y}`
    }));
  }, 5000);
});

socket.on("message", (raw) => {
  console.log(`[${name}] Received: ${raw.toString()}`);
});

socket.on("close", () => {
  console.log(`[${name}] Disconnected`);
});

socket.on("error", (error) => {
  console.error(`[${name}] Error:`, error.message);
});