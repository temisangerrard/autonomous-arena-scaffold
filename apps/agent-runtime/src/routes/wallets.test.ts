import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { SimpleRouter } from '../lib/http.js';
import { registerWalletRoutes } from './wallets.js';
import type { WalletRecord } from '@arena/shared';

function makeWallet(overrides: Partial<WalletRecord> = {}): WalletRecord {
  return {
    id: 'wallet_1',
    ownerProfileId: 'profile_1',
    address: '0x1111111111111111111111111111111111111111',
    encryptedPrivateKey: 'enc-key',
    balance: 10,
    dailyTxCount: 0,
    txDayStamp: '2026-03-12',
    createdAt: Date.now(),
    lastTxAt: null,
    walletProvider: 'internal',
    ...overrides
  };
}

function createReq(url: string, body: unknown) {
  const raw = body == null ? '' : JSON.stringify(body);
  const req = Readable.from(raw ? [raw] : []) as unknown as import('node:http').IncomingMessage;
  Object.assign(req, {
    url,
    method: 'POST',
    headers: {}
  });
  return req;
}

function createRes() {
  const payload: { statusCode: number; body: string; headers: Record<string, string> } = {
    statusCode: 200,
    body: '',
    headers: {}
  };
  const res: Record<string, unknown> = {
    setHeader(key: string, value: string) {
      payload.headers[key.toLowerCase()] = String(value);
    },
    end(chunk?: string) {
      payload.body = String(chunk || '');
    }
  };
  Object.defineProperty(res, 'statusCode', {
    get() {
      return payload.statusCode;
    },
    set(value: number) {
      payload.statusCode = Number(value || 0);
    }
  });
  const serverResponse = res as unknown as import('node:http').ServerResponse;
  return { res: serverResponse, payload };
}

function registerWithWallet(wallet: WalletRecord): SimpleRouter {
  const router = new SimpleRouter();
  const wallets = new Map([[wallet.id, wallet]]);
  registerWalletRoutes(router, {
    isInternalAuthorized: () => true,
    wallets,
    escrowLocks: new Map(),
    escrowSettlements: [],
    pushEscrowSettlement: () => {},
    pseudoTxHash: () => '0xtx',
    walletSummary: (entry) => entry,
    canUseWallet: () => null,
    canLockStake: () => null,
    transferFromHouse: () => ({ ok: true as const, amount: 1 }),
    refillHouse: () => ({ ok: true as const, amount: 1 }),
    schedulePersistState: () => {},
    onchainProvider: null,
    onchainTokenAddress: '',
    onchainEscrowAddress: '',
    onchainTokenDecimals: 6,
    ERC20_ABI: [],
    ensureWalletGas: async () => null,
    gasFunderSigner: () => null,
    signerForWallet: () => null,
    decryptSecret: () => 'decrypted-key',
    onchainWalletSummary: async () => ({
      mode: 'runtime' as const,
      chainId: null,
      tokenAddress: null,
      tokenSymbol: null,
      tokenDecimals: 6,
      address: wallet.address,
      nativeBalanceEth: null,
      tokenBalance: null,
      synced: false,
      gasSponsored: false,
      gasPolicyReason: 'test'
    }),
    prepareWalletForEscrowOnchain: async (walletId) => ({ ok: true, walletId }),
    builderCodeSuffix: ''
  });
  return router;
}

describe('wallet export-key route', () => {
  it('blocks key export for coinbase_embedded wallets', async () => {
    const router = registerWithWallet(makeWallet({ walletProvider: 'coinbase_embedded', encryptedPrivateKey: null }));
    const match = router.match('POST', '/wallets/wallet_1/export-key');
    expect(match).toBeTruthy();

    const req = createReq('/wallets/wallet_1/export-key', { profileId: 'profile_1' });
    const { res, payload } = createRes();
    await match!.handler(req, res, match!.params);

    expect(payload.statusCode).toBe(403);
    expect(JSON.parse(payload.body)).toMatchObject({ ok: false, reason: 'export_not_allowed_for_provider' });
  });

  it('exports key for internal wallets', async () => {
    const router = registerWithWallet(makeWallet({ walletProvider: 'internal' }));
    const match = router.match('POST', '/wallets/wallet_1/export-key');
    expect(match).toBeTruthy();

    const req = createReq('/wallets/wallet_1/export-key', { profileId: 'profile_1' });
    const { res, payload } = createRes();
    await match!.handler(req, res, match!.params);

    expect(payload.statusCode).toBe(200);
    expect(JSON.parse(payload.body)).toMatchObject({ ok: true, walletId: 'wallet_1', privateKey: 'decrypted-key' });
  });
});
