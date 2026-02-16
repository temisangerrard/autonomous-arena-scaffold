import { afterEach, describe, expect, it, vi } from 'vitest';
import { EscrowAdapter } from './EscrowAdapter.js';

describe('EscrowAdapter preflight mapping', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('maps player allowance failure to PLAYER_ALLOWANCE_LOW', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({
        ok: false,
        reason: 'allowance_too_low',
        results: [
          { walletId: 'wallet_player', ok: false, reason: 'allowance_too_low', allowance: '0', balance: '12', nativeBalanceEth: '0.001' },
          { walletId: 'wallet_house', ok: true, allowance: '10', balance: '10', nativeBalanceEth: '0.001' }
        ]
      })
    })) as unknown as typeof fetch);

    const adapter = new EscrowAdapter('http://runtime.local', 100, { mode: 'onchain', tokenDecimals: 6 });
    const result = await adapter.preflightStake({
      challengerWalletId: 'wallet_player',
      opponentWalletId: 'wallet_house',
      amount: 1
    });

    expect(result.ok).toBe(false);
    expect(result.reasonCode).toBe('PLAYER_ALLOWANCE_LOW');
    expect(result.preflight).toEqual({ playerOk: false, houseOk: true });
  });

  it('maps house signer failure to HOUSE_SIGNER_UNAVAILABLE', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({
        ok: false,
        reason: 'wallet_signer_unavailable',
        results: [
          { walletId: 'wallet_player', ok: true, allowance: '10', balance: '12', nativeBalanceEth: '0.001' },
          { walletId: 'wallet_house', ok: false, reason: 'wallet_signer_unavailable', allowance: '0', balance: '0', nativeBalanceEth: '0' }
        ]
      })
    })) as unknown as typeof fetch);

    const adapter = new EscrowAdapter('http://runtime.local', 100, { mode: 'onchain', tokenDecimals: 6 });
    const result = await adapter.preflightStake({
      challengerWalletId: 'wallet_player',
      opponentWalletId: 'wallet_house',
      amount: 1
    });

    expect(result.ok).toBe(false);
    expect(result.reasonCode).toBe('HOUSE_SIGNER_UNAVAILABLE');
    expect(result.preflight).toEqual({ playerOk: true, houseOk: false });
  });
});
