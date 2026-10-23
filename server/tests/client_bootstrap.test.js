"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const source = fs.readFileSync(path.join(__dirname, "../../resources/classicmmo-web/client-bootstrap.js"), "utf8");

function client(url, stored = {}) {
  class Socket extends EventTarget {
    static OPEN = 1;
    readyState = 1;
    sent = [];
    send(data) { this.sent.push(JSON.parse(data)); }
  }
  const location = new URL(url);
  const window = new EventTarget();
  window.WebSocket = Socket;
  const styles = [];
  const document = {
    documentElement: { dataset: {} },
    head: { appendChild: value => styles.push(value) },
    createElement: () => ({}),
    addEventListener() {}
  };
  let cleanUrl;
  const storage = new Map(Object.entries(stored));
  vm.runInNewContext(source, { window, document, location,
    history: { replaceState: (_, __, url) => { cleanUrl = url; } },
    sessionStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    navigator: { userAgent: "Desktop", platform: "Win32", maxTouchPoints: 0 },
    URL, URLSearchParams, CustomEvent, setTimeout, clearTimeout, console });
  return { window, storage, styles, document, get cleanUrl() { return cleanUrl; } };
}

test("legacy URL token is removed and shared session is restored on reload", () => {
  const state = client("https://lumnia.test/easyrpg-player.html?token=secret&characterId=hero&game=default");
  assert.equal(state.window.LumniaSession.getToken(), "secret");
  assert.equal(state.cleanUrl.includes("secret"), false);
  assert.equal(state.cleanUrl.includes("game=default"), true);
  const reloaded = client("https://lumnia.test/easyrpg-player.html?game=default",
    Object.fromEntries(state.storage));
  assert.equal(reloaded.window.LumniaSession.getToken(), "secret");
});

test("chat uses the game connection and displays only server acknowledgement", () => {
  const { window } = client("https://lumnia.test/easyrpg-player.html?server=wss%3A%2F%2Flumnia-server.onrender.com");
  const received = [];
  window.__LUMNIA_HUD__ = { chat: message => received.push(message) };
  assert.equal(window.LumniaChat.send("oi"), false);
  const socket = new window.WebSocket("wss://lumnia-server.onrender.com");
  assert.equal(window.LumniaChat.send("oi"), true);
  assert.deepEqual(socket.sent, [{ type: "chat", text: "oi" }]);
  assert.equal(received.length, 0);
  socket.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({type:"chat",author:"Arlen",text:"oi"}) }));
  assert.equal(received[0].author, "Arlen");
});

test("inventory and progression update canonical state without a URL token", () => {
  const { window } = client("https://lumnia.test/easyrpg-player.html");
  window.dispatchEvent(new CustomEvent("lumnia:inventory", { detail: {
    character: { name: "Arlen", level: 1 }, stats: { level: 1, total: {attack:5} }
  } }));
  window.dispatchEvent(new CustomEvent("lumnia:progression", { detail: {level:2,xp:112,gold:55} }));
  assert.equal(window.LumniaState.character.level, 2);
  assert.equal(window.LumniaState.character.name, "Arlen");
  assert.equal(window.LumniaState.character.gold, 55);
});

test("a URL cannot redirect a stored session token to a different server", () => {
  const { window } = client("https://lumnia.test/easyrpg-player.html?server=wss://attacker.test", {
    "lumnia-entry-session": JSON.stringify({ token: "secret", characterId: "hero" })
  });
  assert.equal(window.LumniaSession.getToken(), "");
  assert.equal(window.LumniaSession.serverUrl, "wss://lumnia-server.onrender.com");
});
