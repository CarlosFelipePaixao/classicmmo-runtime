"use strict";

const MAX_LEVEL = 99;

// Total acumulado: nível 2 = 100 EXP; nível 3 = 400 EXP.
function experienceForLevel(level) {
  return 100 * (Math.max(1, Math.min(MAX_LEVEL, Math.trunc(level))) - 1) ** 2;
}

function progressionForCharacter(character = {}) {
  const xp = Math.max(0, Number(character.xp) || 0);
  // Preserva níveis existentes, inclusive personagens criados antes da curva.
  const level = Math.min(MAX_LEVEL, Math.max(1, Math.trunc(Number(character.level) || 1),
    Math.floor(Math.sqrt(xp / 100)) + 1));
  const floor = experienceForLevel(level);
  const next = level < MAX_LEVEL ? experienceForLevel(level + 1) : null;
  return {
    level, xp, gold: Math.max(0, Number(character.gold) || 0),
    xpToNextLevel: next === null ? 0 : Math.max(0, next - xp),
    nextLevelXp: next,
    progress: next === null ? 1 : Math.max(0, Math.min(1, (xp - floor) / (next - floor)))
  };
}

const GROWTH = Object.freeze({
  warrior: { attack: 2, defense: 2, maxHp: 12, maxMp: 3 },
  rogue: { attack: 3, defense: 1, maxHp: 8, maxMp: 4 },
  mage: { attack: 1, defense: 1, maxHp: 6, maxMp: 12 },
  healer: { attack: 1, defense: 2, maxHp: 9, maxMp: 10 }
});

module.exports = { MAX_LEVEL, experienceForLevel, progressionForCharacter, GROWTH };
