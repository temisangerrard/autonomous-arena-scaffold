declare module '../public/js/play/runtime/wallet-sync.js' {
  export function createWalletSyncController(params: any): {
    syncWalletSummary: (options?: any) => Promise<boolean>;
    startWalletPolling: () => void;
    stopWalletPolling: () => void;
    requestWalletRefresh: (opts?: { immediate?: boolean }) => Promise<void>;
    getWalletSyncInternals: () => any;
  };
}
