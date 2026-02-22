import { JsonRpcProvider, Wallet, Contract, keccak256, toUtf8Bytes, parseUnits } from 'ethers';

type LockParams = {
  challengeId: string;
  challengerWalletId: string;
  opponentWalletId: string;
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

type EscrowExecutionMode = 'runtime' | 'onchain';
type EscrowOnchainReasonCode =
  | 'BET_ID_ALREADY_USED'
  | 'INVALID_WAGER'
  | 'INVALID_ESCROW_PARTICIPANTS'
  | 'BET_NOT_LOCKED'
  | 'WINNER_NOT_PARTICIPANT'
  | 'ONCHAIN_EXECUTION_ERROR';

export type EscrowPreflightReasonCode =
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

export type EscrowPreflightWalletStatus = {
  walletId: string;
  ok: boolean;
  reason?: string;
  allowance?: string;
  balance?: string;
  nativeBalanceEth?: string;
};

export type EscrowPreflightResult = {
  ok: boolean;
  reason?: string;
  reasonCode?: EscrowPreflightReasonCode;
  reasonText?: string;
  preflight?: { playerOk: boolean; houseOk: boolean };
  raw?: Record<string, unknown>;
};

type OnchainEscrowConfig = {
  mode: EscrowExecutionMode;
  rpcUrl?: string;
  resolverPrivateKey?: string;
  escrowContractAddress?: string;
  tokenDecimals: number;
  internalToken?: string;
};

type EscrowContractApi = Contract & {
  createBet: (betId: string, challenger: string, opponent: string, amount: bigint) => Promise<{ hash: string; wait: () => Promise<{ hash?: string } | null> }>;
  resolveBet: (betId: string, winner: string) => Promise<{ hash: string; wait: () => Promise<{ hash?: string } | null> }>;
  refundBet: (betId: string) => Promise<{ hash: string; wait: () => Promise<{ hash?: string } | null> }>;
};

const ESCROW_ABI = [
  'function createBet(bytes32 betId, address challenger, address opponent, uint256 amount) external',
  'function resolveBet(bytes32 betId, address winner) external',
  'function refundBet(bytes32 betId) external',
  'error InvalidAddress()',
  'error InvalidAmount()',
  'error BetAlreadyExists()',
  'error BetNotLocked()',
  'error WinnerNotParticipant()'
];

export class EscrowAdapter {
  private readonly mode: EscrowExecutionMode;
  private readonly provider: JsonRpcProvider | null;
  private readonly signer: Wallet | null;
  private readonly escrowContract: EscrowContractApi | null;
  private readonly tokenDecimals: number;
  private readonly internalToken: string;
  private readonly preflightInFlight = new Map<string, Promise<EscrowResult>>();
  private readonly preflightCache = new Map<string, { expiresAt: number; result: EscrowResult }>();

  constructor(
    private readonly runtimeBaseUrl: string,
    private readonly feeBps: number,
    onchain?: OnchainEscrowConfig
  ) {
    this.mode = onchain?.mode ?? 'runtime';
    this.tokenDecimals = Math.max(0, Math.min(18, Number(onchain?.tokenDecimals ?? 6)));
    this.internalToken = onchain?.internalToken ?? '';

    if (
      this.mode === 'onchain' &&
      onchain?.rpcUrl &&
      onchain?.resolverPrivateKey &&
      onchain?.escrowContractAddress
    ) {
      this.provider = new JsonRpcProvider(onchain.rpcUrl);
      this.signer = new Wallet(onchain.resolverPrivateKey, this.provider);
      this.escrowContract = new Contract(onchain.escrowContractAddress, ESCROW_ABI, this.signer) as EscrowContractApi;
    } else {
      this.provider = null;
      this.signer = null;
      this.escrowContract = null;
    }
  }

  async lockStake(params: LockParams): Promise<EscrowResult> {
    if (this.mode === 'onchain') {
      return this.lockStakeOnchain(params);
    }
    const res = await this.post('/wallets/escrow/lock', params);
    return res;
  }

  async preflightStake(params: {
    challengerWalletId: string;
    opponentWalletId: string;
    amount: number;
  }): Promise<EscrowPreflightResult> {
    if (this.mode !== 'onchain') {
      return { ok: true, preflight: { playerOk: true, houseOk: true } };
    }
    const prepared = await this.prepareWalletsForOnchainEscrow([
      params.challengerWalletId,
      params.opponentWalletId
    ], params.amount);
    if (prepared.ok) {
      return {
        ok: true,
        preflight: { playerOk: true, houseOk: true },
        raw: prepared.raw
      };
    }
    return this.mapPrepareFailure({
      challengerWalletId: params.challengerWalletId,
      opponentWalletId: params.opponentWalletId,
      reason: prepared.reason,
      raw: prepared.raw
    });
  }

  async resolve(params: ResolveParams): Promise<EscrowResult> {
    if (!params.winnerWalletId) {
      return this.refund(params.challengeId);
    }

    if (this.mode === 'onchain') {
      return this.resolveOnchain(params);
    }

    return this.post('/wallets/escrow/resolve', {
      challengeId: params.challengeId,
      winnerWalletId: params.winnerWalletId,
      feeBps: this.feeBps
    });
  }

  async refund(challengeId: string): Promise<EscrowResult> {
    if (this.mode === 'onchain') {
      return this.refundOnchain(challengeId);
    }
    return this.post('/wallets/escrow/refund', { challengeId });
  }

  private async walletAddressById(walletId: string): Promise<string | null> {
    try {
      const response = await fetch(`${this.runtimeBaseUrl}/wallets`);
      if (!response.ok) {
        return null;
      }
      const payload = (await response.json()) as { wallets?: Array<{ id?: string; address?: string }> };
      const wallet = payload.wallets?.find((entry) => entry?.id === walletId);
      return typeof wallet?.address === 'string' ? wallet.address : null;
    } catch {
      return null;
    }
  }

  private betIdFor(challengeId: string): string {
    return keccak256(toUtf8Bytes(`arena:${challengeId}`));
  }

  private async lockStakeOnchain(params: LockParams): Promise<EscrowResult> {
    const escrow = this.escrowContract;
    if (!escrow) {
      return { ok: false, reason: 'onchain_config_missing' };
    }
    const challengerAddress = await this.walletAddressById(params.challengerWalletId);
    const opponentAddress = await this.walletAddressById(params.opponentWalletId);
    if (!challengerAddress || !opponentAddress) {
      return { ok: false, reason: 'wallet_address_missing' };
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
          raw: {
            reasonCode: preflight.reasonCode,
            reasonText: preflight.reasonText,
            preflight: preflight.preflight,
            ...(preflight.raw ?? {})
          }
        };
      }
      const amount = parseUnits(String(params.amount), this.tokenDecimals);
      const tx = await escrow.createBet(
        this.betIdFor(params.challengeId),
        challengerAddress,
        opponentAddress,
        amount
      );
      const receipt = await tx.wait();
      return { ok: true, txHash: receipt?.hash ?? tx.hash };
    } catch (error) {
      return this.onchainErrorResult(error, 'onchain_lock_failed');
    }
  }

  private async prepareWalletsForOnchainEscrow(walletIds: string[], amount: number): Promise<EscrowResult> {
    const key = this.preflightKey(walletIds, amount);
    const now = Date.now();
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
      if (!response.ok || !payload?.ok) {
        const failed = {
          ok: false,
          reason: payload?.reason ?? `wallet_prepare_http_${response.status}`,
          raw: payload as Record<string, unknown> | undefined
        };
        this.cachePreflightResult(key, failed);
        return failed;
      }
      const ok = { ok: true, raw: payload as Record<string, unknown> };
      this.cachePreflightResult(key, ok);
      return ok;
      } catch (error) {
      const timeout = String((error as { name?: string }).name || '').toLowerCase().includes('timeout');
      const failed = { ok: false, reason: timeout ? 'wallet_prepare_timeout' : 'wallet_prepare_unreachable' };
      this.cachePreflightResult(key, failed);
      return failed;
      }
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
    const rawResults = Array.isArray(params.raw?.results)
      ? params.raw.results
      : [];
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

    const player = statuses.find((entry) => entry.walletId === params.challengerWalletId);
    const house = statuses.find((entry) => entry.walletId === params.opponentWalletId);
    const failed =
      statuses.find((entry) => !entry.ok)
      ?? (player && !player.ok ? player : null)
      ?? (house && !house.ok ? house : null);

    const reason = failed?.reason || params.reason || 'wallet_prepare_failed';
    const detail = reason.toLowerCase();
    const isPlayer = failed?.walletId === params.challengerWalletId;

    let reasonCode: EscrowPreflightReasonCode = 'UNKNOWN_PRECHECK_FAILURE';
    let reasonText = 'Escrow precheck failed.';
    if (detail.includes('wallet_prepare_http_401') || detail.includes('wallet_prepare_http_403')) {
      reasonCode = 'INTERNAL_AUTH_FAILED';
      reasonText = 'Internal runtime auth failed. Verify INTERNAL_SERVICE_TOKEN parity.';
    } else if (
      detail.includes('wallet_prepare_http_429')
      || detail.includes('too_many')
      || detail.includes('rate')
    ) {
      reasonCode = 'INTERNAL_TRANSPORT_ERROR';
      reasonText = 'Escrow precheck is rate-limited. Retry shortly.';
    } else if (
      detail.includes('wallet_prepare_http_5')
      || detail.includes('wallet_prepare_timeout')
      || detail.includes('wallet_prepare_unreachable')
    ) {
      reasonCode = 'INTERNAL_TRANSPORT_ERROR';
      reasonText = 'Runtime escrow preparation endpoint is unavailable. Retry shortly.';
    } else if (
      detail.includes('wallet_prepare_unreachable')
      || detail.includes('onchain_config_missing')
      || detail.includes('rpc')
      || detail.includes('network')
    ) {
      reasonCode = 'RPC_UNAVAILABLE';
      reasonText = 'Onchain network is unavailable. Try again shortly.';
    } else if (detail.includes('wallet_signer_unavailable')) {
      reasonCode = isPlayer ? 'PLAYER_SIGNER_UNAVAILABLE' : 'HOUSE_SIGNER_UNAVAILABLE';
      reasonText = isPlayer
        ? 'Player wallet signer unavailable. Reconnect wallet session.'
        : 'House wallet signer unavailable. House must re-enable signer.';
    } else if (detail.includes('allowance_too_low') || detail.includes('approve_failed')) {
      reasonCode = isPlayer ? 'PLAYER_ALLOWANCE_LOW' : 'HOUSE_ALLOWANCE_LOW';
      reasonText = isPlayer
        ? `Approval required for ${params.challengerWalletId} before escrow lock.`
        : `House approval required for ${params.opponentWalletId} before escrow lock.`;
    } else if (detail.includes('gas_topup_failed') || detail.includes('insufficient funds for intrinsic') || detail.includes('insufficient funds')) {
      reasonCode = isPlayer ? 'PLAYER_GAS_LOW' : 'HOUSE_GAS_LOW';
      reasonText = isPlayer
        ? `Insufficient ETH gas for ${params.challengerWalletId} approval transaction.`
        : `House sponsor wallet is out of ETH gas for ${params.opponentWalletId}.`;
    } else if (detail.includes('insufficient_token_balance') || detail.includes('mint_failed')) {
      reasonCode = isPlayer ? 'PLAYER_BALANCE_LOW' : 'HOUSE_BALANCE_LOW';
      reasonText = isPlayer
        ? `Insufficient token balance for ${params.challengerWalletId}. Fund wallet and retry.`
        : 'House cannot cover this wager right now.';
    }

    const result: EscrowPreflightResult = {
      ok: false,
      reason,
      reasonCode,
      reasonText,
      preflight: {
        playerOk: Boolean(player?.ok),
        houseOk: Boolean(house?.ok)
      },
      raw: params.raw
    };
    return result;
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
      result: {
        ...result,
        raw: result.raw ? { ...result.raw } : undefined
      }
    });
  }

  private async resolveOnchain(params: ResolveParams): Promise<EscrowResult> {
    const escrow = this.escrowContract;
    if (!escrow) {
      return { ok: false, reason: 'onchain_config_missing' };
    }
    const winnerAddress = await this.walletAddressById(params.winnerWalletId!);
    if (!winnerAddress) {
      return { ok: false, reason: 'winner_wallet_address_missing' };
    }
    try {
      const tx = await escrow.resolveBet(this.betIdFor(params.challengeId), winnerAddress);
      const receipt = await tx.wait();
      return { ok: true, txHash: receipt?.hash ?? tx.hash };
    } catch (error) {
      return this.onchainErrorResult(error, 'onchain_resolve_failed');
    }
  }

  private async refundOnchain(challengeId: string): Promise<EscrowResult> {
    const escrow = this.escrowContract;
    if (!escrow) {
      return { ok: false, reason: 'onchain_config_missing' };
    }
    try {
      const tx = await escrow.refundBet(this.betIdFor(challengeId));
      const receipt = await tx.wait();
      return { ok: true, txHash: receipt?.hash ?? tx.hash };
    } catch (error) {
      return this.onchainErrorResult(error, 'onchain_refund_failed');
    }
  }

  private onchainErrorResult(error: unknown, fallback: string): EscrowResult {
    const decoded = this.decodeEscrowCustomError(error);
    if (decoded) {
      return {
        ok: false,
        reason: decoded.reason,
        raw: {
          reasonCode: decoded.reasonCode,
          reasonText: decoded.reasonText
        }
      };
    }

    const message = this.errorReason(error, fallback);
    return {
      ok: false,
      reason: message,
      raw: {
        reasonCode: 'ONCHAIN_EXECUTION_ERROR',
        reasonText: message
      }
    };
  }

  private decodeEscrowCustomError(error: unknown): {
    reason: string;
    reasonCode: EscrowOnchainReasonCode;
    reasonText: string;
  } | null {
    const escrow = this.escrowContract;
    if (!escrow) {
      return null;
    }

    const data = this.errorData(error);
    if (!data) {
      return null;
    }

    try {
      const parsed = escrow.interface.parseError(data);
      const name = String(parsed?.name || '');
      if (name === 'BetAlreadyExists') {
        return {
          reason: 'bet_already_exists',
          reasonCode: 'BET_ID_ALREADY_USED',
          reasonText: 'Existing escrow bet ID detected. Retry after refresh.'
        };
      }
      if (name === 'InvalidAmount') {
        return {
          reason: 'invalid_amount',
          reasonCode: 'INVALID_WAGER',
          reasonText: 'Invalid wager amount for escrow lock.'
        };
      }
      if (name === 'InvalidAddress') {
        return {
          reason: 'invalid_address',
          reasonCode: 'INVALID_ESCROW_PARTICIPANTS',
          reasonText: 'Escrow participants are invalid. Reconnect wallets and retry.'
        };
      }
      if (name === 'BetNotLocked') {
        return {
          reason: 'bet_not_locked',
          reasonCode: 'BET_NOT_LOCKED',
          reasonText: 'Escrow bet is not locked for this challenge.'
        };
      }
      if (name === 'WinnerNotParticipant') {
        return {
          reason: 'winner_not_participant',
          reasonCode: 'WINNER_NOT_PARTICIPANT',
          reasonText: 'Winner wallet is not a participant in this escrow bet.'
        };
      }
    } catch {
      return null;
    }
    return null;
  }

  private errorData(error: unknown): string | null {
    const directData = (error as { data?: unknown } | null | undefined)?.data;
    if (typeof directData === 'string' && directData.length > 0) {
      return directData;
    }
    const nestedData = (error as { info?: { error?: { data?: unknown } } } | null | undefined)
      ?.info?.error?.data;
    if (typeof nestedData === 'string' && nestedData.length > 0) {
      return nestedData;
    }
    return null;
  }

  private errorReason(error: unknown, fallback: string): string {
    const message = (error as { shortMessage?: string; message?: string })?.shortMessage
      || (error as { message?: string })?.message
      || fallback;
    return String(message).slice(0, 180);
  }

  private async post(pathname: string, body: unknown): Promise<EscrowResult> {
    try {
      const response = await fetch(`${this.runtimeBaseUrl}${pathname}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });

      const payload = await response.json().catch(() => null) as
        | { ok?: boolean; reason?: string; txHash?: string; fee?: number; payout?: number }
        | null;
      if (!response.ok || !payload?.ok) {
        return { ok: false, reason: payload?.reason ?? `http_${response.status}` };
      }
      return {
        ok: true,
        txHash: typeof payload.txHash === 'string' ? payload.txHash : undefined,
        fee: typeof payload.fee === 'number' ? payload.fee : undefined,
        payout: typeof payload.payout === 'number' ? payload.payout : undefined,
        raw: payload as Record<string, unknown>
      };
    } catch {
      return { ok: false, reason: 'escrow_unreachable' };
    }
  }
}
