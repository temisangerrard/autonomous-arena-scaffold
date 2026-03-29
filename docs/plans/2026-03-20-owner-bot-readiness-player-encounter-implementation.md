# Owner Bot Readiness And Player Encounter Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Gate owner bots on wallet readiness and redesign player-to-player interactions around a staged encounter card instead of a direct challenge composer.

**Architecture:** Add a runtime helper that computes owner-bot wallet readiness from the same `computeWalletReadiness()` path already used by the bot wallet API, then use that helper for reconnect and movement/challenge gating. In the web runtime, extend the existing interaction card state so player interactions become a two-step flow: encounter first, challenge compose second, while keeping the current active-match protocol intact.

**Tech Stack:** TypeScript, vanilla JS runtime UI, Node HTTP routes, shared wallet readiness helpers, Vitest.

---

### Task 1: Add failing owner-bot readiness tests

**Files:**
- Modify: `apps/agent-runtime/src/ownerControl.test.ts`
- Modify: `apps/agent-runtime/src/AgentBot.ws.test.ts`
- Reference: `apps/agent-runtime/src/ownerControl.ts`
- Reference: `apps/agent-runtime/src/AgentBot.ts`

**Step 1: Write the failing tests**
Add tests that prove:
- owner bots should not reconnect when readiness is `insufficient_usdc`
- an owner bot parks movement when readiness is not `ready`

**Step 2: Run tests to verify they fail**
Run:
- `cd apps/agent-runtime && npx vitest run src/ownerControl.test.ts src/AgentBot.ws.test.ts`
Expected: FAIL because readiness is not yet wired into reconnect and movement paths.

**Step 3: Write minimal implementation**
Add only the readiness-aware guard code needed to satisfy those tests.

**Step 4: Run tests to verify they pass**
Run:
- `cd apps/agent-runtime && npx vitest run src/ownerControl.test.ts src/AgentBot.ws.test.ts`
Expected: PASS.

**Step 5: Commit**
```bash
git add apps/agent-runtime/src/ownerControl.test.ts apps/agent-runtime/src/AgentBot.ws.test.ts apps/agent-runtime/src/ownerControl.ts apps/agent-runtime/src/AgentBot.ts
git commit -m "feat: gate owner bots on wallet readiness"
```

### Task 2: Add a runtime helper for bot wallet readiness

**Files:**
- Modify: `apps/agent-runtime/src/index.ts`
- Reference: `apps/agent-runtime/src/walletReadiness.ts`
- Reference: `apps/agent-runtime/src/routes/bots.ts`

**Step 1: Add minimal helper**
Create a helper in `index.ts` that:
- resolves the bot wallet from `botRegistry`
- computes `minWager` from behavior
- calls `computeWalletReadiness()`
- only treats owner bots as readiness-gated

**Step 2: Use helper for reconnect decisions**
Pass the computed readiness status into `shouldOwnerBotReconnect()`.

**Step 3: Use helper for bot runtime accessors**
Inject bot accessors needed for movement/challenge gating without affecting NPC/system bots.

**Step 4: Verify targeted tests**
Run:
- `cd apps/agent-runtime && npx vitest run src/ownerControl.test.ts src/AgentBot.ws.test.ts`
Expected: PASS.

**Step 5: Commit**
```bash
git add apps/agent-runtime/src/index.ts apps/agent-runtime/src/ownerControl.ts apps/agent-runtime/src/AgentBot.ts apps/agent-runtime/src/ownerControl.test.ts apps/agent-runtime/src/AgentBot.ws.test.ts
git commit -m "feat: wire owner bot readiness into runtime decisions"
```

### Task 3: Add failing tests for staged player encounter flow

**Files:**
- Modify: `apps/web/src/interactionShell.test.js`
- Modify: `apps/web/src/interactionCardVisibility.test.js`
- Modify: `apps/web/src/targeting.test.js`

**Step 1: Write the failing tests**
Add tests that prove:
- opening near a player enters `player` interaction mode with encounter view first
- the chosen nearby player target stays locked while the card is open
- challenge controls still send to the rendered target once the challenge subview is open

