// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

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

    IERC20 public immutable token;
    address public feeRecipient;
    uint16 public feeBps;

    mapping(bytes32 => Bet) public bets;

    event BetCreated(bytes32 indexed betId, address indexed challenger, address indexed opponent, uint256 amount);
    event BetResolved(bytes32 indexed betId, address indexed winner, uint256 payout, uint256 fee);
    event BetRefunded(bytes32 indexed betId);
    event FeeConfigUpdated(address indexed feeRecipient, uint16 feeBps);

    error InvalidAddress();
    error InvalidAmount();
    error InvalidFeeBps();
    error BetAlreadyExists();
    error BetNotLocked();
    error WinnerNotParticipant();

    constructor(address admin, address resolver, address tokenAddress, address feeRecipientAddress, uint16 feeBpsValue) {
        if (admin == address(0) || resolver == address(0) || tokenAddress == address(0) || feeRecipientAddress == address(0)) {
            revert InvalidAddress();
        }
        if (feeBpsValue > 10_000) {
            revert InvalidFeeBps();
        }

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(RESOLVER_ROLE, resolver);

        token = IERC20(tokenAddress);
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

        emit BetCreated(betId, challenger, opponent, amount);
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

        uint256 pot = bet.amount * 2;
        uint256 fee = (pot * feeBps) / 10_000;
        uint256 payout = pot - fee;

        if (fee > 0) {
            require(token.transfer(feeRecipient, fee), "fee_transfer_failed");
        }
        require(token.transfer(winner, payout), "winner_transfer_failed");

        emit BetResolved(betId, winner, payout, fee);
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
}
