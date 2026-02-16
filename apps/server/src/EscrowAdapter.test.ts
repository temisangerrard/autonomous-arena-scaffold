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

describe('EscrowAdapter onchain error decoding', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mockWalletAndPreflightFetches(): void {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/wallets/onchain/prepare-escrow')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, results: [] })
        };
      }
      if (url.endsWith('/wallets')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            wallets: [
              { id: 'wallet_player', address: '0x1111111111111111111111111111111111111111' },
              { id: 'wallet_house', address: '0x2222222222222222222222222222222222222222' }
            ]
          })
        };
      }
      return {
        ok: false,
        status: 404,
        json: async () => ({ ok: false })
      };
    }) as unknown as typeof fetch);
  }

  function newOnchainAdapter(): EscrowAdapter {
    return new EscrowAdapter('http://runtime.local', 100, {
      mode: 'onchain',
      tokenDecimals: 6,
      rpcUrl: 'http://localhost:8545',
      resolverPrivateKey: '0x0123456789012345678901234567890123456789012345678901234567890123',
      escrowContractAddress: '0x3333333333333333333333333333333333333333'
    });
  }

  it('maps BetAlreadyExists to BET_ID_ALREADY_USED', async () => {
    mockWalletAndPreflightFetches();
    const adapter = newOnchainAdapter();
    (adapter as any).escrowContract = {
      interface: {
        parseError: () => ({ name: 'BetAlreadyExists' })
      },
      createBet: vi.fn(async () => {
        throw { data: '0xdeadbeef' };
      })
    };

    const result = await adapter.lockStake({
      challengeId: 'c_test_a',
      challengerWalletId: 'wallet_player',
      opponentWalletId: 'wallet_house',
      amount: 1
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('bet_already_exists');
    expect(result.raw?.reasonCode).toBe('BET_ID_ALREADY_USED');
    expect(result.raw?.reasonText).toBe('Existing escrow bet ID detected. Retry after refresh.');
  });

  it('maps InvalidAmount to INVALID_WAGER', async () => {
    mockWalletAndPreflightFetches();
    const adapter = newOnchainAdapter();
    (adapter as any).escrowContract = {
      interface: {
        parseError: () => ({ name: 'InvalidAmount' })
      },
      createBet: vi.fn(async () => {
        throw { data: '0xdeadbeef' };
      })
    };

    const result = await adapter.lockStake({
      challengeId: 'c_test_b',
      challengerWalletId: 'wallet_player',
      opponentWalletId: 'wallet_house',
      amount: 1
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('invalid_amount');
    expect(result.raw?.reasonCode).toBe('INVALID_WAGER');
  });

  it('keeps unknown errors on fallback reason code', async () => {
    mockWalletAndPreflightFetches();
    const adapter = newOnchainAdapter();
    (adapter as any).escrowContract = {
      interface: {
        parseError: () => {
          throw new Error('unknown custom error');
        }
      },
      createBet: vi.fn(async () => {
        throw { shortMessage: 'execution reverted (unknown custom error)' };
      })
    };

    const result = await adapter.lockStake({
      challengeId: 'c_test_c',
      challengerWalletId: 'wallet_player',
      opponentWalletId: 'wallet_house',
      amount: 1
    });

    expect(result.ok).toBe(false);
    expect(result.raw?.reasonCode).toBe('ONCHAIN_EXECUTION_ERROR');
    expect(String(result.raw?.reasonText || '')).toContain('execution reverted');
  });
});
