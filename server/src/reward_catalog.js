"use strict";

const REWARD_CATALOG = Object.freeze({
  "tutorial.slime_gel.sample": Object.freeze({
    key: "tutorial.slime_gel.sample",
    label: "Amostra de Gosma de Slime",
    message: "Você recebeu 1 Gosma de Slime.",
    oncePerCharacter: true,
    items: Object.freeze([
      Object.freeze({
        itemKey: "slime_gel",
        quantity: 1,
        container: "inventory"
      })
    ])
  }),

  /*
   * Drop repetível da Fase 2.
   *
   * O evento do RPG Maker controla quando a batalha foi vencida.
   * O servidor continua decidindo qual item e quantidade serão concedidos.
   */
  "drop.slime.basic": Object.freeze({
    key: "drop.slime.basic",
    label: "Drop de Slime",
    message: "Você recolheu 1 Gosma de Slime.",
    oncePerCharacter: false,
    items: Object.freeze([
      Object.freeze({
        itemKey: "slime_gel",
        quantity: 1,
        container: "inventory"
      })
    ])
  })
});

function getRewardDefinition(rewardKey) {
  return REWARD_CATALOG[
    String(rewardKey || "")
  ] || null;
}

module.exports = {
  REWARD_CATALOG,
  getRewardDefinition
};
