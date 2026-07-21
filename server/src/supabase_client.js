const { createClient } = require("@supabase/supabase-js");

let supabase = null;

function getSupabaseClient() {
  if (supabase) {
    return supabase;
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error("SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não configurado.");
  }

  supabase = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });

  return supabase;
}

async function loadAuthUserFromToken(authToken) {
  if (!authToken) {
    return null;
  }

  const client = getSupabaseClient();

  const { data, error } = await client.auth.getUser(authToken);

  if (error || !data || !data.user) {
    console.warn("[supabase] token inválido:", error ? error.message : "sem usuário");
    return null;
  }

  return data.user;
}

async function loadCharacterByName(name) {
  if (!name) {
    return null;
  }

  const client = getSupabaseClient();

  const { data, error } = await client
    .from("characters")
    .select("*")
    .eq("name", name)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn("[supabase] erro ao buscar personagem por nome:", error.message);
    return null;
  }

  return data || null;
}

async function loadFirstCharacterForUser(userId) {
  if (!userId) {
    return null;
  }

  const client = getSupabaseClient();

  const { data, error } = await client
    .from("characters")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn("[supabase] erro ao buscar primeiro personagem do usuário:", error.message);
    return null;
  }

  return data || null;
}

async function loadCharacterByIdForUser(characterId, userId) {
  if (!characterId || !userId) {
    return null;
  }

  const client = getSupabaseClient();

  const { data, error } = await client
    .from("characters")
    .select("*")
    .eq("id", characterId)
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn("[supabase] erro ao buscar personagem por id/user:", error.message);
    return null;
  }

  return data || null;
}

// LUMNIA_CHARACTER_PERSISTENCE
function clampInteger(value, minimum, maximum, fallback) {
  const number = Number(value);

  if (!Number.isInteger(number)) {
    return fallback;
  }

  return Math.max(minimum, Math.min(maximum, number));
}

function normalizeCharacterName(rawName, userId) {
  let name = String(rawName || "")
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}_ -]+/gu, "_")
    .replace(/\s+/g, " ")
    .trim();

  if (name.length < 3) {
    const suffix = String(userId || "")
      .replace(/-/g, "")
      .slice(0, 6);

    name = `Heroi_${suffix || "Novo"}`;
  }

  return Array.from(name).slice(0, 20).join("");
}

async function createCharacterForUser(userId, characterData = {}) {
  if (!userId) {
    throw new Error("Usuário ausente ao criar personagem.");
  }

  const existing = await loadFirstCharacterForUser(userId);

  if (existing) {
    return {
      character: existing,
      created: false
    };
  }

  const client = getSupabaseClient();

  const skin = clampInteger(characterData.skin, 1, 8, 1);
  const eyes = clampInteger(characterData.eyes, 1, 3, 1);
  const classId = clampInteger(characterData.classId, 1, 99, 1);
  const hair = clampInteger(characterData.hair, 1, 3, 1);
  const spriteIndex = clampInteger(characterData.spriteIndex, 0, 99, 0);

  const baseName = normalizeCharacterName(characterData.name, userId);
  const classKey = classId === 1 ? "mage" : "mage";

  const row = {
    user_id: userId,
    name: baseName,
    class_key: classKey,
    level: 1,
    xp: 0,
    gold: 50,
    current_map_id: "1",
    current_x: 7,
    current_y: 15,
    current_direction: "right",
    appearance: {
      skin,
      eyes,
      class: classId,
      hair
    },
    sprite_name: String(characterData.spriteName || ""),
    sprite_index: spriteIndex
  };

  let result = await client
    .from("characters")
    .insert(row)
    .select("*")
    .single();

  if (result.error && result.error.code === "23505") {
    const concurrentExisting = await loadFirstCharacterForUser(userId);

    if (concurrentExisting) {
      return {
        character: concurrentExisting,
        created: false
      };
    }

    const suffix = String(userId)
      .replace(/-/g, "")
      .slice(0, 5);

    row.name = `${baseName.slice(0, 14)}_${suffix}`;

    result = await client
      .from("characters")
      .insert(row)
      .select("*")
      .single();
  }

  if (result.error || !result.data) {
    throw new Error(
      result.error
        ? result.error.message
        : "Supabase não devolveu o personagem criado."
    );
  }

  console.log("[supabase] personagem criado:", {
    id: result.data.id,
    userId,
    name: result.data.name,
    classKey: result.data.class_key,
    appearance: result.data.appearance,
    spriteName: result.data.sprite_name,
    spriteIndex: result.data.sprite_index
  });

  return {
    character: result.data,
    created: true
  };
}

