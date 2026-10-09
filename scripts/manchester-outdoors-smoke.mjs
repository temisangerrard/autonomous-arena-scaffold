import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const url = process.env.MANCHESTER_URL || 'http://localhost:5188/manchester/';
const out = url.includes('localhost')
  ? 'output/manchester/outdoors'
  : 'output/manchester/outdoors-live';
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
    deviceScaleFactor: 1,
  });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(url);
  await page.waitForFunction(() => window.render_game_to_text);
  const read = () =>
    page.evaluate(() => JSON.parse(window.render_game_to_text()));
  const advance = (ms) => page.evaluate((ms) => window.advanceTime(ms), ms);
  async function choose(name) {
    await page.click('#phone-open');
    await page.getByRole('button', { name: 'Things to do', exact: true }).click();
    await page.getByRole('button', { name: new RegExp(name) }).click();
  }
  await page.click('#phone-open');
    await page.getByRole('button', { name: 'Things to do', exact: true }).click();
  assert.equal(await page.locator('.phone-activity').count(), 8);
  await page.screenshot({ path: `${out}/phone.png` });
  await page.click('#phone-close');
  await choose('Waterfront run');
  await page.waitForSelector('#outdoor-start');
  await page.click('#outdoor-start');
  await page.click('#run-pace');
  await advance(3000);
  assert.ok((await read()).experience.stamina < 100);
  assert.ok((await read()).experience.distance > 15);
  await page.click('#run-left');
  await page.screenshot({ path: `${out}/run.png` });
  await advance(30000);
  assert.equal((await read()).experience.state, 'complete');
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
  assert.equal((await read()).experience.state, 'complete');
  assert.equal((await read()).experience.strokes, 25);
  await page.screenshot({ path: `${out}/rowing.png` });
  await page.click('#experience-exit');
  await choose('The slow way to Sale');
  await page.waitForSelector('#tram-leave');
  assert.equal((await read()).experience.type, 'tram');
  await advance(21000);
  await page.click('#tram-leave');
  await page.waitForSelector('#tour-pause');
  assert.equal((await read()).district, 'castlefield');
  await page.click('#outdoor-start');
  await advance(13000);
  assert.equal((await read()).experience.chapter, 1);
  await page.click('#tour-pause');
  const before = (await read()).experience.time;
  await advance(6000);
  assert.equal((await read()).experience.time, before);
  await page.click('#tour-pause');
  await advance(24000);
  await page.screenshot({ path: `${out}/tour.png` });
  await advance(15000);
  assert.equal((await read()).experience.state, 'complete');
  await page.click('#experience-exit');
  assert.equal((await read()).phone.visits, 3);
  await page.click('#phone-open');
    await page.getByRole('button', { name: 'Things to do', exact: true }).click();
  await page.click('#phone-me');
  assert.equal(await page.locator('.journal-entry').count(), 3);
  await page.click('#phone-close');
  await page.reload();
  await page.waitForFunction(() => window.render_game_to_text);
  assert.equal((await read()).phone.visits, 3);
  assert.deepEqual(errors, []);
  const result = {
    passed: true,
    url,
    checks: [
      'eight phone activities',
      'run sprint energy and completion',
      'alternating oars and rowing completion',
      'phone-to-tram-to-tour flow',
      'tour pause chapters and completion',
      'journal persistence',
      'mobile screenshots',
    ],
    errors,
  };
  await writeFile(`${out}/report.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
