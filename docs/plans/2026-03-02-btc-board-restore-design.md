# BTC Board Restore Design

Goal: restore the BTC board to show only internal Chainlink-backed BTC rails (5m and 24h) instead of legacy Polymarket listings.

Approach:
- Re-enable server-side Chainlink BTC market generation and settlement refresh from the prior oracle-market implementation.
- Persist market proof metadata in `markets.raw_json` so the dashboard and resolution logic can read entry/settle state.
- Update the prediction station UI to present BTC quick actions against the existing station interaction flow, not the stale managed-DeFi Polymarket intent API.

Notes:
- The live oracle-aware Polygon escrow contract is reusable only if current deploy infra still holds the matching admin/resolver keys.
- This shell does not currently have RPC/private-key env loaded, so ownership verification is blocked here.
