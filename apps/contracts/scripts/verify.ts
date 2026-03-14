import hre from 'hardhat';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

type VerifyKind = 'pool' | 'escrow';

type PoolDeployment = {
  network: string;
  deployer: string;
  resolverAddress: string;
  feeRecipientAddress: string;
  feeBps: number;
  tokenAddress: string;
  poolAddress: string;
};

type EscrowDeployment = {
  network: string;
  deployer: string;
  resolverAddress: string;
  feeRecipientAddress: string;
  feeBps: number;
  tokenAddress: string;
  escrowAddress: string;
  priceFeedAddress: string;
};

function getVerifyKind(): VerifyKind {
  const raw = (process.env.VERIFY_CONTRACT || 'pool').trim().toLowerCase();
  if (raw === 'pool' || raw === 'escrow') return raw;
  throw new Error(`Unsupported VERIFY_CONTRACT="${raw}". Use "pool" or "escrow".`);
}

async function readDeploymentFile(kind: VerifyKind, network: string) {
  const defaultName = kind === 'pool' ? `pool-deploy-${network}.json` : `escrow-deploy-${network}.json`;
  const deploymentPath = process.env.VERIFY_DEPLOYMENT_FILE?.trim()
    ? path.resolve(process.cwd(), process.env.VERIFY_DEPLOYMENT_FILE.trim())
    : path.resolve(process.cwd(), '../../output', defaultName);
  const raw = await readFile(deploymentPath, 'utf8');
  return JSON.parse(raw) as PoolDeployment | EscrowDeployment;
}

async function main() {
  const network = hre.network.name;
  const kind = getVerifyKind();
  const deployment = await readDeploymentFile(kind, network);

  if (kind === 'pool') {
    const poolDeployment = deployment as PoolDeployment;
    await hre.run('verify:verify', {
      address: poolDeployment.poolAddress,
      constructorArguments: [
        poolDeployment.deployer,
        poolDeployment.resolverAddress,
        poolDeployment.tokenAddress,
        poolDeployment.feeRecipientAddress,
        poolDeployment.feeBps
      ]
    });
    console.log(`Verified PariMutuelPool at ${poolDeployment.poolAddress} on ${network}`);
    return;
  }

  const escrowDeployment = deployment as EscrowDeployment;
  await hre.run('verify:verify', {
    address: escrowDeployment.escrowAddress,
    constructorArguments: [
      escrowDeployment.deployer,
      escrowDeployment.resolverAddress,
      escrowDeployment.tokenAddress,
      escrowDeployment.feeRecipientAddress,
      escrowDeployment.feeBps,
      escrowDeployment.priceFeedAddress
    ]
  });
  console.log(`Verified BettingEscrow at ${escrowDeployment.escrowAddress} on ${network}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