async function saveCharacterPositionById(characterId, position) {
  if (!characterId || !position) {
    return;
  }

  const client = getSupabaseClient();

  const { error } = await client
    .from("characters")
    .update({
      current_map_id: String(position.mapId),
      current_x: Number(position.x),
      current_y: Number(position.y),
      current_direction: String(position.direction || "down")
    })
    .eq("id", characterId);

  if (error) {
    console.warn("[supabase] erro ao salvar posição:", error.message);
    return;
  }

  console.log("[supabase] posição salva:", characterId, position.mapId, position.x, position.y);
}

async function loadStoryFlag(characterId, flagKey) {
  if (!characterId || !flagKey) {
    return null;
  }

  const client = getSupabaseClient();

  const { data, error } = await client
    .from("story_flags")
    .select("*")
    .eq("character_id", characterId)
    .eq("flag_key", flagKey)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn("[supabase] erro ao buscar story flag:", error.message);
    return null;
  }

  return data || null;
}

function isFlagTrue(flag) {
  if (!flag) {
    return false;
  }

  if (flag.value === true) {
    return true;
  }

  if (flag.value === "true") {
    return true;
  }

  if (flag.value && typeof flag.value === "object" && flag.value.value === true) {
    return true;
  }

  return false;
}

async function loadSpawnForCharacter(character) {
  if (!character || !character.id) {
    return loadSpawnForNewCharacter();
  }

  const tutorialFlag = await loadStoryFlag(character.id, "tutorial.completed");

  if (!isFlagTrue(tutorialFlag)) {
    return {
      spawnKey: "tutorial_start",
      reason: "first_access_or_tutorial_not_completed",
      mapId: "1",
      x: 7,
      y: 16,
      direction: "down",
      spriteName: String(character.sprite_name || ""),
      spriteIndex: Number.isInteger(character.sprite_index)
        ? character.sprite_index
        : 0
    };
  }

  const hubSpawns = [
    { x: 4, y: 8 },
    { x: 5, y: 8 },
    { x: 6, y: 8 },
    { x: 7, y: 8 },
    { x: 8, y: 8 },
    { x: 9, y: 8 }
  ];

  const indexSource = String(character.id || character.name || "0");
  const index = indexSource.charCodeAt(indexSource.length - 1) % hubSpawns.length;
  const point = hubSpawns[index];

  return {
    spawnKey: "social_hub",
    reason: "tutorial_completed",
    mapId: "2",
    x: point.x,
    y: point.y,
    direction: "down",
    spriteName: String(character.sprite_name || ""),
    spriteIndex: Number.isInteger(character.sprite_index)
      ? character.sprite_index
      : 0
  };
}

function loadSpawnForNewCharacter() {
  return {
    spawnKey: "character_creation_pending",
    reason: "authenticated_user_without_character",
    mapId: "3",
    x: 24,
    y: 14,
    direction: "down"
  };
}

module.exports = {
  getSupabaseClient,
  loadAuthUserFromToken,
  loadCharacterByName,
  loadFirstCharacterForUser,
  loadCharacterByIdForUser,
  createCharacterForUser,
  saveCharacterPositionById,
  loadStoryFlag,
  loadSpawnForCharacter,
  loadSpawnForNewCharacter
};
