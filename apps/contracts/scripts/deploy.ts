import { ethers } from 'hardhat';

async function main() {
  const [deployer] = await ethers.getSigners();

  const tokenFactory = await ethers.getContractFactory('MockUSDC');
  const token = await tokenFactory.deploy();
  await token.waitForDeployment();

  const escrowFactory = await ethers.getContractFactory('BettingEscrow');
  const escrow = await escrowFactory.deploy(
    deployer.address,
    deployer.address,
    await token.getAddress(),
    deployer.address,
    250
  );
  await escrow.waitForDeployment();

  console.log('MockUSDC:', await token.getAddress());
  console.log('BettingEscrow:', await escrow.getAddress());
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
