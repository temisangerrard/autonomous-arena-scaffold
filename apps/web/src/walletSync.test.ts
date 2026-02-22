import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createWalletSyncController } from '../public/js/play/runtime/wallet-sync.js';

type MemoryStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
};

function makeStorage(): MemoryStorage {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    }
  };
}

describe('wallet sync controller', () => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalWarn = console.warn;

  beforeEach(() => {
    const storage = makeStorage();
    globalThis.window = {
      localStorage: storage,
      setInterval,
      clearInterval
    } as unknown as Window & typeof globalThis;
    globalThis.document = { hidden: false } as unknown as Document;
    console.warn = vi.fn();
  });

  afterEach(() => {
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
    console.warn = originalWarn;
  });

  test('persists transient backoff across controller instances and suppresses 504 warn noise', async () => {
    const firstApi = vi.fn(async () => {
      const error = new Error('http_504') as Error & { status: number };
      error.status = 504;
      throw error;
    });

    const first = createWalletSyncController({
      apiJson: firstApi,
      state: { walletBalance: null, walletChainId: null },
      dispatch: vi.fn(),
      syncEscrowApprovalPolicy: vi.fn()
    });
    const ok = await first.syncWalletSummary({ keepLastOnFailure: true });
    expect(ok).toBe(false);
    expect(firstApi).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledTimes(0);

    const secondApi = vi.fn(async () => ({ onchain: { tokenBalance: 10, chainId: 8453 } }));
    const second = createWalletSyncController({
      apiJson: secondApi,
      state: { walletBalance: null, walletChainId: null },
      dispatch: vi.fn(),
      syncEscrowApprovalPolicy: vi.fn()
    });
    const skipped = await second.syncWalletSummary({ keepLastOnFailure: true });
    expect(skipped).toBe(false);
    expect(secondApi).toHaveBeenCalledTimes(0);
  });
});
