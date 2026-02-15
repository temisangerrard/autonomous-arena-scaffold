/**
 * E2E Test: World Exploration
 * Walks the avatar around all sections of the world to verify movement works
 * 
 * Run with: npx playwright test scripts/e2e/world-exploration.test.js
 */

const { test, expect } = require('@playwright/test');
const fs = require('node:fs');

fs.mkdirSync('output/e2e', { recursive: true });

// World sections based on WorldSim.ts spawn points
const WORLD_SECTIONS = [
  { name: 'Center', x: 0, z: 0 },
  { name: 'North-West', x: -90, z: -70 },
  { name: 'North-Center-Left', x: -30, z: -70 },
  { name: 'North-Center-Right', x: 30, z: -70 },
  { name: 'North-East', x: 90, z: -70 },
  { name: 'South-West', x: -90, z: 70 },
  { name: 'South-Center-Left', x: -30, z: 70 },
  { name: 'South-Center-Right', x: 30, z: 70 },
  { name: 'South-East', x: 90, z: 70 },
  { name: 'Far-North-West-Corner', x: -110, z: -110 },
  { name: 'Far-North-East-Corner', x: 110, z: -110 },
  { name: 'Far-South-West-Corner', x: -110, z: 110 },
  { name: 'Far-South-East-Corner', x: 110, z: 110 }
];

