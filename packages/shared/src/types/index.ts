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
  encryptedPrivateKey: string;
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
 * Challenge game types
 */
export type GameType = 'rps' | 'coinflip' | 'dice_duel';

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
 * Game move union type
 */
export type GameMove = RpsMove | CoinflipMove | DiceDuelMove;

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
  | 'interact_open'
  | 'interact_use'
  | 'balance'
  | 'fund'
  | 'withdraw'
  | 'transfer';

export interface SnapshotStation {
  id: string;
  kind: 'dealer_coinflip' | 'dealer_rps' | 'dealer_dice_duel' | 'cashier_bank' | 'world_interactable';
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
  | 'dealer_dealing'
  | 'dealer_reveal'
  | 'dealer_reveal_rps'
  | 'dealer_reveal_dice'
  | 'dealer_error';

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
  escrowTx?: {
    lock?: string;
    resolve?: string;
    refund?: string;
  };
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
