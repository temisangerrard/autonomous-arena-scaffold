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

## Verify
```bash
curl http://localhost:3000/health
curl http://localhost:4000/health
curl http://localhost:4100/health
curl http://localhost:4100/status
```

## Environment
Copy `.env.example` to `.env` and fill values as needed.

Google sign-in scaffold expects:
- `GOOGLE_CLIENT_ID` in web env (OAuth Web Client ID)

Local scaffold admin auth is enabled by default:
- username: `admin`
- password: `12345`
- set `LOCAL_AUTH_ENABLED=false` to disable it
- set `ADMIN_EMAILS` to promote Google accounts to admin

Web auth/session persistence:
- file-backed state at `WEB_STATE_FILE` (default `output/web-auth-state.json`, resolved from web process cwd)
- keeps active sessions/identities through local restarts in scaffold mode

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
