# House Funds Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a consolidated admin view of all house-controlled funds and support moving funds from each surfaced source.

**Architecture:** Extend the agent-runtime on-chain status payload so it returns a normalized `houseFunds` object that itemizes contract treasury, house-owned on-chain wallet balance, and runtime house wallet balance. Update the admin UI to render these sources as one grouped treasury surface with per-source actions, then add backend tests and UI tests to keep the accounting truthful.

**Tech Stack:** TypeScript, Node HTTP routes, viem/ethers contract reads, vanilla JS admin UI, Vitest.

---

### Task 1: Add failing route tests for consolidated house funds payload

**Files:**
- Modify: `apps/agent-runtime/src/routes/wallets.test.ts`
- Reference: `apps/agent-runtime/src/routes/wallets.ts`

**Step 1: Write the failing test**
Add a focused test that expects `/onchain/status` to return:
- `houseFunds.totalVisibleUsdc`
- `houseFunds.sources`
- a `contract_treasury` source
- a `runtime_wallet` source
- a `house_wallet_onchain` source for the `system_house` wallet

**Step 2: Run test to verify it fails**
Run: `npm -w @arena/agent-runtime test -- src/routes/wallets.test.ts`
Expected: FAIL because `houseFunds` is not present.

**Step 3: Write minimal implementation**
Implement only the response-shape code required to satisfy the new test.

**Step 4: Run test to verify it passes**
Run: `npm -w @arena/agent-runtime test -- src/routes/wallets.test.ts`
Expected: PASS for the new payload test.

**Step 5: Commit**
```bash
git add apps/agent-runtime/src/routes/wallets.test.ts apps/agent-runtime/src/routes/wallets.ts
git commit -m "test: cover consolidated house funds payload"
```

### Task 2: Add failing route tests for house-wallet token transfer action

**Files:**
- Modify: `apps/agent-runtime/src/routes/wallets.test.ts`
- Modify: `apps/agent-runtime/src/routes/wallets.ts`

**Step 1: Write the failing test**
Add a test for a new internal route that transfers tokens from the house-owned on-chain wallet to a recipient and returns updated source balance metadata.

**Step 2: Run test to verify it fails**
Run: `npm -w @arena/agent-runtime test -- src/routes/wallets.test.ts`
Expected: FAIL because the route does not exist.

**Step 3: Write minimal implementation**
Add the route and gate it behind existing internal auth. Use the backend signer path already used for treasury withdrawal/contract calls.

**Step 4: Run test to verify it passes**
Run: `npm -w @arena/agent-runtime test -- src/routes/wallets.test.ts`
Expected: PASS.

**Step 5: Commit**
```bash
git add apps/agent-runtime/src/routes/wallets.test.ts apps/agent-runtime/src/routes/wallets.ts
git commit -m "feat: add house wallet transfer action"
```

### Task 3: Implement consolidated house-funds aggregation

**Files:**
- Modify: `apps/agent-runtime/src/routes/wallets.ts`
- Reference: `apps/agent-runtime/src/index.ts`

**Step 1: Add minimal aggregation helpers**
Create helper logic in `wallets.ts` to build normalized source entries:
- `contract_treasury`
- `house_wallet_onchain`
- `runtime_wallet`

Include fields:
- `sourceType`
- `label`
- `balanceUsdc`
- `walletId` where relevant
- `address` where relevant
- `withdrawAction` or `transferAction` capability flags

**Step 2: Keep totals explicit**
Compute `totalVisibleUsdc` only from surfaced sources and return it under `houseFunds`.

**Step 3: Preserve existing payload compatibility**
Do not remove existing `houseTreasury`, `wallets`, or status fields in this task.

**Step 4: Verify route tests**
Run: `npm -w @arena/agent-runtime test -- src/routes/wallets.test.ts`
Expected: PASS.

**Step 5: Commit**
```bash
git add apps/agent-runtime/src/routes/wallets.ts apps/agent-runtime/src/routes/wallets.test.ts
git commit -m "feat: aggregate house-controlled funds"
```

### Task 4: Add failing admin UI tests for consolidated house funds rendering

**Files:**
- Modify: `apps/web/src/chief2.test.ts` or relevant admin test file
- Modify: `apps/web/public/js/admin-chief.js`

