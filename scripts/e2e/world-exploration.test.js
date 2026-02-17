/**
 * E2E Test: World Exploration
 * Walks the avatar around all sections of the world to verify movement works
 * 
 * Run with: npx playwright test scripts/e2e/world-exploration.test.js
 */

const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const WEB_BASE_URL = process.env.E2E_WEB_BASE_URL || 'http://localhost:3000';
const LOCAL_USERNAME = process.env.E2E_LOCAL_USERNAME || process.env.ADMIN_USERNAME || 'admin';
const LOCAL_PASSWORD = process.env.E2E_LOCAL_PASSWORD || process.env.ADMIN_PASSWORD || '12345';

async function ensureAuthenticatedPlay(page) {
  const meRes = await page.request.get(`${WEB_BASE_URL}/api/player/me`);
  if (meRes.ok()) {
    return meRes.json();
  }
  const loginRes = await page.request.post(`${WEB_BASE_URL}/api/auth/local`, {
    data: {
      username: LOCAL_USERNAME,
      password: LOCAL_PASSWORD
    }
  });
  if (!loginRes.ok()) {
    throw new Error(
      `Unable to authenticate local test user. Set LOCAL_AUTH_ENABLED=true and valid E2E_LOCAL_USERNAME/E2E_LOCAL_PASSWORD. status=${loginRes.status()}`
    );
  }
  const refreshed = await page.request.get(`${WEB_BASE_URL}/api/player/me`);
  if (!refreshed.ok()) {
    throw new Error(`Authenticated session missing /api/player/me. status=${refreshed.status()}`);
  }
  return refreshed.json();
}

fs.mkdirSync('output/e2e', { recursive: true });

test.describe('World Exploration', () => {
  test.describe.configure({ timeout: 120000 });

  test.beforeEach(async ({ page }) => {
    // Navigate to the game in authenticated play mode.
    const me = await ensureAuthenticatedPlay(page);
    const profile = me?.profile || {};
    const wsAuth = String(me?.wsAuth || '');
    const name = encodeURIComponent(String(profile.displayName || me?.user?.name || 'Explorer'));
    const clientId = encodeURIComponent(String(profile.id || 'profile_1'));
    const walletId = encodeURIComponent(String(profile?.wallet?.id || profile.walletId || ''));
    const wsAuthParam = encodeURIComponent(wsAuth);
    await page.addInitScript(() => {
      localStorage.setItem('arena_onboarding_completed', 'true');
    });
    await page.goto(
      `${WEB_BASE_URL}/play?world=train_world&test=1&name=${name}&clientId=${clientId}&walletId=${walletId}&wsAuth=${wsAuthParam}`
    );
    await page.waitForLoadState('domcontentloaded');
    
    // Wait for canvas to be visible
    const canvas = page.locator('canvas#scene');
    await expect(canvas).toBeVisible({ timeout: 15000 });
    
    // Wait for websocket/player identity hydration.
    await page.waitForFunction(() => {
      const state = window.render_game_to_text?.();
      if (!state) return false;
      const parsed = JSON.parse(state || '{}');
      if (parsed.wsConnected && parsed.playerId && parsed.player) {
        return true;
      }
      return false;
    }, { timeout: 90000 });
  });

  test('should respond to movement keys', async ({ page }) => {
    const getPosition = async () => page.evaluate(() => {
      const parsed = JSON.parse(window.render_game_to_text?.() || '{}');
      return { x: Number(parsed.player?.x || 0), z: Number(parsed.player?.z || 0) };
    });
    const holdKey = async (key, ms = 700) => {
      await page.keyboard.down(key);
      await page.evaluate(async () => {
        await window.advanceTime?.(300);
      });
      await page.waitForTimeout(ms);
      await page.keyboard.up(key);
      await page.evaluate(async () => {
        await window.advanceTime?.(220);
      });
      await page.waitForTimeout(120);
    };

    await page.click('canvas#scene');
    const initial = await getPosition();
    const movedByKey = {};
    let maxDelta = 0;

    for (const key of ['KeyW', 'KeyA', 'KeyS', 'KeyD']) {
      const before = await getPosition();
      await holdKey(key, 750);
      const after = await getPosition();
      const delta = Math.hypot(after.x - before.x, after.z - before.z);
      movedByKey[key] = Number(delta.toFixed(3));
      maxDelta = Math.max(maxDelta, delta);
    }

    const final = await getPosition();
    const net = Math.hypot(final.x - initial.x, final.z - initial.z);
    console.log('movement sample', { initial, final, movedByKey, maxDelta, net });

    expect(maxDelta).toBeGreaterThan(0.5);
    await page.screenshot({ path: 'output/e2e/movement-test.png', fullPage: true });
  });

  test('should traverse a wider area over continuous movement', async ({ page }) => {
    const sample = async () => page.evaluate(() => {
      const parsed = JSON.parse(window.render_game_to_text?.() || '{}');
      return {
        x: Number(parsed.player?.x || 0),
        z: Number(parsed.player?.z || 0),
        tick: Number(parsed.tick || 0)
      };
    });
    const hold = async (keys, ms = 900) => {
      for (const key of keys) await page.keyboard.down(key);
      await page.evaluate(async () => {
        await window.advanceTime?.(300);
      });
      await page.waitForTimeout(ms);
      for (const key of keys) await page.keyboard.up(key);
      await page.evaluate(async () => {
        await window.advanceTime?.(220);
      });
      await page.waitForTimeout(120);
    };

    await page.click('canvas#scene');
    const start = await sample();
    const points = [start];
    const path = [
      ['KeyD'],
      ['KeyD', 'KeyW'],
      ['KeyW'],
      ['KeyA', 'KeyW'],
      ['KeyA'],
      ['KeyS'],
      ['KeyD', 'KeyS']
    ];

    for (const keys of path) {
      await hold(keys, 850);
      points.push(await sample());
    }

    const xs = points.map((p) => p.x);
    const zs = points.map((p) => p.z);
    const spanX = Math.max(...xs) - Math.min(...xs);
    const spanZ = Math.max(...zs) - Math.min(...zs);
    const maxDist = Math.max(...points.map((p) => Math.hypot(p.x - start.x, p.z - start.z)));
    const tickDelta = points[points.length - 1].tick - start.tick;
    console.log('exploration span', { start, end: points[points.length - 1], spanX, spanZ, maxDist, tickDelta });

    expect(tickDelta).toBeGreaterThan(10);
    expect(maxDist).toBeGreaterThan(2.5);
    expect(spanX + spanZ).toBeGreaterThan(4.5);
    await page.screenshot({ path: 'output/e2e/exploration-span-test.png', fullPage: true });
  });

  test('should keep receiving live snapshots during idle and movement', async ({ page }) => {
    await page.click('canvas#scene');
    const baseline = await page.evaluate(() => JSON.parse(window.render_game_to_text?.() || '{}'));
    await page.waitForTimeout(1500);
    await page.keyboard.down('KeyD');
    await page.waitForTimeout(700);
    await page.keyboard.up('KeyD');
    await page.waitForTimeout(300);
    const after = await page.evaluate(() => JSON.parse(window.render_game_to_text?.() || '{}'));

    expect(Number(after.tick || 0)).toBeGreaterThan(Number(baseline.tick || 0));
    expect(Boolean(after.wsConnected)).toBe(true);
    expect(typeof after.playerId).toBe('string');
    await page.screenshot({ path: 'output/e2e/corners-test.png', fullPage: true });
  });
});
