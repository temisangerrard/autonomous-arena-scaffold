# Owner Bot Readiness And Player Encounter Design

## Goal
Align owner-bot autonomy with wallet readiness instead of seeded runtime balance, and replace the current player-to-player challenge-first interaction with a staged encounter card that starts from proximity and lets players deliberately choose how to interact.

## Current Problems
- Owner bots still derive movement and challenge eligibility from runtime wallet balance, which can drift from the real wallet state the product treats as authoritative.
- The current player interaction path drops straight into a challenge composer, so walking up to another player or bot does not feel like an interaction. It feels like a wager form.
- Moving bots are hard to challenge because the card is tied to a weak proximity target model instead of an explicit encounter state.
- Legacy interaction behavior still leaks through the prompt language and challenge shortcuts, so the UI can bypass the card mental model.

## Desired Outcome
- Owner bots only reconnect, roam, and initiate play when their wallet readiness is `ready`.
- Passive or low-funds owner bots stay visible but clearly parked.
- Walking up to another player or bot always opens a player encounter card first.
- The encounter card uses the current design system and becomes the sole entry point for player-to-player actions.
- Challenge composition becomes a second step inside that card rather than the first thing the user sees.

## Recommended Approach
### 1. Runtime readiness gating for owner bots
Introduce a runtime helper that computes bot wallet readiness from the same `computeWalletReadiness()` path already used by the bot wallet API. Use it for:
- owner-bot reconnect decisions
- owner-bot movement/challenge gating

Keep system/NPC bots on the internal ledger path so their current funding model does not change.

### 2. Explicit player encounter state in the web runtime
Add a small player-interaction state machine under `state.ui`:
- `playerView: 'encounter' | 'challenge'`
- `lockedPlayerTargetId`

This lets the card keep focus on a specific player or bot while nearby, even if the target is moving.

### 3. Stage player interaction inside the existing card shell
Reuse the current interaction card container, but split player rendering into:
- encounter summary view
- challenge compose view
- incoming challenge view

The first screen should show:
- identity and role
- control state such as `Active`, `Passive`, `Low Funds`
- range/availability state
- clear actions like `Challenge` and `Back`

### 4. Remove direct challenge-first prompt language
The prompt should say `interact` first, not `challenge` first. Challenge remains an available action once the encounter card opens.

## Interaction Model
### Encounter entry
- Proximity plus `E`/tap opens the player encounter card.
- If the user already selected a nearby player, the card stays locked to that player while in range.
- If the target leaves range, the card stays open long enough to show an out-of-range state instead of disappearing abruptly.

### Encounter actions
- `Challenge` moves to the challenge compose subview.
- `Incoming challenge` takes over the action area with accept/decline.
- `Low Funds` disables outgoing challenge and explains why.
- `Passive` keeps the interaction available but marks the target as parked.

### Match transition
- Once a challenge is accepted, the existing active-match flow remains in place.
- The change in this pass is the entry path, not the in-match game loop.

## Scope
### In scope
- Owner-bot readiness helper and runtime gating
- Player encounter state and card rendering
- Prompt copy and target locking improvements
- Tests for runtime gating and player encounter flow

### Out of scope
- Adding new non-challenge social mechanics
- Changing the underlying peer challenge protocol
- Rebuilding the existing active-match renderer

## Risks
- Target locking can feel sticky if out-of-range fallback is not handled cleanly.
- Owner-bot gating could accidentally park NPC/system bots if the readiness split is not explicit.
- Prompt and card changes could break current mobile shortcuts if the tests do not cover them.

## Mitigations
- Keep owner readiness gating restricted to `record.ownerProfileId` bots.
- Add tests for out-of-range player encounter behavior and target preservation.
- Preserve the current challenge controller API and only change how the card enters it.

## Testing Strategy
- Agent-runtime tests for owner-bot readiness gating and reconnect behavior.
- Web tests for interaction shell target locking and player encounter rendering.
- Web regression checks for challenge send path still using the rendered target inside the card.

## Success Criteria
- An owner bot with non-ready wallet readiness does not reconnect, roam, or send challenges.
- A player can walk up to a bot or player, press interact, and see an encounter card before choosing a challenge.
- The encounter card clearly communicates `Low Funds`, `Passive`, or `Active`.
- No old direct interaction path bypasses the card for player-to-player interactions.
