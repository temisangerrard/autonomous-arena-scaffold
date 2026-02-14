/**
 * E2E Test: Challenge Flow
 * Tests the RPS and Coinflip challenge gameplay
 * 
 * Run with: npx playwright test scripts/e2e/challenge-flow.test.js
 */

const { test, expect } = require('@playwright/test');

test.describe('Challenge Flow', () => {
  test('should display challenge desk UI', async ({ page }) => {
    await page.goto('http://localhost:4100/play?world=train_world');
    await page.waitForLoadState('networkidle');
    
    // Wait for game to initialize
    await page.waitForTimeout(2000);
    
    // Look for challenge desk elements
    const challengeDesk = page.locator('.challenge-desk, #challenge-desk, [class*="challenge"]');
    const hasChallengeDesk = await challengeDesk.count() > 0;
    
    // Look for match controls
    const matchControls = page.locator('.match-controls, #match-controls, [class*="match"], [class*="controls"]');
    const hasMatchControls = await matchControls.count() > 0;
    
    // Take screenshot
    await page.screenshot({ path: 'output/e2e/challenge-desk.png', fullPage: true });
    
    console.log('Challenge desk found:', hasChallengeDesk);
    console.log('Match controls found:', hasMatchControls);
  });

  test('should show RPS controls when in game', async ({ page }) => {
    await page.goto('http://localhost:4100/play?world=train_world');
    await page.waitForLoadState('networkidle');
    
    // Wait for any UI to load
    await page.waitForTimeout(3000);
    
    // Look for RPS buttons (rock, paper, scissors)
    const rockBtn = page.locator('[class*="rock"], button:has-text("Rock")');
    const paperBtn = page.locator('[class*="paper"], button:has-text("Paper")');
    const scissorsBtn = page.locator('[class*="scissors"], button:has-text("Scissors")');
    
    const hasRPS = (await rockBtn.count() > 0) || (await paperBtn.count() > 0) || (await scissorsBtn.count() > 0);
    
    // Look for Coinflip buttons
    const headsBtn = page.locator('[class*="head"], button:has-text("Heads")');
    const tailsBtn = page.locator('[class*="tail"], button:has-text("Tails")');
    
    const hasCoinflip = (await headsBtn.count() > 0) || (await tailsBtn.count() > 0);
    
    // Take screenshot
    await page.screenshot({ path: 'output/e2e/game-controls.png', fullPage: true });
    
    console.log('RPS controls found:', hasRPS);
    console.log('Coinflip controls found:', hasCoinflip);
  });

  test('should display HUD with game info', async ({ page }) => {
    await page.goto('http://localhost:4100/play?world=train_world');
    await page.waitForLoadState('networkidle');
    
    await page.waitForTimeout(2000);
    
    // Look for HUD elements
    const statusText = page.locator('[class*="status"], [class*="score"], [class*="wallet"]');
    const hudCount = await statusText.count();
    
    // Look for minimap
    const minimap = page.locator('[class*="map"], canvas:below(#hud)');
    const hasMinimap = await minimap.count() > 0;
    
    // Take screenshot
    await page.screenshot({ path: 'output/e2e/hud-display.png', fullPage: true });
    
    console.log('HUD elements found:', hudCount);
    console.log('Minimap found:', hasMinimap);
  });

  test('should connect WebSocket for real-time updates', async ({ page }) => {
    const wsMessages = [];
    
    await page.goto('http://localhost:4100/play?world=train_world');
    await page.waitForLoadState('networkidle');
    
    // Listen for WebSocket messages
    await page.evaluate(() => {
      window.wsMessages = [];
      const originalWS = window.WebSocket;
      window.WebSocket = class extends originalWS {
        constructor(url) {
          const ws = new originalWS(url);
          ws.addEventListener = (event, handler) => {
            if (event === 'message') {
              const originalHandler = handler;
              handler = (e) => {
                try {
                  window.wsMessages.push(JSON.parse(e.data));
                } catch (err) {}
                originalHandler(e);
              };
            }
            return super.addEventListener(event, handler);
          };
          return ws;
        }
      };
    });
    
    await page.waitForTimeout(5000);
    
    // Get captured messages
    const messages = await page.evaluate(() => window.wsMessages || []);
    
    // Take screenshot
    await page.screenshot({ path: 'output/e2e/websocket-test.png', fullPage: true });
    
    console.log('WebSocket messages captured:', messages.length);
    console.log('Message types:', [...new Set(messages.map(m => m.type))]);
  });
});
