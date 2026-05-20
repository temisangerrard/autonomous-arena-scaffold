import { JsonRpcProvider, Wallet, Contract, keccak256, toUtf8Bytes, parseUnits, formatUnits } from 'ethers';
import { sendContractCallWithBuilderCode } from './lib/builderCode.js';

type LockParams = {
  challengeId: string;
  challengerWalletId: string;
  opponentWalletId: string; // kept for API compat; no longer staked on-chain
  amount: number;
};

type ResolveParams = {
  challengeId: string;
  winnerWalletId: string | null;
};

type EscrowResult = {
  ok: boolean;
  reason?: string;
  txHash?: string;
  fee?: number;
  payout?: number;
  raw?: Record<string, unknown>;
};

export type PoolBetStatus = 'none' | 'open' | 'settled' | 'refunded';

type PoolBetInspection = {
  ok: boolean;
  reason?: string;
  exists: boolean;
  status: PoolBetStatus;
  stake?: number;
  payout?: number;
  player?: string;
};

type EscrowOnchainReasonCode =
  | 'BET_ID_ALREADY_USED'
  | 'INVALID_WAGER'
  | 'INVALID_ESCROW_PARTICIPANTS'
  | 'BET_NOT_OPEN'
  | 'ROUND_ALREADY_FINALISED'
  | 'ROUND_NOT_SETTLED'
  | 'ONCHAIN_EXECUTION_ERROR';

type EscrowPreflightReasonCode =
  | 'PLAYER_ALLOWANCE_LOW'
  | 'PLAYER_BALANCE_LOW'
  | 'PLAYER_GAS_LOW'
  | 'PLAYER_SIGNER_UNAVAILABLE'
  | 'HOUSE_BALANCE_LOW'
  | 'HOUSE_GAS_LOW'
  | 'HOUSE_SIGNER_UNAVAILABLE'
  | 'HOUSE_ALLOWANCE_LOW'
  | 'INTERNAL_AUTH_FAILED'
  | 'INTERNAL_TRANSPORT_ERROR'
  | 'RPC_UNAVAILABLE'
  | 'UNKNOWN_PRECHECK_FAILURE';

type EscrowPreflightWalletStatus = {
  walletId: string;
  ok: boolean;
  reason?: string;
  allowance?: string;
  balance?: string;
  nativeBalanceEth?: string;
};

type EscrowPreflightResult = {
  ok: boolean;
  reason?: string;
  reasonCode?: EscrowPreflightReasonCode;
  reasonText?: string;
  preflight?: { playerOk: boolean; houseOk: boolean };
  raw?: Record<string, unknown>;
};

type OnchainEscrowConfig = {
  rpcUrl?: string;
  resolverPrivateKey?: string;
  escrowContractAddress?: string;
  tokenDecimals: number;
  internalToken?: string;
  builderCodeSuffix?: string;
};

type PoolContractApi = Contract & {
  deposit: (betId: string, roundId: string, side: boolean, player: string, amount: bigint) => Promise<{ hash: string; wait: () => Promise<{ hash?: string } | null> }>;
  settleRound: (roundId: string, yesWon: boolean) => Promise<{ hash: string; wait: () => Promise<{ hash?: string } | null> }>;
  cancelRound: (roundId: string) => Promise<{ hash: string; wait: () => Promise<{ hash?: string } | null> }>;
  payoutBet: (betId: string) => Promise<{ hash: string; wait: () => Promise<{ hash?: string } | null> }>;
  bets: (betId: string) => Promise<{
    roundId: string;
    player: string;
    stake: bigint;
    side: boolean;
    status: number;
    payout: bigint;
  }>;
};

type TxWithHash = {
  hash?: string;
  wait: () => Promise<{ hash?: string } | null>;
};

