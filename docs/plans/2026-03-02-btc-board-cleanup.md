# BTC Board Cleanup Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the BTC board a BTC-only Chainlink rail with no fallback markets, no generic prediction UI, and clean preflight-gated interaction behavior.

**Architecture:** Filter the prediction venue at the server boundary so only playable `chainlink_btc_usd` markets are exposed to the BTC station UI. Simplify the interaction card into a single-purpose BTC rail surface and move click gating ahead of pending state so insufficient balance, gas, proximity, or closed-market states fail immediately and clearly. Remove the fallback market path for this rail so users never see unrelated or synthetic markets on the BTC board.

**Tech Stack:** TypeScript, Vitest, Fly/Netlify deployed web+server apps, shared station UI state, onchain escrow preflight.

---

### Task 1: Lock expected BTC-only market filtering in tests

**Files:**
- Modify: `apps/server/src/markets/MarketService.test.ts`
- Test: `apps/server/src/markets/MarketService.test.ts`

**Step 1: Write the failing test**
- Add a test that seeds both `chainlink_btc_usd` and unrelated `polymarket_gamma` markets.
- Assert `listActiveMarketsForPlayer()` returns only playable BTC Chainlink rails.
- Add a test that closed BTC rails are excluded.

**Step 2: Run test to verify it fails**
Run: `npm run -w @arena/server test -- src/markets/MarketService.test.ts`
Expected: FAIL because unrelated markets are still returned and/or closed markets still appear.

**Step 3: Write minimal implementation**
- Update market listing logic to filter the BTC board surface to:
  - `oracleSource === 'chainlink_btc_usd'`
  - `status !== 'cancelled'`
  - `closeAt > now` for playable order entry
- Preserve settlement handling for already-open positions elsewhere, not in the board picker.

**Step 4: Run test to verify it passes**
Run: `npm run -w @arena/server test -- src/markets/MarketService.test.ts`
Expected: PASS.

**Step 5: Commit**
```bash
git add apps/server/src/markets/MarketService.test.ts apps/server/src/markets/MarketService.ts
git commit -m "fix(server): limit btc board to playable chainlink rails"
```

### Task 2: Remove fallback market creation from the BTC board path

**Files:**
- Modify: `apps/server/src/markets/MarketService.ts`
- Test: `apps/server/src/markets/MarketService.test.ts`

**Step 1: Write the failing test**
- Add a test asserting no fallback market is created or returned when no playable BTC Chainlink market exists.
- Expected result should be an empty list for the board rather than a synthetic fallback market.

**Step 2: Run test to verify it fails**
Run: `npm run -w @arena/server test -- src/markets/MarketService.test.ts`
Expected: FAIL because the fallback market path still creates `fallback_train_world_market`.

**Step 3: Write minimal implementation**
- Remove `ensureFallbackMarket()` usage from the active BTC board listing path.
- Remove or isolate unused fallback helpers if no longer referenced by the prediction rail.
- Keep only Chainlink market ensure/refresh logic for this surface.

**Step 4: Run test to verify it passes**
Run: `npm run -w @arena/server test -- src/markets/MarketService.test.ts`
Expected: PASS.

**Step 5: Commit**
```bash
git add apps/server/src/markets/MarketService.ts apps/server/src/markets/MarketService.test.ts
git commit -m "refactor(server): remove btc board fallback market path"
```

### Task 3: Simplify the BTC interaction card to a single-purpose rail

**Files:**
- Modify: `apps/web/public/js/play/runtime/templates/interaction-card.js`
- Modify: `apps/web/src/interactionCardVisibility.test.js`
- Test: `apps/web/src/interactionCardVisibility.test.js`

**Step 1: Write the failing test**
- Add assertions that the BTC board card no longer renders generic `Get quote`, `My positions`, or general market-picker copy for unrelated markets.
- Add assertions for BTC-only labels such as `BTC Up`, `BTC Down`, and an empty-state message when no BTC rail is live.

**Step 2: Run test to verify it fails**
Run: `npm run -w @arena/web test -- src/interactionCardVisibility.test.js`
Expected: FAIL because the current template still includes generic prediction controls and a generic selector path.

