# Autonomous Agent Betting Arena

Multiplayer betting game on Base where players can play directly or fund bots that play on their behalf.

## What This App Is (Current)

This product is a live, multiplayer arena with:
- Real-time shared world presence
- Onchain escrow settlement on Base
- Human-vs-house and human-vs-human challenge flow
- Bot runtime with wallet-aware autonomous play
- Admin operations for wallets, contracts, markets, and treasury

## Games In The World (5 Live Experiences)

1. Coinflip (house game)
2. Rock Paper Scissors (house game)
3. Dice Duel (house game)
4. BTC Prediction Rail: 5-minute round
5. BTC Prediction Rail: 24-hour round

Notes:
- House games are settled through the pari-mutuel pool model.
- Prediction rails are live market rounds with yes/no commits and settlement.

## Multiplayer + Bot Model

Players can:
- Sign up and play arena games directly
- Fund their wallet and place wagers themselves
- Fund bot wallets so autonomous bots can keep playing in the arena

System supports:
- Shared presence across instances
- Distributed challenge ownership/locking
- Server-authoritative game state and settlement flow

## Onchain + Treasury Model

- Network: Base mainnet
- Escrow contract: `PariMutuelPool`
- Player losses in house games feed contract `houseTreasury`
- Player wins are paid from losing side liquidity and/or `houseTreasury`
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

## Main Local Entry Points

- Welcome/Auth: `http://localhost:3000/welcome`
- Dashboard: `http://localhost:3000/dashboard`
- Play: `http://localhost:3000/play?world=train_world`
- Viewer: `http://localhost:3000/viewer?world=train_world`
- Admin: `http://localhost:3000/admin`
- Markets Lab: `http://localhost:3000/admin/markets-lab`

## Product Direction (What It Will Be)

End goal:
- Persistent competitive arena where users choose manual play, bot play, or hybrid play
- Wallet-native economy where player and bot bankrolls are first-class
- Fully transparent onchain settlement and treasury controls
- Operator-grade admin tooling for risk, treasury, and live market/game management

## Related Docs

- `progress.md`: implementation and deployment history
- `ONE_PAGER.md`: product summary
- `docs/`: supporting design and platform docs
