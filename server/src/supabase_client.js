const { createClient } = require("@supabase/supabase-js");
const { resolveAppearanceSprite, resolveCharacterSprite } = require("./appearance_sprite");
const {
  STARTER_INVENTORY,
  getItemDefinition,
  canPlaceItemInSlot,
  serializeInventoryRows,
  calculateCharacterStats
} = require("./inventory_catalog");
const {
  getRewardDefinition
} = require("./reward_catalog");

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

function normalizeChoice(value, allowed, fallback) {
  const normalized = String(value || "").trim();

  if (allowed.includes(normalized)) {
    return normalized;
  }

  return fallback;
}

function normalizeLegacyClass(value) {
  const numeric = Number(value);
  const legacyMap = {
    1: "mage",
    2: "warrior",
    3: "rogue",
    4: "healer"
  };

  return legacyMap[numeric] || "mage";
}

function normalizeLegacySkin(value) {
  const number = clampInteger(value, 1, 5, 1);
  return `skin-${String(number).padStart(2, "0")}`;
}

function normalizeLegacyEyes(value) {
  const legacyMap = {
    1: "eyes-blue",
    2: "eyes-brown",
    3: "eyes-green"
  };

  return legacyMap[Number(value)] || "eyes-blue";
}

function normalizeLegacyHair(value) {
  const legacyMap = {
    1: "hair-01",
    2: "hair-02",
    3: "none"
  };

  return legacyMap[Number(value)] || "hair-01";
}

