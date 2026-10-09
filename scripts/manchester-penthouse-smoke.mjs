import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const url = process.env.MANCHESTER_URL || 'http://localhost:5188/manchester/';
const out = url.includes('localhost')
  ? 'output/manchester/penthouse'
  : 'output/manchester/penthouse-live';
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
  await page.click('#home-open');
  await page.waitForSelector('[data-room="kitchen"]');
  const read = () =>
    page.evaluate(() => JSON.parse(window.render_game_to_text()).experience);
  const advance = (ms) => page.evaluate((ms) => window.advanceTime(ms), ms);
  async function go(room) {
    await page.click(`[data-room="${room}"]`);
    await advance(15000);
    assert.equal((await read()).room, room);
    assert.deepEqual((await read()).route, []);
  }
  async function hit(id) {
    await page.evaluate((id) => {
      for (let i = 0; i < 200; i++) {
        const s = JSON.parse(window.render_game_to_text()).experience;
        if (s.meter >= 45 && s.meter <= 65) {
          document.querySelector(id).click();
          return;
        }
        window.advanceTime(17);
      }
      throw Error('timing zone not reached');
    }, id);
  }
  await advance(17);
  await page.screenshot({ path: `${out}/lounge.png` });
  const joy=await page.locator('#joystick').boundingBox();
  const cdp=await page.context().newCDPSession(page);
  const beforeTouch=(await read()).player;
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:joy.x+joy.width/2,y:joy.y+5}]});
  await advance(300);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});
  const afterTouch=(await read()).player;assert.notDeepEqual(afterTouch,beforeTouch);
  await advance(500);assert.deepEqual((await read()).player,afterTouch);
  await page.click('#home-tv');
  await page.click('#tv-next');
  assert.equal((await read()).channel, 1);
  await page.click('#home-cancel');
  await go('kitchen');
  await page.click('#home-cook');
  for (let i = 0; i < 6; i++) await page.click('#chop');
  assert.equal((await read()).stage, 1);
  await hit('#serve');
  assert.equal((await read()).stage, 2);
  await page.click('#eat');
  assert.ok((await read()).completed.includes('cook'));
  await advance(17);
  await page.screenshot({ path: `${out}/kitchen.png` });
  await go('games');
  await page.click('#home-darts');
  await page.locator('#dart-aim').fill('0');
  for (let i = 0; i < 3; i++) {
    await advance(850);
    await hit('#dart-throw');
  }
  assert.ok((await read()).score > 0);
  assert.equal((await read()).shots, 3);
  assert.ok((await read()).completed.includes('darts'));
  await advance(17);
  await page.screenshot({ path: `${out}/games.png` });
  await go('bedroom');
  assert.equal((await read()).floor, 1);
  await page.click('#home-curtains');
  await page.click('#home-rest');
  for (let i = 0; i < 3; i++) {
    await advance(850);
    await hit('#breathe');
  }
  assert.ok((await read()).completed.includes('rest'));
  await advance(17);
  await page.screenshot({ path: `${out}/bedroom.png` });
  await go('guest');
  await page.click('#home-relax');
  for (let i = 0; i < 3; i++) {
    await advance(850);
    await hit('#breathe');
  }
  assert.ok((await read()).completed.includes('relax'));
  await go('bathroom');
  await page.click('#home-shower');
  await advance(7000);
  assert.equal((await read()).action, 'shower');
  await page.locator('#water-temp').fill('38');
  await advance(6100);
  assert.ok((await read()).completed.includes('shower'));
  await advance(17);
  await page.screenshot({ path: `${out}/bathroom.png` });
  await go('balcony');
  await page.click('#home-telescope');
  for (let i = 0; i < 3; i++) {
    await page.click('#sky-spot');
    if (i < 2) await page.click('#sky-next');
  }
  assert.ok((await read()).completed.includes('telescope'));
  await advance(17);
  await page.screenshot({ path: `${out}/terrace.png` });
  await go('lounge');
  assert.equal((await read()).floor, 0);
  // Manual input can also walk through a doorway, without room buttons.
  await page.keyboard.down('ArrowDown');
  await advance(1270);
  await page.keyboard.up('ArrowDown');
  await page.keyboard.down('ArrowLeft');
  await advance(1900);
  await page.keyboard.up('ArrowLeft');
  assert.equal((await read()).room, 'kitchen');
  await page.click('#home-cook');
  await page.click('#home-cancel');
  assert.equal((await read()).action, null);
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(250);
  await advance(17);
  await advance(17);
  await page.screenshot({ path: `${out}/landscape.png` });
  await page.click('#experience-exit');
  assert.equal(await read(), null);
  assert.deepEqual(errors, []);
  const result = {
    passed: true,
    url,
    checks: [
      'seven rooms via connected doors',
      'stairs up/down',
      'manual doorway walking',
      'cooking steps and timing',
      'three-dart scoring',
      'bedroom and guest routines',
      'shower temperature',
      'three terrace views',
      'television channels',
      'cancel and exit',
      'portrait/landscape',
    ],
    errors,
  };
  console.log(JSON.stringify(result));
  await writeFile(`${out}/report.json`, JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
