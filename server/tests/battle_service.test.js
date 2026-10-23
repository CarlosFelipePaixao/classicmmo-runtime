"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../src/battle_service.js"), "utf8");
const sessionId = "12345678-1234-4234-8234-123456789012";

function service(session) {
  let finishes = 0;
  const awarded = new Set();
  const client = {
    from: () => ({ select() { return this; }, eq() { return this; }, limit() { return this; },
      maybeSingle: async () => ({ data: session }) }),
    rpc: async (name, values) => {
      assert.equal(name, "finish_character_battle_with_loot");
      finishes++;
      session.status = "victory";
      session.result = "victory";
      session.experience_awarded = values.p_experience;
      session.gold_awarded = values.p_gold;
      session.loot_awarded = values.p_loot;
      return { data: [{ experience_awarded: 28, gold_awarded: 5, total_xp: 112,
        total_gold: 55, loot_awarded: values.p_loot, was_repeated: false }] };
    }
  };
  const module = { exports: {} };
  vm.runInNewContext(source, { module, console, require(name) {
    if (name === "./supabase_client") return {
      getSupabaseClient: () => client,
      grantCharacterBattleLoot: async (hero, id, loot) => {
        const repeated = awarded.has(id);
        awarded.add(id);
        return { alreadyGranted: repeated, items: loot,
          state: { items: [], stats: { level: hero.level } } };
      }
    };
    return require(path.join(__dirname, "../src", name));
  } });
  return { ...module.exports, finishes: () => finishes, awarded };
}

test("finish uses official totals for progression and returns the same stored loot on retry", async () => {
  const session = { status: "started", enemy_roster: [{ enemyId: 1, troopMemberId: 1, hidden: false }] };
  const api = service(session);
  const hero = { id: "hero", level: 1, xp: 84, gold: 50 };
  const payload = { sessionId, result: "victory", enemies: [{ enemyId: 1, troopMemberId: 1, defeated: true }] };
  const first = await api.finishCharacterBattle(hero, payload);
  assert.equal(first.progression.level, 2);
  assert.equal(first.inventory.stats.level, 2);
  const retry = await api.finishCharacterBattle({ ...hero, xp: 112, gold: 55 }, payload);
  assert.equal(retry.repeated, true);
  assert.equal(retry.lootAlreadyGranted, true);
  assert.equal(api.finishes(), 1);
  assert.equal(api.awarded.size, 1);
});

test("unknown session cannot award experience or loot", async () => {
  const api = service(null);
  await assert.rejects(() => api.finishCharacterBattle({id:"hero"}, {sessionId,result:"victory",enemies:[]}), /não encontrada/);
  assert.equal(api.finishes(), 0);
  assert.equal(api.awarded.size, 0);
});