const POOL_ABI = [
  'function deposit(bytes32 betId, bytes32 roundId, bool side, address player, uint256 amount) external',
  'function settleRound(bytes32 roundId, bool yesWon) external',
  'function cancelRound(bytes32 roundId) external',
  'function payoutBet(bytes32 betId) external',
  'function bets(bytes32 betId) view returns (bytes32 roundId, address player, uint256 stake, bool side, uint8 status, uint256 payout)',
  'error InvalidAddress()',
  'error InvalidAmount()',
  'error BetAlreadyExists()',
  'error BetNotOpen()',
  'error RoundAlreadyFinalised()',
  'error RoundNotSettled()'
];

export class EscrowAdapter {
  private readonly provider: JsonRpcProvider | null;
  private readonly signer: Wallet | null;
  private readonly poolContract: PoolContractApi | null;
  private readonly tokenDecimals: number;
  private readonly internalToken: string;
  private readonly builderCodeSuffix: string;

  // Tracks challengeId → challengerWalletId so resolve() can determine yesWon side
  private readonly betChallengerMap = new Map<string, string>();

  private readonly preflightInFlight = new Map<string, Promise<EscrowResult>>();
  private readonly preflightCache = new Map<string, { expiresAt: number; result: EscrowResult }>();

  constructor(
    private readonly runtimeBaseUrl: string,
    onchain?: OnchainEscrowConfig
  ) {
    this.tokenDecimals = Math.max(0, Math.min(18, Number(onchain?.tokenDecimals ?? 6)));
    this.internalToken = onchain?.internalToken ?? '';
    this.builderCodeSuffix = String(onchain?.builderCodeSuffix || '').trim();

    if (
      onchain?.rpcUrl &&
      onchain?.resolverPrivateKey &&
      onchain?.escrowContractAddress
    ) {
      this.provider     = new JsonRpcProvider(onchain.rpcUrl);
      this.signer       = new Wallet(onchain.resolverPrivateKey, this.provider);
      this.poolContract = new Contract(onchain.escrowContractAddress, POOL_ABI, this.signer) as PoolContractApi;
    } else {
      this.provider     = null;
      this.signer       = null;
      this.poolContract = null;
    }
  }

  // ---------------------------------------------------------------------------
  // PUBLIC API — house-game flow (called from index.ts)
  // ---------------------------------------------------------------------------

  async lockStake(params: LockParams): Promise<EscrowResult> {
    this.betChallengerMap.set(params.challengeId, params.challengerWalletId);
    return this.lockStakeOnchain(params);
  }

  async preflightStake(params: {
    challengerWalletId: string;
    opponentWalletId: string; // kept for API compat; pool model only checks player
    amount: number;
  }): Promise<EscrowPreflightResult> {
    const prepared = await this.prepareWalletsForOnchainEscrow([params.challengerWalletId], params.amount);
    if (prepared.ok) {
      return { ok: true, preflight: { playerOk: true, houseOk: true }, raw: prepared.raw };
    }
    return this.mapPrepareFailure({
      challengerWalletId: params.challengerWalletId,
      opponentWalletId: params.opponentWalletId,
      reason: prepared.reason,
      raw: prepared.raw
    });
  }

  async resolve(params: ResolveParams): Promise<EscrowResult> {
    if (!params.winnerWalletId) return this.refund(params.challengeId);
    return this.resolveOnchain(params);
  }

  async refund(challengeId: string): Promise<EscrowResult> {
    return this.refundOnchain(challengeId);
  }

  // ---------------------------------------------------------------------------
  // PUBLIC API — pool/prediction-market flow (called from MarketService)
  // ---------------------------------------------------------------------------

