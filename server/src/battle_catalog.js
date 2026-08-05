"use strict";

const crypto = require("crypto");

const {
  getItemDefinition
} = require("./inventory_catalog");

const BATTLE_ENEMY_CATALOG = Object.freeze({
  /*
   * Inimigo 1 do RPG Maker usado no teste atual.
   *
   * O servidor controla EXP, ouro e loot.
   * Nesta primeira validação, cada Slime derrotado concede
   * exatamente 1 Gosma de Slime.
   */
  "1": Object.freeze({
    enemyId: 1,
    key: "slime",
    label: "Slime",
    experience: 28,
    gold: 5,
    loot: Object.freeze([
      Object.freeze({
        itemKey: "slime_gel",
        chanceBps: 10000,
        minQuantity: 1,
        maxQuantity: 1,
        container: "inventory"
      })
    ])
  })
});

const MAX_BATTLE_ENEMIES = 30;
const MAX_BATTLE_REWARD = 1000000;
const MAX_LOOT_QUANTITY = 999;

function normalizeBattleSource(value) {
  const source =
    String(value || "")
      .trim()
      .toLowerCase();

  if (
    source === "random" ||
    source === "event" ||
    source === "unknown"
  ) {
    return source;
  }

  return "unknown";
}

function normalizeBattleResult(value) {
  const result =
    String(value || "")
      .trim()
      .toLowerCase();

  if (
    result === "victory" ||
    result === "escape" ||
    result === "defeat" ||
    result === "abort"
  ) {
    return result;
  }

  return "";
}

function normalizeMapId(value) {
  const mapId =
    String(value || "")
      .trim();

  if (
    !mapId ||
    mapId.length > 40 ||
    !/^[a-zA-Z0-9._:-]+$/.test(mapId)
  ) {
    return "";
  }

  return mapId;
}

function normalizeTroopId(value) {
  const troopId =
    Number(value);

  if (
    !Number.isInteger(troopId) ||
    troopId < 0 ||
    troopId > 999999
  ) {
    return -1;
  }

  return troopId;
}

function normalizeEnemyEntry(entry) {
  const enemyId =
    Number(entry && entry.enemyId);

  const troopMemberId =
    Number(
      entry &&
      entry.troopMemberId
    );

  if (
    !Number.isInteger(enemyId) ||
    enemyId < 1 ||
    enemyId > 999999 ||
    !Number.isInteger(troopMemberId) ||
    troopMemberId < 0 ||
    troopMemberId > 999999
  ) {
    return null;
  }

  return {
    enemyId,
    troopMemberId,
    hidden:
      entry &&
      entry.hidden === true,
    defeated:
      entry &&
      entry.defeated === true
  };
}

function normalizeEnemyList(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  const unique =
    new Map();

  for (const rawEntry of value) {
    const entry =
      normalizeEnemyEntry(rawEntry);

    if (!entry) {
      continue;
    }

    if (
      unique.has(
        entry.troopMemberId
      )
    ) {
      continue;
    }

    unique.set(
      entry.troopMemberId,
      entry
    );

    if (
      unique.size >=
      MAX_BATTLE_ENEMIES
    ) {
      break;
    }
  }

  return Array.from(
    unique.values()
  );
}

function normalizeBattleStartPayload(payload) {
  const source =
    normalizeBattleSource(
      payload && payload.source
    );

  const mapId =
    normalizeMapId(
      payload && payload.mapId
    );

  const troopId =
    normalizeTroopId(
      payload && payload.troopId
    );

  const enemies =
    normalizeEnemyList(
      payload && payload.enemies
    ).map(
      (entry) => ({
        enemyId:
          entry.enemyId,
        troopMemberId:
          entry.troopMemberId,
        hidden:
          entry.hidden
      })
    );

  if (
    !mapId ||
    troopId < 0 ||
    enemies.length === 0
  ) {
    throw new Error(
      "Dados de início da batalha inválidos."
    );
  }

  return {
    source,
    mapId,
    troopId,
    enemies
  };
}

function normalizeBattleFinishPayload(payload) {
  const sessionId =
    String(
      payload &&
      payload.sessionId ||
      ""
    ).trim();

  const result =
    normalizeBattleResult(
      payload && payload.result
    );

  const enemies =
    normalizeEnemyList(
      payload && payload.enemies
    );

  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      sessionId
    ) ||
    !result
  ) {
    throw new Error(
      "Dados de finalização da batalha inválidos."
    );
  }

  return {
    sessionId,
    result,
    enemies
  };
}

