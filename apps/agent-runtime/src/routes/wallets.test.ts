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

function createGetReq(url: string) {
  const req = Readable.from([]) as unknown as import('node:http').IncomingMessage;
  Object.assign(req, {
    url,
    method: 'GET',
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
    readTokenSymbol: async () => 'USDC',
    readHouseTreasury: async () => 0n,
    readTreasuryWithdrawnTotal: async () => 0n,
    transferOnchainTokenFromWallet: async () => ({ txHash: '0xhouse' }),
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

describe('wallet onchain admin routes', () => {
  it('surfaces consolidated house funds in onchain status', async () => {
    const houseWallet = makeWallet({
      id: 'wallet_house',
      ownerProfileId: 'system_house',
      address: '0x2222222222222222222222222222222222222222',
      balance: 3
    });
    const playerWallet = makeWallet({
      id: 'wallet_player',
      ownerProfileId: 'profile_player',
      address: '0x3333333333333333333333333333333333333333',
      balance: 2
    });
    const router = new SimpleRouter();
    const wallets = new Map([
      [houseWallet.id, houseWallet],
      [playerWallet.id, playerWallet]
    ]);

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
      onchainProvider: {
        getNetwork: async () => ({ chainId: 8453 }),
        getBalance: async () => 1_000_000_000_000_000_000n
      },
      onchainTokenAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      onchainEscrowAddress: '0xc071a2a0da5901a8c036cc5d2d2d4ffc7b09787d',
      onchainTokenDecimals: 6,
      ERC20_ABI: [
        'function symbol() view returns (string)',
        'function balanceOf(address owner) view returns (uint256)'
      ],
      ensureWalletGas: async () => null,
      gasFunderSigner: () => ({
        address: '0x4444444444444444444444444444444444444444'
      } as unknown as import('ethers').Wallet),
      signerForWallet: () => null,
      decryptSecret: () => 'decrypted-key',
      onchainWalletSummary: async (wallet) => ({
        mode: 'onchain' as const,
        chainId: 8453,
        tokenAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        tokenSymbol: 'USDC',
        tokenDecimals: 6,
        address: wallet.address,
        nativeBalanceEth: '0.01',
        tokenBalance: wallet.id === 'wallet_house' ? '5' : '1.5',
        synced: true,
        gasSponsored: false,
        gasPolicyReason: 'test'
      }),
      readTokenSymbol: async () => 'USDC',
      readHouseTreasury: async () => 500000n,
      readTreasuryWithdrawnTotal: async () => 1250000n,
      transferOnchainTokenFromWallet: async () => ({ txHash: '0xhouse' }),
      prepareWalletForEscrowOnchain: async (walletId) => ({ ok: true, walletId }),
      builderCodeSuffix: ''
    });

    const match = router.match('GET', '/onchain/status');
    expect(match).toBeTruthy();

    const req = createGetReq('/onchain/status');
    const { res, payload } = createRes();
    await match!.handler(req, res, match!.params);

    expect(payload.statusCode).toBe(200);
    expect(JSON.parse(payload.body)).toMatchObject({
      ok: true,
      houseFunds: {
        totalVisibleUsdc: '8.500000',
        historicalTreasuryOutflowsUsdc: '1.250000',
        sources: [
          expect.objectContaining({ sourceType: 'contract_treasury' }),
          expect.objectContaining({ sourceType: 'house_wallet_onchain', walletId: 'wallet_house' }),
          expect.objectContaining({ sourceType: 'runtime_wallet', walletId: 'wallet_house' })
        ]
      }
    });
  });

  it('transfers tokens from the house-owned onchain wallet', async () => {
    const houseWallet = makeWallet({
      id: 'wallet_house',
      ownerProfileId: 'system_house',
      address: '0x2222222222222222222222222222222222222222',
      balance: 3
    });
    const router = new SimpleRouter();
    registerWalletRoutes(router, {
      isInternalAuthorized: () => true,
      wallets: new Map([[houseWallet.id, houseWallet]]),
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
      onchainProvider: {
        getNetwork: async () => ({ chainId: 8453 }),
        getBalance: async () => 1_000_000_000_000_000_000n
      },
      onchainTokenAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      onchainEscrowAddress: '0xc071a2a0da5901a8c036cc5d2d2d4ffc7b09787d',
      onchainTokenDecimals: 6,
      ERC20_ABI: ['function transfer(address to, uint256 amount)'],
      ensureWalletGas: async () => null,
      gasFunderSigner: () => null,
      signerForWallet: () => null,
      decryptSecret: () => 'decrypted-key',
      onchainWalletSummary: async () => ({
        mode: 'onchain' as const,
        chainId: 8453,
        tokenAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        tokenSymbol: 'USDC',
        tokenDecimals: 6,
        address: houseWallet.address,
        nativeBalanceEth: '0.01',
        tokenBalance: '5',
        synced: true,
        gasSponsored: false,
        gasPolicyReason: 'test'
      }),
      readTokenSymbol: async () => 'USDC',
      readHouseTreasury: async () => 0n,
      readTreasuryWithdrawnTotal: async () => 0n,
      transferOnchainTokenFromWallet: async () => ({ txHash: '0xhouse' }),
      prepareWalletForEscrowOnchain: async (walletId) => ({ ok: true, walletId }),
      builderCodeSuffix: ''
    });
    const match = router.match('POST', '/house/wallet/transfer');
    expect(match).toBeTruthy();

    const req = createReq('/house/wallet/transfer', {
      recipient: '0x5555555555555555555555555555555555555555',
      amount: 2.5
    });
    const { res, payload } = createRes();
    await match!.handler(req, res, match!.params);

    expect(payload.statusCode).toBe(200);
    expect(JSON.parse(payload.body)).toMatchObject({
      ok: true,
      sourceType: 'house_wallet_onchain',
      amount: 2.5,
      recipient: '0x5555555555555555555555555555555555555555'
    });
  });
});