**Step 1: Write the failing test**
Add a UI test expecting admin rendering to show:
- consolidated total
- source rows for treasury / house wallet / runtime wallet
- correct labels and balances

**Step 2: Run test to verify it fails**
Run: `npm -w @arena/web test -- src/chief2.test.ts`
Expected: FAIL because the new rendering is absent.

**Step 3: Write minimal implementation**
Update admin rendering logic to consume `houseFunds` and render grouped sources without removing the existing wallet table.

**Step 4: Run test to verify it passes**
Run: `npm -w @arena/web test -- src/chief2.test.ts`
Expected: PASS.

**Step 5: Commit**
```bash
git add apps/web/public/js/admin-chief.js apps/web/src/chief2.test.ts
git commit -m "feat: render consolidated house funds in admin"
```

### Task 5: Wire admin actions to the correct source type

**Files:**
- Modify: `apps/web/public/js/admin-chief.js`
- Modify: `apps/web/src/server.ts`
- Reference: `apps/agent-runtime/src/routes/wallets.ts`

**Step 1: Add source-aware action handlers**
Support:
- contract treasury withdraw via existing route
- house wallet transfer via new route
- runtime transfer/refill via existing runtime routes, clearly labeled

**Step 2: Keep labels explicit**
Use copy that distinguishes:
- `On-chain treasury`
- `House wallet (on-chain)`
- `House wallet (runtime)`

**Step 3: Verify targeted tests**
Run:
- `npm -w @arena/web test -- src/chief2.test.ts`
- `npm -w @arena/agent-runtime test -- src/routes/wallets.test.ts`
Expected: PASS.

**Step 4: Commit**
```bash
git add apps/web/public/js/admin-chief.js apps/web/src/server.ts apps/agent-runtime/src/routes/wallets.ts apps/agent-runtime/src/routes/wallets.test.ts apps/web/src/chief2.test.ts
git commit -m "feat: add source-aware house funds actions"
```

### Task 6: Add operator traceability for where money sits

**Files:**
- Modify: `apps/web/public/js/admin-chief.js`
- Modify: `apps/agent-runtime/src/routes/wallets.ts`

**Step 1: Expose explanatory source metadata**
Return lightweight descriptions per source, e.g.:
- treasury funded by one-sided losses / house-game losses
- house wallet used for ops liquidity
- runtime wallet used for internal refills

**Step 2: Render operator-facing hints**
Show a compact note near the total clarifying that funds may exist across multiple house-controlled sources.

**Step 3: Verify tests**
Run:
- `npm -w @arena/web test -- src/chief2.test.ts`
- `npm -w @arena/agent-runtime test -- src/routes/wallets.test.ts`
Expected: PASS.

**Step 4: Commit**
```bash
git add apps/web/public/js/admin-chief.js apps/agent-runtime/src/routes/wallets.ts apps/web/src/chief2.test.ts apps/agent-runtime/src/routes/wallets.test.ts
git commit -m "feat: explain house funds sources in admin"
```

### Task 7: Full verification

**Files:**
- No code changes unless verification fails

**Step 1: Run runtime tests**
Run: `npm -w @arena/agent-runtime test -- src/routes/wallets.test.ts`
Expected: PASS.

**Step 2: Run web tests**
Run: `npm -w @arena/web test -- src/chief2.test.ts`
Expected: PASS.

**Step 3: Run typechecks**
Run:
- `npm run -w @arena/agent-runtime typecheck`
- `npm run -w @arena/web typecheck`
Expected: PASS.

**Step 4: Review diff for surface correctness**
Run: `git diff --stat && git diff -- apps/agent-runtime/src/routes/wallets.ts apps/web/public/js/admin-chief.js apps/web/src/server.ts`
Expected: Only intended files changed.

**Step 5: Commit final polish if needed**
```bash
git add apps/agent-runtime/src/routes/wallets.ts apps/agent-runtime/src/routes/wallets.test.ts apps/web/public/js/admin-chief.js apps/web/src/server.ts apps/web/src/chief2.test.ts package-lock.json
git commit -m "feat: surface and manage consolidated house funds"
```
