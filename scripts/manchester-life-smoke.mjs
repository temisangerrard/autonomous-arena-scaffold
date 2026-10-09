import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const url = process.env.MANCHESTER_URL || 'http://localhost:5188/manchester/';
const out = url.includes('localhost')
  ? 'output/manchester/fantasy'
  : 'output/manchester/fantasy-live';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader'],
});
const errors = [];
try {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url);
  await page.evaluate(() => {
    localStorage.setItem(
      'manchester-life-v1',
      JSON.stringify({ balance: 17, owned: ['plant'], hunger: 40, energy: 60 })
    );
  });
  await page.reload();
  await page.waitForFunction(() => window.render_game_to_text);
  const read = () =>
    page.evaluate(() => JSON.parse(window.render_game_to_text()));
  const advance = (ms) => page.evaluate((ms) => window.advanceTime(ms), ms);
  assert.equal((await read()).life.balance, 250000);
  assert.equal((await read()).life.owned.length, 4);
  await page.click('#home-open');
  await page.waitForSelector('[data-room="kitchen"]');
  await page.click('[data-room="kitchen"]');
  await advance(15000);
  await page.waitForSelector('#home-cook');
  await page.click('#home-cook');
  for (let i = 0; i < 6; i++) await page.click('#chop');
  await page.evaluate(() => {
    for (let i = 0; i < 200; i++) {
      const s = JSON.parse(window.render_game_to_text()).experience;
      if (s.meter >= 45 && s.meter <= 65) {
        document.querySelector('#serve').click();
        return;
      }
      window.advanceTime(17);
    }
  });
  await page.click('#eat');
  assert.equal((await read()).life.balance, 250000);
  assert.equal((await read()).life.hunger, 75);
  await page.click('#home-decor');
  await page.click('[data-buy="rug"]');
  await advance(17);
  assert.deepEqual((await read()).life.hiddenDecor, ['rug']);
  await page.click('[data-buy="rug"]');
  await advance(17);
  await page.screenshot({ path: `${out}/home.png` });
  await page.click('#experience-exit');
  async function choose(name) {
    await page.click('#phone-open');
    await page.getByRole('button', { name: 'Things to do', exact: true }).click();
    await page.getByRole('button', { name: new RegExp(name) }).click();
  }
  await choose('Waterfront run');
  await page.waitForSelector('#outdoor-start');
  await page.click('#outdoor-start');
  await advance(30000);
  assert.ok((await read()).life.achievements.includes('run'));
  assert.equal((await read()).life.balance, 250000);
  await page.click('#experience-exit');
  await choose('Row the Quays');
  await page.waitForSelector('#row-left');
  await page.click('#outdoor-start');
  await page.evaluate(() => {
    for (let i = 0; i < 25; i++) {
      window.advanceTime(300);
      document.querySelector(i % 2 ? '#row-right' : '#row-left').click();
    }
  });
  await advance(17);
  assert.ok((await read()).life.achievements.includes('rowing'));
  await page.click('#experience-exit');
  await page.click('#phone-open');
    await page.getByRole('button', { name: 'Things to do', exact: true }).click();
  await page.click('#phone-me');
  assert.ok(
    (await page.locator('#phone-content').innerText()).includes('Golden Mile')
  );
  await page.screenshot({ path: `${out}/collection.png` });
  await page.click('#phone-close');
  await choose('Private sunset cruise');
  await page.waitForSelector('#tram-leave');
  await advance(21000);
  await page.click('#tram-leave');
  await page.waitForSelector('#outdoor-start');
  assert.equal((await read()).experience.type, 'sunset-tour');
  await page.click('#outdoor-start');
  await advance(14000);
  await page.screenshot({ path: `${out}/sunset.png` });
  await page.click('#experience-exit');
  await choose('Your Manchester look');
  await page.waitForSelector('#tram-leave');
  await advance(21000);
  await page.click('#tram-leave');
  await page.waitForSelector('#look-choice');
  await page.selectOption('#look-choice', { label: 'Golden Mile jacket' });
  await page.click('#look-save');
  assert.equal((await read()).experience.color, '#d8ad50');
  await page.click('#experience-exit');
  await page.reload();
  await page.waitForFunction(() => window.render_game_to_text);
  assert.deepEqual((await read()).life.achievements, ['run', 'rowing']);
  assert.equal((await read()).life.balance, 250000);
  assert.deepEqual(errors, []);
  const result = {
    passed: true,
    url,
    checks: [
      'existing save upgraded',
      'all furniture included',
      'free meals',
      'decor arrangement',
      'collectible unlocks',
      'private sunset cruise',
      'earned jacket wearable',
      'reload persistence',
    ],
    errors,
  };
  console.log(JSON.stringify(result));
  await writeFile(`${out}/report.json`, JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