**Step 2: Run tests to verify they fail**
Run:
- `cd apps/web && npx vitest run src/interactionShell.test.js src/interactionCardVisibility.test.js src/targeting.test.js`
Expected: FAIL because there is no staged player encounter state yet.

**Step 3: Write minimal implementation**
Add only the smallest state/model changes needed for the tests.

**Step 4: Run tests to verify they pass**
Run:
- `cd apps/web && npx vitest run src/interactionShell.test.js src/interactionCardVisibility.test.js src/targeting.test.js`
Expected: PASS.

**Step 5: Commit**
```bash
git add apps/web/src/interactionShell.test.js apps/web/src/interactionCardVisibility.test.js apps/web/src/targeting.test.js apps/web/public/js/play/runtime/interaction-shell.js apps/web/public/js/play/runtime/targeting.js
git commit -m "feat: add staged player encounter targeting"
```

### Task 4: Implement player encounter card view

**Files:**
- Modify: `apps/web/public/js/play/runtime/templates/interaction-card/index.js`
- Modify: `apps/web/public/js/play/runtime/interaction-shell.js`
- Modify: `apps/web/public/js/play/challenge.js`

**Step 1: Add encounter state**
Track:
- `state.ui.playerView`
- locked player target behavior when the interaction card is open

**Step 2: Render encounter-first card**
Render the first player card view with:
- name
- role/state badges
- encounter status text
- primary `Challenge` action

**Step 3: Move challenge composer behind `Challenge`**
Only show wager/game controls after the user enters the challenge subview.

**Step 4: Preserve incoming/outgoing challenge flows**
Keep the existing accept/decline and pending states inside the same card surface.

**Step 5: Verify targeted tests**
Run:
- `cd apps/web && npx vitest run src/interactionShell.test.js src/interactionCardVisibility.test.js src/challengeControls.test.js`
Expected: PASS.

**Step 6: Commit**
```bash
git add apps/web/public/js/play/runtime/templates/interaction-card/index.js apps/web/public/js/play/runtime/interaction-shell.js apps/web/public/js/play/challenge.js apps/web/src/interactionShell.test.js apps/web/src/interactionCardVisibility.test.js apps/web/src/challengeControls.test.js
git commit -m "feat: stage player interactions through encounter cards"
```

### Task 5: Align prompts and target-state copy with the new card model

**Files:**
- Modify: `apps/web/public/js/play/runtime/interaction-shell.js`
- Modify: `apps/web/public/js/play/runtime/player-drawer.js`
- Modify: `apps/web/src/playerDrawer.test.js`

**Step 1: Update prompt copy**
Shift prompt language from `challenge` to `interact`.

**Step 2: Show state-driven encounter copy**
Use `Low Funds`, `Passive`, `Active`, and out-of-range messaging consistently.

**Step 3: Verify tests**
Run:
- `cd apps/web && npx vitest run src/playerDrawer.test.js src/interactionShell.test.js`
Expected: PASS.

**Step 4: Commit**
```bash
git add apps/web/public/js/play/runtime/interaction-shell.js apps/web/public/js/play/runtime/player-drawer.js apps/web/src/playerDrawer.test.js apps/web/src/interactionShell.test.js
git commit -m "feat: align encounter prompts with bot readiness states"
```

### Task 6: Full verification

**Files:**
- No code changes unless verification fails

**Step 1: Run agent-runtime verification**
Run:
- `cd apps/agent-runtime && npx vitest run src/ownerControl.test.ts src/AgentBot.ws.test.ts src/AgentBot.test.ts`
- `cd apps/agent-runtime && npx tsc -p tsconfig.json --noEmit`
Expected: PASS.

**Step 2: Run web verification**
Run:
- `cd apps/web && npx vitest run src/interactionShell.test.js src/interactionCardVisibility.test.js src/targeting.test.js src/challengeControls.test.js src/playerDrawer.test.js`
Expected: PASS.

**Step 3: Review diff**
Run:
- `git diff --stat`
Expected: Only owner-bot runtime, interaction card, and test files changed.

**Step 4: Commit final polish if needed**
```bash
git add apps/agent-runtime/src apps/web/public/js/play/runtime apps/web/public/js/play apps/web/src docs/plans
git commit -m "feat: unify owner bot readiness and player encounter flow"
```
