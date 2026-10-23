"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { validateEncounter } = require("../src/world_policy");
const { calculateBattleRewards } = require("../src/battle_catalog");

const character = { id: "hero" };
const player = { characterId: "hero", mapId: "1", x: 9, y: 20 };
const battle = { mapId: "1", source: "event", troopId: 1,
  enemies: [{ enemyId: 1, troopMemberId: 1, hidden: false }] };

test("server rejects a different map, forged roster and remote event", () => {
  assert.throws(() => validateEncounter(character, battle, null));
  assert.throws(() => validateEncounter(character, battle, { ...player, characterId: "other" }));
  assert.throws(() => validateEncounter(character, battle, { ...player, mapId: "2" }));
  assert.throws(() => validateEncounter(character, battle, { ...player, x: 80 }));
  assert.throws(() => validateEncounter(character, { ...battle, enemies: [...battle.enemies, ...battle.enemies] }, player));
  assert.throws(() => validateEncounter(character, { ...battle, enemies: [{ enemyId: 1, troopMemberId: 0 }] }, player));
});

test("real RM troop works for event and configured random encounters", () => {
  const valid = validateEncounter(character, battle, player);
  assert.equal(valid.enemies[0].troopMemberId, 1);
  assert.doesNotThrow(() => validateEncounter(character, { ...battle, source: "random" }, { ...player, x: 40 }));
  const reward = calculateBattleRewards({ result: "victory", roster: valid.enemies,
    reportedEnemies: valid.enemies.map(enemy => ({ ...enemy, defeated: true })) });
  assert.equal(reward.experience, 28);
  assert.equal(reward.gold, 5);
  assert.equal(reward.loot[0].quantity, 1);
});
