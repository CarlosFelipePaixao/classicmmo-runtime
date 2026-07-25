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
    iconKey: "wooden_sword"
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
    iconKey: "worn_tunic"
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
    iconKey: "forest_herb"
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
    iconKey: "copper_ore"
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
    iconKey: "minor_health_potion"
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
    iconKey: "minor_mana_potion"
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
  return ITEM_CATALOG[String(itemKey || "")] || null;
}

function canPlaceItemInContainer(itemKey, container) {
  const item = getItemDefinition(itemKey);

  if (!item) {
    return false;
  }

  if (container === "inventory") {
    return true;
  }

  if (container === "potions") {
    return item.category === "potion";
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
        quantity: Number(row.quantity) || 1,
        item: {
          ...definition
        }
      };
    })
    .filter(Boolean)
    .sort((left, right) => {
      if (left.container !== right.container) {
        return left.container.localeCompare(
          right.container
        );
      }

      return left.slot - right.slot;
    });
}

module.exports = {
  ITEM_CATALOG,
  STARTER_INVENTORY,
  getItemDefinition,
  canPlaceItemInContainer,
  serializeInventoryRows
};
