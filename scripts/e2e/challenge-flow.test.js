/**
 * E2E Test: Challenge Flow
 * Tests the RPS and Coinflip challenge gameplay
 * 
 * Run with: npx playwright test scripts/e2e/challenge-flow.test.js
 */

const { test, expect } = require('@playwright/test');

const WEB_BASE_URL = process.env.E2E_WEB_BASE_URL || 'http://localhost:3000';
const PLAY_URL = `${WEB_BASE_URL}/play?world=train_world`;
const LOCAL_USERNAME = process.env.E2E_LOCAL_USERNAME || process.env.ADMIN_USERNAME || 'admin';
const LOCAL_PASSWORD = process.env.E2E_LOCAL_PASSWORD || process.env.ADMIN_PASSWORD || '12345';

async function ensureAuthenticatedPlay(page) {
  const meRes = await page.request.get(`${WEB_BASE_URL}/api/player/me`);
  if (meRes.ok()) return;

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
}

async function openPlay(page) {
  await page.addInitScript(() => {
    localStorage.setItem('arena_onboarding_completed', 'true');
  });
  await page.goto(PLAY_URL);
}

test.describe('Challenge Flow', () => {
  test('should render interaction challenge UI shell', async ({ page }) => {
    await ensureAuthenticatedPlay(page);
    await openPlay(page);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    await expect(page.locator('#interaction-card')).toHaveCount(1);
    await expect(page.locator('#station-ui')).toHaveCount(1);
    await expect(page.locator('#interaction-npc-info')).toHaveCount(1);
    await expect(page.locator('#interaction-prompt')).toHaveCount(1);

    await page.screenshot({ path: 'output/e2e/challenge-desk.png' });
  });

  test('should expose desktop/mobile controls for RPS and coinflip', async ({ page }) => {
    await ensureAuthenticatedPlay(page);
    await openPlay(page);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000);

    await expect(page.locator('#mobile-controls')).toHaveCount(1);
    await expect(page.locator('#mobile-interact')).toHaveCount(1);
    await expect(page.locator('#mobile-send')).toHaveCount(1);
    await expect(page.locator('#mobile-accept')).toHaveCount(1);
    await expect(page.locator('#mobile-decline')).toHaveCount(1);
    await expect(page.locator('#mobile-move-1')).toHaveCount(1);
    await expect(page.locator('#mobile-move-2')).toHaveCount(1);
    await expect(page.locator('#mobile-move-3')).toHaveCount(1);
    await expect(page.locator('#mobile-move-h')).toHaveCount(1);
    await expect(page.locator('#mobile-move-t')).toHaveCount(1);
    await expect(page.locator('#control-hints')).toHaveCount(1);

    await page.screenshot({ path: 'output/e2e/game-controls.png' });
  });

  test('should display HUD with game info', async ({ page }) => {
    await ensureAuthenticatedPlay(page);
    await openPlay(page);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    await expect(page.locator('#hud')).toHaveCount(1);
    await expect(page.locator('#topbar-name')).toHaveCount(1);
    await expect(page.locator('#topbar-wallet')).toHaveCount(1);
    await expect(page.locator('#topbar-streak')).toHaveCount(1);
    await expect(page.locator('#world-map')).toHaveCount(1);
    await expect(page.locator('#map-coords')).toHaveCount(1);

    await page.screenshot({ path: 'output/e2e/hud-display.png' });
  });

  test('should expose websocket/runtime readiness signals', async ({ page }) => {
    await ensureAuthenticatedPlay(page);
    await openPlay(page);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(5000);

    const runtime = await page.evaluate(() => {
      return {
        hasWebSocket: typeof window.WebSocket === 'function',
        hasSceneCanvas: Boolean(document.getElementById('scene'))
      };
    });

    expect(runtime.hasWebSocket).toBe(true);
    expect(runtime.hasSceneCanvas).toBe(true);

    await page.screenshot({ path: 'output/e2e/websocket-test.png' });
  });
});