function normalizeAppearance(characterData = {}) {
  const classChoices = [
    "warrior",
    "rogue",
    "mage",
    "healer"
  ];

  const genderChoices = [
    "male",
    "female"
  ];

  const skinChoices = [
    "skin-01",
    "skin-02",
    "skin-03",
    "skin-04",
    "skin-05"
  ];

  const eyeChoices = [
    "eyes-blue",
    "eyes-brown",
    "eyes-green"
  ];

  const hairColorChoices = [
    "hair-black",
    "hair-brown",
    "hair-blonde",
    "hair-red",
    "hair-purple"
  ];

  const maleHairChoices = [
    "none",
    "hair-01",
    "hair-02",
    "male-03",
    "male-04",
    "male-05",
    "male-06",
    "male-07",
    "male-08"
  ];

  const femaleHairChoices = [
    "none",
    "female-01",
    "female-02",
    "female-03",
    "female-04",
    "female-05",
    "female-06",
    "female-07",
    "female-08"
  ];

  const isLegacy =
    Number.isInteger(Number(characterData.classId)) &&
    !String(characterData.classId).includes("-");

  const classId = isLegacy
    ? normalizeLegacyClass(characterData.classId)
    : normalizeChoice(
        characterData.classId,
        classChoices,
        "mage"
      );

  const gender = normalizeChoice(
    characterData.gender,
    genderChoices,
    "male"
  );

  const skin = isLegacy
    ? normalizeLegacySkin(characterData.skin)
    : normalizeChoice(
        characterData.skin,
        skinChoices,
        "skin-01"
      );

  const eyes = isLegacy
    ? normalizeLegacyEyes(characterData.eyes)
    : normalizeChoice(
        characterData.eyes,
        eyeChoices,
        "eyes-blue"
      );

  const allowedHair =
    gender === "female"
      ? femaleHairChoices
      : maleHairChoices;

  const hair = isLegacy
    ? normalizeLegacyHair(characterData.hair)
    : normalizeChoice(
        characterData.hair,
        allowedHair,
        "none"
      );

  const hairColor = normalizeChoice(
    characterData.hairColor,
    hairColorChoices,
    "hair-brown"
  );

  return {
    schemaVersion: 2,
    gender,
    classId,
    skin,
    eyes,
    hair,
    hairColor
  };
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
  const appearance = normalizeAppearance(characterData);
  const resolvedSprite = resolveAppearanceSprite(appearance);
  const spriteIndex = clampInteger(
    characterData.spriteIndex,
    0,
    99,
    0
  );

  const baseName = normalizeCharacterName(
    characterData.name,
    userId
  );

  const row = {
    user_id: userId,
    name: baseName,
    class_key: appearance.classId,
    level: 1,
    xp: 0,
    gold: 50,
    current_map_id: "1",
    current_x: 7,
    current_y: 15,
    current_direction: "right",
    appearance,
    sprite_name: resolvedSprite.spriteName,
    sprite_index: resolvedSprite.spriteIndex
  };

  let result = await client
    .from("characters")
    .insert(row)
    .select("*")
    .single();

  if (
    result.error &&
    result.error.code === "23505"
  ) {
    const concurrentExisting =
      await loadFirstCharacterForUser(userId);

    if (concurrentExisting) {
      return {
        character: concurrentExisting,
        created: false
      };
    }

    const suffix = String(userId)
      .replace(/-/g, "")
      .slice(0, 5);

    row.name =
      `${baseName.slice(0, 14)}_${suffix}`;

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

async function loadLevelRankings(limit = 50) {
  const client = getSupabaseClient();
  const safeLimit = clampInteger(
    limit,
    1,
    100,
    50
  );

  const { data, error } = await client
    .from("characters")
    .select(
      "id,name,class_key,level,sprite_name,sprite_index"
    )
    .order("level", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(safeLimit);

  if (error) {
    throw new Error(
      `Não foi possível carregar o ranking: ${error.message}`
    );
  }

  return Array.isArray(data) ? data : [];
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

    const resolvedSprite = resolveCharacterSprite(character);

const tutorialFlag = await loadStoryFlag(character.id, "tutorial.completed");

  if (!isFlagTrue(tutorialFlag)) {
    return {
      spawnKey: "tutorial_start",
      reason: "first_access_or_tutorial_not_completed",
      mapId: "1",
      x: 7,
      y: 16,
      direction: "down",
      spriteName: resolvedSprite.spriteName,
      spriteIndex: resolvedSprite.spriteIndex
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
    spriteName: resolvedSprite.spriteName,
      spriteIndex: resolvedSprite.spriteIndex
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


async function queryCharacterInventoryRows(characterId) {
  const client = getSupabaseClient();

  const { data, error } = await client
    .from("character_inventory")
    .select(
      "id,character_id,container,slot,item_key,quantity,created_at,updated_at"
    )
    .eq("character_id", characterId)
    .neq("slot", 0)
    .order("container", {
      ascending: true
    })
    .order("slot", {
      ascending: true
    });

  if (error) {
    const message = String(
      error.message || ""
    );

    if (
      message.includes(
        "character_inventory"
      )
    ) {
      throw new Error(
        "A migração do inventário ainda não foi executada no Supabase."
      );
    }

    throw new Error(
      `Não foi possível carregar o inventário: ${message}`
    );
  }

  return Array.isArray(data)
    ? data
    : [];
}

async function ensureStarterInventory(characterId) {
  let rows =
    await queryCharacterInventoryRows(
      characterId
    );

  if (rows.length > 0) {
    return rows;
  }

  const client = getSupabaseClient();

  const starterRows =
    STARTER_INVENTORY.map(
      (entry) => ({
        character_id: characterId,
        container: entry.container,
        slot: entry.slot,
        item_key: entry.itemKey,
        quantity: entry.quantity
      })
    );

  const { error } = await client
    .from("character_inventory")
    .upsert(
      starterRows,
      {
        onConflict:
          "character_id,container,slot",
        ignoreDuplicates: true
      }
    );

  if (error) {
    throw new Error(
      `Não foi possível criar o inventário inicial: ${error.message}`
    );
  }

  rows =
    await queryCharacterInventoryRows(
      characterId
    );

  return rows;
}

async function saveCharacterStats(
  characterId,
  stats
) {
  const client = getSupabaseClient();

  const { error } = await client
    .from("character_stats")
    .upsert(
      {
        character_id: characterId,
        level: stats.level,
        base_attack:
          stats.base.attack,
        base_defense:
          stats.base.defense,
        base_max_hp:
          stats.base.maxHp,
        base_max_mp:
          stats.base.maxMp,
        equipment_attack:
          stats.equipmentBonus.attack,
        equipment_defense:
          stats.equipmentBonus.defense,
        equipment_max_hp:
          stats.equipmentBonus.maxHp,
        equipment_max_mp:
          stats.equipmentBonus.maxMp,
        attack_power:
          stats.total.attack,
        defense_power:
          stats.total.defense,
        max_hp:
          stats.total.maxHp,
        max_mp:
          stats.total.maxMp,
        combat_power:
          stats.total.combatPower,
        updated_at:
          new Date().toISOString()
      },
      {
        onConflict:
          "character_id"
      }
    );

  if (error) {
    const message = String(
      error.message || ""
    );

    if (
      message.includes(
        "character_stats"
      )
    ) {
      throw new Error(
        "A migração dos equipamentos ainda não foi executada no Supabase."
      );
    }

    throw new Error(
      `Não foi possível salvar os atributos: ${message}`
    );
  }
}

async function loadCharacterInventory(
  characterId
) {
  if (!characterId) {
    return [];
  }

  const rows =
    await ensureStarterInventory(
      characterId
    );

  return serializeInventoryRows(rows);
}

async function loadCharacterInventoryState(
  character
) {
  if (!character || !character.id) {
    return {
      items: [],
      stats:
        calculateCharacterStats(
          character || {},
          []
        )
    };
  }

  const rows =
    await ensureStarterInventory(
      character.id
    );

  const stats =
    calculateCharacterStats(
      character,
      rows
    );

  await saveCharacterStats(
    character.id,
    stats
  );

  return {
    items:
      serializeInventoryRows(rows),
    stats
  };
}

async function loadCharacterInventorySlot(
  characterId,
  container,
  slot
) {
  const client = getSupabaseClient();

  const { data, error } = await client
    .from("character_inventory")
    .select(
      "id,character_id,container,slot,item_key,quantity"
    )
    .eq("character_id", characterId)
    .eq("container", container)
    .eq("slot", slot)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Não foi possível consultar o slot: ${error.message}`
    );
  }

  return data || null;
}

function normalizeInventoryContainer(value) {
  const container =
    String(value || "").trim();

  if (
    container === "inventory" ||
    container === "potions" ||
    container === "equipment"
  ) {
    return container;
  }

  return "";
}

function normalizeInventorySlot(
  container,
  value
) {
  const slot = Number(value);

  if (!Number.isInteger(slot)) {
    return 0;
  }

  const maximumByContainer = {
    inventory: 12,
    potions: 6,
    equipment: 7
  };

  const maximum =
    maximumByContainer[container] ||
    0;

  if (
    slot < 1 ||
    slot > maximum
  ) {
    return 0;
  }

  return slot;
}

async function moveCharacterInventoryItem(
  character,
  move
) {
  const characterId =
    character && character.id;

  const fromContainer =
    normalizeInventoryContainer(
      move && move.fromContainer
    );

  const toContainer =
    normalizeInventoryContainer(
      move && move.toContainer
    );

  const fromSlot =
    normalizeInventorySlot(
      fromContainer,
      move && move.fromSlot
    );

  const toSlot =
    normalizeInventorySlot(
      toContainer,
      move && move.toSlot
    );

  if (
    !characterId ||
    !fromContainer ||
    !toContainer ||
    !fromSlot ||
    !toSlot
  ) {
    throw new Error(
      "Movimento de inventário inválido."
    );
  }

  if (
    fromContainer === toContainer &&
    fromSlot === toSlot
  ) {
    return loadCharacterInventoryState(
      character
    );
  }

  const source =
    await loadCharacterInventorySlot(
      characterId,
      fromContainer,
      fromSlot
    );

  if (!source) {
    throw new Error(
      "O item de origem não existe."
    );
  }

  const sourceDefinition =
    getItemDefinition(
      source.item_key
    );

  if (
    !sourceDefinition ||
    !canPlaceItemInSlot(
      source.item_key,
      toContainer,
      toSlot
    )
  ) {
    throw new Error(
      "Esse item não é compatível com o slot escolhido."
    );
  }

  const target =
    await loadCharacterInventorySlot(
      characterId,
      toContainer,
      toSlot
    );

  if (
    target &&
    !canPlaceItemInSlot(
      target.item_key,
      fromContainer,
      fromSlot
    )
  ) {
    throw new Error(
      "Os itens desses slots não podem ser trocados."
    );
  }

  const client = getSupabaseClient();

  const { error } = await client.rpc(
    "move_character_inventory_item",
    {
      p_character_id: characterId,
      p_from_container: fromContainer,
      p_from_slot: fromSlot,
      p_to_container: toContainer,
      p_to_slot: toSlot
    }
  );

  if (error) {
    const databaseMessage =
      String(
        error.message || ""
      );

    console.error(
      "[Inventory] Falha ao mover item:",
      error
    );

    if (
      databaseMessage.includes(
        "character_inventory_check"
      ) ||
      databaseMessage.includes(
        "violates check constraint"
      )
    ) {
      throw new Error(
        "O banco ainda está com a regra antiga do inventário. Execute a migração SQL 003."
      );
    }

    throw new Error(
      "Não foi possível salvar a alteração do inventário."
    );
  }

  return loadCharacterInventoryState(
    character
  );
}


function normalizeRewardKey(value) {
  const rewardKey =
    String(value || "").trim();

  if (
    !/^[a-z0-9][a-z0-9._:-]{0,79}$/.test(
      rewardKey
    )
  ) {
    return "";
  }

  return rewardKey;
}

async function claimCharacterReward(
  character,
  rewardKeyValue
) {
  if (!character || !character.id) {
    throw new Error(
      "Personagem ausente ao conceder recompensa."
    );
  }

  const rewardKey =
    normalizeRewardKey(
      rewardKeyValue
    );

  const reward =
    getRewardDefinition(
      rewardKey
    );

  if (!reward) {
    throw new Error(
      "Recompensa online desconhecida."
    );
  }

  const items = reward.items.map(
    (entry) => {
      const definition =
        getItemDefinition(
          entry.itemKey
        );

      if (!definition) {
        throw new Error(
          `O item ${entry.itemKey} não existe no catálogo.`
        );
      }

      const quantity =
        Math.max(
          1,
          Math.min(
            999,
            Math.round(
              Number(entry.quantity) || 1
            )
          )
        );

      return {
        itemKey: definition.key,
        quantity,
        maximumStack:
          Math.max(
            1,
            Math.min(
              999,
              Number(
                definition.maximumStack
              ) || 1
            )
          ),
        container:
          entry.container === "potions"
            ? "potions"
            : "inventory"
      };
    }
  );

  const client = getSupabaseClient();

  const { error } = await client.rpc(
    "claim_character_reward",
    {
      p_character_id:
        character.id,
      p_reward_key:
        reward.key,
      p_once_per_character:
        reward.oncePerCharacter === true,
      p_items:
        items
    }
  );

  if (error) {
    const message =
      String(error.message || "");

    if (
      message.includes(
        "reward already claimed"
      )
    ) {
      throw new Error(
        "Essa recompensa já foi recebida por este personagem."
      );
    }

    if (
      message.includes(
        "inventory is full"
      )
    ) {
      throw new Error(
        "A mochila está cheia. Libere um slot antes de receber a recompensa."
      );
    }

    if (
      message.includes(
        "claim_character_reward"
      ) ||
      message.includes(
        "function public.claim_character_reward"
      )
    ) {
      throw new Error(
        "A migração SQL 004 das recompensas ainda não foi executada."
      );
    }

    console.error(
      "[Rewards] Falha ao conceder recompensa:",
      error
    );

    throw new Error(
      "Não foi possível salvar a recompensa."
    );
  }

  const state =
    await loadCharacterInventoryState(
      character
    );

  return {
    reward: {
      key: reward.key,
      label: reward.label,
      message: reward.message,
      items: items.map(
        (entry) => {
          const definition =
            getItemDefinition(
              entry.itemKey
            );

          return {
            itemKey: entry.itemKey,
            name:
              definition
                ? definition.name
                : entry.itemKey,
            quantity: entry.quantity
          };
        }
      )
    },
    state
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
  loadLevelRankings,
  loadStoryFlag,
  loadSpawnForCharacter,
  loadSpawnForNewCharacter,
  loadCharacterInventory,
  loadCharacterInventoryState,
  moveCharacterInventoryItem,
  claimCharacterReward
};
