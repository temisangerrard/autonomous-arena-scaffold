# House Funds Design

## Goal
Provide one admin surface that shows every house-controlled balance, explains where each balance comes from, and lets operators move funds out of each source without guessing whether money is in runtime memory, an on-chain treasury, or a house-owned wallet.

## Current Problem
The repo currently exposes at least three different house money buckets:
- Runtime house wallet balance from `apps/agent-runtime/src/index.ts`
- On-chain `houseTreasury` from `PariMutuelPool`
- Server-side in-memory `housePool` mirror in `apps/server/src/index.ts`

These are surfaced inconsistently. The admin UI labels one balance as the house balance even though dealer-game losses settle into `houseTreasury`, and prediction-market outcomes can move money through shared pool settlement rather than the runtime wallet. That makes a real loss look "missing" even when the value still exists elsewhere.

## Desired Outcome
The admin treasury area should expose a consolidated view with itemized sources:
- `contract_treasury`: on-chain `PariMutuelPool.houseTreasury`
- `house_wallet_onchain`: on-chain token balance of the house-owned wallet address
- `runtime_wallet`: runtime/internal house wallet balance used for ops and NPC liquidity

The UI should show:
- per-source balance
- total visible house-controlled funds
- source type and mutability
- available action for that source

The backend should support:
- reading all sources in one payload
- withdrawing from contract treasury via existing `withdrawTreasury`
- transferring from the house-owned on-chain wallet via backend signer
- keeping runtime-wallet transfers explicitly separate and labeled as runtime-only

## Accounting Model
This change does not force all games into one economic model. It only makes all house-controlled balances visible in one place.

Rules:
- Dealer-house games can credit `houseTreasury`
- Prediction markets may credit either winners or treasury depending on settlement path and liquidity
- Runtime wallet balance is operational liquidity, not automatically game revenue
- The consolidated admin view sums all house-controlled buckets but retains source-level provenance

## Scope
### In scope
- Consolidated house-funds API payload in agent runtime wallet routes
- Admin UI changes to display total + per-source balances
- Per-source actions for treasury withdraw and house-wallet token transfer
- Recent accounting hints / source labels in admin for operator traceability
- Tests for new route payloads and UI rendering logic

### Out of scope
- Rewriting prediction-market economics
- Removing `housePool` from server settlement logic in this pass
- Historical reconciliation of old bets from unavailable persistence

## Recommended Approach
Use the agent-runtime on-chain status route as the aggregation point.

Why:
- It already has access to provider, token, escrow contract, house wallet records, and internal auth
- It already exposes `houseTreasury` and wallet on-chain balances
- It is the least disruptive place to assemble a truthful funds snapshot for the admin UI

Implementation shape:
- extend `/onchain/status` response with a `houseFunds` object
- compute `totalVisibleUsdc` as the sum of itemized house-controlled USDC sources
- expose source metadata and action capability flags
- add a route for on-chain house-wallet token transfer if one does not already exist
- keep runtime wallet actions on existing house transfer/refill endpoints, but label them separately in UI

## Risks
- Double-counting if contract treasury and house wallet token balance are conflated without labels
- Misleading totals if runtime wallet is presented as on-chain withdrawable money
- Settlement confusion if `housePool` remains invisible while treasury is visible

Mitigations:
- each source is itemized and typed
- total label says “visible house-controlled funds”, not “contract treasury”
- admin copy explains runtime vs on-chain

## Testing Strategy
- Route tests for `houseFunds` payload shape and totals
- Route tests for treasury withdraw and house-wallet transfer action gating
- UI tests for rendering source rows, totals, and labels
- Regression checks for existing on-chain status payload consumers

## Success Criteria
- An operator can see all house-controlled USDC in one admin view
- An operator can tell which source holds a specific lost stake
- An operator can withdraw/transfer from each supported source without guessing where the money is
