"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("a stale inventory move is rejected with item identities checked by the transaction", async () => {
  const slots = [{id:"source-id",item_key:"wooden_sword",container:"inventory",slot:1},null];
  let requested;
  const client = {
    from() { return {select(){return this;},eq(){return this;},limit(){return this;},
      maybeSingle:async()=>({data:slots.shift()})}; },
    async rpc(name,args) {requested={name,args};return {error:{message:"inventory changed; reload before moving"}};}
  };
  const module={exports:{}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,"../src/supabase_client.js"),"utf8"),{
    module,console,process:{env:{SUPABASE_URL:"http://fixture",SUPABASE_SERVICE_ROLE_KEY:"fixture"}},
    require(name) {
      if(name==='@supabase/supabase-js')return {createClient:()=>client};
      return require(path.join(__dirname,"../src",name));
    }
  });
  await assert.rejects(()=>module.exports.moveCharacterInventoryItem({id:"hero"},{
    fromContainer:"inventory",fromSlot:1,toContainer:"equipment",toSlot:2
  }),/inventário mudou/);
  assert.equal(requested.name,"move_character_inventory_item_checked");
  assert.equal(requested.args.p_expected_source_id,"source-id");
  assert.equal(requested.args.p_expected_target_id,null);
});
