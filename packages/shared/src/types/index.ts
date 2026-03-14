/**
 * Shared types for the arena application
 * Used across agent-runtime, server, and web packages
 */

/**
 * Player profile representing a user in the system
 */
export interface Profile {
  id: string;
  username: string;
  displayName: string;
  createdAt: number;
  walletId: string;
  ownedBotIds: string[];
}

/**
 * Wallet record for managing user funds
 */
export interface WalletRecord {
  id: string;
  ownerProfileId: string;
  address: string;
  encryptedPrivateKey: string | null;
  walletProvider?: 'internal' | 'coinbase_embedded';
  externalWalletAddress?: string | null;
  externalWalletRef?: string | null;
  externalWalletLinkedAt?: number | null;
  balance: number;
  dailyTxCount: number;
  txDayStamp: string;
  createdAt: number;
  lastTxAt: number | null;
}

/**
 * Bot record for agent configuration
 */
export interface BotRecord {
  id: string;
  ownerProfileId: string | null;
  displayName: string;
  createdAt: number;
  managedBySuperAgent: boolean;
  autoplayEnabled?: boolean;
  duty: 'super' | 'npc' | 'duelist' | 'scout' | 'sparrer' | 'sentinel' | 'owner';
  patrolSection: number | null;
  walletId: string | null;
}

/**
 * Escrow lock record for challenge stakes
 */
export interface EscrowLockRecord {
  challengeId: string;
  challengerWalletId: string;
  opponentWalletId: string;
  amount: number;
  createdAt: number;
  lockTxHash: string;
}

/**
 * Escrow settlement record for completed challenges
 */
export interface EscrowSettlementRecord {
  challengeId: string;
  outcome: 'resolved' | 'refunded';
  challengerWalletId: string;
  opponentWalletId: string;
  winnerWalletId: string | null;
  amount: number;
  fee: number;
  payout: number;
  txHash: string;
  at: number;
}

/**
 * Wallet denial reason
 */
export interface WalletDenied {
  ok: false;
  reason: string;
}

/**
 * ETHSkills digest for cached knowledge
 */
export interface EthSkillDigest {
  url: string;
  title: string;
  summary: string;
  fetchedAt: number;
}

/**
 * Super Agent memory entry
 */
export interface SuperAgentMemoryEntry {
  at: number;
  type: 'command' | 'decision' | 'system';
  message: string;
}

/**
 * Super Agent LLM usage tracking
 */
export interface SuperAgentLlmUsage {
  hourStamp: string;
  requestsThisHour: number;
  dayStamp: string;
  tokensToday: number;
}

/**
 * Autoplay wager strategy modes
 */
export type WagerStrategyMode = 'fixed' | 'percent_wallet' | 'martingale';

/**
 * Autoplay pause reason codes
 */
export type AutoplayPauseReason =
  | 'stop_loss_hit'
  | 'take_profit_hit'
  | 'cooling_down'
  | 'blocked_no_eligible_game'
  | 'blocked_approval_required'
  | 'blocked_insufficient_funds'
  | 'owner_online'
  | null;

/**
 * Autoplay strategy configuration (distinct from static bot behavior)
 */
export interface AutoplayStrategyConfig {
  enabled: boolean;
  allowedGames: GameType[];
  wagerMode: WagerStrategyMode;
  baseWager: number;
  maxWager: number;
  /** % of wallet balance to wager (1-100), used when wagerMode is percent_wallet */
  walletPercent?: number;
  /** Martingale multiplier on loss (e.g. 2 = double), capped at maxWager */
  martingaleMultiplier?: number;
  sessionLossLimit?: number;
  sessionWinTarget?: number;
  cooldownMs: number;
}

/**
 * Autoplay runtime session state (ephemeral, not static config)
 */
export interface AutoplaySessionState {
  sessionNetPnl: number;
  currentWager: number;
  consecutiveLosses: number;
  pauseReason: AutoplayPauseReason;
  pausedAt: number | null;
  lastGameAt: number | null;
}

/**
 * Wallet readiness state for autoplay and manual play
 */
export type WalletReadinessStatus =
  | 'ready'
  | 'needs_approval'
  | 'needs_gas'
  | 'insufficient_usdc'
  | 'unsupported_provider';

export interface WalletReadiness {
  status: WalletReadinessStatus;
  reason: string;
  /** Minimum USDC needed to play at current wager config */
  minUsdc?: number;
  /** Whether gas is sponsored */
  gasSponsored: boolean;
}

