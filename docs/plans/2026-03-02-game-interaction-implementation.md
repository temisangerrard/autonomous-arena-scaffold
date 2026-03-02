# Game Interaction Cleanup Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace mixed legacy station cards with clean game-specific interaction flows, including a tabbed BTC prediction card and a maintained dice station.

**Architecture:** Keep the existing station/runtime architecture, but narrow each game card to a single-purpose rendering path with explicit per-game states. Prediction remains backed by the server market service, but the client only surfaces two fixed BTC rails (`5m`, `24h`) and removes generic market controls entirely.

**Tech Stack:** TypeScript, Vitest, existing web runtime station UI, server station router/market service.

---

### Task 1: Lock prediction card rendering behind fixed BTC tabs

**Files:**
- Modify: `apps/web/public/js/play/runtime/templates/interaction-card.js`
- Test: `apps/web/src/interactionCardVisibility.test.js`

**Step 1: Write the failing test**
Add a test that expects the prediction card to render fixed `BTC 5m` and `BTC 24h` tabs and to omit the market dropdown / generic `YES/NO` controls.

**Step 2: Run test to verify it fails**
Run: `npm run -w @arena/web test -- src/interactionCardVisibility.test.js`
Expected: FAIL because current prediction card still includes legacy controls.

**Step 3: Write minimal implementation**
Refactor prediction rendering to:
- render two fixed tabs
- default to `BTC 5m`
- remove dropdown, `Get quote`, `My positions`, and generic action controls

**Step 4: Run test to verify it passes**
Run: `npm run -w @arena/web test -- src/interactionCardVisibility.test.js`
Expected: PASS

**Step 5: Commit**
```bash
git add apps/web/public/js/play/runtime/templates/interaction-card.js apps/web/src/interactionCardVisibility.test.js
git commit -m "feat(web): switch prediction card to fixed btc tabs"
```

### Task 2: Surface explicit prediction timing and availability states

**Files:**
- Modify: `apps/web/public/js/play/runtime/templates/interaction-card.js`
- Modify: `apps/server/src/markets/MarketService.ts`
- Test: `apps/server/src/markets/MarketService.test.ts`
- Test: `apps/web/src/interactionCardVisibility.test.js`

**Step 1: Write the failing tests**
Add tests for:
- selected rail shows `Live`, `Closing soon`, or `Next round in Xm`
- selected rail shows plain-language question, lock time, and settle time

**Step 2: Run tests to verify they fail**
Run:
```bash
npm run -w @arena/server test -- src/markets/MarketService.test.ts
npm run -w @arena/web test -- src/interactionCardVisibility.test.js
```
Expected: FAIL because the current surface does not expose next-available timing cleanly.

**Step 3: Write minimal implementation**
Expose / derive the selected BTC rail state and render:
- rail status pill
- lock/settle row
- disabled state when no playable current market exists

**Step 4: Run tests to verify they pass**
Run the same two commands.
Expected: PASS

**Step 5: Commit**
```bash
git add apps/server/src/markets/MarketService.ts apps/server/src/markets/MarketService.test.ts apps/web/public/js/play/runtime/templates/interaction-card.js apps/web/src/interactionCardVisibility.test.js
git commit -m "feat(prediction): show btc rail timing and availability"
```

### Task 3: Normalize coinflip, RPS, and dice cards to the same structure

**Files:**
- Modify: `apps/web/public/js/play/runtime/templates/interaction-card.js`
- Test: `apps/web/src/interactionCardVisibility.test.js`

**Step 1: Write the failing tests**
Add tests that each game card includes:
- title
- one-line rule text
- stake input
- only its valid action area

**Step 2: Run test to verify it fails**
Run: `npm run -w @arena/web test -- src/interactionCardVisibility.test.js`
Expected: FAIL because the cards still share inconsistent legacy patterns.

**Step 3: Write minimal implementation**
Refactor the card sections for:
- coinflip
- rps
- dice
Remove invalid cross-game controls.

**Step 4: Run test to verify it passes**
Run: `npm run -w @arena/web test -- src/interactionCardVisibility.test.js`
Expected: PASS

**Step 5: Commit**
```bash
git add apps/web/public/js/play/runtime/templates/interaction-card.js apps/web/src/interactionCardVisibility.test.js
git commit -m "feat(web): normalize game interaction card layout"
```

### Task 4: Keep duplicate hosts playable from their visible positions

**Files:**
- Modify: `apps/web/public/js/play/runtime/world-npc-hosts.js`
- Test: `apps/web/src/worldNpcHosts.test.js`
- Test: `apps/web/src/stationRouting.test.js`

**Step 1: Write the failing test**
Add a test ensuring each proxied host spawn is within the routed station radius.

**Step 2: Run test to verify it fails**
Run: `npm run -w @arena/web test -- src/worldNpcHosts.test.js src/stationRouting.test.js`
Expected: FAIL for host drift.

**Step 3: Write minimal implementation**
Move duplicate host positions so they remain near their canonical routed stations.

**Step 4: Run test to verify it passes**
Run the same command.
Expected: PASS

**Step 5: Commit**
```bash
git add apps/web/public/js/play/runtime/world-npc-hosts.js apps/web/src/worldNpcHosts.test.js apps/web/src/stationRouting.test.js
git commit -m "fix(web): keep proxied npc hosts within station range"
```

### Task 5: Remove redundant prediction fallbacks from server routing

**Files:**
- Modify: `apps/server/src/game/stations/handlers/dealerPrediction.ts`
- Modify: `apps/server/src/game/stations/catalog.ts`
- Test: `apps/server/src/game/stations/catalog.test.ts`
- Test: `apps/server/src/markets/MarketService.test.ts`

**Step 1: Write the failing tests**
Add coverage that the prediction station surface is BTC-only and dice remains present as a canonical station.

**Step 2: Run tests to verify they fail**
Run:
```bash
npm run -w @arena/server test -- src/game/stations/catalog.test.ts src/markets/MarketService.test.ts
```
Expected: FAIL if legacy fallback behavior still leaks.

**Step 3: Write minimal implementation**
Trim dealer prediction routing to the BTC-only station contract used by the UI and confirm dice remains canonical.

**Step 4: Run tests to verify they pass**
Run the same command.
Expected: PASS

**Step 5: Commit**
```bash
git add apps/server/src/game/stations/handlers/dealerPrediction.ts apps/server/src/game/stations/catalog.ts apps/server/src/game/stations/catalog.test.ts apps/server/src/markets/MarketService.test.ts
git commit -m "fix(server): align station handlers with cleaned game surfaces"
```

### Task 6: Full verification and docs update

**Files:**
- Modify: `progress.md`
- Modify: `collaboration.md`

**Step 1: Run focused test suites**
Run:
```bash
npm run -w @arena/server test -- src/game/stations/catalog.test.ts src/markets/MarketService.test.ts
npm run -w @arena/web test -- src/interactionCardVisibility.test.js src/worldNpcHosts.test.js src/stationRouting.test.js
```
Expected: PASS

**Step 2: Run builds**
Run:
```bash
npm run -w @arena/server build
npm run -w @arena/web build
```
Expected: PASS

**Step 3: Update docs**
Record what changed, what was verified, and the branch/worktree used.

**Step 4: Commit**
```bash
git add progress.md collaboration.md
git commit -m "docs: record interaction card cleanup verification"
```
