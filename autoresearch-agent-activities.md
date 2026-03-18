# Autoresearch: Agent Activity Coverage

## Session

- **Metric**: Uncovered statements in `apps/agent-runtime/src/AgentBot.ts` (lower is better)
- **Direction**: lower is better
- **Goal**: 0 uncovered statements
- **Benchmark**: `bash autoresearch-agent-activities.sh`
- **Context**: Autoplay is back on. `AgentBot.ts` is the core autonomous bot runtime —
  wager calculation, challenge targeting, session risk stops, move submission — none of it had
  unit tests before this loop began.

## Baseline

| Metric | Value |
|--------|-------|
| Total statements in AgentBot.ts | 368 |
| Covered (before this loop) | 0 (0%) |
| Uncovered (baseline) | 368 |

## Loop Rules (agent instructions)

1. Pick the highest-impact fix (most statements covered per test added).
2. Run `bash autoresearch-agent-activities.sh` to measure the new uncovered count.
3. If the count went down → commit the change and log the run below.
4. If the count went up or stayed the same → revert and try a different fix.
5. Never use blanket mocks that skip the real logic (e.g. no `vi.mock('./AgentBot')`).
6. Tests must exercise real method behavior — not just import the class.
7. Private methods are accessed via `(bot as any).method()` — acceptable for unit testing.
8. Repeat until 0 (or the irreducible WS-dependent floor is reached).

## Run Log

| Run | Uncovered | Δ | Tests | Notes |
|-----|-----------|---|-------|-------|
| 0   | 368 | —    | 0   | Baseline: no AgentBot.test.ts |
| 1   | 179 | −189 | 44  | Round 1: `computeNextWager` (3 modes), `pickAutoplayGame`, `enforceSessionRiskStops`, `updateAutoplayWagerAfterResult`, `resetAutoplaySession`, `restoreAutoplaySession`, `shouldAcceptChallenge` (aggressive/passive), `pickChallengeTarget`, `getStatus`, `updateBehavior`, `updateDisplayName`, `getId`/`isConnected` |
| 2   | 179 | 0    | 55  | Round 2: `maybeSubmitGameMove` (existing move, already submitted, not participant, schedule), `handleChallengeEvent` resolved. Script bug (truncated line ranges) masked improvement — fixed to JSON coverage. |
| 3   | 179 | 0    | 62  | Round 3: `handleChallengeEvent` declined/expired/guard/invalid/busy/created. New tests covered missed paths already counted in run 1 via the old script. |
| 4   | 99  | −80  | 85  | Round 4: `stop()` (timer/ws cleanup), `ensureActive()` (3 guard paths), `updateDisplayName` reconnect path, `maybeSendChallenge` (5 early exits + cooling_down clear). 0% → 73%. |
| 5   | 6   | −93  | 156 | Round 5: `vi.mock('ws')` pattern unlocked WS lifecycle — `connect()`, `open`/`message`/`close`/`error` handlers, `startDecisionLoop`, `onMessage` (welcome/snapshot/proximity/challenge/malformed), reconnect timer, `decideAndSendInput` (passive, stall detection, with others), `maybeSendChallenge` happy path, `sectionFor`, `isInSameOrAdjacentSection`. 73% → 98.4%. |
| 6   | **0** | −6 | 158 | Round 6: `ensureActive(!running)` path (line 211), `decideAndSendInput` with mixed agent/human players (lines 407-416). **100% statement coverage.** |

## Final Coverage Summary

| Metric | Before | After |
|--------|--------|-------|
| Uncovered statements | 368 | **0** |
| Statement coverage | 0% | **100%** |
| Test files | 0 | 2 (`AgentBot.test.ts`, `AgentBot.ws.test.ts`) |
| Test count | 0 | **158** |

## Key Techniques Used

| Technique | Used For |
|-----------|----------|
| Direct class instantiation | All tests — no integration harness needed |
| `(bot as any).method()` for privates | Testing internal logic without exposing APIs |
| Injecting internal state via `priv(bot).field = x` | Setting up scenarios (timers, ws, playerId, etc.) |
| Plain object mock WS (`{ OPEN:1, readyState:1, send }`) | Testing methods that guard on `ws.readyState !== ws.OPEN` |
| `vi.useFakeTimers()` + `vi.runAllTimers()` | Testing `setTimeout` callbacks (response delay, move dispatch) |
| `vi.mock('ws', ...)` + EventEmitter-based `MockWebSocket` | Covering the WS connection lifecycle without a real server |
| `vi.setSystemTime()` | Controlling probabilistic time-modulo gates |
| `afterEach(() => vi.useRealTimers())` | Preventing fake-timer leakage between tests |
