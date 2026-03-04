/**
 * E2E Test: Prediction Markets Flow
 * Verifies the prediction panel receives and displays BTC markets from the server.
 * With CHAIN_RPC_URL unset, server uses synthetic oracle so markets are available in dev.
 *
 * Run with: npx playwright test scripts/e2e/prediction-markets.test.js
 */

const { test, expect } = require('@playwright/test');

const WEB_BASE_URL = process.env.E2E_WEB_BASE_URL || 'http://localhost:3000';
const LOCAL_USERNAME = process.env.E2E_LOCAL_USERNAME || process.env.ADMIN_USERNAME || 'admin';
const LOCAL_PASSWORD = process.env.E2E_LOCAL_PASSWORD || process.env.ADMIN_PASSWORD || '12345';

async function ensureAuthenticatedPlay(page) {
  const meRes = await page.request.get(`${WEB_BASE_URL}/api/player/me`);
  if (meRes.ok()) return;
  const loginRes = await page.request.post(`${WEB_BASE_URL}/api/auth/local`, {
    data: { username: LOCAL_USERNAME, password: LOCAL_PASSWORD }
  });
  if (!loginRes.ok()) {
    throw new Error(
      `Unable to authenticate. Set LOCAL_AUTH_ENABLED=true and valid credentials. status=${loginRes.status}`
    );
  }
}

async function openPlayAndHydrate(page) {
  await page.addInitScript(() => {
    localStorage.setItem('arena_onboarding_completed', 'true');
  });
  await page.goto(`${WEB_BASE_URL}/play?world=train_world`);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2000);

  await page.waitForFunction(() => typeof window.render_game_to_text === 'function', { timeout: 15000 });
  const hydrated = await page.evaluate(async () => {
    for (let i = 0; i < 200; i += 1) {
      await window.advanceTime?.(50);
      const snapshot = window.render_game_to_text?.();
      if (snapshot) {
        const parsed = JSON.parse(snapshot || '{}');
        if (parsed.wsConnected && parsed.playerId) return true;
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    return false;
  });
  expect(hydrated).toBe(true);
}

test.describe('Prediction Markets', () => {
  test.beforeEach(async ({ page }) => {
    await ensureAuthenticatedPlay(page);
    await openPlayAndHydrate(page);
  });

  test('prediction panel shows markets or empty state after opening', async ({ page }) => {
    await page.click('canvas#scene');

    const hasPredictionDealer = await page.evaluate(() => {
      const parsed = JSON.parse(window.render_game_to_text?.() || '{}');
      const stations = parsed.stations || [];
      return stations.some((s) => s?.kind === 'dealer_prediction');
    });

    if (!hasPredictionDealer) {
      test.skip();
      return;
    }

    const nearby = await page.evaluate(() => {
      const parsed = JSON.parse(window.render_game_to_text?.() || '{}');
      return parsed.nearbyIds || [];
    });

    const predictionStationId = await page.evaluate(() => {
      const parsed = JSON.parse(window.render_game_to_text?.() || '{}');
      const stations = parsed.stations || [];
      const pred = stations.find((s) => s?.kind === 'dealer_prediction');
      return pred?.id || null;
    });

    if (!predictionStationId) {
      test.skip();
      return;
    }

    const isNearby = await page.evaluate(
      (id) => {
        const parsed = JSON.parse(window.render_game_to_text?.() || '{}');
        return (parsed.nearbyIds || []).includes(id);
      },
      predictionStationId
    );

    if (!isNearby) {
      await page.keyboard.press('KeyE');
      await page.waitForTimeout(500);
    }

    await page.keyboard.press('KeyE');
    await page.waitForTimeout(1500);

    const interactionOpen = await page.evaluate(() => {
      const parsed = JSON.parse(window.render_game_to_text?.() || '{}');
      return parsed.ui?.interactOpen === true;
    });

    if (!interactionOpen) {
      await page.keyboard.press('KeyE');
      await page.waitForTimeout(1000);
    }

    const statusText = await page.locator('#prediction-status').textContent({ timeout: 12000 });
    const hasMarkets = statusText?.includes('Choose BTC Up or BTC Down') ?? false;
    const hasEmptyState = statusText?.includes('No next BTC market') ?? false;
    const hasFetching = statusText?.includes('Fetching markets') ?? false;

    expect(hasMarkets || hasEmptyState || hasFetching).toBe(true);
  });
});
