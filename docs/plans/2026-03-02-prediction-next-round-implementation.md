# Prediction Next-Round Commits Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add support for committing to the immediately next BTC oracle round with immediate escrow lock, explicit round selection, and price surfaces for spot, lock, and final resolution.

**Architecture:** Keep the current Chainlink BTC rail model, but expand it from a single live market per rail to a two-round window (`current`, `next`). Future commitments create market-scoped scheduled positions that lock escrow immediately but stay excluded from current-round liquidity until promotion.

**Tech Stack:** TypeScript, Vitest, existing MarketService/Database/EscrowAdapter stack, web runtime station UI.

---

### Task 1: Extend market generation to ensure current and next rounds exist

**Files:**
- Modify: `apps/server/src/markets/MarketService.ts`
- Test: `apps/server/src/markets/MarketService.test.ts`

**Step 1: Write the failing test**
Add a test that expects `listActiveMarketsForPlayer()` or a new rail-listing helper to expose both the current and next Chainlink BTC markets per rail.

**Step 2: Run test to verify it fails**
Run: `npm run -w @arena/server test -- src/markets/MarketService.test.ts`
Expected: FAIL because only the current round is created today.

**Step 3: Write minimal implementation**
Update market creation so each configured rail ensures:
- one current market
- one next market
with distinct `marketId` values and raw metadata marking the round role.

**Step 4: Run test to verify it passes**
Run: `npm run -w @arena/server test -- src/markets/MarketService.test.ts`
Expected: PASS

**Step 5: Commit**
```bash
git add apps/server/src/markets/MarketService.ts apps/server/src/markets/MarketService.test.ts
git commit -m "feat(markets): expose current and next btc rounds"
```

### Task 2: Add scheduled market-position state with immediate escrow lock

**Files:**
- Modify: `apps/server/src/Database.ts`
- Modify: `apps/server/src/markets/MarketService.ts`
- Test: `apps/server/src/markets/MarketService.test.ts`

**Step 1: Write the failing tests**
Add coverage for:
- opening a position against the next market id creates a `scheduled` position
- escrow lock still happens immediately
- scheduled positions are tied to the future market id

**Step 2: Run tests to verify they fail**
Run: `npm run -w @arena/server test -- src/markets/MarketService.test.ts`
Expected: FAIL because only `open` positions exist today.

**Step 3: Write minimal implementation**
Add scheduled position creation path and preserve unique escrow bet ids derived from the future market id.

**Step 4: Run tests to verify they pass**
Run the same command.
Expected: PASS

**Step 5: Commit**
```bash
git add apps/server/src/Database.ts apps/server/src/markets/MarketService.ts apps/server/src/markets/MarketService.test.ts
git commit -m "feat(markets): add scheduled next-round positions"
```

### Task 3: Exclude scheduled positions from current-round liquidity and settlement

**Files:**
- Modify: `apps/server/src/markets/MarketService.ts`
- Test: `apps/server/src/markets/MarketService.test.ts`

**Step 1: Write the failing tests**
Add tests showing:
- scheduled positions do not count toward current market liquidity
- prior market settlement does not touch funds for the next market

**Step 2: Run tests to verify they fail**
Run: `npm run -w @arena/server test -- src/markets/MarketService.test.ts`
Expected: FAIL because current open-position logic assumes immediate participation.

**Step 3: Write minimal implementation**
Filter liquidity and settlement to use only eligible positions for the relevant market lifecycle state.

**Step 4: Run tests to verify they pass**
Run the same command.
Expected: PASS

**Step 5: Commit**
```bash
git add apps/server/src/markets/MarketService.ts apps/server/src/markets/MarketService.test.ts
git commit -m "fix(markets): isolate scheduled round liquidity and payouts"
```

### Task 4: Promote scheduled positions when their round opens

**Files:**
- Modify: `apps/server/src/markets/MarketService.ts`
- Test: `apps/server/src/markets/MarketService.test.ts`

**Step 1: Write the failing test**
Add a test expecting scheduled positions for the target market to become `open` when that round becomes the current/live round.

**Step 2: Run test to verify it fails**
Run: `npm run -w @arena/server test -- src/markets/MarketService.test.ts`
Expected: FAIL because no promotion path exists.

**Step 3: Write minimal implementation**
Add promotion logic in the market refresh/settlement lifecycle.

