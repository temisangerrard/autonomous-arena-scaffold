import { ethers } from 'hardhat';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

async function main() {
  const [deployer] = await ethers.getSigners();

  const resolverAddress     = process.env.ESCROW_RESOLVER_ADDRESS?.trim() || deployer.address;
  const feeRecipientAddress = process.env.ESCROW_FEE_RECIPIENT?.trim()    || deployer.address;
  const feeBps              = Math.max(0, Math.min(10_000, Number(process.env.ESCROW_FEE_BPS ?? 500)));
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

  const poolFactory = await ethers.getContractFactory('PariMutuelPool');
  const pool = await poolFactory.deploy(
    deployer.address,    // admin
    resolverAddress,     // resolver (game-server hot wallet)
    tokenAddress,
    feeRecipientAddress,
    feeBps
  );
  await pool.waitForDeployment();
  const poolAddress = await pool.getAddress();

  console.log('PariMutuelPool:', poolAddress);
  console.log('Resolver:',      resolverAddress);
  console.log('FeeRecipient:',  feeRecipientAddress);
  console.log('FeeBps:',        feeBps);
  console.log('Token:',         tokenAddress);

  const payload = {
    network:           process.env.HARDHAT_NETWORK || 'unknown',
    deployer:          deployer.address,
    resolverAddress,
    feeRecipientAddress,
    feeBps,
    tokenAddress,
    poolAddress,
    deployedAt:        new Date().toISOString()
  };

  const outDir  = path.resolve(process.cwd(), '../../output');
  await mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, `pool-deploy-${payload.network}.json`);
  await writeFile(outPath, JSON.stringify(payload, null, 2), 'utf8');
  console.log('Wrote deploy artifact:', outPath);

  // Convenience: also write a pool-specific env snippet
  const envSnippet = [
    `# PariMutuelPool deployment — ${payload.network} — ${payload.deployedAt}`,
    `ESCROW_CONTRACT_ADDRESS=${poolAddress}`,
    `ESCROW_TOKEN_ADDRESS=${tokenAddress}`,
    `ESCROW_RESOLVER_ADDRESS=${resolverAddress}`,
    ''
  ].join('\n');
  const envPath = path.join(outDir, `pool-deploy-${payload.network}.env`);
  await writeFile(envPath, envSnippet, 'utf8');
  console.log('Wrote env snippet:', envPath);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
