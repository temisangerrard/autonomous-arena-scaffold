# BTC Board Restore Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Restore the in-game BTC board so it surfaces only internal Chainlink-backed BTC markets and resolves them correctly.

**Architecture:** Reintroduce the prior oracle-market path into `main` by extending `MarketService` to create and resolve Chainlink BTC rails, persisting oracle proof metadata in `markets.raw_json`, and refreshing outcomes in the settlement worker. Update the station interaction card to expose BTC quick actions while keeping the current station interaction transport.

**Tech Stack:** Node.js, TypeScript, Vitest, browser JS, Postgres-backed database layer.

---

### Task 1: Lock failing server tests

**Files:**
- Modify: `apps/server/src/markets/MarketService.test.ts`

**Steps:**
1. Add a failing test proving `listActiveMarketsForPlayer()` creates active `chainlink_btc_usd` markets for `5m` and `24h`.
2. Add a failing test proving `refreshMarketOutcomes()` resolves expired Chainlink markets from stored `rawJson.entryPrice`.
3. Add a failing test proving `SettlementWorker.tick()` calls `refreshMarketOutcomes()` before `settleResolvedMarkets()`.
4. Run the targeted server tests and confirm failure.

### Task 2: Restore server market logic

**Files:**
- Modify: `apps/server/src/markets/MarketService.ts`
- Modify: `apps/server/src/markets/SettlementWorker.ts`
- Modify: `apps/server/src/Database.ts`
- Modify: `.env.example`

**Steps:**
1. Add `rawJson` support to `MarketRecord`, `upsertMarket()`, `listMarkets()`, and `getMarketById()`.
2. Restore Chainlink BTC config/env handling and market lifecycle helpers in `MarketService`.
3. Ensure `ensureAtLeastOneActiveMarket()` creates internal BTC rails first and `listActiveMarketsForPlayer()` prioritizes them.
4. Ensure `refreshMarketOutcomes()` runs from `SettlementWorker.tick()` before settlement.
5. Run targeted server tests and build.

### Task 3: Restore BTC station UI

**Files:**
- Modify: `apps/web/public/js/play/runtime/templates/interaction-card.js`

**Steps:**
1. Add BTC target/status line and `BTC Up (YES)` / `BTC Down (NO)` quick buttons.
2. Wire quick buttons to select the internal BTC market and reuse existing quote/buy station interactions.
3. Keep current station transport; do not revive `/api/player/defi/polymarket/*` calls.
4. Run the relevant web tests/build.

### Task 4: Verify and document

**Files:**
- Modify: `progress.md`
- Modify: `collaboration.md`

**Steps:**
1. Run targeted tests and full package builds for server/web.
2. Record the BTC board restore and verification commands in docs.
3. Commit with a focused message after validation.
