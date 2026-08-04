"use strict";

const {
  getSupabaseClient
} = require("./supabase_client");

const {
  normalizeBattleStartPayload,
  normalizeBattleFinishPayload,
  calculateBattleRewards
} = require("./battle_catalog");

async function startCharacterBattle(
  character,
  payload
) {
  if (
    !character ||
    !character.id
  ) {
    throw new Error(
      "Personagem ausente ao iniciar batalha."
    );
  }

  const battle =
    normalizeBattleStartPayload(
      payload
    );

  const client =
    getSupabaseClient();

  const {
    data,
    error
  } = await client.rpc(
    "start_character_battle",
    {
      p_character_id:
        character.id,
      p_source:
        battle.source,
      p_map_id:
        battle.mapId,
      p_troop_id:
        battle.troopId,
      p_enemy_roster:
        battle.enemies
    }
  );

  if (error) {
    const message =
      String(
        error.message || ""
      );

    if (
      message.includes(
        "battle already active"
      )
    ) {
      throw new Error(
        "Já existe uma batalha ativa para este personagem."
      );
    }

    if (
      message.includes(
        "start_character_battle"
      )
    ) {
      throw new Error(
        "A migração SQL 005 das batalhas ainda não foi executada."
      );
    }

    console.error(
      "[Battle] Falha ao iniciar sessão:",
      error
    );

    throw new Error(
      "Não foi possível iniciar a sessão da batalha."
    );
  }

  const sessionId =
    Array.isArray(data)
      ? data[0]
      : data;

  if (!sessionId) {
    throw new Error(
      "O servidor não retornou o identificador da batalha."
    );
  }

  return {
    sessionId:
      String(sessionId),
    source:
      battle.source,
    mapId:
      battle.mapId,
    troopId:
      battle.troopId
  };
}

async function loadBattleSession(
  characterId,
  sessionId
) {
  const client =
    getSupabaseClient();

  const {
    data,
    error
  } = await client
    .from(
      "character_battle_sessions"
    )
    .select(
      "id,character_id,status,result,enemy_roster,experience_awarded,gold_awarded,started_at,finished_at"
    )
    .eq(
      "id",
      sessionId
    )
    .eq(
      "character_id",
      characterId
    )
    .limit(1)
    .maybeSingle();

  if (error) {
    const message =
      String(
        error.message || ""
      );

    if (
      message.includes(
        "character_battle_sessions"
      )
    ) {
      throw new Error(
        "A migração SQL 005 das batalhas ainda não foi executada."
      );
    }

    throw new Error(
      "Não foi possível consultar a sessão da batalha."
    );
  }

  return data || null;
}

async function finishCharacterBattle(
  character,
  payload
) {
  if (
    !character ||
    !character.id
  ) {
    throw new Error(
      "Personagem ausente ao finalizar batalha."
    );
  }

  const battle =
    normalizeBattleFinishPayload(
      payload
    );

  const session =
    await loadBattleSession(
      character.id,
      battle.sessionId
    );

  if (!session) {
    throw new Error(
      "Sessão de batalha não encontrada."
    );
  }

  if (
    session.status !==
    "started"
  ) {
    return {
      repeated: true,
      sessionId:
        session.id,
      result:
        session.result,
      experience:
        Number(
          session.experience_awarded
        ) || 0,
      gold:
        Number(
          session.gold_awarded
        ) || 0
    };
  }

  const rewards =
    calculateBattleRewards({
      result:
        battle.result,
      roster:
        session.enemy_roster,
      reportedEnemies:
        battle.enemies
    });

  const client =
    getSupabaseClient();

  const {
    data,
    error
  } = await client.rpc(
    "finish_character_battle",
    {
      p_character_id:
        character.id,
      p_session_id:
        battle.sessionId,
      p_result:
        battle.result,
      p_defeated_enemies:
        rewards.defeatedEnemies,
      p_experience:
        rewards.experience,
      p_gold:
        rewards.gold
    }
  );

  if (error) {
    const message =
      String(
        error.message || ""
      );

    if (
      message.includes(
        "battle session expired"
      )
    ) {
      throw new Error(
        "A sessão da batalha expirou."
      );
    }

    if (
      message.includes(
        "finish_character_battle"
      )
    ) {
      throw new Error(
        "A migração SQL 005 das batalhas ainda não foi executada."
      );
    }

    console.error(
      "[Battle] Falha ao finalizar sessão:",
      error
    );

    throw new Error(
      "Não foi possível finalizar a sessão da batalha."
    );
  }

  const row =
    Array.isArray(data)
      ? data[0]
      : data;

  if (!row) {
    throw new Error(
      "O servidor não retornou a recompensa da batalha."
    );
  }

  return {
    repeated: false,
    sessionId:
      String(
        row.session_id ||
        battle.sessionId
      ),
    result:
      battle.result,
    experience:
      Number(
        row.experience_awarded
      ) || 0,
    gold:
      Number(
        row.gold_awarded
      ) || 0,
    totalXp:
      Number(
        row.total_xp
      ) || 0,
    totalGold:
      Number(
        row.total_gold
      ) || 0
  };
}

module.exports = {
  startCharacterBattle,
  finishCharacterBattle
};
