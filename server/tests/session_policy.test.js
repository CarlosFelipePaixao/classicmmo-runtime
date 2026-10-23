"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { readMessage, consumeRate, normalizeChat } = require("../src/session_policy");
const { progressionForCharacter, experienceForLevel } = require("../src/progression");
const { calculateCharacterStats } = require("../src/inventory_catalog");

test("rejects valid JSON that is not a protocol message", () => {
  for (const value of ["null", "[]", "1", '"position"', '{}', '{"type":"admin"}']) {
    assert.throws(() => readMessage(Buffer.from(value)));
  }
  assert.throws(() => readMessage(Buffer.from("x".repeat(8193))));
});

test("rate limits expire independently for each socket and action", () => {
  const socket = {};
  for (let i = 0; i < 3; i++) assert.equal(consumeRate(socket, "chat", 3, 5000, 10), true);
  assert.equal(consumeRate(socket, "chat", 3, 5000, 11), false);
  assert.equal(consumeRate({}, "chat", 3, 5000, 11), true);
  assert.equal(consumeRate(socket, "chat", 3, 5000, 5010), true);
});

test("chat rejects non-text and counts Unicode characters", () => {
  assert.equal(normalizeChat("  Olá\nSoltia  "), "Olá Soltia");
  assert.equal(normalizeChat("😀".repeat(180)).length, 360);
  assert.throws(() => normalizeChat("😀".repeat(181)));
  assert.throws(() => normalizeChat({ text: "oi" }));
});

test("progression handles thresholds, caps and existing characters", () => {
  assert.equal(progressionForCharacter({ xp: 99 }).level, 1);
  assert.equal(progressionForCharacter({ xp: 100 }).level, 2);
  assert.equal(progressionForCharacter({ xp: 400 }).level, 3);
  assert.equal(progressionForCharacter({ xp: 0, level: 7 }).level, 7);
  assert.equal(progressionForCharacter({ xp: 1e12 }).level, 99);
  assert.equal(experienceForLevel(2), 100);
});

test("level increases actual stats and equipment remains additive", () => {
  const level1 = calculateCharacterStats({ class_key: "mage", level: 1 }, []);
  const level10 = calculateCharacterStats({ class_key: "mage", level: 10 }, []);
  assert.ok(level10.total.maxMp > level1.total.maxMp);
  assert.ok(level10.total.attack > level1.total.attack);
  const equipped = calculateCharacterStats({ class_key: "mage", level: 10 }, [
    { container: "equipment", item_key: "wooden_sword", slot: 2 }
  ]);
  assert.equal(equipped.total.attack - level10.total.attack, 4);
});
