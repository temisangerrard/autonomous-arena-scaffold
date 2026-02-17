/**
 * E2E Test: Game World Loading
 * Verifies the 3D world loads correctly in the browser
 * 
 * Run with: npx playwright test scripts/e2e/game-load.test.js
 */

const { test, expect } = require('@playwright/test');
const WEB_BASE_URL = process.env.E2E_WEB_BASE_URL || 'http://localhost:3000';
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

test.describe('Game World Loading', () => {
  test('should load the 3D world and render canvas', async ({ page }) => {
    // Navigate to the game
    await ensureAuthenticatedPlay(page);
    await page.addInitScript(() => {
      localStorage.setItem('arena_onboarding_completed', 'true');
    });
    await page.goto(`${WEB_BASE_URL}/play?world=train_world`);
    
    // Runtime keeps long-lived network activity; use DOM readiness instead.
    await page.waitForLoadState('domcontentloaded');
    
    // Check that the canvas exists (Three.js renders to canvas)
    const canvas = page.locator('canvas#scene');
    await expect(canvas).toBeVisible({ timeout: 10000 });
    
    // Verify canvas has dimensions (was rendered)
    const boundingBox = await canvas.boundingBox();
    expect(boundingBox).not.toBeNull();
    expect(boundingBox.width).toBeGreaterThan(0);
    expect(boundingBox.height).toBeGreaterThan(0);
    
    // Take a screenshot for visual verification
    await page.screenshot({ path: 'output/e2e/world-load.png', fullPage: true });
  });

  test('should load viewer mode', async ({ page }) => {
    await page.goto(`${WEB_BASE_URL}/viewer?world=train_world`);
    await page.waitForLoadState('networkidle');
    
    // Wait for world to load
    await page.waitForTimeout(3000);
    
    // Check canvas exists in viewer mode
    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible({ timeout: 15000 });
    
    // Take screenshot
    await page.screenshot({ path: 'output/e2e/viewer-load.png', fullPage: true });
  });

  test('should load home/dashboard page', async ({ page }) => {
    await page.goto(`${WEB_BASE_URL}/home`);
    await page.waitForLoadState('domcontentloaded');
    
    // Check page loaded
    await expect(page.locator('body')).toBeVisible();
    
    // Take screenshot
    await page.screenshot({ path: 'output/e2e/home-load.png', fullPage: true });
  });
});