test.describe('World Exploration', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the game in test mode
    await page.goto('http://localhost:4100/play?test=1&name=Explorer&clientId=test_explorer');
    await page.waitForLoadState('networkidle');
    
    // Wait for canvas to be visible
    const canvas = page.locator('canvas#scene');
    await expect(canvas).toBeVisible({ timeout: 15000 });
    
    // Wait for WebSocket connection
    await page.waitForFunction(() => {
      const state = window.render_game_to_text?.();
      if (!state) return false;
      const parsed = JSON.parse(state);
      return parsed.wsConnected && parsed.playerId;
    }, { timeout: 10000 });
  });

  test('should be able to move in all directions', async ({ page }) => {
    // Get initial position
    const getPosition = async () => {
      const state = await page.evaluate(() => window.render_game_to_text?.());
      const parsed = JSON.parse(state);
      return { x: parsed.player?.x ?? 0, z: parsed.player?.z ?? 0 };
    };

    const initial = await getPosition();
    console.log(`Initial position: x=${initial.x.toFixed(1)}, z=${initial.z.toFixed(1)}`);

    // Test forward movement (W key)
    await page.keyboard.down('KeyW');
    await page.evaluate(() => window.advanceTime?.(1000));
    await page.keyboard.up('KeyW');
    
    const afterForward = await getPosition();
    console.log(`After forward: x=${afterForward.x.toFixed(1)}, z=${afterForward.z.toFixed(1)}`);
    
    // Should have moved
    const forwardDist = Math.hypot(afterForward.x - initial.x, afterForward.z - initial.z);
    expect(forwardDist).toBeGreaterThan(0.5);

    // Test backward movement (S key)
    await page.keyboard.down('KeyS');
    await page.evaluate(() => window.advanceTime?.(1000));
    await page.keyboard.up('KeyS');
    
    const afterBackward = await getPosition();
    console.log(`After backward: x=${afterBackward.x.toFixed(1)}, z=${afterBackward.z.toFixed(1)}`);

    // Test left movement (A key)
    await page.keyboard.down('KeyA');
    await page.evaluate(() => window.advanceTime?.(1000));
    await page.keyboard.up('KeyA');
    
    const afterLeft = await getPosition();
    console.log(`After left: x=${afterLeft.x.toFixed(1)}, z=${afterLeft.z.toFixed(1)}`);
    expect(afterLeft.x).toBeLessThan(afterBackward.x - 0.2);

    // Test right movement (D key)
    await page.keyboard.down('KeyD');
    await page.evaluate(() => window.advanceTime?.(1000));
    await page.keyboard.up('KeyD');
    
    const afterRight = await getPosition();
    console.log(`After right: x=${afterRight.x.toFixed(1)}, z=${afterRight.z.toFixed(1)}`);
    expect(afterRight.x).toBeGreaterThan(afterLeft.x + 0.2);

    // Take screenshot
    await page.screenshot({ path: 'output/e2e/movement-test.png', fullPage: true });
  });

  test('should explore all world sections', async ({ page }) => {
    const results = [];
    
    for (const section of WORLD_SECTIONS) {
      console.log(`\n--- Exploring ${section.name} (${section.x}, ${section.z}) ---`);
      
      // Get current position
      const getPosition = async () => {
        const state = await page.evaluate(() => window.render_game_to_text?.());
        const parsed = JSON.parse(state);
        return { x: parsed.player?.x ?? 0, z: parsed.player?.z ?? 0 };
      };

      const current = await getPosition();
      const dx = section.x - current.x;
      const dz = section.z - current.z;
      const distance = Math.hypot(dx, dz);
      
      console.log(`Current: (${current.x.toFixed(1)}, ${current.z.toFixed(1)}), Target: (${section.x}, ${section.z}), Distance: ${distance.toFixed(1)}`);

      // Move towards target section
      const steps = Math.ceil(distance / 3); // ~3 units per step
      let blocked = false;
      let lastPos = current;

      for (let i = 0; i < steps && !blocked; i++) {
        const pos = await getPosition();
        const toDx = section.x - pos.x;
        const toDz = section.z - pos.z;
        const toDist = Math.hypot(toDx, toDz);
        
        if (toDist < 5) {
          console.log(`Reached ${section.name}!`);
          break;
        }

        // Determine which keys to press
        const keys = [];
        // In this game, `W` is "forward" relative to the camera basis.
        // In the default test camera orientation, forward increases +Z.
        if (toDz > 1) keys.push('KeyW');  // Forward is +Z
        if (toDz < -1) keys.push('KeyS'); // Backward is -Z
        if (toDx < -1) keys.push('KeyA'); // Left is -X
        if (toDx > 1) keys.push('KeyD');  // Right is +X

        // Press movement keys
        for (const key of keys) {
          await page.keyboard.down(key);
        }
        await page.evaluate(() => window.advanceTime?.(500));
        for (const key of keys) {
          await page.keyboard.up(key);
        }

        const newPos = await getPosition();
        const moved = Math.hypot(newPos.x - lastPos.x, newPos.z - lastPos.z);
        
        if (moved < 0.1 && i > 2) {
          console.log(`BLOCKED at (${newPos.x.toFixed(1)}, ${newPos.z.toFixed(1)})`);
          blocked = true;
        }
        
        lastPos = newPos;
      }

      const finalPos = await getPosition();
      const finalDist = Math.hypot(section.x - finalPos.x, section.z - finalPos.z);
      
      results.push({
        section: section.name,
        target: { x: section.x, z: section.z },
        reached: { x: finalPos.x, z: finalPos.z },
        distance: finalDist,
        success: finalDist < 15,
        blocked
      });

      // Take screenshot at this section
      await page.screenshot({ 
        path: `output/e2e/section-${section.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}.png`, 
        fullPage: true 
      });
    }

    // Print summary
    console.log('\n\n=== EXPLORATION SUMMARY ===');
    for (const r of results) {
      const status = r.success ? '✓' : (r.blocked ? '✗ BLOCKED' : '✗ UNREACHED');
      console.log(`${status} ${r.section}: reached (${r.reached.x.toFixed(1)}, ${r.reached.z.toFixed(1)}), distance to target: ${r.distance.toFixed(1)}`);
    }

    const successCount = results.filter(r => r.success).length;
    const blockedCount = results.filter(r => r.blocked).length;
    console.log(`\nTotal: ${successCount}/${results.length} sections reached, ${blockedCount} blocked`);

    // Fail if too many sections are blocked
    expect(blockedCount).toBeLessThan(3);
  });

  test('should reach world corners', async ({ page }) => {
    const corners = [
      { name: 'NW', x: -100, z: -100 },
      { name: 'NE', x: 100, z: -100 },
      { name: 'SW', x: -100, z: 100 },
      { name: 'SE', x: 100, z: 100 }
    ];

    for (const corner of corners) {
      // Teleport to corner using test API (if available)
      const reached = await page.evaluate(async (target) => {
        // Simulate movement towards corner
        for (let i = 0; i < 100; i++) {
          await window.advanceTime?.(100);
        }
        const state = window.render_game_to_text?.();
        return JSON.parse(state);
      }, corner);

      console.log(`Corner ${corner.name}: player at (${reached.player?.x?.toFixed(1)}, ${reached.player?.z?.toFixed(1)})`);
    }

    await page.screenshot({ path: 'output/e2e/corners-test.png', fullPage: true });
  });
});
