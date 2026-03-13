declare module '../public/js/play/runtime/wallet-sync.js' {
  export function createWalletSyncController(params: Record<string, unknown>): {
    syncWalletSummary: (options?: Record<string, unknown>) => Promise<boolean>;
    startWalletPolling: () => void;
    stopWalletPolling: () => void;
    requestWalletRefresh: (opts?: { immediate?: boolean }) => Promise<void>;
    getWalletSyncInternals: () => unknown;
  };
}