  /**
   * Deposit a player's stake into a shared parimutuel round.
   * Used for prediction markets where multiple positions share a roundId (marketId).
   */
  async lockPoolBet(params: {
    betId: string;
    marketId: string;
    side: boolean;       // true = yes/up,  false = no/down
    playerWalletId: string;
    amount: number;
  }): Promise<EscrowResult> {
    const pool = this.poolContract;
    if (!pool) return this.poolNotConfiguredError();

    const playerAddress = await this.walletAddressById(params.playerWalletId);
    if (!playerAddress) {
      return { ok: false, reason: 'wallet_address_missing', raw: { reasonCode: 'PLAYER_SIGNER_UNAVAILABLE' } };
    }

    const preflight = await this.prepareWalletsForOnchainEscrow([params.playerWalletId], params.amount);
    if (!preflight.ok) {
      const mapped = this.mapPrepareFailure({
        challengerWalletId: params.playerWalletId,
        opponentWalletId: params.playerWalletId,
        reason: preflight.reason,
        raw: preflight.raw
      });
      return {
        ok: false,
        reason: mapped.reason ?? 'wallet_prepare_failed',
        raw: { reasonCode: mapped.reasonCode, reasonText: mapped.reasonText, ...(mapped.raw ?? {}) }
      };
    }

    try {
      const betId32   = this.betIdFor(params.betId);
      const roundId32 = this.roundIdFor(params.marketId);
      const amount    = parseUnits(String(params.amount), this.tokenDecimals);
      const tx        = await sendContractCallWithBuilderCode(
        pool,
        this.signer!,
        'deposit',
        [betId32, roundId32, params.side, playerAddress, amount],
        this.builderCodeSuffix
      ) as TxWithHash;
      const receipt   = await tx.wait();
      return { ok: true, txHash: receipt?.hash ?? tx.hash };
    } catch (error) {
      return this.onchainErrorResult(error, 'onchain_pool_deposit_failed');
    }
  }

  /** Settle a prediction-market round on-chain. Call once per market before payoutPoolBet. */
  async settlePoolRound(params: { marketId: string; yesWon: boolean }): Promise<EscrowResult> {
    const pool = this.poolContract;
    if (!pool) return this.poolNotConfiguredError();
    try {
      const tx      = await sendContractCallWithBuilderCode(
        pool,
        this.signer!,
        'settleRound',
        [this.roundIdFor(params.marketId), params.yesWon],
        this.builderCodeSuffix
      ) as TxWithHash;
      const receipt = await tx.wait();
      return { ok: true, txHash: receipt?.hash ?? tx.hash };
    } catch (error) {
      return this.onchainErrorResult(error, 'onchain_settle_round_failed');
    }
  }

  /** Cancel a prediction-market round (tie, oracle failure). */
  async cancelPoolRound(params: { marketId: string }): Promise<EscrowResult> {
    const pool = this.poolContract;
    if (!pool) return this.poolNotConfiguredError();
    try {
      const tx      = await sendContractCallWithBuilderCode(
        pool,
        this.signer!,
        'cancelRound',
        [this.roundIdFor(params.marketId)],
        this.builderCodeSuffix
      ) as TxWithHash;
      const receipt = await tx.wait();
      return { ok: true, txHash: receipt?.hash ?? tx.hash };
    } catch (error) {
      return this.onchainErrorResult(error, 'onchain_cancel_round_failed');
    }
  }

  /** Push payout for a single bet after its round is settled or cancelled. */
  async payoutPoolBet(params: { betId: string }): Promise<EscrowResult> {
    const pool = this.poolContract;
    if (!pool) return this.poolNotConfiguredError();
    try {
      const tx      = await sendContractCallWithBuilderCode(
        pool,
        this.signer!,
        'payoutBet',
        [this.betIdFor(params.betId)],
        this.builderCodeSuffix
      ) as TxWithHash;
      const receipt = await tx.wait();
      return { ok: true, txHash: receipt?.hash ?? tx.hash };
    } catch (error) {
      return this.onchainErrorResult(error, 'onchain_payout_bet_failed');
    }
  }

