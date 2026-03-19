import { expect } from 'chai';
import { ethers } from 'hardhat';
import { describe } from 'mocha';

describe('PariMutuelPool', () => {
  before(function () {
    this.timeout(120_000);
  });

  async function deployFixture() {
    const [admin, resolver, player, otherPlayer, feeRecipient] = await ethers.getSigners();
    const tokenFactory = await ethers.getContractFactory('MockUSDC');
    const token = await tokenFactory.deploy();
    const poolFactory = await ethers.getContractFactory('PariMutuelPool');
    const pool = await poolFactory.deploy(
      admin.address,
      resolver.address,
      await token.getAddress(),
      feeRecipient.address,
      500
    );
    return { admin, resolver, player, otherPlayer, feeRecipient, token, pool };
  }

  it('moves a losing house-game stake into houseTreasury when nobody is on the winning side', async () => {
    const { resolver, player, token, pool } = await deployFixture();
    const amount = 1_000_000n;
    const betId = ethers.keccak256(ethers.toUtf8Bytes('house-loss-to-treasury'));

    await token.mint(player.address, amount);
    await token.connect(player).approve(await pool.getAddress(), amount);
    await pool.connect(resolver).deposit(betId, betId, true, player.address, amount);

    await pool.connect(resolver).settleRound(betId, false);
    await pool.connect(resolver).payoutBet(betId);

    expect(await pool.houseTreasury()).to.equal(amount);
    expect(await token.balanceOf(player.address)).to.equal(0n);
  });

  it('pays a house-game win from treasury and charges fee on the gross payout', async () => {
    const { resolver, player, otherPlayer, feeRecipient, token, pool } = await deployFixture();
    const seedAmount = 1_000_000n;
    const winAmount = 1_000_000n;
    const lossBetId = ethers.keccak256(ethers.toUtf8Bytes('seed-house-treasury'));
    const winBetId = ethers.keccak256(ethers.toUtf8Bytes('house-win-from-treasury'));

    await token.mint(player.address, seedAmount + winAmount);
    await token.connect(player).approve(await pool.getAddress(), seedAmount + winAmount);
    await pool.connect(resolver).deposit(lossBetId, lossBetId, true, player.address, seedAmount);
    await pool.connect(resolver).settleRound(lossBetId, false);
    await pool.connect(resolver).payoutBet(lossBetId);

    await token.mint(otherPlayer.address, winAmount);
    await token.connect(otherPlayer).approve(await pool.getAddress(), winAmount);
    await pool.connect(resolver).deposit(winBetId, winBetId, true, otherPlayer.address, winAmount);
    await pool.connect(resolver).settleRound(winBetId, true);
    await pool.connect(resolver).payoutBet(winBetId);

    expect(await token.balanceOf(otherPlayer.address)).to.equal(1_900_000n);
    expect(await token.balanceOf(feeRecipient.address)).to.equal(100_000n);
    expect(await pool.houseTreasury()).to.equal(0n);
  });

  it('refunds stake when treasury cannot cover a house-game win', async () => {
    const { resolver, player, token, pool } = await deployFixture();
    const amount = 1_000_000n;
    const betId = ethers.keccak256(ethers.toUtf8Bytes('refund-when-house-empty'));

    await token.mint(player.address, amount);
    await token.connect(player).approve(await pool.getAddress(), amount);
    await pool.connect(resolver).deposit(betId, betId, true, player.address, amount);

    await pool.connect(resolver).settleRound(betId, true);
    await pool.connect(resolver).payoutBet(betId);

    expect(await token.balanceOf(player.address)).to.equal(amount);
    expect(await token.balanceOf(pool.getAddress())).to.equal(0n);
    expect(await pool.houseTreasury()).to.equal(0n);
  });

  it('splits a parimutuel losing pool proportionally across multiple winners and charges fees on each gross payout', async () => {
    const { resolver, player, otherPlayer, feeRecipient, token, pool } = await deployFixture();
    const signers = await ethers.getSigners();
    const winnerA = signers[5];
    const winnerB = signers[6];
    const winnerC = signers[7];
    const loserA = signers[8];
    const loserB = signers[9];
    const roundId = ethers.keccak256(ethers.toUtf8Bytes('multi-winner-round'));
    const winnerAStake = 1_000_000n;
    const winnerBStake = 2_000_000n;
    const winnerCStake = 3_000_000n;
    const loserAStake = 4_000_000n;
    const loserBStake = 2_000_000n;

    const bets = [
      { signer: winnerA, betId: ethers.keccak256(ethers.toUtf8Bytes('winner-a')), side: true, amount: winnerAStake },
      { signer: winnerB, betId: ethers.keccak256(ethers.toUtf8Bytes('winner-b')), side: true, amount: winnerBStake },
      { signer: winnerC, betId: ethers.keccak256(ethers.toUtf8Bytes('winner-c')), side: true, amount: winnerCStake },
      { signer: loserA, betId: ethers.keccak256(ethers.toUtf8Bytes('loser-a')), side: false, amount: loserAStake },
      { signer: loserB, betId: ethers.keccak256(ethers.toUtf8Bytes('loser-b')), side: false, amount: loserBStake }
    ];

    for (const bet of bets) {
      await token.mint(bet.signer.address, bet.amount);
      await token.connect(bet.signer).approve(await pool.getAddress(), bet.amount);
      await pool.connect(resolver).deposit(bet.betId, roundId, bet.side, bet.signer.address, bet.amount);
    }

    await pool.connect(resolver).settleRound(roundId, true);
    for (const bet of bets) {
      await pool.connect(resolver).payoutBet(bet.betId);
    }

    const winnerABalance = await token.balanceOf(winnerA.address);
    const winnerBBalance = await token.balanceOf(winnerB.address);
    const winnerCBalance = await token.balanceOf(winnerC.address);
    const feeBalance = await token.balanceOf(feeRecipient.address);

    expect(winnerABalance).to.equal(1_900_000n);
    expect(winnerBBalance).to.equal(3_800_000n);
    expect(winnerCBalance).to.equal(5_700_000n);
    expect(await token.balanceOf(loserA.address)).to.equal(0n);
    expect(await token.balanceOf(loserB.address)).to.equal(0n);
    expect(feeBalance).to.equal(599_998n);
    expect(await pool.houseTreasury()).to.equal(0n);
    expect(await token.balanceOf(await pool.getAddress())).to.equal(2n);
    void player;
    void otherPlayer;
  });

  it('accumulates house treasury across many house-game losses with different bet sizes and pays winners independently', async () => {
    const { resolver, feeRecipient, token, pool } = await deployFixture();
    const signers = await ethers.getSigners();
    const losers = signers.slice(2, 7);
    const winners = signers.slice(7, 10);
    const losingAmounts = [500_000n, 750_000n, 1_250_000n, 2_000_000n, 3_500_000n];
    const winningAmounts = [1_000_000n, 2_000_000n, 500_000n];

    for (const [index, signer] of losers.entries()) {
      const betId = ethers.keccak256(ethers.toUtf8Bytes(`house-loss-${index}`));
      const amount = losingAmounts[index];
      await token.mint(signer.address, amount);
      await token.connect(signer).approve(await pool.getAddress(), amount);
      await pool.connect(resolver).deposit(betId, betId, true, signer.address, amount);
      await pool.connect(resolver).settleRound(betId, false);
      await pool.connect(resolver).payoutBet(betId);
    }

    expect(await pool.houseTreasury()).to.equal(8_000_000n);

    for (const [index, signer] of winners.entries()) {
      const betId = ethers.keccak256(ethers.toUtf8Bytes(`house-win-${index}`));
      const amount = winningAmounts[index];
      await token.mint(signer.address, amount);
      await token.connect(signer).approve(await pool.getAddress(), amount);
      await pool.connect(resolver).deposit(betId, betId, true, signer.address, amount);
      await pool.connect(resolver).settleRound(betId, true);
      await pool.connect(resolver).payoutBet(betId);
    }

    expect(await token.balanceOf(winners[0].address)).to.equal(1_900_000n);
    expect(await token.balanceOf(winners[1].address)).to.equal(3_800_000n);
    expect(await token.balanceOf(winners[2].address)).to.equal(950_000n);
    expect(await token.balanceOf(feeRecipient.address)).to.equal(350_000n);
    expect(await pool.houseTreasury()).to.equal(4_500_000n);
    expect(await token.balanceOf(await pool.getAddress())).to.equal(4_500_000n);
  });

  it('allows admin to withdraw treasury and leaves player balances untouched', async () => {
    const { admin, resolver, player, otherPlayer, token, pool } = await deployFixture();
    const amount = 2_000_000n;
    const betId = ethers.keccak256(ethers.toUtf8Bytes('treasury-withdraw-seed'));

    await token.mint(player.address, amount);
    await token.connect(player).approve(await pool.getAddress(), amount);
    await pool.connect(resolver).deposit(betId, betId, true, player.address, amount);
    await pool.connect(resolver).settleRound(betId, false);
    await pool.connect(resolver).payoutBet(betId);

    expect(await pool.houseTreasury()).to.equal(amount);

    await pool.connect(admin).withdrawTreasury(otherPlayer.address, 1_250_000n);

    expect(await pool.houseTreasury()).to.equal(750_000n);
    expect(await token.balanceOf(otherPlayer.address)).to.equal(1_250_000n);
    expect(await token.balanceOf(player.address)).to.equal(0n);
    expect(await token.balanceOf(await pool.getAddress())).to.equal(750_000n);
  });
});
