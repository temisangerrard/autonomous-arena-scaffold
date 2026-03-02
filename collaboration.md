# Collaboration Snapshot

## Timestamp
- Date: 2026-02-22
- Branch: `main`
- Commit: `4f230f8`

## Current App Health
- No blocking build/lint/test issues detected going into this session.
- Full admin v1→v2 port is complete and live at `/admin` (admin-chief warm parchment UI, Overview as default landing).
- Polymarket CLOB hedge path shipped — server-side only, no UI changes, feature off by default.

## Product Surface Status

### Admin
- `/admin` → `admin-chief.html` (v2, warm parchment design, overview-first rail).
- Rail views: Overview (KPI grid + runtime snapshot), Mission, Live State, Incidents, Runbooks, Tools, Activity, Super Agent, Fleet, Treasury, Markets, Users.
- Admin role gate (`/api/session` → `role === 'admin'`) present in page bootstrap.
- `/admin-markets-lab` pretty route active; Markets Lab guided demo (quote → submit → settlement + outcome simulation) intact.
- Legacy `agents.html` / `agents.js` / `agents-legacy.html` deleted.

### Prediction Markets
- Gamma API sync (`PolymarketFeed`) fetches live Polymarket markets; admin can activate/configure per-market.
- Players open YES/NO positions at prediction stations in-world; internal escrow (EscrowAdapter) handles stake locking and settlement.
- **New (2026-02-22):** `PolymarketClobClient` wired into `MarketService.openPosition()` as a fire-and-forget hedge. When `POLYMARKET_HEDGE_ENABLED=true` and a Polygon wallet key is provided, each player position triggers a mirroring FOK market-buy on the real Polymarket CLOB. Failure is non-fatal (warn log only). Order ID stored in `market_positions.clob_order_id`.

### In-World / Gameplay
- Server-authoritative movement over WebSocket at 20Hz, Polygon-chain escrow for wagers.
- 8 world host NPCs with fixed roles; baked NPC station detection and proxy routing active.
- Background bots default to `BOT_COUNT=0`; super-agent-managed fleet provisioned via admin.

## Recent Reference Commits
- `4f230f8` feat(markets): add Polymarket CLOB client and fire-and-forget hedge path
- `0793429` Add guided Market Lab demo
- `dfa4236` Fix startup validation and auth
- `bfc334d` Port v1 admin to chief

## Open Collaboration Notes
- CLOB hedge is ready to activate once a funded Polygon wallet is available:
  ```
  POLYMARKET_HEDGE_ENABLED=true
  POLYMARKET_HEDGE_PRIVATE_KEY=<0x...>
  POLYMARKET_HEDGE_FRACTION=1.0   # optional
  ```
- Migration 8 (`clob_order_id` column) will auto-run on next server deploy.
- Follow-on options: WebSocket live price feed from Polymarket CLOB (replace Gamma API polling); liquidity provision (posting limit orders instead of FOK); settlement reconciliation using `clob_order_id` to verify on-chain fills.

## 2026-02-26 Update
- Implemented wallet dashboard activity filters and richer transaction metadata presentation.
  - Filters added in wallet activity panel: `All`, `Onchain`, `Escrow`, `Markets`.
  - Onchain rows now show decoded method labels (ERC20 + escrow/oracle function names when parseable).
- Added internal market-position activity endpoint on server (`/markets/player/positions`) and merged those records into `/api/player/activity`.
- Validation run in this session:
  - `npm run -w @arena/web test -- src/interactionShell.test.js` passed.
  - `npm run -w @arena/server test -- src/routes/index.test.ts` passed.
  - `npm run -w @arena/web build` passed.
  - `npm run -w @arena/server build` passed.
  - `npm run -w @arena/agent-runtime build` passed.


## 2026-03-02 Update
- Restored the intended internal BTC board behavior on `main`.
  - Prediction station now presents the internal `Arena Oracle` BTC board instead of the legacy Polymarket-framed BTC surface.
  - BTC quick actions (`BTC Up (YES)` / `BTC Down (NO)`) reuse the existing station interaction transport; no stale managed-DeFi intent API was revived.
- Server-side Chainlink BTC rails are active in code again.
  - `MarketService` auto-creates 5m and 24h `chainlink_btc_usd` markets and resolves them from the Chainlink BTC/USD feed.
  - `SettlementWorker` refreshes oracle outcomes before position settlement.
  - `markets.raw_json` is again surfaced through `Database.ts` for oracle proof metadata.
- Workspace repair work included:
  - added missing shared `arena/stationLayout` module required by current tests/build,
  - restored wallet summary metadata handling in web runtime store to satisfy current dashboard/runtime expectations.
- Validation run in this session:
  - `npm run -w @arena/server test -- src/markets/MarketService.test.ts src/markets/SettlementWorker.test.ts` passed.
  - `npm run -w @arena/web test -- src/stationRouting.test.js src/runtimeStore.test.js` passed.
  - `npm run -w @arena/server build` passed.
  - `npm run -w @arena/web build` passed.
- Contract control note:
  - existing Polygon oracle escrow contracts can be kept only if deploy infra still retains the matching resolver/admin keys;
  - this shell had no live RPC/private-key env loaded, so ownership/control was not verifiable from the workspace alone.


