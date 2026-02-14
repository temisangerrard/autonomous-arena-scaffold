/**
 * E2E Test: Visual Regression
 * Captures screenshots for visual comparison
 * 
 * Run with: npx playwright test scripts/e2e/visual-regression.test.js
 */

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

test.describe('Visual Regression', () => {
  const outputDir = 'output/e2e/screenshots';
  
  test.beforeAll(() => {
    // Ensure output directory exists
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
  });

  test('should capture homepage screenshot', async ({ page }) => {
    await page.goto('http://localhost:4100/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    
    await page.screenshot({ 
      path: `${outputDir}/homepage.png`,
      fullPage: true 
    });
  });

  test('should capture play page screenshot', async ({ page }) => {
    await page.goto('http://localhost:4100/play?world=train_world');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);
    
    await page.screenshot({ 
      path: `${outputDir}/play-page.png`,
      fullPage: true 
    });
  });

  test('should capture viewer page screenshot', async ({ page }) => {
    await page.goto('http://localhost:4100/viewer?world=train_world');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);
    
    await page.screenshot({ 
      path: `${outputDir}/viewer-page.png`,
      fullPage: true 
    });
  });

  test('should capture dashboard screenshot', async ({ page }) => {
    await page.goto('http://localhost:4100/dashboard');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    
    await page.screenshot({ 
      path: `${outputDir}/dashboard.png`,
      fullPage: true 
    });
  });

  test('should capture agents page screenshot', async ({ page }) => {
    await page.goto('http://localhost:4100/agents');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    
    await page.screenshot({ 
      path: `${outputDir}/agents-page.png`,
      fullPage: true 
    });
  });

  test('should capture canvas element screenshot', async ({ page }) => {
    await page.goto('http://localhost:4100/play?world=train_world');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);
    
    // Capture just the canvas element
    const canvas = page.locator('canvas').first();
    if (await canvas.count() > 0) {
      await canvas.screenshot({ 
        path: `${outputDir}/game-canvas.png`
      });
    }
  });

  test('should capture welcome page screenshot', async ({ page }) => {
    await page.goto('http://localhost:4100/welcome');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    
    await page.screenshot({ 
      path: `${outputDir}/welcome-page.png`,
      fullPage: true 
    });
  });
});
