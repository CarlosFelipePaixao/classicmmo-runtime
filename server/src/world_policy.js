"use strict";
const world = require("./world_catalog.json");

function validateEncounter(character, battle, player) {
  if (!player || player.characterId !== character.id || String(player.mapId) !== String(battle.mapId)) {
    throw new Error("Entre no mapa com seu personagem antes de iniciar a batalha.");
  }
  const map = world.maps[String(battle.mapId)];
  const roster = world.troops[String(battle.troopId)];
  const randomAllowed = map?.randomTroops.includes(battle.troopId);
  const eventAllowed = map?.events.some(event => event.troopId === battle.troopId &&
    Math.abs(event.x - player.x) + Math.abs(event.y - player.y) <= 2);
  if (!roster || !(battle.source === "random" ? randomAllowed : eventAllowed)) {
    throw new Error("Esse encontro não está disponível neste local.");
  }
  if (battle.enemies.length !== roster.length || roster.some(expected =>
    !battle.enemies.some(actual => actual.enemyId === expected.enemyId &&
      actual.troopMemberId === expected.troopMemberId && actual.hidden === expected.hidden))) {
    throw new Error("Os inimigos não correspondem à tropa definida no servidor.");
  }
  return { ...battle, enemies: roster.map(enemy => ({ ...enemy })) };
}

module.exports = { validateEncounter };
