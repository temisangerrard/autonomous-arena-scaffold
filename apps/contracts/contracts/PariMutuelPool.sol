// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title PariMutuelPool
 * @notice Player-funded parimutuel pool for all arena games.
 *         The house never needs its own capital. Players stake; losers fund winners.
 *
 * House games (coinflip / RPS / dice):
 *   - Each bet is its own "round" (pass roundId == betId).
 *   - Player deposits on the "yes" side; house never stakes.
 *   - Player loses  → stake enters `houseTreasury`.
 *   - Player wins + treasury >= stake → paid from treasury (2× minus fee).
 *   - Player wins + treasury empty   → stake refunded (no profit, no loss for house).
 *
 * Pool/prediction games (BTC up/down markets):
 *   - Multiple bets share a roundId (the market ID).
 *   - After resolution, the losing pool is split proportionally among winners.
 *   - Winner with no opposite liquidity → stake refunded.
 */
contract PariMutuelPool is AccessControl, ReentrancyGuard {
    bytes32 public constant RESOLVER_ROLE = keccak256("RESOLVER_ROLE");

    enum BetStatus { None, Open, Settled, Refunded }

    struct Bet {
        bytes32 roundId;
        address player;
        uint256 stake;
        bool side;       // true = yes / up,  false = no / down
        BetStatus status;
        uint256 payout;  // actual amount transferred on settlement
    }

    struct Round {
        uint256 yesPool;
        uint256 noPool;
        bool settled;
        bool cancelled;
        bool yesWon;
    }

    IERC20 public immutable token;
    address public feeRecipient;
    uint16  public feeBps;
    uint256 public houseTreasury; // accumulated from house-game losses; funds house-game wins

    mapping(bytes32 => Bet)   public bets;
    mapping(bytes32 => Round) public rounds;

    // ---- Events ----
    event BetDeposited(bytes32 indexed betId, bytes32 indexed roundId, address indexed player, bool side, uint256 amount);
    event RoundSettled(bytes32 indexed roundId, bool yesWon, uint256 yesPool, uint256 noPool);
    event RoundCancelled(bytes32 indexed roundId);
    event BetPaidOut(bytes32 indexed betId, address indexed player, uint256 amount);
    event BetRefunded(bytes32 indexed betId, address indexed player, uint256 amount);
    event TreasuryChanged(uint256 newBalance);
    event FeeConfigUpdated(address feeRecipient, uint16 feeBps);

    // ---- Errors ----
    error InvalidAddress();
    error InvalidAmount();
    error InvalidFeeBps();
    error BetAlreadyExists();
    error BetNotOpen();
    error RoundAlreadyFinalised();
    error RoundNotSettled();
    error InsufficientTreasury();

    constructor(
        address admin,
        address resolver,
        address tokenAddress,
        address feeRecipientAddress,
        uint16  feeBpsValue
    ) {
        if (
            admin == address(0) ||
            resolver == address(0) ||
            tokenAddress == address(0) ||
            feeRecipientAddress == address(0)
        ) revert InvalidAddress();
        if (feeBpsValue > 10_000) revert InvalidFeeBps();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(RESOLVER_ROLE, resolver);

        token        = IERC20(tokenAddress);
        feeRecipient = feeRecipientAddress;
        feeBps       = feeBpsValue;
    }

    // =========================================================================
    // DEPOSIT
    // =========================================================================

    /**
     * @notice Lock a player's stake into a round pool.
     * @param betId   Unique bet ID (use keccak256 of "arena:<challengeId>").
     * @param roundId Shared market/round ID. For house games pass betId itself.
     * @param side    true = yes/up, false = no/down.
     *                For house games the player always deposits on `true`.
     * @param player  Player's on-chain address (must have approved this contract).
     * @param amount  Token amount in base units.
     */
    function deposit(
        bytes32 betId,
        bytes32 roundId,
        bool    side,
        address player,
        uint256 amount
    ) external onlyRole(RESOLVER_ROLE) nonReentrant {
        if (player == address(0)) revert InvalidAddress();
        if (amount == 0)          revert InvalidAmount();
        if (bets[betId].status != BetStatus.None) revert BetAlreadyExists();

        Round storage round = rounds[roundId];
        if (round.settled || round.cancelled) revert RoundAlreadyFinalised();

        require(token.transferFrom(player, address(this), amount), "transfer_failed");

        bets[betId] = Bet({
            roundId: roundId,
            player:  player,
            stake:   amount,
            side:    side,
            status:  BetStatus.Open,
            payout:  0
        });

        if (side) {
            round.yesPool += amount;
        } else {
            round.noPool += amount;
        }

        emit BetDeposited(betId, roundId, player, side, amount);
    }

    // =========================================================================
    // SETTLEMENT
    // =========================================================================

    /**
     * @notice Finalise a round with its winning side.
     *         Must be called before any `payoutBet` for bets in this round.
     */
    function settleRound(bytes32 roundId, bool yesWon) external onlyRole(RESOLVER_ROLE) {
        Round storage round = rounds[roundId];
        if (round.settled || round.cancelled) revert RoundAlreadyFinalised();
        round.settled = true;
        round.yesWon  = yesWon;
        emit RoundSettled(roundId, yesWon, round.yesPool, round.noPool);
    }

    /**
     * @notice Cancel a round (e.g. price tied, oracle failure). All bets refunded.
     */
    function cancelRound(bytes32 roundId) external onlyRole(RESOLVER_ROLE) {
        Round storage round = rounds[roundId];
        if (round.settled || round.cancelled) revert RoundAlreadyFinalised();
        round.cancelled = true;
        emit RoundCancelled(roundId);
    }

    // =========================================================================
    // PAYOUT / REFUND
    // =========================================================================

    /**
     * @notice Push the settlement for a single bet after its round is resolved.
     *
     * Cancelled round → refund stake.
     *
     * Loser in a resolved round → stake stays in contract (funds winners).
     *   Exception: if the winning pool is empty (nobody on the winning side),
     *   the loser's stake is moved into `houseTreasury`.
     *
     * Winner in a resolved round:
     *   a) losingPool > 0 (parimutuel): stake + proportional share of losingPool - fee.
     *   b) losingPool == 0 AND houseTreasury >= stake: 2× stake from treasury - fee.
     *   c) losingPool == 0 AND houseTreasury < stake: refund stake (no profit).
     */
    function payoutBet(bytes32 betId) external onlyRole(RESOLVER_ROLE) nonReentrant {
        Bet storage bet = bets[betId];
        if (bet.status != BetStatus.Open) revert BetNotOpen();

        Round storage round = rounds[bet.roundId];

        // --- Cancelled: refund ---
        if (round.cancelled) {
            bet.status = BetStatus.Refunded;
            bet.payout = bet.stake;
            require(token.transfer(bet.player, bet.stake), "refund_failed");
            emit BetRefunded(betId, bet.player, bet.stake);
            return;
        }

        if (!round.settled) revert RoundNotSettled();

        bool isWinner = (bet.side == round.yesWon);

        // --- Loser ---
        if (!isWinner) {
            bet.status = BetStatus.Settled;
            bet.payout = 0;
            // If nobody is on the winning side, treat loser's stake as house revenue
            uint256 winningPool = round.yesWon ? round.yesPool : round.noPool;
            if (winningPool == 0) {
                houseTreasury += bet.stake;
                emit TreasuryChanged(houseTreasury);
            }
            return;
        }

        // --- Winner ---
        uint256 losingPool  = round.yesWon ? round.noPool  : round.yesPool;
        uint256 winningPool = round.yesWon ? round.yesPool : round.noPool;

        uint256 payoutAmount;
        bool    isRefund;

        if (losingPool == 0) {
            // No opposite liquidity — try house treasury
            if (houseTreasury >= bet.stake) {
                uint256 gross = bet.stake * 2;
                uint256 fee   = (gross * feeBps) / 10_000;
                payoutAmount  = gross - fee;
                houseTreasury -= bet.stake;
                if (fee > 0) require(token.transfer(feeRecipient, fee), "fee_failed");
                emit TreasuryChanged(houseTreasury);
                isRefund = false;
            } else {
                // Treasury empty — return stake, no profit for player, no loss for house
                payoutAmount = bet.stake;
                isRefund     = true;
            }
        } else {
            // Parimutuel: proportional share of losing pool
            // myShare (1e18-scaled) = bet.stake / winningPool
            uint256 myShare  = (bet.stake * 1e18) / winningPool;
            uint256 winnings = (losingPool * myShare) / 1e18;
            uint256 gross    = bet.stake + winnings;
            uint256 fee      = (gross * feeBps) / 10_000;
            payoutAmount     = gross - fee;
            if (fee > 0) require(token.transfer(feeRecipient, fee), "fee_failed");
            isRefund = false;
        }

        bet.status = isRefund ? BetStatus.Refunded : BetStatus.Settled;
        bet.payout = payoutAmount;
        require(token.transfer(bet.player, payoutAmount), "payout_failed");

        if (isRefund) {
            emit BetRefunded(betId, bet.player, payoutAmount);
        } else {
            emit BetPaidOut(betId, bet.player, payoutAmount);
        }
    }

    // =========================================================================
    // ADMIN
    // =========================================================================

    /** @notice Fund the house treasury directly (e.g. initial seeding). */
    function fundTreasury(uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        require(token.transferFrom(msg.sender, address(this), amount), "fund_failed");
        houseTreasury += amount;
        emit TreasuryChanged(houseTreasury);
    }

    /** @notice Withdraw accumulated house profits from the treasury. */
    function withdrawTreasury(address recipient, uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        if (recipient == address(0)) revert InvalidAddress();
        if (amount > houseTreasury)  revert InsufficientTreasury();
        houseTreasury -= amount;
        require(token.transfer(recipient, amount), "withdraw_failed");
        emit TreasuryChanged(houseTreasury);
    }

    function setFeeConfig(address recipient, uint16 bps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (recipient == address(0)) revert InvalidAddress();
        if (bps > 10_000)            revert InvalidFeeBps();
        feeRecipient = recipient;
        feeBps       = bps;
        emit FeeConfigUpdated(recipient, bps);
    }
}
