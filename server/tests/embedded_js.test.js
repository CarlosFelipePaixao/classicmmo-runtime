"use strict";
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("JavaScript bridges embedded in C++ remain syntactically valid", () => {
  for (const name of ["classicmmo/classicmmo_runtime.cpp", "game_interpreter.cpp", "scene_battle.cpp"]) {
    const source = fs.readFileSync(path.resolve(__dirname,"../../src",name),"utf8");
    const starts = /\bEM_(?:ASM(?:_INT)?|JS)\s*\(/g;
    for (const start of source.matchAll(starts)) {
      const begin = source.indexOf("{",start.index);
      let depth=1, quote=null, escaped=false, end=begin+1;
      for (;end<source.length && depth;end++) {
        const c=source[end];
        if (quote) {
          if (escaped) escaped=false;
          else if(c==='\\')escaped=true;
          else if(c===quote)quote=null;
        } else if(c==='"'||c==="'"||c==='`')quote=c;
        else if(c==='{')depth++;
        else if(c==='}')depth--;
      }
      new vm.Script('(function(){'+source.slice(begin+1,end-1)+'})',{filename:name});
    }
  }
});
