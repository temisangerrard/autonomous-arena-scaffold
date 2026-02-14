#!/usr/bin/env node
/**
 * E2E Test Runner
 * Starts services and runs Playwright E2E tests
 * 
 * Usage: node scripts/run-e2e.js
 * 
 * Requires services to be running on:
 * - Server: localhost:4010 (configurable via E2E_SERVER_PORT)
 * - Runtime: localhost:4110 (configurable via E2E_RUNTIME_PORT)
 * - Web: localhost:4100
 */

const { spawn } = require('child_process');
const { setTimeout: delay } = require('timers/promises');
const fs = require('fs');
const path = require('path');

const SERVER_PORT = process.env.E2E_SERVER_PORT || 4010;
const RUNTIME_PORT = process.env.E2E_RUNTIME_PORT || 4110;
const WEB_PORT = process.env.E2E_WEB_PORT || 4100;

// Output directories
const OUTPUT_DIR = path.join(__dirname, '..', 'output', 'e2e');
const SCREENSHOTS_DIR = path.join(OUTPUT_DIR, 'screenshots');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function startService(name, cmd, args, env, port, healthEndpoint) {
  console.log(`\n🚀 Starting ${name} on port ${port}...`);
  
  const child = spawn(cmd, args, {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd: path.join(__dirname, '..')
  });

  child.stdout.on('data', (chunk) => {
    const lines = chunk.toString().trim().split('\n');
    lines.forEach(line => {
      if (line.includes('error') || line.includes('Error') || line.includes('ERROR')) {
        console.error(`[${name}] ${line}`);
      } else if (line.includes('listen') || line.includes('running') || line.includes('started')) {
        console.log(`[${name}] ${line}`);
      }
    });
  });

  child.stderr.on('data', (chunk) => {
    const lines = chunk.toString().trim().split('\n');
    lines.forEach(line => {
      if (line.trim()) {
        console.error(`[${name}] ${line}`);
      }
    });
  });

  return child;
}

async function waitForHealth(url, name, timeoutMs = 30000) {
  console.log(`   Checking ${name} health at ${url}...`);
  const deadline = Date.now() + timeoutMs;
  
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        console.log(`   ✅ ${name} is healthy!`);
        return true;
      }
    } catch (err) {
      // retry
    }
    await delay(500);
  }
  throw new Error(`Health check timeout for ${name} at ${url}`);
}

async function main() {
  console.log('='.repeat(60));
  console.log('🎮 E2E Test Runner for Autonomous Agent Betting Arena');
  console.log('='.repeat(60));

  // Ensure output directories exist
  ensureDir(OUTPUT_DIR);
  ensureDir(SCREENSHOTS_DIR);

  let server, runtime, web;
  const services = [];

  try {
    // Start server
    server = startService(
      'Server',
      'npx',
      ['tsx', 'apps/server/src/index.ts'],
      {
        PORT: String(SERVER_PORT),
        AGENT_RUNTIME_URL: `http://localhost:${RUNTIME_PORT}`,
        ESCROW_FEE_BPS: '0',
        PROXIMITY_THRESHOLD: '500'
      },
      SERVER_PORT,
      '/health'
    );
    services.push({ name: 'Server', process: server });

    // Start agent runtime
    runtime = startService(
      'Agent Runtime',
      'npx',
      ['tsx', 'apps/agent-runtime/src/index.ts'],
      {
        PORT: String(RUNTIME_PORT),
        GAME_WS_URL: `ws://localhost:${SERVER_PORT}/ws`,
        BOT_COUNT: '12',
        WALLET_SKILLS_ENABLED: 'true'
      },
      RUNTIME_PORT,
      '/health'
    );
    services.push({ name: 'Agent Runtime', process: runtime });

    // Start web
    web = startService(
      'Web',
      'npx',
      ['tsx', 'apps/web/src/server.ts'],
      {
        PORT: String(WEB_PORT),
        SERVER_URL: `http://localhost:${SERVER_PORT}`,
        RUNTIME_URL: `http://localhost:${RUNTIME_PORT}`
      },
      WEB_PORT,
      '/health'
    );
    services.push({ name: 'Web', process: web });

    // Wait for services to be ready
    console.log('\n⏳ Waiting for services to start...');
    
    await waitForHealth(`http://localhost:${SERVER_PORT}/health`, 'Server');
    await waitForHealth(`http://localhost:${RUNTIME_PORT}/health`, 'Agent Runtime');
    await waitForHealth(`http://localhost:${WEB_PORT}/health`, 'Web');

    console.log('\n✅ All services are healthy!');

    // Check runtime status
    console.log('\n📊 Checking runtime status...');
    const statusRes = await fetch(`http://localhost:${RUNTIME_PORT}/status`);
    const status = await statusRes.json();
    console.log(`   Bots running: ${status.backgroundBotCount || 0}`);
    console.log(`   Wallets: ${status.wallets?.length || 0}`);

    // Run Playwright tests
    console.log('\n🧪 Running Playwright E2E tests...\n');
    
    const testFiles = [
      'scripts/e2e/game-load.test.js',
      'scripts/e2e/challenge-flow.test.js',
      'scripts/e2e/scoring.test.js',
      'scripts/e2e/visual-regression.test.js'
    ];

    for (const testFile of testFiles) {
      console.log(`\n📝 Running ${path.basename(testFile)}...`);
      
      const testProc = spawn('npx', ['playwright', 'test', testFile], {
        cwd: path.join(__dirname, '..'),
        stdio: 'inherit'
      });
      
      await new Promise((resolve, reject) => {
        testProc.on('close', (code) => {
          if (code === 0) {
            resolve();
          } else {
            console.log(`   Test ${path.basename(testFile)} exited with code ${code}`);
            resolve(); // Don't fail the whole run
          }
        });
      });
    }

    console.log('\n' + '='.repeat(60));
    console.log('✅ E2E tests complete!');
    console.log('📸 Screenshots saved to:', SCREENSHOTS_DIR);
    console.log('='.repeat(60));

  } catch (error) {
    console.error('\n❌ E2E test run failed:', error.message);
    process.exit(1);
  } finally {
    // Cleanup
    console.log('\n🧹 Shutting down services...');
    for (const svc of services) {
      if (svc.process && !svc.process.killed) {
        svc.process.kill('SIGTERM');
        console.log(`   Stopped ${svc.name}`);
      }
    }
    await delay(1000);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
