import { ethers } from 'hardhat';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

async function main() {
  const [deployer] = await ethers.getSigners();

  const resolverAddress = process.env.ESCROW_RESOLVER_ADDRESS?.trim() || deployer.address;
  const feeRecipientAddress = process.env.ESCROW_FEE_RECIPIENT?.trim() || deployer.address;
  const feeBps = Math.max(0, Math.min(10_000, Number(process.env.ESCROW_FEE_BPS ?? 500)));
  const existingTokenAddress = process.env.ESCROW_TOKEN_ADDRESS?.trim();
  const configuredFeedAddress = process.env.CHAINLINK_BTC_USD_FEED?.trim() || process.env.ESCROW_PRICE_FEED_ADDRESS?.trim() || '';

  let tokenAddress = existingTokenAddress || '';
  if (!tokenAddress) {
    const tokenFactory = await ethers.getContractFactory('MockUSDC');
    const token = await tokenFactory.deploy();
    await token.waitForDeployment();
    tokenAddress = await token.getAddress();
    console.log('MockUSDC deployed:', tokenAddress);
  } else {
    console.log('Using existing token:', tokenAddress);
  }

  const escrowFactory = await ethers.getContractFactory('BettingEscrow');
  const networkName = process.env.HARDHAT_NETWORK || 'unknown';
  const defaultFeedAddress = networkName === 'polygon'
    ? '0xc907E116054Ad103354f2D350FD2514433D57F6f'
    : networkName === 'base'
      ? '0x64c911996D3c6aC71f9b455B1E8E7266BcbD848F'
      : '';
  const priceFeedAddress = configuredFeedAddress || defaultFeedAddress;
  if (!priceFeedAddress) {
    throw new Error('Missing CHAINLINK_BTC_USD_FEED (or ESCROW_PRICE_FEED_ADDRESS) for this network.');
  }
  const escrow = await escrowFactory.deploy(
    deployer.address,
    resolverAddress,
    tokenAddress,
    feeRecipientAddress,
    feeBps,
    priceFeedAddress
  );
  await escrow.waitForDeployment();
  const escrowAddress = await escrow.getAddress();

  console.log('BettingEscrow:', escrowAddress);
  console.log('Resolver:', resolverAddress);
  console.log('FeeRecipient:', feeRecipientAddress);
  console.log('FeeBps:', feeBps);
  console.log('PriceFeed:', priceFeedAddress);

  const payload = {
    network: process.env.HARDHAT_NETWORK || 'unknown',
    deployer: deployer.address,
    resolverAddress,
    feeRecipientAddress,
    feeBps,
    tokenAddress,
    escrowAddress,
    priceFeedAddress,
    deployedAt: new Date().toISOString()
  };
  const outDir = path.resolve(process.cwd(), '../../output');
  await mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, `escrow-deploy-${payload.network}.json`);
  await writeFile(outPath, JSON.stringify(payload, null, 2), 'utf8');
  console.log('Wrote deploy artifact:', outPath);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
