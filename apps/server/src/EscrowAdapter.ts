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

export type EscrowPreflightReasonCode =
  | 'PLAYER_ALLOWANCE_LOW'
  | 'PLAYER_BALANCE_LOW'
  | 'PLAYER_GAS_LOW'
  | 'PLAYER_SIGNER_UNAVAILABLE'
  | 'HOUSE_BALANCE_LOW'
  | 'HOUSE_SIGNER_UNAVAILABLE'
  | 'HOUSE_ALLOWANCE_LOW'
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
  'function refundBet(bytes32 betId) external'
];

export class EscrowAdapter {
  private readonly mode: EscrowExecutionMode;
  private readonly provider: JsonRpcProvider | null;
  private readonly signer: Wallet | null;
  private readonly escrowContract: EscrowContractApi | null;
  private readonly tokenDecimals: number;
  private readonly internalToken: string;

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
      return { ok: false, reason: this.errorReason(error, 'onchain_lock_failed') };
    }
  }

  private async prepareWalletsForOnchainEscrow(walletIds: string[], amount: number): Promise<EscrowResult> {
    try {
      const response = await fetch(`${this.runtimeBaseUrl}/wallets/onchain/prepare-escrow`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.internalToken ? { 'x-internal-token': this.internalToken } : {})
        },
        body: JSON.stringify({ walletIds, amount })
      });
      const payload = await response.json().catch(() => null) as { ok?: boolean; reason?: string } | null;
      if (!response.ok || !payload?.ok) {
        return { ok: false, reason: payload?.reason ?? `wallet_prepare_http_${response.status}`, raw: payload as Record<string, unknown> | undefined };
      }
      return { ok: true, raw: payload as Record<string, unknown> };
    } catch {
      return { ok: false, reason: 'wallet_prepare_unreachable' };
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
    if (
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
    } else if (detail.includes('gas_topup_failed') || detail.includes('insufficient funds for intrinsic')) {
      reasonCode = isPlayer ? 'PLAYER_GAS_LOW' : 'RPC_UNAVAILABLE';
      reasonText = isPlayer
        ? `Insufficient ETH gas for ${params.challengerWalletId} approval transaction.`
        : 'Gas top-up failed during escrow preparation.';
    } else if (detail.includes('insufficient_token_balance') || detail.includes('mint_failed')) {
      reasonCode = isPlayer ? 'PLAYER_BALANCE_LOW' : 'HOUSE_BALANCE_LOW';
      reasonText = isPlayer
        ? `Insufficient token balance for ${params.challengerWalletId}. Fund wallet and retry.`
        : 'House cannot cover this wager right now.';
    }

    return {
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
      return { ok: false, reason: this.errorReason(error, 'onchain_resolve_failed') };
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
      return { ok: false, reason: this.errorReason(error, 'onchain_refund_failed') };
    }
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
