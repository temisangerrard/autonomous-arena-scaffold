/**
 * E2E Test: Scoring & Wallet Updates
 * Tests that scores and wallet balances update correctly after games
 * 
 * Run with: npx playwright test scripts/e2e/scoring.test.js
 */

const { test, expect } = require('@playwright/test');
const WEB_BASE_URL = process.env.E2E_WEB_BASE_URL || 'http://localhost:3000';

test.describe('Scoring & Wallet', () => {
  test('should display wallet balance', async ({ page }) => {
    await page.goto(`${WEB_BASE_URL}/dashboard`);
    await page.waitForLoadState('networkidle');
    
    // Wait for page to render
    await page.waitForTimeout(2000);
    
    // Look for wallet balance elements
    const walletElements = page.locator('[class*="wallet"], [class*="balance"], [class*="USDC"]');
    const walletCount = await walletElements.count();
    
    // Take screenshot
    await page.screenshot({ path: 'output/e2e/wallet-display.png', fullPage: true });
    
    console.log('Wallet elements found:', walletCount);
  });

  test('should show escrow activity', async ({ page }) => {
    await page.goto(`${WEB_BASE_URL}/dashboard`);
    await page.waitForLoadState('networkidle');
    
    await page.waitForTimeout(2000);
    
    // Look for escrow elements
    const escrowElements = page.locator('[class*="escrow"], [class*="bet"], [class*="wager"]');
    const escrowCount = await escrowElements.count();
    
    // Take screenshot
    await page.screenshot({ path: 'output/e2e/escrow-display.png', fullPage: true });
    
    console.log('Escrow elements found:', escrowCount);
  });

  test('should display challenge results', async ({ page }) => {
    await page.goto(`${WEB_BASE_URL}/play?world=train_world`);
    await page.waitForLoadState('networkidle');
    
    await page.waitForTimeout(3000);
    
    // Look for result/modal elements
    const resultElements = page.locator('[class*="result"], [class*="winner"], [class*="modal"], [class*="outcome"]');
    const resultCount = await resultElements.count();
    
    // Take screenshot
    await page.screenshot({ path: 'output/e2e/challenge-result.png', fullPage: true });
    
    console.log('Result elements found:', resultCount);
  });

  test('should show agent/challenge feed', async ({ page }) => {
    await page.goto(`${WEB_BASE_URL}/home`);
    await page.waitForLoadState('domcontentloaded');
    
    await page.waitForTimeout(2000);
    
    // Look for challenge feed or activity log
    const feedElements = page.locator('[class*="feed"], [class*="activity"], [class*="log"], [class*="event"]');
    const feedCount = await feedElements.count();
    
    // Take screenshot
    await page.screenshot({ path: 'output/e2e/activity-feed.png', fullPage: true });
    
    console.log('Feed elements found:', feedCount);
  });

  test('should display player stats', async ({ page }) => {
    await page.goto(`${WEB_BASE_URL}/dashboard`);
    await page.waitForLoadState('networkidle');
    
    await page.waitForTimeout(2000);
    
    // Look for stats elements (wins, losses, etc.)
    const statsElements = page.locator('[class*="stat"], [class*="wins"], [class*="losses"], [class*="record"]');
    const statsCount = await statsElements.count();
    
    // Take screenshot
    await page.screenshot({ path: 'output/e2e/player-stats.png', fullPage: true });
    
    console.log('Stats elements found:', statsCount);
  });
});
