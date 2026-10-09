import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const url = process.env.MANCHESTER_URL || 'http://localhost:5188/manchester/';
const out = url.includes('localhost')
  ? 'output/manchester/shop'
  : 'output/manchester/shop-live';
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
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(url);
  await page.waitForFunction(() => window.render_game_to_text);
  const read = () =>
    page.evaluate(() => JSON.parse(window.render_game_to_text()));
  const advance = (ms) => page.evaluate((ms) => window.advanceTime(ms), ms);
  await page.click('#phone-open');
  await page.screenshot({ path: `${out}/phone-launcher.png` });
  await page.getByRole('button', { name: 'Quays & Co.', exact: true }).click();
  assert.equal(await page.locator('.shop-card').count(), 8);
  await page.screenshot({ path: `${out}/catalog.png` });
  await page.click('[data-purchase="cloud-sofa"]');
  assert.equal((await read()).life.balance, 247200);
  assert.ok(
    (await page.locator('#shop-message').innerText()).includes('Living room')
  );
  await page.click('[data-purchase="cloud-sofa"]');
  assert.equal((await read()).life.balance, 247200);
  await page.click('#phone-close');
  await page.click('#home-open');
  await page.waitForSelector('[data-room="lounge"]');
  await advance(17);
  await page.screenshot({ path: `${out}/sofa-delivered.png` });
  await page.click('#phone-open');
  await page.getByRole('button', { name: 'Quays & Co.', exact: true }).click();
  assert.ok(await page.locator('#phone-shop').isVisible());
  await page.selectOption('#room-gallery-art', 'lounge');
  await page.click('[data-purchase="gallery-art"]');
  assert.equal((await read()).life.balance, 246000);
  await page.click('#phone-close');
  await advance(17);
  await page.screenshot({ path: `${out}/art-delivered.png` });
  await page.click('#phone-open');
  await page.getByRole('button', { name: 'Quays & Co.', exact: true }).click();
  await page.selectOption('#room-sunset-rug', 'lounge');
  await page.click('[data-purchase="sunset-rug"]');
  await page.selectOption('#room-ocean-rug', 'lounge');
  await page.click('[data-purchase="ocean-rug"]');
  assert.equal(
    (await read()).life.furniture.find((o) => o.id === 'sunset-rug').room,
    null
  );
  await page.selectOption('#room-sunset-rug', 'bedroom');
  await page.click('[data-purchase="sunset-rug"]');
  const balance = (await read()).life.balance;
  await page.click('#phone-close');
  await page.click('[data-room="bedroom"]');
  await advance(15000);
  assert.equal((await read()).experience.room, 'bedroom');
  await page.screenshot({ path: `${out}/bedroom-rug.png` });
  await page.click('#experience-exit');
  await page.reload();
  await page.waitForFunction(() => window.render_game_to_text);
  assert.equal((await read()).life.balance, balance);
  assert.equal(
    (await read()).life.furniture.find((o) => o.id === 'sunset-rug').room,
    'bedroom'
  );
  await page.click('#phone-open');
  await page.getByRole('button', { name: 'Quays & Co.', exact: true }).click();
  assert.ok(
    (await page.locator('[data-purchase="cloud-sofa"]').innerText()).includes(
      'Place'
    )
  );
  await page.selectOption('#room-cloud-sofa', '');
  await page.click('[data-purchase="cloud-sofa"]');
  assert.equal(
    (await read()).life.furniture.find((o) => o.id === 'cloud-sofa').room,
    null
  );
  assert.equal((await read()).life.balance, balance);
  await page.click('#phone-close');
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(250);
  await page.click('#home-open');
  await page.waitForSelector('[data-room="lounge"]');
  await page.click('#phone-open');
  await page.screenshot({ path: `${out}/landscape-launcher.png` });
  await page.getByRole('button', { name: 'Quays & Co.', exact: true }).click();
  await page.screenshot({ path: `${out}/landscape-shop.png` });
  await page.click('#phone-close');
  await page.click('#experience-exit');
  assert.deepEqual(errors, []);
  const result = {
    passed: true,
    url,
    checks: [
      'eight-product phone shop',
      'single game-money debit',
      'delivery renders in home',
      'shopping from inside penthouse',
      'replacement goes to storage',
      'free relocation',
      'reload persistence',
      'storage',
      'portrait and landscape',
    ],
    errors,
  };
  console.log(JSON.stringify(result));
  await writeFile(`${out}/report.json`, JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
