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
};

export class EscrowAdapter {
  constructor(
    private readonly runtimeBaseUrl: string,
    private readonly feeBps: number
  ) {}

  async lockStake(params: LockParams): Promise<EscrowResult> {
    const res = await this.post('/wallets/escrow/lock', params);
    return res;
  }

  async resolve(params: ResolveParams): Promise<EscrowResult> {
    if (!params.winnerWalletId) {
      return this.refund(params.challengeId);
    }

    return this.post('/wallets/escrow/resolve', {
      challengeId: params.challengeId,
      winnerWalletId: params.winnerWalletId,
      feeBps: this.feeBps
    });
  }

  async refund(challengeId: string): Promise<EscrowResult> {
    return this.post('/wallets/escrow/refund', { challengeId });
  }

  private async post(pathname: string, body: unknown): Promise<EscrowResult> {
    try {
      const response = await fetch(`${this.runtimeBaseUrl}${pathname}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });

      const payload = await response.json().catch(() => null) as { ok?: boolean; reason?: string } | null;
      if (!response.ok || !payload?.ok) {
        return { ok: false, reason: payload?.reason ?? `http_${response.status}` };
      }
      return { ok: true };
    } catch {
      return { ok: false, reason: 'escrow_unreachable' };
    }
  }
}