**Step 3: Write minimal implementation**
- Replace the prediction card flow with:
  - BTC-only market tiles/selector
  - `BTC Up` and `BTC Down` actions only
  - no generic `YES/NO`, `Get quote`, or `My positions`
  - no fallback text that implies a generic market venue
- Show only active/playable BTC rails.

**Step 4: Run test to verify it passes**
Run: `npm run -w @arena/web test -- src/interactionCardVisibility.test.js`
Expected: PASS.

**Step 5: Commit**
```bash
git add apps/web/public/js/play/runtime/templates/interaction-card.js apps/web/src/interactionCardVisibility.test.js
git commit -m "fix(web): simplify btc board interaction card"
```

### Task 4: Gate button actions before pending state and map clear inline errors

**Files:**
- Modify: `apps/web/public/js/play/runtime/templates/interaction-card.js`
- Modify: `apps/web/public/js/play/runtime/dealer-reasons.js`
- Test: `apps/web/src/interactionCardVisibility.test.js`

**Step 1: Write the failing test**
- Add a test for immediate inline error handling when balance/gas/market-open requirements are not met.
- Assert the card does not leave buttons stuck in pending state after a rejected preflight/commit path.

**Step 2: Run test to verify it fails**
Run: `npm run -w @arena/web test -- src/interactionCardVisibility.test.js`
Expected: FAIL because the current flow still starts pending UI around generic actions.

**Step 3: Write minimal implementation**
- Keep click handling synchronous until a valid playable BTC market and stake are present.
- Clear pending state immediately on any server-side error.
- Surface reason text inline, not as hanging state.
- Keep toast optional, but card state must remain usable.

**Step 4: Run test to verify it passes**
Run: `npm run -w @arena/web test -- src/interactionCardVisibility.test.js`
Expected: PASS.

**Step 5: Commit**
```bash
git add apps/web/public/js/play/runtime/templates/interaction-card.js apps/web/public/js/play/runtime/dealer-reasons.js apps/web/src/interactionCardVisibility.test.js
git commit -m "fix(web): preflight gate btc board actions"
```

### Task 5: Document the refund-only pool logic in the card

**Files:**
- Modify: `apps/web/public/js/play/runtime/templates/interaction-card.js`
- Test: `apps/web/src/interactionCardVisibility.test.js`

**Step 1: Write the failing test**
- Add an assertion for copy explaining refund behavior when no opposite liquidity exists.

**Step 2: Run test to verify it fails**
Run: `npm run -w @arena/web test -- src/interactionCardVisibility.test.js`
Expected: FAIL because this explanation is not clearly presented today.

**Step 3: Write minimal implementation**
- Add concise copy such as: `If your side wins without opposite liquidity, your stake is refunded.`
- Do not imply the house always pays a winner.

**Step 4: Run test to verify it passes**
Run: `npm run -w @arena/web test -- src/interactionCardVisibility.test.js`
Expected: PASS.

**Step 5: Commit**
```bash
git add apps/web/public/js/play/runtime/templates/interaction-card.js apps/web/src/interactionCardVisibility.test.js
git commit -m "docs(web): explain refund-only btc pool behavior"
```

### Task 6: Run focused verification and update progress docs

**Files:**
- Modify: `progress.md`
- Modify: `collaboration.md`

**Step 1: Run server tests**
Run: `npm run -w @arena/server test -- src/markets/MarketService.test.ts`
Expected: PASS.

**Step 2: Run web tests**
Run: `npm run -w @arena/web test -- src/interactionCardVisibility.test.js src/worldNpcHosts.test.js`
Expected: PASS.

**Step 3: Run builds**
Run: `npm run -w @arena/server build && npm run -w @arena/web build`
Expected: PASS.

**Step 4: Update docs**
- Add the BTC-only rail cleanup and verification commands to `progress.md` and `collaboration.md`.

**Step 5: Commit**
```bash
git add progress.md collaboration.md
git commit -m "docs: record btc board cleanup verification"
```
