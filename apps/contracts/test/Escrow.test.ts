import { expect } from 'chai';
import { ethers } from 'hardhat';

describe('BettingEscrow', () => {
  it('locks and resolves a bet to winner with fee', async () => {
    const [admin, resolver, challenger, opponent, feeRecipient] = await ethers.getSigners();

    const tokenFactory = await ethers.getContractFactory('MockUSDC');
    const token = await tokenFactory.deploy();

    const escrowFactory = await ethers.getContractFactory('BettingEscrow');
    const escrow = await escrowFactory.deploy(
      admin.address,
      resolver.address,
      await token.getAddress(),
      feeRecipient.address,
      500
    );

    const amount = 1_000_000n;
    await token.mint(challenger.address, amount);
    await token.mint(opponent.address, amount);

    await token.connect(challenger).approve(await escrow.getAddress(), amount);
    await token.connect(opponent).approve(await escrow.getAddress(), amount);

    const betId = ethers.keccak256(ethers.toUtf8Bytes('bet-1'));
    await escrow.createBet(betId, challenger.address, opponent.address, amount);

    await escrow.connect(resolver).resolveBet(betId, challenger.address);

    const winnerBalance = await token.balanceOf(challenger.address);
    const feeBalance = await token.balanceOf(feeRecipient.address);
    expect(feeBalance).to.equal(100_000n);
    expect(winnerBalance).to.equal(1_900_000n);
  });

  it('refunds both players on resolver refund', async () => {
    const [admin, resolver, challenger, opponent, feeRecipient] = await ethers.getSigners();

    const tokenFactory = await ethers.getContractFactory('MockUSDC');
    const token = await tokenFactory.deploy();

    const escrowFactory = await ethers.getContractFactory('BettingEscrow');
    const escrow = await escrowFactory.deploy(
      admin.address,
      resolver.address,
      await token.getAddress(),
      feeRecipient.address,
      0
    );

    const amount = 500_000n;
    await token.mint(challenger.address, amount);
    await token.mint(opponent.address, amount);

    await token.connect(challenger).approve(await escrow.getAddress(), amount);
    await token.connect(opponent).approve(await escrow.getAddress(), amount);

    const betId = ethers.keccak256(ethers.toUtf8Bytes('bet-2'));
    await escrow.createBet(betId, challenger.address, opponent.address, amount);

    await escrow.connect(resolver).refundBet(betId);

    expect(await token.balanceOf(challenger.address)).to.equal(amount);
    expect(await token.balanceOf(opponent.address)).to.equal(amount);
  });
});