  async inspectPoolBet(params: { betId: string }): Promise<PoolBetInspection> {
    const pool = this.poolContract;
    if (!pool) {
      return { ok: false, reason: 'onchain_config_missing', exists: false, status: 'none' };
    }
    try {
      const row = await pool.bets(this.betIdFor(params.betId));
      const statusRaw = Number((row as { status?: unknown })?.status ?? 0);
      const stakeRaw = (row as { stake?: bigint })?.stake ?? 0n;
      const payoutRaw = (row as { payout?: bigint })?.payout ?? 0n;
      const player = String((row as { player?: unknown })?.player || '');
      const status: PoolBetStatus =
        statusRaw === 1 ? 'open' :
        statusRaw === 2 ? 'settled' :
        statusRaw === 3 ? 'refunded' :
        'none';
      const exists = status !== 'none';
      return {
        ok: true,
        exists,
        status,
        stake: Number(formatUnits(stakeRaw, this.tokenDecimals)),
        payout: Number(formatUnits(payoutRaw, this.tokenDecimals)),
        player
      };
    } catch (error) {
      return { ok: false, reason: this.errorReason(error, 'onchain_inspect_failed'), exists: false, status: 'none' };
    }
  }

  async forceRefundPoolBet(params: { marketId: string; betId: string }): Promise<EscrowResult> {
    const pool = this.poolContract;
    if (!pool) return this.poolNotConfiguredError();
    const roundId = this.roundIdFor(params.marketId);
    const betId = this.betIdFor(params.betId);
    try {
      // If the round is already finalised, payoutBet can still succeed for Open bets.
      await sendContractCallWithBuilderCode(
        pool,
        this.signer!,
        'cancelRound',
        [roundId],
        this.builderCodeSuffix
      ).then((tx) => tx.wait()).catch(() => null);
      const payoutTx = await sendContractCallWithBuilderCode(
        pool,
        this.signer!,
        'payoutBet',
        [betId],
        this.builderCodeSuffix
      ) as TxWithHash;
      const receipt = await payoutTx.wait();
      return { ok: true, txHash: receipt?.hash ?? payoutTx.hash };
    } catch (error) {
      return this.onchainErrorResult(error, 'onchain_force_refund_failed');
    }
  }

  // ---------------------------------------------------------------------------
  // PRIVATE — wallet address resolution
  // ---------------------------------------------------------------------------

  private walletAddressCache = new Map<string, { address: string; fetchedAt: number }>();
  private static readonly WALLET_CACHE_TTL_MS = 30_000;

  private async walletAddressById(walletId: string): Promise<string | null> {
    const cached = this.walletAddressCache.get(walletId);
    if (cached && (Date.now() - cached.fetchedAt) < EscrowAdapter.WALLET_CACHE_TTL_MS) {
      return cached.address;
    }
    try {
      const response = await fetch(`${this.runtimeBaseUrl}/wallets`, {
        headers: this.internalToken ? { 'x-internal-token': this.internalToken } : {}
      });
      if (!response.ok) return null;
      const payload = (await response.json()) as { wallets?: Array<{ id?: string; address?: string }> };
      const now = Date.now();
      for (const entry of payload.wallets ?? []) {
        if (entry?.id && typeof entry.address === 'string') {
          this.walletAddressCache.set(entry.id, { address: entry.address, fetchedAt: now });
        }
      }
      const wallet = payload.wallets?.find((entry) => entry?.id === walletId);
      return typeof wallet?.address === 'string' ? wallet.address : null;
    } catch {
      return null;
    }
  }

  private betIdFor(id: string): string {
    return keccak256(toUtf8Bytes(`arena:${id}`));
  }

  private roundIdFor(marketId: string): string {
    return keccak256(toUtf8Bytes(`arena:round:${marketId}`));
  }

  // ---------------------------------------------------------------------------
  // PRIVATE — house-game on-chain operations
  // ---------------------------------------------------------------------------

