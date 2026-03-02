import { expect } from 'chai';
import { ethers } from 'hardhat';
import { describe } from 'mocha';

describe('BettingEscrow', () => {
  // Hardhat startup/first deploy can be slow on some machines; avoid flaky timeout.
  before(function () {
    this.timeout(120_000);
  });

  it('locks and resolves a bet to winner with fee', async () => {
    const [admin, resolver, challenger, opponent, feeRecipient] = await ethers.getSigners();

    const tokenFactory = await ethers.getContractFactory('MockUSDC');
    const token = await tokenFactory.deploy();
    const feedFactory = await ethers.getContractFactory('MockPriceFeed');
    const feed = await feedFactory.deploy();
    await feed.setLatestRoundData(1n, 100_000_000_000n, BigInt(Math.floor(Date.now() / 1000)));

    const escrowFactory = await ethers.getContractFactory('BettingEscrow');
    const escrow = await escrowFactory.deploy(
      admin.address,
      resolver.address,
      await token.getAddress(),
      feeRecipient.address,
      500,
      await feed.getAddress()
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
    const feedFactory = await ethers.getContractFactory('MockPriceFeed');
    const feed = await feedFactory.deploy();
    await feed.setLatestRoundData(1n, 100_000_000_000n, BigInt(Math.floor(Date.now() / 1000)));

    const escrowFactory = await ethers.getContractFactory('BettingEscrow');
    const escrow = await escrowFactory.deploy(
      admin.address,
      resolver.address,
      await token.getAddress(),
      feeRecipient.address,
      0,
      await feed.getAddress()
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

  it('resolves oracle bet from onchain price feed and emits oracle proof event', async () => {
    const [admin, resolver, challenger, opponent, feeRecipient] = await ethers.getSigners();
    const tokenFactory = await ethers.getContractFactory('MockUSDC');
    const token = await tokenFactory.deploy();
    const feedFactory = await ethers.getContractFactory('MockPriceFeed');
    const feed = await feedFactory.deploy();
    const nowSec = BigInt(Math.floor(Date.now() / 1000));
    await feed.setLatestRoundData(10n, 100_000_000_000n, nowSec);

    const escrowFactory = await ethers.getContractFactory('BettingEscrow');
    const escrow = await escrowFactory.deploy(
      admin.address,
      resolver.address,
      await token.getAddress(),
      feeRecipient.address,
      0,
      await feed.getAddress()
    );

    const amount = 1_000_000n;
    await token.mint(challenger.address, amount);
    await token.mint(opponent.address, amount);
    await token.connect(challenger).approve(await escrow.getAddress(), amount);
    await token.connect(opponent).approve(await escrow.getAddress(), amount);

    const betId = ethers.keccak256(ethers.toUtf8Bytes('oracle-bet-1'));
    const marketId = ethers.keccak256(ethers.toUtf8Bytes('cl_btc_5m_slot_1'));
    const block = await ethers.provider.getBlock('latest');
    const resolveAfter = BigInt((block?.timestamp ?? Math.floor(Date.now() / 1000)) + 60);
    await escrow.createOracleBet(betId, marketId, challenger.address, opponent.address, amount, resolveAfter);

    await ethers.provider.send('evm_increaseTime', [65]);
    await ethers.provider.send('evm_mine', []);
    const nextTs = BigInt(Math.floor(Date.now() / 1000) + 10);
    await feed.setLatestRoundData(11n, 101_000_000_000n, nextTs);

    const tx = await escrow.connect(resolver).resolveBetFromOracle(betId);
    await expect(tx).to.emit(escrow, 'OracleBetResolved');

    expect(await token.balanceOf(challenger.address)).to.equal(2_000_000n);
    expect(await token.balanceOf(opponent.address)).to.equal(0n);
  });
});
