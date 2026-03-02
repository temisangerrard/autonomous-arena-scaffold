# Contracts

Scaffolded Hardhat workspace for Milestone 7.

Implemented:
- `contracts/BettingEscrow.sol` (lock/resolve/refund with resolver role + oracle resolution support)
- `contracts/MockUSDC.sol` (local test token)
- `contracts/MockPriceFeed.sol` (local oracle test feed)
- `test/Escrow.test.ts` (lock/resolve + refund + oracle flows)
- `scripts/deploy.ts` (local/sepolia/base deploy script)

Run:
- `npm i`
- `npm run build --workspace @arena/contracts`
- `npm run test --workspace @arena/contracts`
- `npm run deploy:local --workspace @arena/contracts`

Sepolia/Base deploy:
- Set env vars:
  - `SEPOLIA_RPC_URL` or `BASE_RPC_URL`
  - `DEPLOYER_PRIVATE_KEY`
  - `CHAINLINK_BTC_USD_FEED` or `ESCROW_PRICE_FEED_ADDRESS` for custom feed override
  - optional `ESCROW_TOKEN_ADDRESS` (if omitted, deploys `MockUSDC`; for Base mainnet use native USDC)
  - optional `ESCROW_RESOLVER_ADDRESS`
  - optional `ESCROW_FEE_RECIPIENT`
  - optional `ESCROW_FEE_BPS`
- Run:
  - `npm run deploy:sepolia --workspace @arena/contracts`
  - `npm run deploy:base --workspace @arena/contracts`
- Output artifact:
  - `output/escrow-deploy-sepolia.json`
  - `output/escrow-deploy-base.json`
