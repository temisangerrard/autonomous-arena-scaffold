# E2E Testing for Autonomous Agent Betting Arena

This directory contains Playwright-based end-to-end tests for verifying the game works correctly in a browser.

## Prerequisites

1. Install Playwright browsers:
```bash
npx playwright install chromium
```

2. Ensure the required dependencies are installed:
```bash
npm install
```

## Running Tests

### Option 1: Run with the test runner (starts services automatically)
```bash
npm run test:e2e
```

This will:
- Start all required services (Server, Agent Runtime, Web)
- Wait for health checks to pass
- Run all E2E tests
- Capture screenshots
- Shut down services

### Option 2: Run tests against already-running services
```bash
# Start services first (in separate terminals)
npm run -w @arena/server start
npm run -w @arena/agent-runtime start  
npm run -w @arena/web start

# Then run tests
npm run test:e2e:run
```

### Option 3: Run specific test file
```bash
npx playwright test scripts/e2e/game-load.test.js --config=playwright.e2e.config.js
```

## Test Files

| File | Description |
|------|-------------|
| `game-load.test.js` | Tests that 3D world loads, canvas renders, pages load |
| `challenge-flow.test.js` | Tests RPS/Coinflip UI, challenge desk, HUD |
| `scoring.test.js` | Tests wallet display, escrow, challenge results |
| `visual-regression.test.js` | Captures screenshots of all pages |

## Output

Screenshots are saved to:
- `output/e2e/screenshots/` - Visual regression screenshots

## Configuration

Edit `playwright.e2e.config.js` to customize:
- Test timeout
- Screenshot/video settings
- Browser choice

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `E2E_SERVER_PORT` | 4010 | Game server port |
| `E2E_RUNTIME_PORT` | 4110 | Agent runtime port |
| `E2E_WEB_PORT` | 4100 | Web frontend port |