/**
 * Challenge game types
 */
export type GameType = 'rps' | 'coinflip' | 'dice_duel' | 'blackjack';

/**
 * RPS move options
 */
export type RpsMove = 'rock' | 'paper' | 'scissors';

/**
 * Coinflip move options
 */
export type CoinflipMove = 'heads' | 'tails';
export type DiceDuelMove = 'd1' | 'd2' | 'd3' | 'd4' | 'd5' | 'd6';

/**
 * Blackjack move options
 */
export type BlackjackMove = 'hit' | 'stand' | 'double';

/**
 * Game move union type
 */
export type GameMove = RpsMove | CoinflipMove | DiceDuelMove | BlackjackMove;

/**
 * Challenge status (server-authoritative states)
 */
export type ChallengeStatus =
  | 'pending'
  | 'active'
  | 'resolved'
  | 'declined'
  | 'expired';

/**
 * Challenge event types
 */
export type ChallengeEventType =
  | 'created'
  | 'accepted'
  | 'declined'
  | 'expired'
  | 'resolved'
  | 'move_submitted'
  | 'invalid'
  | 'busy';

/**
 * Challenge record (server-side shape with all fields)
 */
export interface Challenge {
  id: string;
  challengerId: string;
  opponentId: string;
  status: ChallengeStatus;
  gameType: GameType;
  wager: number;
  createdAt: number;
  expiresAt: number;
  acceptedAt: number | null;
  resolvedAt: number | null;
  winnerId: string | null;
  challengerMove: GameMove | null;
  opponentMove: GameMove | null;
  coinflipResult: CoinflipMove | null;
  diceResult?: number | null;
  provablyFair?: ProvablyFairReceipt;
}

/**
 * Challenge event for state machine transitions
 */
export interface ChallengeEvent {
  type: 'challenge';
  event: ChallengeEventType;
  challengeId?: string;
  challenge?: Challenge;
  to?: string[];
  reason?: string;
}

/**
 * Challenge log entry for history tracking
 */
export interface ChallengeLog {
  at: number;
  event: ChallengeEventType;
  challengeId: string | null;
  challengerId: string | null;
  opponentId: string | null;
  gameType: GameType | null;
  winnerId: string | null;
  reason: string | null;
}

/**
 * World snapshot for multiplayer state
 */
export interface WorldSnapshot {
  tick: number;
  timestamp: number;
  players: SnapshotPlayer[];
}

export interface SnapshotPlayer {
  id: string;
  displayName: string;
  x: number;
  z: number;
  yaw: number;
  wallet?: string;
}

export type StationActionId =
  | 'coinflip_house_start'
  | 'coinflip_house_pick'
  | 'coinflip_pvp'
  | 'rps_house_start'
  | 'rps_house_pick'
  | 'dice_duel_start'
  | 'dice_duel_pick'
  | 'blackjack_start'
  | 'blackjack_hit'
  | 'blackjack_stand'
  | 'prediction_markets_open'
  | 'prediction_market_buy_yes'
  | 'prediction_market_buy_no'
  | 'interact_open'
  | 'interact_use'
  | 'balance'
  | 'fund'
  | 'withdraw'
  | 'transfer';

export interface SnapshotStation {
  id: string;
  kind: 'dealer_coinflip' | 'dealer_rps' | 'dealer_dice_duel' | 'dealer_blackjack' | 'dealer_prediction' | 'cashier_bank' | 'world_interactable';
  displayName: string;
  x: number;
  z: number;
  yaw: number;
  radius?: number;
  interactionTag?: string;
  actions: StationActionId[];
}

export interface ProvablyFairReceipt {
  commitHash: string;
  playerSeed: string;
  revealSeed?: string;
  method: string;
}

export type StationUiViewState =
  | 'dealer_ready'
  | 'dealer_ready_rps'
  | 'dealer_ready_dice'
  | 'dealer_ready_blackjack'
  | 'dealer_dealing'
  | 'dealer_reveal'
  | 'dealer_reveal_rps'
  | 'dealer_reveal_dice'
  | 'dealer_reveal_blackjack'
  | 'prediction_list'
  | 'prediction_order_pending'
  | 'prediction_order_filled'
  | 'prediction_settle'
  | 'prediction_error'
  | 'dealer_error';

export type PredictionSide = 'yes' | 'no';

