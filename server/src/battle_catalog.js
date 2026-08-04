"use strict";

const BATTLE_ENEMY_CATALOG = Object.freeze({
  /*
   * Inimigo 1 do RPG Maker usado no teste atual.
   *
   * O servidor, e não o cliente, controla EXP e ouro.
   * Quando o valor mudar no RPG Maker, atualize também este catálogo.
   */
  "1": Object.freeze({
    enemyId: 1,
    key: "slime",
    label: "Slime",
    experience: 28,
    gold: 5
  })
});

const MAX_BATTLE_ENEMIES = 30;
const MAX_BATTLE_REWARD = 1000000;

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

function calculateBattleRewards({
  result,
  roster,
  reportedEnemies
}) {
  if (result !== "victory") {
    return {
      experience: 0,
      gold: 0,
      defeatedEnemies: []
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
    defeatedEnemies
  };
}

module.exports = {
  BATTLE_ENEMY_CATALOG,
  normalizeBattleStartPayload,
  normalizeBattleFinishPayload,
  calculateBattleRewards
};
