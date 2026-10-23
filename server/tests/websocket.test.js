"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const WebSocket = require("ws");
const { createLumniaServer } = require("../src/index");

async function fixture(t, overrides = {}) {
  const saves = [];
  const hero = { id: "hero", user_id: "user", name: "Arlen", level: 1,
    sprite_name: "Actor4", sprite_index: 0 };
  const repository = {
    loadAuthUserFromToken: async token => token === "valid" ? { id: "user" } : null,
    loadCharacterByIdForUser: async () => hero,
    loadFirstCharacterForUser: async () => hero,
    loadSpawnForCharacter: async () => ({ mapId: "1", x: 7, y: 16, direction: "down" }),
    saveCharacterPositionById: async (...args) => saves.push(args),
    ...overrides
  };
  const app = createLumniaServer({ env: { PORT: "0" }, repository });
  app.httpServer.listen(0, "127.0.0.1");
  await once(app.httpServer, "listening");
  t.after(async () => {
    for (const socket of app.clients.values()) socket.terminate();
    await new Promise(resolve => app.server.close(resolve));
    await new Promise(resolve => app.httpServer.close(resolve));
  });
  const url = `ws://127.0.0.1:${app.httpServer.address().port}`;
  async function connect() {
    const socket = new WebSocket(url);
    const messages = [];
    socket.on("message", data => messages.push(JSON.parse(data)));
    await once(socket, "open");
    return { socket, messages };
  }
  return { ...app, connect, saves };
}

const position = token => ({ type: "position", mapId: "1", x: 8, y: 16,
  direction: "down", playerName: "forged", characterId: "hero", authToken: token });

async function until(predicate) {
  const end = Date.now() + 2000;
  while (!predicate()) {
    if (Date.now() > end) throw new Error("Resultado esperado não chegou.");
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

test("a name alone cannot load or save a character or receive a snapshot", async t => {
  const app = await fixture(t);
  const { socket, messages } = await app.connect();
  socket.send(JSON.stringify(position("")));
  const [code] = await once(socket, "close");
  assert.equal(code, 4003);
  assert.equal(messages.some(message => message.type === "state_snapshot"), false);
  assert.equal(app.players.size, 0);
  assert.equal(app.saves.length, 0);
});

test("concurrent packets cannot bypass a pending authentication", async t => {
  let release;
  const app = await fixture(t, { loadAuthUserFromToken: () => new Promise(resolve => { release = resolve; }) });
  const { socket, messages } = await app.connect();
  socket.send(JSON.stringify(position("bad")));
  socket.send(JSON.stringify(position("bad")));
  await until(() => release);
  assert.equal(app.players.size, 0);
  release(null);
  await once(socket, "close");
  assert.equal(app.players.size, 0);
  assert.equal(messages.some(message => message.type === "state_snapshot"), false);
});

test("malformed messages leave the server usable and authenticated chat is echoed", async t => {
  const app = await fixture(t);
  const { socket, messages } = await app.connect();
  socket.send("null");
  socket.send("[]");
  socket.send("{");
  socket.send(JSON.stringify(position("valid")));
  await until(() => app.players.size === 1);
  assert.equal(Array.from(app.players.values())[0].playerName, "Arlen");
  socket.send(JSON.stringify({ type: "chat", text: "Olá Soltia" }));
  await until(() => messages.some(message => message.type === "chat"));
  assert.equal(messages.find(message => message.type === "chat").author, "Arlen");
  socket.send(JSON.stringify({ ...position("valid"), x: 999999 }));
  await until(() => messages.filter(message => message.type === "error").length >= 4);
  assert.equal(Array.from(app.players.values())[0].x, 7);
});

test("database errors are contained inside the message handler", async t => {
  const app = await fixture(t, { loadAuthUserFromToken: async () => { throw new Error("DB offline"); } });
  const { socket, messages } = await app.connect();
  socket.send(JSON.stringify(position("valid")));
  await until(() => messages.some(message => message.type === "error"));
  assert.equal(app.players.size, 0);
  assert.equal(socket.readyState, WebSocket.OPEN);
});

test("expired sessions cannot continue chatting or moving", async t => {
  const app = await fixture(t);
  const { socket, messages } = await app.connect();
  socket.send(JSON.stringify(position("valid")));
  await until(() => app.players.size === 1);
  Array.from(app.clients.values())[0].classicmmoSessionExpiresAt = Date.now() - 1;
  socket.send(JSON.stringify({type:"chat",text:"expired"}));
  const [code] = await once(socket,"close");
  assert.equal(code,4003);
  assert.equal(messages.some(value => value.type === "chat"), false);
});

test("presence and local chat are isolated by map and refresh after transfer", async t => {
  const hero = id => ({ id, name: id, sprite_name: "Actor4", sprite_index: 0 });
  const app = await fixture(t, {
    loadAuthUserFromToken: async token => ({id:token}),
    loadCharacterByIdForUser: async (_id,user) => hero(user),
    loadFirstCharacterForUser: async user => hero(user),
    loadSpawnForCharacter: async character => ({mapId:character.id==='b'?'2':'1',x:7,y:8,direction:'down'})
  });
  const a = await app.connect();
  a.socket.send(JSON.stringify(position('a')));
  await until(() => app.players.size===1);
  const b = await app.connect();
  b.socket.send(JSON.stringify(position('b')));
  await until(() => app.players.size===2);
  a.socket.send(JSON.stringify({type:'chat',text:'map one'}));
  await until(() => a.messages.some(message=>message.type==='chat'));
  assert.equal(b.messages.some(message=>message.type==='chat'),false);
  assert.equal(b.messages.find(message=>message.type==='state_snapshot').players.length,0);
  a.socket.send(JSON.stringify({...position('a'),mapId:'2',x:5,y:8}));
  await until(() => a.messages.filter(message=>message.type==='state_snapshot').length===2);
  assert.equal(a.messages.filter(message=>message.type==='state_snapshot')[1].players[0].playerName,'b');
});
