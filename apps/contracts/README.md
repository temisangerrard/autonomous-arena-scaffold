# Contracts

Scaffolded Hardhat workspace for Milestone 7.

Implemented:
- `contracts/BettingEscrow.sol` (lock/resolve/refund with resolver role + fee)
- `contracts/MockUSDC.sol` (local test token)
- `test/Escrow.test.ts` (lock/resolve + refund flows)
- `scripts/deploy.ts` (local deploy script)

Run:
- `npm i`
- `npm run build --workspace @arena/contracts`
- `npm run test --workspace @arena/contracts`
- `npm run deploy:local --workspace @arena/contracts`

Sepolia deploy:
- Set env vars:
  - `SEPOLIA_RPC_URL`
  - `DEPLOYER_PRIVATE_KEY`
  - optional `ESCROW_TOKEN_ADDRESS` (if omitted, deploys `MockUSDC`)
  - optional `ESCROW_RESOLVER_ADDRESS`
  - optional `ESCROW_FEE_RECIPIENT`
  - optional `ESCROW_FEE_BPS`
- Run:
  - `npm run deploy:sepolia --workspace @arena/contracts`
- Output artifact:
  - `output/escrow-deploy-sepolia.json`
