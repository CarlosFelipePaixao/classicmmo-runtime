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
      direction: "down"
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
    direction: "down"
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
  saveCharacterPositionById,
  loadStoryFlag,
  loadSpawnForCharacter,
  loadSpawnForNewCharacter
};