**Step 4: Run test to verify it passes**
Run the same command.
Expected: PASS

**Step 5: Commit**
```bash
git add apps/server/src/markets/MarketService.ts apps/server/src/markets/MarketService.test.ts
git commit -m "feat(markets): promote scheduled positions when round opens"
```

### Task 5: Surface round selector and price states in the prediction card

**Files:**
- Modify: `apps/web/public/js/play/runtime/templates/interaction-card.js`
- Modify: `apps/web/public/js/play/runtime/network/socket-runtime.js`
- Modify: `apps/web/public/js/play/state.js`
- Test: `apps/web/src/interactionCardVisibility.test.js`

**Step 1: Write the failing tests**
Add tests for:
- `Current` / `Next` selector
- `BTC now`, `Lock price`, `Final price`
- next-round copy: `Funds lock immediately.`

**Step 2: Run tests to verify they fail**
Run: `npm run -w @arena/web test -- src/interactionCardVisibility.test.js`
Expected: FAIL because current UI only supports current round and does not show those prices.

**Step 3: Write minimal implementation**
Render round choice within each rail tab and add the spot/lock/final price fields with pending states.

**Step 4: Run test to verify it passes**
Run the same command.
Expected: PASS

**Step 5: Commit**
```bash
git add apps/web/public/js/play/runtime/templates/interaction-card.js apps/web/public/js/play/runtime/network/socket-runtime.js apps/web/public/js/play/state.js apps/web/src/interactionCardVisibility.test.js
git commit -m "feat(web): add current and next round prediction commits"
```

### Task 6: Align prediction handler and payloads to accept next-round target market ids

**Files:**
- Modify: `apps/server/src/game/stations/handlers/dealerPrediction.ts`
- Modify: `apps/server/src/websocket/messages.ts`
- Modify: `packages/shared/src/types/index.ts`
- Test: `apps/server/src/websocket/messages.test.ts`

**Step 1: Write the failing test**
Add coverage that prediction buy actions can carry a valid future market id and still parse/flow correctly.

**Step 2: Run test to verify it fails**
Run: `npm run -w @arena/server test -- src/websocket/messages.test.ts`
Expected: FAIL if the new payload/state is not represented.

**Step 3: Write minimal implementation**
Keep the buy action shape but ensure the handler/runtime accepts the future market id and returns scheduled/open status correctly.

**Step 4: Run test to verify it passes**
Run the same command.
Expected: PASS

**Step 5: Commit**
```bash
git add apps/server/src/game/stations/handlers/dealerPrediction.ts apps/server/src/websocket/messages.ts packages/shared/src/types/index.ts apps/server/src/websocket/messages.test.ts
git commit -m "feat(server): accept next-round prediction commits"
```

### Task 7: Surface scheduled lifecycle in dashboard activity

**Files:**
- Modify: `apps/web/src/server.ts`
- Modify: `apps/web/public/js/dashboard.js`
- Test: existing activity-related tests or add focused coverage where needed

**Step 1: Write the failing test**
Add a test or assertion showing scheduled next-round activity is labeled distinctly from live/open positions.

**Step 2: Run test to verify it fails**
Run the relevant focused dashboard/server test.
Expected: FAIL because scheduled lifecycle is not surfaced today.

**Step 3: Write minimal implementation**
Render scheduled/open/resolved progression with explicit market round context and price fields when available.

**Step 4: Run test to verify it passes**
Run the same focused test command.
Expected: PASS

**Step 5: Commit**
```bash
git add apps/web/src/server.ts apps/web/public/js/dashboard.js
git commit -m "feat(activity): show scheduled next-round prediction lifecycle"
```

### Task 8: Full verification and docs update

**Files:**
- Modify: `progress.md`
- Modify: `collaboration.md`

**Step 1: Run focused tests**
Run:
```bash
npm run -w @arena/server test -- src/markets/MarketService.test.ts src/game/stations/catalog.test.ts src/websocket/messages.test.ts
npm run -w @arena/web test -- src/interactionCardVisibility.test.js src/worldNpcHosts.test.js src/stationMarkers.test.js src/worldStations.test.js
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
Record the next-round commit model, immediate lock behavior, and validation performed.

**Step 4: Commit**
```bash
git add progress.md collaboration.md
git commit -m "docs: record next-round prediction commit work"
```
