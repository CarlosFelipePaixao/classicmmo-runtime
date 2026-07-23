"use strict";

const GENDERS = ["male", "female"];
const CLASSES = ["warrior", "rogue", "mage", "healer"];
const SKINS = ["skin-01", "skin-02", "skin-03", "skin-04", "skin-05"];
const EYES = ["eyes-blue", "eyes-brown", "eyes-green"];
const HAIR_COLORS = [
  "hair-black",
  "hair-brown",
  "hair-blonde",
  "hair-red",
  "hair-purple"
];

const HAIRS_BY_GENDER = {
  male: [
    "hair-01",
    "hair-02",
    "male-03",
    "male-04",
    "male-05",
    "male-06",
    "male-07",
    "male-08"
  ],
  female: [
    "female-01",
    "female-02",
    "female-03",
    "female-04",
    "female-05",
    "female-06",
    "female-07",
    "female-08"
  ]
};

const HAIR_VARIANTS_PER_FACE =
  1 + HAIRS_BY_GENDER.male.length * HAIR_COLORS.length;

const VARIANTS_PER_SKIN =
  EYES.length * HAIR_VARIANTS_PER_FACE;

const VARIANTS_PER_CLASS =
  SKINS.length * VARIANTS_PER_SKIN;

const VARIANTS_PER_GENDER =
  CLASSES.length * VARIANTS_PER_CLASS;

const ATLAS_PREFIX = "LumniaCC";
const SLOTS_PER_ATLAS = 8;

function safeIndex(values, value, fallbackIndex = 0) {
  const index = values.indexOf(String(value || ""));
  return index >= 0 ? index : fallbackIndex;
}

function normalizeAppearanceForSprite(appearance = {}) {
  const genderIndex = safeIndex(GENDERS, appearance.gender, 0);
  const gender = GENDERS[genderIndex];

  const classIndex = safeIndex(CLASSES, appearance.classId, 2);
  const skinIndex = safeIndex(SKINS, appearance.skin, 0);
  const eyesIndex = safeIndex(EYES, appearance.eyes, 0);

  const hairChoices = HAIRS_BY_GENDER[gender];
  const rawHair = String(appearance.hair || "none");
  const hair = rawHair === "none" || hairChoices.includes(rawHair)
    ? rawHair
    : "none";

  const hairColorIndex = safeIndex(
    HAIR_COLORS,
    appearance.hairColor,
    1
  );

  const hairColor = HAIR_COLORS[hairColorIndex];

  return {
    gender,
    genderIndex,
    classId: CLASSES[classIndex],
    classIndex,
    skin: SKINS[skinIndex],
    skinIndex,
    eyes: EYES[eyesIndex],
    eyesIndex,
    hair,
    hairColor,
    hairColorIndex
  };
}

function resolveAppearanceSprite(appearance = {}) {
  const normalized = normalizeAppearanceForSprite(appearance);
  const hairChoices = HAIRS_BY_GENDER[normalized.gender];

  let hairVariantIndex = 0;

  if (normalized.hair !== "none") {
    const hairIndex = hairChoices.indexOf(normalized.hair);

    hairVariantIndex =
      1 +
      hairIndex * HAIR_COLORS.length +
      normalized.hairColorIndex;
  }

  const variantIndex =
    normalized.genderIndex * VARIANTS_PER_GENDER +
    normalized.classIndex * VARIANTS_PER_CLASS +
    normalized.skinIndex * VARIANTS_PER_SKIN +
    normalized.eyesIndex * HAIR_VARIANTS_PER_FACE +
    hairVariantIndex;

  const atlasIndex = Math.floor(
    variantIndex / SLOTS_PER_ATLAS
  );

  return {
    spriteName:
      `${ATLAS_PREFIX}${String(atlasIndex).padStart(4, "0")}`,
    spriteIndex:
      variantIndex % SLOTS_PER_ATLAS,
    variantIndex,
    normalizedAppearance: {
      gender: normalized.gender,
      classId: normalized.classId,
      skin: normalized.skin,
      eyes: normalized.eyes,
      hair: normalized.hair,
      hairColor: normalized.hairColor
    }
  };
}

function hasVersionedAppearance(character) {
  const appearance = character && character.appearance;

  return Boolean(
    appearance &&
    typeof appearance === "object" &&
    typeof appearance.gender === "string" &&
    typeof appearance.classId === "string" &&
    typeof appearance.skin === "string" &&
    typeof appearance.eyes === "string" &&
    typeof appearance.hair === "string"
  );
}

function resolveCharacterSprite(character = {}) {
  if (hasVersionedAppearance(character)) {
    return resolveAppearanceSprite(character.appearance);
  }

  return {
    spriteName: String(character.sprite_name || "Actor4"),
    spriteIndex: Number.isInteger(character.sprite_index)
      ? character.sprite_index
      : 0,
    variantIndex: null,
    normalizedAppearance: null
  };
}

module.exports = {
  ATLAS_PREFIX,
  SLOTS_PER_ATLAS,
  resolveAppearanceSprite,
  resolveCharacterSprite
};
