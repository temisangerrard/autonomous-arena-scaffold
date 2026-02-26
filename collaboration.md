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
