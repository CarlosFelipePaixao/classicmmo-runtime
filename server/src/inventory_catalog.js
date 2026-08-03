const EQUIPMENT_SLOTS = Object.freeze({
  1: "helmet",
  2: "weapon",
  3: "armor",
  4: "shield",
  5: "ring",
  6: "boots",
  7: "ring"
});

const EQUIPMENT_SLOT_LABELS = Object.freeze({
  1: "Capacete",
  2: "Arma",
  3: "Armadura",
  4: "Escudo",
  5: "Anel esquerdo",
  6: "Botas",
  7: "Anel direito"
});

const CLASS_BASE_STATS = Object.freeze({
  warrior: Object.freeze({
    attack: 10,
    defense: 8,
    maxHp: 130,
    maxMp: 35
  }),

  rogue: Object.freeze({
    attack: 11,
    defense: 5,
    maxHp: 105,
    maxMp: 50
  }),

  mage: Object.freeze({
    attack: 5,
    defense: 4,
    maxHp: 90,
    maxMp: 110
  }),

  healer: Object.freeze({
    attack: 6,
    defense: 6,
    maxHp: 110,
    maxMp: 95
  })
});

const ITEM_CATALOG = Object.freeze({
  wooden_sword: Object.freeze({
    key: "wooden_sword",
    name: "Espada de Madeira",
    description:
      "Uma espada simples de treino. Leve, gasta e confiável.",
    category: "equipment",
    equipmentSlot: "weapon",
    rarity: "common",
    stackable: false,
    maximumStack: 1,
    iconKey: "wooden_sword",
    stats: Object.freeze({
      attack: 4,
      defense: 0,
      maxHp: 0,
      maxMp: 0
    })
  }),

  worn_tunic: Object.freeze({
    key: "worn_tunic",
    name: "Túnica Desgastada",
    description:
      "Tecido grosso usado por viajantes iniciantes.",
    category: "equipment",
    equipmentSlot: "armor",
    rarity: "common",
    stackable: false,
    maximumStack: 1,
    iconKey: "worn_tunic",
    stats: Object.freeze({
      attack: 0,
      defense: 3,
      maxHp: 10,
      maxMp: 0
    })
  }),

  forest_herb: Object.freeze({
    key: "forest_herb",
    name: "Erva da Floresta",
    description:
      "Ingrediente medicinal encontrado nas trilhas de Soltia.",
    category: "material",
    equipmentSlot: null,
    rarity: "common",
    stackable: true,
    maximumStack: 99,
    iconKey: "forest_herb",
    stats: Object.freeze({
      attack: 0,
      defense: 0,
      maxHp: 0,
      maxMp: 0
    })
  }),

  copper_ore: Object.freeze({
    key: "copper_ore",
    name: "Minério de Cobre",
    description:
      "Material bruto usado por ferreiros e artesãos.",
    category: "material",
    equipmentSlot: null,
    rarity: "common",
    stackable: true,
    maximumStack: 99,
    iconKey: "copper_ore",
    stats: Object.freeze({
      attack: 0,
      defense: 0,
      maxHp: 0,
      maxMp: 0
    })
  }),

  slime_gel: Object.freeze({
    key: "slime_gel",
    name: "Gosma de Slime",
    description:
      "Material viscoso deixado por slimes.",
    category: "material",
    equipmentSlot: null,
    rarity: "common",
    stackable: true,
    maximumStack: 99,
    iconKey: "slime_gel",
    stats: Object.freeze({
      attack: 0,
      defense: 0,
      maxHp: 0,
      maxMp: 0
    })
  }),

  minor_health_potion: Object.freeze({
    key: "minor_health_potion",
    name: "Poção Menor de Vida",
    description:
      "Recupera uma pequena quantidade de vida.",
    category: "potion",
    equipmentSlot: null,
    rarity: "common",
    stackable: true,
    maximumStack: 20,
    iconKey: "minor_health_potion",
    stats: Object.freeze({
      attack: 0,
      defense: 0,
      maxHp: 0,
      maxMp: 0
    })
  }),

  minor_mana_potion: Object.freeze({
    key: "minor_mana_potion",
    name: "Poção Menor de Mana",
    description:
      "Recupera uma pequena quantidade de mana.",
    category: "potion",
    equipmentSlot: null,
    rarity: "common",
    stackable: true,
    maximumStack: 20,
    iconKey: "minor_mana_potion",
    stats: Object.freeze({
      attack: 0,
      defense: 0,
      maxHp: 0,
      maxMp: 0
    })
  })
});

