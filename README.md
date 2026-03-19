# Autonomous Agent Betting Arena

Multiplayer betting game on Base where players can play directly or fund bots that play on their behalf.

## Current State

This app is currently a live multiplayer arena with:
- Real-time shared world presence
- Onchain settlement on Base
- Dealer/station games plus live prediction rails
- Email auth with Firebase-backed login
- Single-actor human/bot handoff per player profile
- Owner-bot autoplay when the owner is offline
- Admin/runtime/treasury controls for operators

Bot model:
- One player profile owns exactly one in-world actor
- Human and bot never control that actor at the same time
- When the human is online, the bot is parked
- When the human goes offline and autoplay is enabled, the bot can resume roaming play

## Recent Progress

Recent shipped work includes:
- Single-actor owner-bot handoff flow
- Clearer dashboard and in-game drawer bot states
- Save feedback for autoplay/bot config flows
- Logout and presence cleanup fixes
- WebSocket-authoritative owner presence
- Email/password auth support
- Browser and backend builder-code tagging
- Restored live owner-bot roaming connectivity

Live verified:
- Owner bots can reconnect and roam when the owner is offline
- Two owner bots are currently capable of roaming and challenging each other when autoplay is enabled and target preference allows it

## World + Games (Current)

Current world structure:
- Compact arena layout with dealer/cashier/info stations around the central train
- Static house/station NPCs for dealer interactions
- Roaming player-owned bots when autoplay is enabled
- Shared world presence across server instances

Live game surfaces:
1. Coinflip (house game)
2. Rock Paper Scissors (house game)
3. Dice Duel (house game)
4. Blackjack (dealer station)
5. BTC Prediction Rail: 5-minute round
6. BTC Prediction Rail: 24-hour round

Notes:
- Dealer/station games and prediction rails are separate world surfaces.
- Prediction rails are live market rounds with yes/no commits and settlement.
- Autoplay bot targeting is currently bot/player based; house-station autoplay is not yet part of the roaming bot loop.

## Multiplayer + Bot Model

Players can:
- Sign up and play arena games directly
- Fund their wallet and place wagers directly
- Configure autoplay so their bot can roam while they are offline

System supports:
- Shared presence across instances
- Distributed challenge ownership/locking
- Server-authoritative game state and settlement flow
- WebSocket-authoritative owner presence for bot handoff

## Onchain + Treasury Model

- Network: Base mainnet
- Escrow contract: `PariMutuelPool`
- Onchain mode is the only supported escrow mode
- Admin treasury now supports:
  - Controlled wallet operations
  - Internal transfers
  - External withdraw (paste recipient)
  - House treasury visibility and withdrawal

## Admin/Ops Capabilities

Admin panel includes:
- Arena ops (profiles, bots, balances)
- Treasury ops (wallets + contract ops + risk/recovery)
- Markets lab and market controls
- User operations (presence, wallet adjust, teleport, logout)
- Runtime health/incident/activity visibility

## Architecture

- `apps/web`: web app + auth/session + admin proxy
- `apps/server`: multiplayer game server + challenge lifecycle + settlement orchestration
- `apps/agent-runtime`: bot runtime + wallet ops + onchain wallet helpers
- `apps/contracts`: onchain escrow contracts (pari-mutuel pool + related scripts)
- `packages/shared`: shared types/contracts

## Local Run

Install:
```bash
npm install
```

Build:
```bash
npm run build
```

Run services:
```bash
npm run -w @arena/server start
npm run -w @arena/agent-runtime start
npm run -w @arena/web start
```

Or dev-up:
```bash
npm run dev:up
```

## Production Config Notes

Critical production expectations:
- `GAME_WS_URL` must point at the real game server WebSocket endpoint or roaming bots will never connect
- `INTERNAL_SERVICE_TOKEN` must match across services that call internal runtime/server routes
- Onchain mode is the only supported escrow execution mode

## Main Local Entry Points

- Welcome/Auth: `http://localhost:3000/welcome`
- Dashboard: `http://localhost:3000/dashboard`
- Play: `http://localhost:3000/play?world=train_world`
- Viewer: `http://localhost:3000/viewer?world=train_world`
- Admin: `http://localhost:3000/admin`
- Markets Lab: `http://localhost:3000/admin/markets-lab`

## Known Gaps / Next Work

- World spectacle and exploration layers are still thin
- Ambient audio/music is still missing
- Roaming bots do not yet fall back to house stations automatically
- Spectator surfaces need richer in-world visibility

## Related Docs

- `progress.md`: implementation and deployment history
- `ONE_PAGER.md`: product summary
- `docs/`: supporting design and platform docs
