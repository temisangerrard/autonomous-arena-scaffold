# Autonomous Agent Betting Arena — One Pager

## 1) Current Product State
A browser-based 3D arena is running with server-authoritative movement, autonomous agents, challenge lifecycle, and an operations UI.

- Playable world loaded from existing train station GLB assets
- Multiplayer snapshot model over WebSocket
- Agent runtime with deterministic policies and super-agent delegation
- Challenge system (create/accept/decline/expire/resolve) with telemetry feed
- Operator control surfaces for agents, OpenRouter config, and wallet capability policy

---

## 2) Monorepo Structure
- `/Users/temisan/Downloads/blender implementation/apps/web`
- `/Users/temisan/Downloads/blender implementation/apps/server`
- `/Users/temisan/Downloads/blender implementation/apps/agent-runtime`
- `/Users/temisan/Downloads/blender implementation/apps/contracts` (placeholder)
- `/Users/temisan/Downloads/blender implementation/apps/ops` (placeholder)
- `/Users/temisan/Downloads/blender implementation/packages/shared`
- `/Users/temisan/Downloads/blender implementation/packages/sdk`

Tooling/infra:
- npm workspaces
- TypeScript, ESLint, Vitest
- GitHub Actions CI (`lint`, `typecheck`, `test`)
- Dockerfiles + compose scaffold (compose file exists)

---

## 3) Frontend Surfaces (Web)
### Landing Hub
- URL: `http://localhost:3000/`
- Includes links + live service health + challenge feed

### Play Mode
- URL: `http://localhost:3000/play?world=train_world`
- Third-person camera
- Camera-relative WASD/Arrow movement
- Low-poly avatars with legs + procedural gait
- Realtime HUD:
  - nearby/proximity counts
  - player/agent counts
  - challenge status and feed
- Inputs:
  - `WASD` / arrow keys movement
  - mouse drag camera orbit offset
  - `F` fullscreen
  - `C` send challenge to nearby player
  - `Y/N` accept/decline incoming challenge

### Viewer Mode
- URL: `http://localhost:3000/viewer?world=train_world`
- Orbit inspection of world assets

### Agent Control Panel
- URL: `http://localhost:3000/agents`
- Manage bot count and per-bot behavior
- Configure Super Agent mode/delegation
- Set OpenRouter API key in runtime
- Configure wallet capability policy and allowed wallet skills
- See recent challenge event log

---

## 4) Server Runtime (Game Server)
Core file:
- `/Users/temisan/Downloads/blender implementation/apps/server/src/index.ts`

### Implemented
- Server-authoritative world simulation ticks
- WebSocket gateway (`/ws`) for humans + agents
- Snapshot broadcast (players, positions, roles)
- Proximity enter/exit detection and events
- Challenge state machine integration
- Challenge feed broadcast to clients
- Challenge recent-event API

### Challenge Engine
- `/Users/temisan/Downloads/blender implementation/apps/server/src/ChallengeService.ts`
- States/events:
  - `created`, `accepted`, `declined`, `expired`, `resolved`, `busy`, `invalid`
- Guards:
  - proximity required for challenge create
  - active challenge lock per player
- Timeouts:
  - pending expiry
  - active auto-resolve winner selection (placeholder logic)

---

## 5) Agent Runtime
Core files:
- `/Users/temisan/Downloads/blender implementation/apps/agent-runtime/src/index.ts`
- `/Users/temisan/Downloads/blender implementation/apps/agent-runtime/src/AgentBot.ts`
- `/Users/temisan/Downloads/blender implementation/apps/agent-runtime/src/PolicyEngine.ts`
- `/Users/temisan/Downloads/blender implementation/apps/agent-runtime/src/SuperAgent.ts`

### Implemented
- Multiple autonomous bots connected via WebSocket
- Deterministic personality policy (`aggressive`, `social`, `conservative`)
- Auto movement + challenge send/respond
- Bot stats (sent/received/accepted/declined/won/lost)

### Super Agent Layer
- deterministic delegation to worker bots
- super modes: `balanced`, `hunter`, `defensive`
- worker directives include:
  - personality
  - challenge enabled flag
  - challenge cooldown
  - target preference (`human_only`, `human_first`, `any`)
- LLM policy object (OpenRouter-focused) + budget knobs
- Wallet policy object (skills + risk guardrails)

### Agent Runtime APIs
- `GET /health`
- `GET /status`
- `GET /super-agent/status`
- `POST /super-agent/config`
- `GET /super-agent/delegate/preview`
- `POST /super-agent/delegate/apply`
- `POST /agents/reconcile`
- `POST /agents/:id/config`
- `POST /secrets/openrouter`
- `POST /capabilities/wallet`

---

## 6) Wallet Skill Enablement
Installed wallet skill pack via skills CLI:
- command used: `npx skills add coinbase/agentic-wallet-skills --all -y`

Installed skills include:
- `authenticate-wallet`, `fund`, `send-usdc`, `trade`, `query-onchain-data`, `pay-for-service`, `monetize-service`, `search-for-service`, `x402`

Paths:
- `/Users/temisan/Downloads/blender implementation/.agents/skills/authenticate-wallet`
- `/Users/temisan/Downloads/blender implementation/.agents/skills/fund`
- `/Users/temisan/Downloads/blender implementation/.agents/skills/send-usdc`
- `/Users/temisan/Downloads/blender implementation/.agents/skills/trade`
- (and others listed above)

---

## 7) World Asset Integration
Alias-based serving from root GLBs:
- `train_world`, `train-world`, `mega` -> `train_station_mega_world.glb`
- `plaza` -> `train_station_plaza_expanded.glb`
- `base`, `world` -> `train_station_world.glb`

API:
- `GET /api/worlds`
- `GET /assets/world/:alias.glb`

---

## 8) Test Coverage Added
Server:
- `WorldSim` tests
- `ChallengeService` tests

Agent runtime:
- `PolicyEngine` tests
- `SuperAgent` delegation tests

Web/shared/sdk:
- health + world alias + sdk tests

Workspace checks currently pass:
- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run build`

---

## 9) Known Gaps (Next Milestones)
- No on-chain escrow/contracts integration yet
- No real wallet execution service yet (policy only)
- No real OpenRouter request pipeline yet (config/policy scaffolding exists)
- Challenge resolution is placeholder logic (random winner), not game-type resolver yet
- No leaderboard/profile/history UI yet

---

## 10) Ready For GitHub?
Yes. The repo is now coherent for an initial public/private push with a functioning demo and control plane.

Suggested immediate next commit theme:
- `feat: super-agent delegation, challenge lifecycle, ops landing + agent control panel`

Suggested follow-up branch themes:
1. `feat/escrow-wallet-execution`
2. `feat/openrouter-llm-gateway-budgets`
3. `feat/game-resolvers-and-history`

