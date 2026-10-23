"use strict";
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const base = path.resolve(__dirname, "../../..");

test("shared client and edited portal inline scripts parse as JavaScript", () => {
  const files = [
    "lumnia-web-deploy/index.html", "lumnia-web-deploy/easyrpg-player.html",
    "lumnia-web-deploy/character-creator/tools/preview-layers.html",
    "lumnia-game/Project1/CharacterCreatorV2/tools/preview-layers.html",
    "lumnia-windows/src/inject-hud.js", "lumnia-windows/src/main.js",
    "lumnia-web-deploy/lumnia-ranking.js", "lumnia-web-deploy/lumnia-entry-flow.js"
  ];
  // The server/runtime repository can be tested alone in CI.
  for (const relative of files) {
    const file = path.join(base, relative);
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, "utf8");
    if (file.endsWith(".js")) new vm.Script(text, {filename:relative});
    else for (const match of text.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      if (!/\bsrc\s*=/.test(match[1])) new vm.Script(match[2], {filename:relative});
    }
  }
});
