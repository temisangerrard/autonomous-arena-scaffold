// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IAggregatorV3 {
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}

contract BettingEscrow is AccessControl, ReentrancyGuard {
    bytes32 public constant RESOLVER_ROLE = keccak256("RESOLVER_ROLE");

    enum BetStatus {
        None,
        Locked,
        Resolved,
        Refunded
    }

    struct Bet {
        address challenger;
        address opponent;
        uint256 amount;
        BetStatus status;
    }

    struct OracleBet {
        bytes32 marketId;
        uint80 entryRoundId;
        int256 entryPrice;
        uint256 resolveAfter;
        bool exists;
    }

    IERC20 public immutable token;
    IAggregatorV3 public immutable priceFeed;
    address public feeRecipient;
    uint16 public feeBps;

    mapping(bytes32 => Bet) public bets;
    mapping(bytes32 => OracleBet) public oracleBets;

    event BetCreated(bytes32 indexed betId, address indexed challenger, address indexed opponent, uint256 amount);
    event BetResolved(bytes32 indexed betId, address indexed winner, uint256 payout, uint256 fee);
    event BetRefunded(bytes32 indexed betId);
    event OracleBetCreated(
        bytes32 indexed betId,
        bytes32 indexed marketId,
        uint80 entryRoundId,
        int256 entryPrice,
        uint256 resolveAfter
    );
    event OracleBetResolved(
        bytes32 indexed betId,
        bytes32 indexed marketId,
        uint80 settleRoundId,
        int256 settlePrice,
        int8 outcome
    );
    event FeeConfigUpdated(address indexed feeRecipient, uint16 feeBps);

    error InvalidAddress();
    error InvalidAmount();
    error InvalidFeeBps();
    error BetAlreadyExists();
    error BetNotLocked();
    error WinnerNotParticipant();
    error OracleUnavailable();
    error OracleResolutionTooEarly();

    constructor(
        address admin,
        address resolver,
        address tokenAddress,
        address feeRecipientAddress,
        uint16 feeBpsValue,
        address priceFeedAddress
    ) {
        if (
            admin == address(0)
                || resolver == address(0)
                || tokenAddress == address(0)
                || feeRecipientAddress == address(0)
                || priceFeedAddress == address(0)
        ) {
            revert InvalidAddress();
        }
        if (feeBpsValue > 10_000) {
            revert InvalidFeeBps();
        }

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(RESOLVER_ROLE, resolver);

        token = IERC20(tokenAddress);
        priceFeed = IAggregatorV3(priceFeedAddress);
        feeRecipient = feeRecipientAddress;
        feeBps = feeBpsValue;
    }

    function setFeeConfig(address recipient, uint16 bps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (recipient == address(0)) {
            revert InvalidAddress();
        }
        if (bps > 10_000) {
            revert InvalidFeeBps();
        }
        feeRecipient = recipient;
        feeBps = bps;
        emit FeeConfigUpdated(recipient, bps);
    }

    function createBet(bytes32 betId, address challenger, address opponent, uint256 amount) external nonReentrant {
        _lockBet(betId, challenger, opponent, amount);
        emit BetCreated(betId, challenger, opponent, amount);
    }

    function createOracleBet(
        bytes32 betId,
        bytes32 marketId,
        address challenger,
        address opponent,
        uint256 amount,
        uint256 resolveAfter
    ) external nonReentrant {
        if (resolveAfter <= block.timestamp) {
            revert InvalidAmount();
        }
        (uint80 roundId, int256 entryPrice,, uint256 updatedAt,) = priceFeed.latestRoundData();
        if (roundId == 0 || entryPrice <= 0 || updatedAt == 0) {
            revert OracleUnavailable();
        }

        _lockBet(betId, challenger, opponent, amount);
        emit BetCreated(betId, challenger, opponent, amount);
        oracleBets[betId] = OracleBet({
            marketId: marketId,
            entryRoundId: roundId,
            entryPrice: entryPrice,
            resolveAfter: resolveAfter,
            exists: true
        });
        emit OracleBetCreated(betId, marketId, roundId, entryPrice, resolveAfter);
    }

    function _lockBet(bytes32 betId, address challenger, address opponent, uint256 amount) private {
        if (challenger == address(0) || opponent == address(0)) {
            revert InvalidAddress();
        }
        if (amount == 0) {
            revert InvalidAmount();
        }
        if (bets[betId].status != BetStatus.None) {
            revert BetAlreadyExists();
        }

        bets[betId] = Bet({
            challenger: challenger,
            opponent: opponent,
            amount: amount,
            status: BetStatus.Locked
        });

        require(token.transferFrom(challenger, address(this), amount), "challenger_transfer_failed");
        require(token.transferFrom(opponent, address(this), amount), "opponent_transfer_failed");
    }

    function resolveBet(bytes32 betId, address winner) external onlyRole(RESOLVER_ROLE) nonReentrant {
        Bet storage bet = bets[betId];
        if (bet.status != BetStatus.Locked) {
            revert BetNotLocked();
        }
        if (winner != bet.challenger && winner != bet.opponent) {
            revert WinnerNotParticipant();
        }

        bet.status = BetStatus.Resolved;
        _payoutWinner(betId, winner, bet.amount);
    }

    function resolveBetFromOracle(bytes32 betId) external onlyRole(RESOLVER_ROLE) nonReentrant {
        Bet storage bet = bets[betId];
        OracleBet memory oracleBet = oracleBets[betId];
        if (bet.status != BetStatus.Locked) {
            revert BetNotLocked();
        }
        if (!oracleBet.exists) {
            revert OracleUnavailable();
        }
        if (block.timestamp < oracleBet.resolveAfter) {
            revert OracleResolutionTooEarly();
        }

        (uint80 settleRoundId, int256 settlePrice,, uint256 updatedAt,) = priceFeed.latestRoundData();
        if (settleRoundId == 0 || settlePrice <= 0 || updatedAt == 0) {
            revert OracleUnavailable();
        }

        if (settlePrice == oracleBet.entryPrice) {
            bet.status = BetStatus.Refunded;
            require(token.transfer(bet.challenger, bet.amount), "challenger_refund_failed");
            require(token.transfer(bet.opponent, bet.amount), "opponent_refund_failed");
            emit BetRefunded(betId);
            emit OracleBetResolved(betId, oracleBet.marketId, settleRoundId, settlePrice, 0);
            return;
        }

        bet.status = BetStatus.Resolved;
        bool up = settlePrice > oracleBet.entryPrice;
        address winner = up ? bet.challenger : bet.opponent;
        _payoutWinner(betId, winner, bet.amount);
        emit OracleBetResolved(betId, oracleBet.marketId, settleRoundId, settlePrice, up ? int8(1) : int8(-1));
    }

    function refundBet(bytes32 betId) external onlyRole(RESOLVER_ROLE) nonReentrant {
        Bet storage bet = bets[betId];
        if (bet.status != BetStatus.Locked) {
            revert BetNotLocked();
        }

        bet.status = BetStatus.Refunded;
        require(token.transfer(bet.challenger, bet.amount), "challenger_refund_failed");
        require(token.transfer(bet.opponent, bet.amount), "opponent_refund_failed");

        emit BetRefunded(betId);
    }

    function _payoutWinner(bytes32 betId, address winner, uint256 stake) private {
        uint256 pot = stake * 2;
        uint256 fee = (pot * feeBps) / 10_000;
        uint256 payout = pot - fee;
        if (fee > 0) {
            require(token.transfer(feeRecipient, fee), "fee_transfer_failed");
        }
        require(token.transfer(winner, payout), "winner_transfer_failed");
        emit BetResolved(betId, winner, payout, fee);
    }
}