function rollLootQuantity(entry) {
  const minimum =
    Math.max(
      1,
      Math.min(
        MAX_LOOT_QUANTITY,
        Math.round(
          Number(entry.minQuantity) || 1
        )
      )
    );

  const maximum =
    Math.max(
      minimum,
      Math.min(
        MAX_LOOT_QUANTITY,
        Math.round(
          Number(entry.maxQuantity) || minimum
        )
      )
    );

  if (minimum === maximum) {
    return minimum;
  }

  return crypto.randomInt(
    minimum,
    maximum + 1
  );
}

function rollEnemyLoot(definition) {
  const aggregated =
    new Map();

  for (
    const entry of
    Array.isArray(definition.loot)
      ? definition.loot
      : []
  ) {
    const item =
      getItemDefinition(
        entry.itemKey
      );

    if (!item) {
      throw new Error(
        `O item ${entry.itemKey} do loot não existe no catálogo.`
      );
    }

    const chanceBps =
      Math.max(
        0,
        Math.min(
          10000,
          Math.round(
            Number(entry.chanceBps) || 0
          )
        )
      );

    if (
      chanceBps === 0 ||
      crypto.randomInt(0, 10000) >=
        chanceBps
    ) {
      continue;
    }

    const container =
      entry.container === "potions"
        ? "potions"
        : "inventory";

    const key =
      `${item.key}:${container}`;

    const current =
      aggregated.get(key) || {
        itemKey: item.key,
        name: item.name,
        rarity: item.rarity,
        iconKey: item.iconKey,
        container,
        quantity: 0
      };

    current.quantity +=
      rollLootQuantity(entry);

    aggregated.set(
      key,
      current
    );
  }

  return Array.from(
    aggregated.values()
  );
}

function mergeLoot(target, entries) {
  for (const entry of entries) {
    const key =
      `${entry.itemKey}:${entry.container}`;

    const current =
      target.get(key) || {
        ...entry,
        quantity: 0
      };

    current.quantity =
      Math.min(
        MAX_LOOT_QUANTITY,
        current.quantity +
          Math.max(
            1,
            Number(entry.quantity) || 1
          )
      );

    target.set(
      key,
      current
    );
  }
}

function calculateBattleRewards({
  result,
  roster,
  reportedEnemies
}) {
  if (result !== "victory") {
    return {
      experience: 0,
      gold: 0,
      defeatedEnemies: [],
      loot: []
    };
  }

  const expectedByMember =
    new Map(
      normalizeEnemyList(roster)
        .map(
          (entry) => [
            entry.troopMemberId,
            entry
          ]
        )
    );

  const defeatedEnemies = [];
  const loot = new Map();
  let experience = 0;
  let gold = 0;

  for (
    const reported of
    normalizeEnemyList(
      reportedEnemies
    )
  ) {
    if (!reported.defeated) {
      continue;
    }

    const expected =
      expectedByMember.get(
        reported.troopMemberId
      );

    if (
      !expected ||
      expected.enemyId !==
        reported.enemyId
    ) {
      throw new Error(
        "A composição final da batalha não corresponde à sessão iniciada."
      );
    }

    const definition =
      BATTLE_ENEMY_CATALOG[
        String(reported.enemyId)
      ];

    if (!definition) {
      throw new Error(
        `Inimigo ${reported.enemyId} ainda não possui recompensa no catálogo do servidor.`
      );
    }

    experience +=
      Number(
        definition.experience
      ) || 0;

    gold +=
      Number(
        definition.gold
      ) || 0;

    mergeLoot(
      loot,
      rollEnemyLoot(definition)
    );

    defeatedEnemies.push({
      enemyId:
        reported.enemyId,
      troopMemberId:
        reported.troopMemberId
    });
  }

  return {
    experience:
      Math.max(
        0,
        Math.min(
          MAX_BATTLE_REWARD,
          Math.round(experience)
        )
      ),
    gold:
      Math.max(
        0,
        Math.min(
          MAX_BATTLE_REWARD,
          Math.round(gold)
        )
      ),
    defeatedEnemies,
    loot:
      Array.from(
        loot.values()
      )
  };
}

module.exports = {
  BATTLE_ENEMY_CATALOG,
  normalizeBattleStartPayload,
  normalizeBattleFinishPayload,
  calculateBattleRewards
};