  private async lockStakeOnchain(params: LockParams): Promise<EscrowResult> {
    const pool = this.poolContract;
    if (!pool) return this.poolNotConfiguredError();

    const playerAddress = await this.walletAddressById(params.challengerWalletId);
    if (!playerAddress) {
      return {
        ok: false,
        reason: 'wallet_address_missing',
        raw: { reasonCode: 'PLAYER_SIGNER_UNAVAILABLE', reasonText: 'Could not resolve player wallet address. Reconnect wallet and retry.' }
      };
    }

    try {
      const preflight = await this.preflightStake({
        challengerWalletId: params.challengerWalletId,
        opponentWalletId: params.opponentWalletId,
        amount: params.amount
      });
      if (!preflight.ok) {
        return {
          ok: false,
          reason: preflight.reason ?? 'wallet_prepare_failed',
          raw: { reasonCode: preflight.reasonCode, reasonText: preflight.reasonText, ...(preflight.raw ?? {}) }
        };
      }

      const betId32 = this.betIdFor(params.challengeId);
      const amount  = parseUnits(String(params.amount), this.tokenDecimals);
      // House games: roundId == betId, player always on "yes" side (true)
      const tx      = await sendContractCallWithBuilderCode(
        pool,
        this.signer!,
        'deposit',
        [betId32, betId32, true, playerAddress, amount],
        this.builderCodeSuffix
      ) as TxWithHash;
      const receipt = await tx.wait();
      return { ok: true, txHash: receipt?.hash ?? tx.hash };
    } catch (error) {
      return this.onchainErrorResult(error, 'onchain_lock_failed');
    }
  }

  private async resolveOnchain(params: ResolveParams): Promise<EscrowResult> {
    const pool = this.poolContract;
    if (!pool) return this.poolNotConfiguredError();

    const winnerAddress = await this.walletAddressById(params.winnerWalletId!);
    if (!winnerAddress) return { ok: false, reason: 'winner_wallet_address_missing' };

    // Determine winning side: player (yes=true) or house (no=false)
    const challengerWalletId = this.betChallengerMap.get(params.challengeId);
    let playerWon = true;
    if (challengerWalletId) {
      const challengerAddress = await this.walletAddressById(challengerWalletId);
      if (challengerAddress) {
        playerWon = winnerAddress.toLowerCase() === challengerAddress.toLowerCase();
      }
    }

    try {
      const betId32   = this.betIdFor(params.challengeId);
      const settleTx  = await sendContractCallWithBuilderCode(
        pool,
        this.signer!,
        'settleRound',
        [betId32, playerWon],
        this.builderCodeSuffix
      ) as TxWithHash;
      await settleTx.wait();
      const payoutTx  = await sendContractCallWithBuilderCode(
        pool,
        this.signer!,
        'payoutBet',
        [betId32],
        this.builderCodeSuffix
      ) as TxWithHash;
      const receipt   = await payoutTx.wait();
      this.betChallengerMap.delete(params.challengeId);
      return { ok: true, txHash: receipt?.hash ?? payoutTx.hash };
    } catch (error) {
      return this.onchainErrorResult(error, 'onchain_resolve_failed');
    }
  }

  private async refundOnchain(challengeId: string): Promise<EscrowResult> {
    const pool = this.poolContract;
    if (!pool) return this.poolNotConfiguredError();
    try {
      const betId32  = this.betIdFor(challengeId);
      const cancelTx = await sendContractCallWithBuilderCode(
        pool,
        this.signer!,
        'cancelRound',
        [betId32],
        this.builderCodeSuffix
      ) as TxWithHash;
      await cancelTx.wait();
      const payoutTx = await sendContractCallWithBuilderCode(
        pool,
        this.signer!,
        'payoutBet',
        [betId32],
        this.builderCodeSuffix
      ) as TxWithHash;
      const receipt  = await payoutTx.wait();
      this.betChallengerMap.delete(challengeId);
      return { ok: true, txHash: receipt?.hash ?? payoutTx.hash };
    } catch (error) {
      return this.onchainErrorResult(error, 'onchain_refund_failed');
    }
  }

  // ---------------------------------------------------------------------------
  // PRIVATE — preflight / wallet preparation
  // ---------------------------------------------------------------------------

