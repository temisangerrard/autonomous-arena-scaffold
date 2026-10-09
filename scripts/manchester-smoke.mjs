import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const url = process.env.MANCHESTER_URL || 'http://localhost:5188/manchester/';
const out = 'output/manchester';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader'],
});
const errors = [];
const watch = (page) => {
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
};
const read = (page) =>
  page.evaluate(() => JSON.parse(window.render_game_to_text()));
async function load(page) {
  watch(page);
  await page.goto(url);
  await page.waitForFunction(
    () => typeof window.render_game_to_text === 'function'
  );
}
async function step(page, keys, ms) {
  await page.evaluate(
    ({ keys, ms }) => {
      document.activeElement?.blur();
      keys.forEach((code) =>
        window.dispatchEvent(new KeyboardEvent('keydown', { code }))
      );
      window.advanceTime(ms);
      keys.forEach((code) =>
        window.dispatchEvent(new KeyboardEvent('keyup', { code }))
      );
    },
    { keys, ms }
  );
}
async function walkTo(page, x, z) {
  console.log('Walking to', x, z);
  // Drive only public keyboard inputs, rather than teleporting through collisions.
  for (let i = 0; i < 180; i++) {
    const s = await read(page),
      dx = x - s.player.x,
      dz = z - s.player.z;
    if (Math.hypot(dx, dz) < 0.6) return;
    const localX = dx * Math.cos(s.cameraYaw) - dz * Math.sin(s.cameraYaw);
    const localZ = dx * Math.sin(s.cameraYaw) + dz * Math.cos(s.cameraYaw);
    const keys = [];
    if (Math.abs(localX) > 0.22) keys.push(localX > 0 ? 'KeyD' : 'KeyA');
    if (Math.abs(localZ) > 0.22) keys.push(localZ > 0 ? 'KeyS' : 'KeyW');
    await step(page, keys, 120);
  }
  throw new Error(
    `Could not walk to ${x},${z}: ${JSON.stringify((await read(page)).player)}`
  );
}
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  await load(page);
  await page.screenshot({ path: `${out}/desktop-quays.png` });
  const initial = await read(page);
  assert.equal(initial.district, 'quays');
  await step(page, ['ArrowUp'], 1000);
  const moved = await read(page);
  assert.ok(
    Math.hypot(
      moved.player.x - initial.player.x,
      moved.player.z - initial.player.z
    ) > 4,
    'movement must move avatar'
  );
  await page.click('#help');
  const paused = await read(page);
  await step(page, ['KeyW'], 2000);
  assert.deepEqual(
    (await read(page)).player,
    paused.player,
    'dialog must stop movement'
  );
  await page.keyboard.press('Escape');
  await page.click('#trail-start');
  for (const [x, z] of [
    [7, 17],
    [18, 17],
    [27, 13],
    [34, 13],
    [34, 6],
    [27, 6],
    [34, 6],
    [34, -5],
    [10, -5],
    [10, -9],
    [-18, -9],
    [-20, 12],
    [-30, 14],
  ])
    await walkTo(page, x, z);
  const completed = await read(page);
  assert.equal(completed.trail.status, 'complete');
  assert.equal(completed.trail.collected, 5);
  assert.ok(completed.trail.best > 0);
  await page.screenshot({ path: `${out}/trail-complete.png` });
  await page.click('#trail-start');
  assert.equal((await read(page)).trail.collected, 0);
  assert.equal((await read(page)).trail.status, 'running');
  // Walk west into the canal from the spawn; the avatar must stay on land.
  await walkTo(page, 7, 24);
  await step(page, ['KeyA'], 2000);
  assert.ok((await read(page)).player.x >= 5.4, 'canal collision');
  const metrics = {};
  for (const id of [
    'trafford',
    'centre',
    'northern',
    'castlefield',
    'quays',
    'trafford',
    'quays',
  ]) {
    await page.click('#tram-open');
    await page.click(`[data-id="${id}"]`);
    await page.waitForSelector('#tram-leave');
    await page.evaluate(() => window.advanceTime(21000));
    await page.click('#tram-leave');
    await page.evaluate(() => window.advanceTime(17));
    const s = await read(page);
    assert.equal(s.district, id);
    assert.equal(s.trail.status, 'idle');
    assert.ok(s.renderer.calls < 100, 'draw call budget');
    assert.ok(s.renderer.triangles < 100000, 'triangle budget');
    if (metrics[id])
      assert.equal(
        s.renderer.geometries,
        metrics[id].geometries,
        'geometry memory must not grow across switches'
      );
    metrics[id] = s.renderer;
    await page.screenshot({ path: `${out}/desktop-${id}.png` });
  }
  await page.reload();
  await page.waitForFunction(() => window.render_game_to_text);
  assert.equal((await read(page)).trail.best, completed.trail.best);
  await page.close();
  const mobile = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 3,
  });
  await load(mobile);
  assert.ok((await read(mobile)).renderer.pixelRatio <= 1.5);
  const a = await read(mobile);
  const joy = await mobile.locator('#joystick').boundingBox();
  const cdp = await mobile.context().newCDPSession(mobile);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: joy.x + joy.width / 2, y: joy.y + 5 }],
  });
  await mobile.evaluate(() => window.advanceTime(1000));
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchCancel',
    touchPoints: [],
  });
  const b = await read(mobile);
  assert.ok(
    Math.hypot(a.player.x - b.player.x, a.player.z - b.player.z) > 3,
    'touch joystick movement'
  );
  await mobile.evaluate(() => window.advanceTime(1000));
  assert.deepEqual(
    (await read(mobile)).player,
    b.player,
    'pointer cancel releases joystick'
  );
  await mobile.screenshot({ path: `${out}/mobile-quays.png` });
  await mobile.click('#tram-open');
  await mobile.screenshot({ path: `${out}/mobile-tram.png` });
  await mobile.click('[data-id="northern"]');
  assert.equal((await read(mobile)).district, 'northern');
  await mobile.setViewportSize({ width: 844, height: 390 });
  await mobile.screenshot({ path: `${out}/mobile-landscape.png` });
  await mobile.close();
  const privatePage = await browser.newPage();
  await privatePage.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new Error('disabled');
      },
    });
  });
  await load(privatePage);
  await privatePage.click('#trail-start');
  assert.equal((await read(privatePage)).trail.status, 'running');
  assert.deepEqual(errors, []);
  const report = {
    passed: true,
    checks: [
      'keyboard movement',
      'dialog pause',
      'complete trail through real movement',
      'restart',
      'canal collision',
      'all district travel',
      'bounded renderer resources',
      'best persistence',
      'touch movement and cancellation',
      'mobile and landscape layouts',
      'storage unavailable',
    ],
    metrics,
  };
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
