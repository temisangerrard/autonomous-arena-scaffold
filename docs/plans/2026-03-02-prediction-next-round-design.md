# Prediction Next-Round Commit Design

**Date:** 2026-03-02
**Scope:** BTC oracle market support for committing to the immediately next round with immediate escrow lock

## Goals
- Allow players to commit to the immediately next BTC market round before it opens.
- Lock funds immediately at commit time.
- Keep settlement and payout fully isolated per market round.
- Surface current BTC price, round lock price, and final resolution price clearly.

## Product Decisions
- Users may commit only to the current round or the immediately next round.
- Next-round commits lock funds immediately.
- The bet outcome is determined by the next round's lock price versus final price.
- Commit-time spot price is informational only and is not used for settlement.
- Each market round has its own market id, positions, liquidity accounting, and escrow bet ids.
- Scheduled next-round positions do not participate in the prior market's payout path.

## Mental Model
Each BTC rail has two adjacent rounds available in the UI:
1. Current round
2. Next round

For each rail (`BTC 5m`, `BTC 24h`), the player can choose either:
- `Current`
- `Next`

If the player chooses `Next`, the app creates a future position tied to the future round's `marketId`, but escrow locks immediately.

## Pricing Model
### Prices to surface
- `BTC now`: current spot price when the player is viewing/committing
- `Lock price`: the price captured when the selected market round opens/locks
- `Final price`: the price captured when that market resolves

### Settlement rule
- Winning/losing is determined only by:
  - `Lock price`
  - `Final price`
- `BTC now` is informational and does not affect payout.

## Round Scheduling
### Current behavior baseline
- Server creates one active market per configured rail based on time slot boundaries.
- Slot boundaries are determined by the rail duration.

### New behavior
For each rail, the server should ensure:
- one `current` round market
- one `next` round market

The next round market:
- has a distinct `marketId`
- has known `closeAt` / `resolveAt`
- is surfaced as `scheduled` before it becomes live

## Position Lifecycle
### Current round position
- status: `open`
- escrow locked immediately
- participates in normal liquidity and settlement logic immediately

### Next round position
- status: `scheduled`
- escrow locked immediately
- does not contribute to the current round liquidity pool
- promotes to `open` when its target market becomes the live round
- settles only when its own market resolves

## Escrow Separation
Immediate next-round locking is safe only if positions stay market-scoped.

Required separation guarantees:
- every position row keeps its own `marketId`
- every escrow bet id is unique per position and derived from that future `marketId`
- settlement groups positions by `marketId`
- prior rounds cannot touch funds committed to the next round

This means funds locked early for market `M_next` are not used to pay market `M_current`.

## UI Surface
### Prediction rail card
For each tab (`BTC 5m`, `BTC 24h`), show:
- round selector:
  - `Current`
  - `Next`
- status line:
  - `Live`
  - `Closing soon`
  - `Opens in Xm`
- `BTC now: $...`
- `Lock price: pending` until round opens
- `Final price: pending` until round resolves
- `Locks: ...`
- `Settles: ...`
- warning copy for next round:
  - `Funds lock immediately.`

### After commit to next round
Show:
- `Committed to next round. Funds are locked.`
- `Lock price will be set at market open.`

### After round opens
Show:
- `Lock price: $...`

### After resolution
Show:
- `Final price: $...`
- `Resolved: BTC Up` or `Resolved: BTC Down`

## Activity / Dashboard
Next-round positions should appear distinctly in activity:
- `Scheduled BTC 5m Up`
- `Scheduled BTC 24h Down`
- then later:
  - `Round opened`
  - `Round resolved`

Each activity item should remain attached to the specific future market id.

## Data Model Changes
Need explicit support for scheduled rounds and scheduled positions.

### Markets
Potential additional derived state or persisted state:
- `scheduled`
- `open`
- `resolved`
- `cancelled`

### Positions
Need position state to allow:
- `scheduled`
- `open`
- `won`
- `lost`
- `voided`

## Server Responsibilities
- Generate current and next markets per configured rail.
- Return both current and next rail choices to the client.
- Accept open-position requests for future market ids.
- Lock escrow immediately.
- Exclude scheduled positions from current market liquidity.
- Promote scheduled positions to open at market start.
- Record lock/final prices in market metadata for UI display.

## Testing Requirements
- Server tests for ensuring current and next markets exist.
- Server tests that scheduled positions do not count toward current market payout/liquidity.
- Server tests that scheduled positions promote when the target round opens.
- Web tests for `Current` / `Next` round selector.
- Web tests for `BTC now`, `Lock price`, `Final price` display states.
- Activity tests for scheduled -> open -> settled lifecycle.

## Out of Scope
- committing more than one round ahead
- partial reserve / soft hold model
- changing the payout model from pool-based to guaranteed house payout
