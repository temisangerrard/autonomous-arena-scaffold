# Autonomous Agent Betting Arena

3D browser arena with server-authoritative movement, autonomous agents, challenge lifecycle, and a super-agent control layer.

## Included Now
- Web 3D world using train-station GLB assets
- Server-authoritative movement + proximity events + challenge state machine
- Agent runtime with deterministic bots and super-agent delegation
- Agent control UI for bot tuning, OpenRouter key, and wallet policy skills
- Challenge telemetry feed and operational landing page

## Entry Points
- Welcome/Auth: `http://localhost:3000/welcome`
- Landing hub: `http://localhost:3000/home`
- Player dashboard: `http://localhost:3000/dashboard`
- Play: `http://localhost:3000/play?world=train_world`
- Viewer: `http://localhost:3000/viewer?world=train_world`
- Admin operations panel: `http://localhost:3000/admin`

## Quick Start
1. Install dependencies:
```bash
npm install
```
2. Build all workspaces:
```bash
npm run build
```
3. Run services in separate terminals:
```bash
npm run -w @arena/server start
npm run -w @arena/agent-runtime start
npm run -w @arena/web start
```

Or start local dev watchers together:
```bash
npm run dev:up
```

## Verify
```bash
curl http://localhost:3000/health
curl http://localhost:4000/health
curl http://localhost:4100/health
curl http://localhost:4100/status
curl http://localhost:4000/presence
curl http://localhost:3000/api/chief/v1/heartbeat
```

Chief APIs:
- `GET /api/chief/v1/heartbeat`
- `POST /api/chief/v1/chat`
- Compatibility shim: `POST /api/player/chief/chat`

## Backend Auto-Deploy (GitHub Actions -> Cloud Run)

This repo now includes `.github/workflows/deploy-backend.yml` to auto-deploy:
- `arena-server`
- `arena-runtime`

Triggers:
- push to `main` (only when backend-related paths change)
- manual run via `workflow_dispatch`

Required GitHub repository secret:
- `GCP_SA_KEY`: JSON key for a GCP service account in project `junipalee`

Required IAM permissions for that service account:
- `roles/cloudbuild.builds.editor`
- `roles/run.admin`
- `roles/iam.serviceAccountUser`
- `roles/storage.admin` (for Cloud Build source/upload access)

## Environment
Copy `.env.example` to `.env` and fill values as needed.

Google sign-in scaffold expects:
- `GOOGLE_CLIENT_ID` in web env (OAuth Web Client ID)
- `GOOGLE_NONCE_SECRET` in web env (required in production unless `GAME_WS_AUTH_SECRET` or `INTERNAL_SERVICE_TOKEN` is set)

Local scaffold admin auth (dev-only escape hatch):
- set `LOCAL_AUTH_ENABLED=true` only in local dev
- set `ADMIN_USERNAME` + `ADMIN_PASSWORD` (do not ship defaults)
- set `ADMIN_EMAILS` to promote Google accounts to admin

WebSocket auth:
- set `GAME_WS_AUTH_SECRET` on web + server + agent-runtime to require signed `/ws` connections

Web auth/session persistence:
- file-backed state at `WEB_STATE_FILE` (default `output/web-auth-state.json`, resolved from web process cwd)
- keeps active sessions/identities through local restarts in scaffold mode
- pass-through `clientId` is now used on `/play` websocket to keep the same in-world player id across reconnects

Multiplayer shared presence (new scaffold):
- set `REDIS_URL` to enable Redis-backed presence sync across server instances
- each server advertises `SERVER_INSTANCE_ID`
- server keeps player state in redis keys with ttl `PRESENCE_TTL_SECONDS`
- inspect with `GET /presence` (all players) or `GET /presence?id=<playerId>`

Distributed challenge scaffold (new):
- challenge ownership tracked per challenge id in redis (`ownerServerId`)
- per-player distributed challenge locks prevent duplicate cross-node matches
- direct player event routing via redis bus for non-local participants
- cross-node response/move forwarding to owner node (challenge command bus)
- orphaned open challenges are auto-expired if owner server heartbeat disappears beyond `CHALLENGE_ORPHAN_GRACE_MS`
- distributed recent feed available via `GET /challenges/recent`

Auth UX is available on all pages via top-right shell nav (Home/Profile/Play/Viewer/Agents + login/logout).

## Wallet Skills
Installed via:
```bash
npx skills add coinbase/agentic-wallet-skills --all -y
```

Installed skill ids include:
- `authenticate-wallet`
- `fund`
- `send-usdc`
- `trade`
- `query-onchain-data`
- `pay-for-service`
- `monetize-service`
- `search-for-service`
- `x402`
- `solidity-contract-design` (super-agent capability tag)
- `solidity-security-review` (super-agent capability tag)
- `evm-gas-optimization` (super-agent capability tag)

Super-agent ETH skills source:
- `https://ethskills.com/` (synced into runtime cache via `/super-agent/ethskills/sync`)

## Escrow Execution Modes
Default mode is runtime escrow simulation (fast scaffold).

Set these env vars for optional onchain execution mode:
- `ESCROW_EXECUTION_MODE=onchain`
- `CHAIN_RPC_URL`
- `ESCROW_RESOLVER_PRIVATE_KEY`
- `ESCROW_CONTRACT_ADDRESS`
- `ESCROW_TOKEN_ADDRESS`
- `ESCROW_TOKEN_DECIMALS` (default `6`)
- `INTERNAL_SERVICE_TOKEN` (same value on server + agent-runtime)

When onchain mode is enabled, server escrow adapter calls `BettingEscrow` contract methods:
- `createBet`
- `resolveBet`
- `refundBet`

Automatic wallet prep in onchain mode:
- server calls runtime `/wallets/onchain/prepare-escrow` before each `createBet`
- runtime signs `approve(escrow, amount)` from each participant wallet
- if token exposes open `mint` (e.g. local `MockUSDC`), runtime mints missing balance before approve
- optional gas auto-topup in runtime:
  - `GAS_FUNDING_PRIVATE_KEY` (funder key)
  - `MIN_WALLET_GAS_ETH` (default `0.0003`)
  - `WALLET_GAS_TOPUP_ETH` (default `0.001`)

## Important Asset Note
The large `.glb` world files are intentionally ignored in git to keep repo size/pushes safe.
To run full visuals after clone, place these files in the repo root:
- `train_station_mega_world.glb`
- `train_station_plaza_expanded.glb`
- `train_station_world.glb`

## Current Status + Scope
See:
- `ONE_PAGER.md` for full delivery/status
- `progress.md` for running implementation notes

## Suggested First Git Commit
`feat: bootstrap autonomous arena with super-agent runtime, challenges, and ops control UI`