const STARTER_INVENTORY = Object.freeze([
  Object.freeze({
    container: "inventory",
    slot: 1,
    itemKey: "wooden_sword",
    quantity: 1
  }),

  Object.freeze({
    container: "inventory",
    slot: 2,
    itemKey: "worn_tunic",
    quantity: 1
  }),

  Object.freeze({
    container: "inventory",
    slot: 3,
    itemKey: "forest_herb",
    quantity: 4
  }),

  Object.freeze({
    container: "inventory",
    slot: 4,
    itemKey: "copper_ore",
    quantity: 3
  }),

  Object.freeze({
    container: "potions",
    slot: 1,
    itemKey: "minor_health_potion",
    quantity: 3
  }),

  Object.freeze({
    container: "potions",
    slot: 2,
    itemKey: "minor_mana_potion",
    quantity: 2
  })
]);

function getItemDefinition(itemKey) {
  return ITEM_CATALOG[
    String(itemKey || "")
  ] || null;
}

function getEquipmentSlotKey(slot) {
  return EQUIPMENT_SLOTS[
    Number(slot)
  ] || "";
}

function getEquipmentSlotLabel(slot) {
  return EQUIPMENT_SLOT_LABELS[
    Number(slot)
  ] || "Equipamento";
}

function canPlaceItemInSlot(
  itemKey,
  container,
  slot
) {
  const item =
    getItemDefinition(itemKey);

  if (!item) {
    return false;
  }

  if (container === "inventory") {
    return (
      Number.isInteger(Number(slot)) &&
      Number(slot) >= 1 &&
      Number(slot) <= 12
    );
  }

  if (container === "potions") {
    return (
      item.category === "potion" &&
      Number.isInteger(Number(slot)) &&
      Number(slot) >= 1 &&
      Number(slot) <= 6
    );
  }

  if (container === "equipment") {
    const targetSlot =
      getEquipmentSlotKey(slot);

    return (
      item.category === "equipment" &&
      Boolean(targetSlot) &&
      item.equipmentSlot === targetSlot
    );
  }

  return false;
}

function serializeInventoryRows(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => {
      const definition =
        getItemDefinition(row.item_key);

      if (!definition) {
        return null;
      }

      return {
        id: row.id,
        container: row.container,
        slot: Number(row.slot),
        itemKey: definition.key,
        quantity:
          Number(row.quantity) || 1,
        item: {
          ...definition,
          stats: {
            ...definition.stats
          }
        }
      };
    })
    .filter(Boolean)
    .sort((left, right) => {
      if (
        left.container !==
        right.container
      ) {
        return left.container.localeCompare(
          right.container
        );
      }

      return left.slot - right.slot;
    });
}

function normalizeStatValue(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return 0;
  }

  return Math.max(
    0,
    Math.round(number)
  );
}

function getBaseStatsForCharacter(
  character = {}
) {
  const classKey =
    String(
      character.class_key ||
      "warrior"
    );

  const base =
    CLASS_BASE_STATS[classKey] ||
    CLASS_BASE_STATS.warrior;

  return {
    attack: base.attack,
    defense: base.defense,
    maxHp: base.maxHp,
    maxMp: base.maxMp
  };
}

function calculateCharacterStats(
  character,
  rows
) {
  const base =
    getBaseStatsForCharacter(
      character
    );

  const equipmentBonus = {
    attack: 0,
    defense: 0,
    maxHp: 0,
    maxMp: 0
  };

  for (
    const row of
    Array.isArray(rows)
      ? rows
      : []
  ) {
    if (
      row.container !==
      "equipment"
    ) {
      continue;
    }

    const item =
      getItemDefinition(
        row.item_key
      );

    if (!item) {
      continue;
    }

    for (
      const key of [
        "attack",
        "defense",
        "maxHp",
        "maxMp"
      ]
    ) {
      equipmentBonus[key] +=
        normalizeStatValue(
          item.stats &&
          item.stats[key]
        );
    }
  }

  const total = {
    attack:
      base.attack +
      equipmentBonus.attack,

    defense:
      base.defense +
      equipmentBonus.defense,

    maxHp:
      base.maxHp +
      equipmentBonus.maxHp,

    maxMp:
      base.maxMp +
      equipmentBonus.maxMp
  };

  const level =
    Math.max(
      1,
      Number(character.level) || 1
    );

  total.combatPower =
    Math.round(
      level * 10 +
      total.attack * 3 +
      total.defense * 3 +
      total.maxHp / 5 +
      total.maxMp / 5
    );

  return {
    level,
    base,
    equipmentBonus,
    total
  };
}

module.exports = {
  EQUIPMENT_SLOTS,
  EQUIPMENT_SLOT_LABELS,
  ITEM_CATALOG,
  STARTER_INVENTORY,
  getItemDefinition,
  getEquipmentSlotKey,
  getEquipmentSlotLabel,
  canPlaceItemInSlot,
  serializeInventoryRows,
  calculateCharacterStats
};