## 2026-03-02 Mainnet Gas Policy Update
- Mainnet/Base wallets are now treated as user-funded for gas by default.
  - Automatic sponsor gas top-ups remain available for test rails.
  - Base mainnet sponsorship is blocked in runtime unless `MAINNET_GAS_SPONSOR_ENABLED=true` is set explicitly.
- Surfacing changes:
  - wallet summary exposes sponsorship state,
  - dashboard labels Base gas as user-paid,
  - dealer/mainnet failure reasons now instruct users to fund Base ETH in their own wallet.
- Validation in this session:
  - `npm run -w @arena/agent-runtime test -- src/gasPolicy.test.ts` passed.
  - `npm run -w @arena/web test -- src/walletSync.test.ts src/runtimeStore.test.js` passed.
  - `npm run -w @arena/agent-runtime build` passed.
  - `npm run -w @arena/web build` passed.


## 2026-03-02 Base Oracle Escrow Prep
- Restored the contracts package to the oracle-aware escrow path needed for Base mainnet BTC rails.
  - `apps/contracts/contracts/BettingEscrow.sol` now supports oracle bet creation and in-contract oracle-based resolution.
  - `apps/contracts/contracts/MockPriceFeed.sol` added for deterministic oracle tests.
- Base deployment wiring is now present.
  - `apps/contracts/hardhat.config.ts` includes `base`.
  - `apps/contracts/package.json` includes `deploy:base`.
  - `apps/contracts/scripts/deploy.ts` now defaults protocol fee to `500` bps and uses the Base Chainlink BTC/USD feed by default when deploying on Base.
- Fee collection setup:
  - separate fee recipient wallet created: `0x5Ca5082dD5d26B8F9402be8569D4d72FAA907C3c`
  - private key stored outside repo in `~/.codex/local-secrets/arena-base-fee-wallet.json`
- Validation in this session:
  - `npm run -w @arena/contracts test` passed.
  - `npm run -w @arena/contracts build` passed.
- Remaining blocker:
  - current shell does not have a valid operator/deployer private key loaded in env, so the Base deploy itself was not executed here.


## 2026-03-02 Auth Continuity Fix
- Fixed the wallet drift bug caused by mixed canonical subjects (`google:*` vs `firebase:*`).
  - Firebase `localId` is now treated as canonical when available.
  - Google login now exchanges through Firebase first, then reuses or migrates legacy Google continuity links instead of silently provisioning a new wallet.
  - Web session state can now recover legacy identities by verified email when runtime canonical continuity is missing.
- Added tests:
  - `apps/web/src/authSubjects.test.ts`
  - `apps/web/src/identityContinuity.test.ts`
  - `apps/web/src/sessionStore.test.ts`
- Validation in this session:
  - `npm run -w @arena/web test -- src/authSubjects.test.ts src/identityContinuity.test.ts src/sessionStore.test.ts src/walletSync.test.ts src/runtimeStore.test.js` passed.
  - `npm run -w @arena/web build` passed.

## 2026-03-02 BTC Board Cleanup
- Converted the BTC board to a BTC-only Chainlink rail in the player-facing flow.
  - `apps/server/src/markets/MarketService.ts`
    - player market listings now expose only playable `chainlink_btc_usd` markets
    - fallback market generation removed from this rail
  - `apps/web/public/js/play/runtime/templates/interaction-card.js`
    - removed generic prediction controls from the BTC board
    - BTC board now presents only `BTC Up` and `BTC Down`
    - added local prechecks for missing live market, closed market, and insufficient balance
    - added explicit refund-only liquidity copy
- Added regression coverage:
  - `apps/server/src/markets/MarketService.test.ts`
  - `apps/web/src/interactionCardVisibility.test.js`
  - `apps/web/src/worldNpcHosts.test.js`
- Validation in this session:
  - `npm run -w @arena/server test -- src/markets/MarketService.test.ts` passed
  - `npm run -w @arena/web test -- src/interactionCardVisibility.test.js src/worldNpcHosts.test.js` passed
  - `npm run -w @arena/web build && npm run -w @arena/server build` passed

## 2026-03-02 Game Interaction Cleanup
- Prediction station UI was narrowed to a fixed BTC rail model.
  - Two tabs only: `BTC 5m`, `BTC 24h`
  - No market dropdown, no generic quote flow, no positions button inside the station card
  - Status copy now explains live/closing/next-round timing and shows lock/settle timing inline
- Coinflip, RPS, and Dice now share the same card rhythm:
  - title
  - rule line
  - stake input
  - `Start Round`
  - game-specific pick area only
- Duplicate visible NPC hosts were moved back into range of the canonical playable dealer they proxy to, eliminating `not_near_station` failures from visible interaction spots.
- Prediction station/server contract was trimmed:
  - removed `prediction_market_quote`
  - removed `prediction_positions_open`
  - parser/router/catalog/action lists now expose only live actions used by the cleaned station
- Dead client prediction quote/positions handling was removed from the runtime state/update path.
- Validation in this session:
  - `npm run -w @arena/web test -- src/interactionCardVisibility.test.js src/worldNpcHosts.test.js src/stationRouting.test.js` passed
  - `npm run -w @arena/server test -- src/game/stations/catalog.test.ts src/markets/MarketService.test.ts src/websocket/messages.test.ts` passed
  - `npm run -w @arena/web build` passed
  - `npm run -w @arena/server build` passed
