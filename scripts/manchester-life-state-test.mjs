import assert from 'node:assert/strict';
import { createLife, DECOR } from '../apps/web/public/manchester/life.js';
let saved = JSON.stringify({
  balance: 17,
  owned: ['plant'],
  hunger: 40,
  energy: 60,
});
const storage = { getItem: () => saved, setItem: (_, v) => (saved = v) };
const life = createLife(storage);
assert.equal(life.snapshot().balance, 250000);
assert.equal(life.snapshot().owned.length, DECOR.length);
assert.equal(JSON.parse(saved).version, 2);
assert.equal(life.cook().ok, true);
assert.equal(life.snapshot().balance, 250000);
assert.equal(life.reward('run'), 'Golden Mile jacket');
assert.equal(life.reward('run'), null);
assert.equal(life.reward('__proto__'), null);
life.toggleDecor('rug');
const again = createLife(storage);
assert.deepEqual(again.snapshot().hiddenDecor, ['rug']);
assert.deepEqual(again.snapshot().achievements, ['run']);
assert.equal(again.snapshot().balance, 250000);
saved = JSON.stringify({ ...again.snapshot(), balance: 123 });
assert.equal(
  createLife(storage).snapshot().balance,
  123,
  'migration must not repeat'
);
const blocked = createLife({
  getItem() {
    throw Error();
  },
  setItem() {
    throw Error();
  },
});
assert.equal(blocked.snapshot().balance, 250000);
assert.equal(blocked.snapshot().saved, false);
console.log(
  'Rich-start migration, free meals, collectibles, no repeat grant, decor persistence passed.'
);
