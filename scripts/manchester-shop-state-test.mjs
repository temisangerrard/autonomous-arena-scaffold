import assert from 'node:assert/strict';import {createLife} from '../apps/web/public/manchester/life.js';
let saved;const storage={getItem:()=>saved,setItem:(_,v)=>saved=v};const life=createLife(storage);
assert.equal(life.buyFurniture('cloud-sofa','bedroom').ok,false);assert.equal(life.snapshot().balance,250000);
assert.equal(life.buyFurniture('cloud-sofa','lounge').ok,true);assert.equal(life.snapshot().balance,247200);assert.equal(life.buyFurniture('cloud-sofa','lounge').ok,false);assert.equal(life.snapshot().balance,247200);
life.buyFurniture('sunset-rug','lounge');life.buyFurniture('ocean-rug','lounge');assert.equal(life.snapshot().furniture.find(o=>o.id==='sunset-rug').room,null);
life.placeFurniture('sunset-rug','bedroom');assert.equal(createLife(storage).snapshot().furniture.find(o=>o.id==='sunset-rug').room,'bedroom');
const balance=life.snapshot().balance;life.placeFurniture('ocean-rug',null);assert.equal(life.snapshot().balance,balance);assert.equal(createLife(storage).snapshot().furniture.find(o=>o.id==='ocean-rug').room,null);
saved=JSON.stringify({version:2,balance:1,furniture:[{id:'bad',room:'lounge'},{id:'cloud-sofa',room:'bad'}]});const poor=createLife(storage);assert.deepEqual(poor.snapshot().furniture,[]);assert.equal(poor.buyFurniture('olive-tree','lounge').ok,false);assert.equal(poor.snapshot().balance,1);
console.log('Shop validation, single debit, replacements, storage, relocation and persistence pass.');