export interface PredictionMarketView {
  marketId: string;
  slug: string;
  question: string;
  category: string;
  closeAt: number;
  resolveAt: number;
  status: 'open' | 'closed' | 'resolved' | 'cancelled';
  outcome: PredictionSide | null;
  yesPrice: number;
  noPrice: number;
  maxWager: number;
  oracleSource?: string;
  oracleMarketId?: string;
  rail?: 'btc_5m' | 'btc_24h';
  roundType?: 'current' | 'next';
  slotStart?: number;
  slotEnd?: number;
  currentSpotPrice?: number | null;
  currentSpotUpdatedAt?: number | null;
  currentSpotRoundId?: string | null;
  lockPrice?: number | null;
  lockPriceUpdatedAt?: number | null;
  lockRoundId?: string | null;
  finalPrice?: number | null;
  finalPriceUpdatedAt?: number | null;
  finalRoundId?: string | null;
  yesLiquidity?: number;
  noLiquidity?: number;
}

export interface PredictionPositionView {
  positionId: string;
  marketId: string;
  question: string;
  side: PredictionSide;
  stake: number;
  price: number;
  shares: number;
  potentialPayout: number;
  estimatedPayout?: number;
  minPayout?: number;
  payout?: number;
  settlementReason?: string | null;
  liquidityFloor?: number;
  status: 'scheduled' | 'open' | 'won' | 'lost' | 'voided';
  createdAt: number;
  settledAt: number | null;
  roundType?: 'current' | 'next';
  currentSpotPrice?: number | null;
  lockPrice?: number | null;
  finalPrice?: number | null;
}

export interface StationUiView {
  ok: boolean;
  reason?: string;
  reasonCode?: string;
  reasonText?: string;
  state?: StationUiViewState;
  preflight?: {
    playerOk: boolean;
    houseOk: boolean;
  };
  stationId?: string;
  challengeId?: string;
  commitHash?: string;
  method?: string;
  wager?: number;
  playerPick?: CoinflipMove;
  coinflipResult?: CoinflipMove;
  diceResult?: number;
  challengerPick?: DiceDuelMove;
  opponentPick?: DiceDuelMove;
  winnerId?: string | null;
  payoutDelta?: number;
  marketId?: string;
  side?: PredictionSide;
  price?: number;
  shares?: number;
  potentialPayout?: number;
  estimatedPayout?: number;
  minPayout?: number;
  liquidityOpposite?: number;
  liquiditySameSide?: number;
  liquidityWarning?: string;
  positionStatus?: 'scheduled' | 'open' | 'won' | 'lost' | 'voided';
  settlementStatus?: 'pending' | 'settled' | 'error';
  markets?: PredictionMarketView[];
  positions?: PredictionPositionView[];
  escrowTx?: {
    lock?: string;
    resolve?: string;
    refund?: string;
  };
  // Blackjack-specific fields
  playerHand?: string[];
  dealerHand?: string[];
  playerHandValue?: number;
  dealerHandValue?: number;
  dealerShowValue?: number;
  isSoft?: boolean;
}

/**
 * Input state from clients
 */
export interface InputState {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  timestamp: number;
}

/**
 * WebSocket client message types
 */
export type ClientMessageType =
  | 'join'
  | 'input'
  | 'challenge_send'
  | 'challenge_response'
  | 'challenge_counter'
  | 'station_interact'
  | 'move_submit'
  | 'leave';

export interface ClientMessage {
  type: ClientMessageType;
  [key: string]: unknown;
}

/**
 * Server message types
 */
export type ServerMessageType =
  | 'welcome'
  | 'snapshot'
  | 'challenge'
  | 'challenge_escrow'
  | 'station_ui'
  | 'error';

export interface ServerMessage {
  type: ServerMessageType;
  [key: string]: unknown;
}

/**
 * Presence entry for player tracking
 */
export interface PresenceEntry {
  id: string;
  displayName: string;
  x: number;
  z: number;
  yaw: number;
  updatedAt: number;
  serverId: string;
}

/**
 * API response helpers
 */
export interface ApiResponse<T = unknown> {
  ok: boolean;
  reason?: string;
  data?: T;
}

export interface ApiError {
  ok: false;
  reason: string;
}

export function createApiSuccess<T>(data: T): ApiResponse<T> & { ok: true } {
  return { ok: true, data };
}

export function createApiError(reason: string): ApiError {
  return { ok: false, reason };
}