  private async prepareWalletsForOnchainEscrow(walletIds: string[], amount: number): Promise<EscrowResult> {
    const key    = this.preflightKey(walletIds, amount);
    const now    = Date.now();
    const cached = this.preflightCache.get(key);
    if (cached && cached.expiresAt > now) {
      return { ...cached.result, raw: cached.result.raw ? { ...cached.result.raw } : undefined };
    }

    const inFlight = this.preflightInFlight.get(key);
    if (inFlight) {
      const shared = await inFlight;
      return { ...shared, raw: shared.raw ? { ...shared.raw } : undefined };
    }

    const run = (async (): Promise<EscrowResult> => {
      const maxAttempts = 3;
      let lastFailure: EscrowResult = { ok: false, reason: 'wallet_prepare_unreachable' };
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
          const response = await fetch(`${this.runtimeBaseUrl}/wallets/onchain/prepare-escrow`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              ...(this.internalToken ? { 'x-internal-token': this.internalToken } : {})
            },
            signal: AbortSignal.timeout(10_000),
            body: JSON.stringify({ walletIds, amount })
          });
          const payload = await response.json().catch(() => null) as { ok?: boolean; reason?: string } | null;
          if (response.ok && payload?.ok) {
            const ok = { ok: true, raw: payload as Record<string, unknown> };
            this.cachePreflightResult(key, ok);
            return ok;
          }
          lastFailure = {
            ok: false,
            reason: payload?.reason ?? `wallet_prepare_http_${response.status}`,
            raw: payload as Record<string, unknown> | undefined
          };
          if (!this.shouldRetryPrepareFailure(lastFailure.reason, response.status) || attempt >= maxAttempts) {
            this.cachePreflightResult(key, lastFailure);
            return lastFailure;
          }
        } catch (error) {
          const timeout = String((error as { name?: string }).name || '').toLowerCase().includes('timeout');
          lastFailure = { ok: false, reason: timeout ? 'wallet_prepare_timeout' : 'wallet_prepare_unreachable' };
          if (attempt >= maxAttempts) {
            this.cachePreflightResult(key, lastFailure);
            return lastFailure;
          }
        }
        await this.delayPrepareRetry(attempt);
      }
      this.cachePreflightResult(key, lastFailure);
      return lastFailure;
    })();

    this.preflightInFlight.set(key, run);
    try {
      return await run;
    } finally {
      this.preflightInFlight.delete(key);
    }
  }

  private mapPrepareFailure(params: {
    challengerWalletId: string;
    opponentWalletId: string;
    reason?: string;
    raw?: Record<string, unknown>;
  }): EscrowPreflightResult {
    const rawResults = Array.isArray(params.raw?.results) ? params.raw.results : [];
    const statuses: EscrowPreflightWalletStatus[] = rawResults
      .filter((entry) => entry && typeof entry === 'object')
      .map((entry) => {
        const obj = entry as Record<string, unknown>;
        return {
          walletId: String(obj.walletId ?? ''),
          ok: Boolean(obj.ok),
          reason: typeof obj.reason === 'string' ? obj.reason : undefined,
          allowance: typeof obj.allowance === 'string' ? obj.allowance : undefined,
          balance: typeof obj.balance === 'string' ? obj.balance : undefined,
          nativeBalanceEth: typeof obj.nativeBalanceEth === 'string' ? obj.nativeBalanceEth : undefined
        };
      })
      .filter((entry) => entry.walletId.length > 0);

    const player   = statuses.find((entry) => entry.walletId === params.challengerWalletId);
    const house    = statuses.find((entry) => entry.walletId === params.opponentWalletId);
    const failed   = statuses.find((entry) => !entry.ok) ?? (player && !player.ok ? player : null);
    const reason   = failed?.reason || params.reason || 'wallet_prepare_failed';
    const detail   = reason.toLowerCase();
    const isPlayer = !failed || failed.walletId === params.challengerWalletId;

    let reasonCode: EscrowPreflightReasonCode = 'UNKNOWN_PRECHECK_FAILURE';
    let reasonText = 'Escrow precheck failed.';

    if (detail.includes('wallet_prepare_http_401') || detail.includes('wallet_prepare_http_403')) {
      reasonCode = 'INTERNAL_AUTH_FAILED';
      reasonText = 'Internal runtime auth failed. Verify INTERNAL_SERVICE_TOKEN parity.';
    } else if (detail.includes('wallet_prepare_http_429') || detail.includes('too_many') || detail.includes('rate')) {
      reasonCode = 'INTERNAL_TRANSPORT_ERROR';
      reasonText = 'Escrow precheck is rate-limited. Retry shortly.';
    } else if (detail.includes('wallet_prepare_http_5') || detail.includes('wallet_prepare_timeout') || detail.includes('wallet_prepare_unreachable')) {
      reasonCode = 'INTERNAL_TRANSPORT_ERROR';
      reasonText = 'Runtime escrow preparation endpoint is unavailable. Retry shortly.';
    } else if (detail.includes('paymaster_unavailable') || detail.includes('paymaster_policy_denied')) {
      reasonCode = 'INTERNAL_TRANSPORT_ERROR';
      reasonText = 'Coinbase paymaster is unavailable for escrow preflight. Retry shortly.';
    } else if (detail.includes('rpc') || detail.includes('network') || detail.includes('onchain_config_missing')) {
      reasonCode = 'RPC_UNAVAILABLE';
      reasonText = 'Onchain network is unavailable. Try again shortly.';
    } else if (detail.includes('wallet_signer_unavailable')) {
      reasonCode = isPlayer ? 'PLAYER_SIGNER_UNAVAILABLE' : 'HOUSE_SIGNER_UNAVAILABLE';
      reasonText = isPlayer
        ? 'Player wallet signer unavailable. Reconnect wallet session.'
        : 'House wallet signer unavailable.';
    } else if (detail.includes('allowance_too_low') || detail.includes('approve_failed')) {
      reasonCode = isPlayer ? 'PLAYER_ALLOWANCE_LOW' : 'HOUSE_ALLOWANCE_LOW';
      reasonText = isPlayer
        ? `Approval required for ${params.challengerWalletId} before pool deposit.`
        : 'Approval required before pool deposit.';
    } else if (detail.includes('mainnet_gas_required') || detail.includes('user_funded') || detail.includes('gas_topup_failed') || detail.includes('insufficient funds')) {
      reasonCode = isPlayer ? 'PLAYER_GAS_LOW' : 'HOUSE_GAS_LOW';
      reasonText = isPlayer
        ? `This mainnet trade needs ETH gas in ${params.challengerWalletId}. Fund Base ETH and retry.`
        : 'House sponsor wallet is out of ETH gas.';
    } else if (detail.includes('insufficient_token_balance')) {
      reasonCode = isPlayer ? 'PLAYER_BALANCE_LOW' : 'HOUSE_BALANCE_LOW';
      reasonText = isPlayer
        ? `Insufficient token balance for ${params.challengerWalletId}. Fund wallet and retry.`
        : 'Insufficient token balance.';
    }

    return {
      ok: false,
      reason,
      reasonCode,
      reasonText,
      preflight: { playerOk: Boolean(player?.ok), houseOk: house !== undefined ? Boolean(house.ok) : true },
      raw: params.raw
    };
  }

  private preflightKey(walletIds: string[], amount: number): string {
    const normalizedAmount = Number.isFinite(amount) ? Number(amount) : 0;
    const ids = walletIds.map((entry) => String(entry || '').trim()).filter(Boolean).sort();
    return `${ids.join('|')}::${normalizedAmount}`;
  }

  private cachePreflightResult(key: string, result: EscrowResult): void {
    const reason = String(result.reason || '').toLowerCase();
    let ttlMs = result.ok ? 1_500 : 800;
    if (!result.ok && (reason.includes('429') || reason.includes('rate') || reason.includes('too_many'))) {
      ttlMs = 2_500;
    }
    this.preflightCache.set(key, {
      expiresAt: Date.now() + ttlMs,
      result: { ...result, raw: result.raw ? { ...result.raw } : undefined }
    });
  }

  private shouldRetryPrepareFailure(reason: string | undefined, status: number): boolean {
    const r = String(reason || '').toLowerCase();
    if (status === 429 || status >= 500) return true;
    return r.includes('timeout')
      || r.includes('unreachable')
      || r.includes('transport')
      || r.includes('rate')
      || r.includes('too_many')
      || r.includes('paymaster_unavailable')
      || r.includes('paymaster_policy_denied');
  }

  private async delayPrepareRetry(attempt: number): Promise<void> {
    const ms = Math.max(50, Math.min(250, attempt * 75));
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ---------------------------------------------------------------------------
  // PRIVATE — error helpers
  // ---------------------------------------------------------------------------

  private poolNotConfiguredError(): EscrowResult {
    return {
      ok: false,
      reason: 'onchain_config_missing',
      raw: {
        reasonCode: 'RPC_UNAVAILABLE',
        reasonText: 'Pool contract not configured. Set CHAIN_RPC_URL, ESCROW_CONTRACT_ADDRESS (PariMutuelPool), and ESCROW_RESOLVER_PRIVATE_KEY.'
      }
    };
  }

  private onchainErrorResult(error: unknown, fallback: string): EscrowResult {
    const decoded = this.decodePoolCustomError(error);
    if (decoded) {
      return { ok: false, reason: decoded.reason, raw: { reasonCode: decoded.reasonCode, reasonText: decoded.reasonText } };
    }
    const message = this.errorReason(error, fallback);
    return { ok: false, reason: message, raw: { reasonCode: 'ONCHAIN_EXECUTION_ERROR', reasonText: message } };
  }

  private decodePoolCustomError(error: unknown): {
    reason: string; reasonCode: EscrowOnchainReasonCode; reasonText: string;
  } | null {
    const pool = this.poolContract;
    if (!pool) return null;
    const data = this.errorData(error);
    if (!data) return null;
    try {
      const parsed = pool.interface.parseError(data);
      const name   = String(parsed?.name || '');
      if (name === 'BetAlreadyExists')      return { reason: 'bet_already_exists',      reasonCode: 'BET_ID_ALREADY_USED',         reasonText: 'Bet ID already in use. Retry after refresh.' };
      if (name === 'InvalidAmount')         return { reason: 'invalid_amount',          reasonCode: 'INVALID_WAGER',               reasonText: 'Invalid wager amount.' };
      if (name === 'InvalidAddress')        return { reason: 'invalid_address',         reasonCode: 'INVALID_ESCROW_PARTICIPANTS', reasonText: 'Invalid participant address. Reconnect wallet.' };
      if (name === 'BetNotOpen')            return { reason: 'bet_not_open',            reasonCode: 'BET_NOT_OPEN',               reasonText: 'Bet is not in Open state.' };
      if (name === 'RoundAlreadyFinalised') return { reason: 'round_already_finalised', reasonCode: 'ROUND_ALREADY_FINALISED',    reasonText: 'Round already settled or cancelled.' };
      if (name === 'RoundNotSettled')       return { reason: 'round_not_settled',       reasonCode: 'ROUND_NOT_SETTLED',          reasonText: 'Round has not been settled yet.' };
    } catch {
      return null;
    }
    return null;
  }

  private errorData(error: unknown): string | null {
    const directData = (error as { data?: unknown } | null | undefined)?.data;
    if (typeof directData === 'string' && directData.length > 0) return directData;
    const nestedData = (error as { info?: { error?: { data?: unknown } } } | null | undefined)?.info?.error?.data;
    if (typeof nestedData === 'string' && nestedData.length > 0) return nestedData;
    return null;
  }

  private errorReason(error: unknown, fallback: string): string {
    const message = (error as { shortMessage?: string; message?: string })?.shortMessage
      || (error as { message?: string })?.message
      || fallback;
    return String(message).slice(0, 180);
  }
}
