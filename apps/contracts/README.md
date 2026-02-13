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
