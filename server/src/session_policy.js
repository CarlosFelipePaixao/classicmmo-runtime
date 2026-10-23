"use strict";

function readMessage(raw) {
  if (Buffer.byteLength(raw) > 8192) throw new Error("Mensagem excede 8 KB.");
  const value = JSON.parse(raw.toString());
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      !["position", "chat"].includes(value.type)) {
    throw new Error("Tipo de mensagem inválido.");
  }
  return value;
}

function consumeRate(socket, key, limit, windowMs, now = Date.now()) {
  socket.rates ||= new Map();
  let bucket = socket.rates.get(key);
  if (!bucket || now - bucket.started >= windowMs) {
    bucket = { started: now, count: 0 };
    socket.rates.set(key, bucket);
  }
  return ++bucket.count <= limit;
}

function normalizeChat(value) {
  if (typeof value !== "string") throw new Error("Mensagem de chat inválida.");
  const text = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  if (!text || Array.from(text).length > 180) {
    throw new Error("Use entre 1 e 180 caracteres.");
  }
  return text;
}

function sessionExpiresAt(token, now = Date.now()) {
  try {
    const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
    if (Number.isFinite(claims.exp)) return claims.exp * 1000;
  } catch (_) {}
  return now + 60 * 60 * 1000;
}

module.exports = { readMessage, consumeRate, normalizeChat, sessionExpiresAt };
