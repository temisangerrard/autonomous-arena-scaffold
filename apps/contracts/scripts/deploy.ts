import { ethers } from 'hardhat';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

async function main() {
  const [deployer] = await ethers.getSigners();

  const resolverAddress = process.env.ESCROW_RESOLVER_ADDRESS?.trim() || deployer.address;
  const feeRecipientAddress = process.env.ESCROW_FEE_RECIPIENT?.trim() || deployer.address;
  const feeBps = Math.max(0, Math.min(10_000, Number(process.env.ESCROW_FEE_BPS ?? 0)));
  const existingTokenAddress = process.env.ESCROW_TOKEN_ADDRESS?.trim();

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
  const escrow = await escrowFactory.deploy(
    deployer.address,
    resolverAddress,
    tokenAddress,
    feeRecipientAddress,
    feeBps
  );
  await escrow.waitForDeployment();
  const escrowAddress = await escrow.getAddress();

  console.log('BettingEscrow:', escrowAddress);
  console.log('Resolver:', resolverAddress);
  console.log('FeeRecipient:', feeRecipientAddress);
  console.log('FeeBps:', feeBps);

  const payload = {
    network: process.env.HARDHAT_NETWORK || 'unknown',
    deployer: deployer.address,
    resolverAddress,
    feeRecipientAddress,
    feeBps,
    tokenAddress,
    escrowAddress,
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
