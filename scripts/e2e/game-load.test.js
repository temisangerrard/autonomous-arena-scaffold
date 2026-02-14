/**
 * E2E Test: Game World Loading
 * Verifies the 3D world loads correctly in the browser
 * 
 * Run with: npx playwright test scripts/e2e/game-load.test.js
 */

const { test, expect } = require('@playwright/test');

test.describe('Game World Loading', () => {
  test('should load the 3D world and render canvas', async ({ page }) => {
    // Navigate to the game
    await page.goto('http://localhost:4100/play?world=train_world');
    
    // Wait for the page to load
    await page.waitForLoadState('networkidle');
    
    // Check that the canvas exists (Three.js renders to canvas)
    const canvas = page.locator('canvas');
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
    await page.goto('http://localhost:4100/viewer?world=train_world');
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
    await page.goto('http://localhost:4100/home');
    await page.waitForLoadState('networkidle');
    
    // Check page loaded
    await expect(page.locator('body')).toBeVisible();
    
    // Take screenshot
    await page.screenshot({ path: 'output/e2e/home-load.png', fullPage: true });
  });
});
