/**
 * Wallet route handlers
 * Extracted from index.ts for better modularity
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { readJsonBody, sendJson } from '../lib/http.js';
import type { WalletRecord, WalletDenied } from '@arena/shared';

interface WalletManagerDeps {
  wallets: Map<string, WalletRecord>;
  canUseWallet: (wallet: WalletRecord) => WalletDenied | null;
  canLockStake: (wallet: WalletRecord, amount: number) => WalletDenied | null;
  onchainProvider: unknown;
  onchainTokenAddress: string;
  onchainTokenDecimals: number;
  signerForWallet?: (wallet: WalletRecord) => unknown;
  onchainWalletSummary?: (wallet: WalletRecord) => Promise<unknown>;
}

export function createWalletsRouter(deps: WalletManagerDeps) {
  const router = {
    /**
     * GET /wallets - List all wallets
     */
    handleList(req: IncomingMessage, res: ServerResponse) {
      const wallets = [...deps.wallets.values()].map((wallet) => ({
        id: wallet.id,
        ownerProfileId: wallet.ownerProfileId,
        address: wallet.address,
        balance: wallet.balance,
        dailyTxCount: wallet.dailyTxCount,
        txDayStamp: wallet.txDayStamp,
        lastTxAt: wallet.lastTxAt,
        createdAt: wallet.createdAt
      }));
      sendJson(res, { wallets });
    },

    /**
     * GET /wallets/:id/summary - Get wallet summary with optional onchain data
     */
    async handleSummary(req: IncomingMessage, res: ServerResponse, params: Record<string, string>) {
      const walletId = params.id;
      const wallet = walletId ? deps.wallets.get(walletId) : null;
      
      if (!wallet) {
        sendJson(res, { ok: false, reason: 'wallet_not_found' }, 404);
        return;
      }

      const summary = {
        id: wallet.id,
        ownerProfileId: wallet.ownerProfileId,
        address: wallet.address,
        balance: wallet.balance,
        dailyTxCount: wallet.dailyTxCount,
        txDayStamp: wallet.txDayStamp,
        lastTxAt: wallet.lastTxAt,
        createdAt: wallet.createdAt
      };

      if (deps.onchainWalletSummary && deps.onchainProvider && deps.onchainTokenAddress) {
        try {
          const onchain = await deps.onchainWalletSummary(wallet);
          sendJson(res, { ok: true, wallet: summary, onchain });
          return;
        } catch (error) {
          sendJson(res, {
            ok: true,
            wallet: summary,
            onchain: {
              mode: 'runtime',
              chainId: null,
              tokenAddress: deps.onchainTokenAddress || null,
              tokenSymbol: null,
              tokenDecimals: deps.onchainTokenDecimals,
              address: wallet.address,
              nativeBalanceEth: null,
              tokenBalance: null,
              synced: false,
              reason: String((error as Error).message || 'onchain_summary_failed').slice(0, 160)
            }
          });
          return;
        }
      }

      sendJson(res, { ok: true, wallet: summary });
    },

    /**
     * POST /wallets/:id/fund - Add funds to wallet
     */
    async handleFund(req: IncomingMessage, res: ServerResponse, params: Record<string, string>) {
      const walletId = params.id;
      const wallet = walletId ? deps.wallets.get(walletId) : null;
      
      if (!wallet) {
        sendJson(res, { ok: false, reason: 'wallet_not_found' }, 404);
        return;
      }

      const body = await readJsonBody<{ amount?: number }>(req);
      const amount = Math.max(0, Number(body?.amount ?? 0));
      
      if (amount <= 0) {
        sendJson(res, { ok: false, reason: 'invalid_amount' }, 400);
        return;
      }

      const denied = deps.canUseWallet(wallet);
      if (denied) {
        sendJson(res, denied, 403);
        return;
      }

      // Runtime mode funding
      wallet.balance += amount;
      wallet.dailyTxCount += 1;
      wallet.lastTxAt = Date.now();

      sendJson(res, { 
        ok: true, 
        mode: 'runtime', 
        wallet: {
          id: wallet.id,
          ownerProfileId: wallet.ownerProfileId,
          address: wallet.address,
          balance: wallet.balance,
          dailyTxCount: wallet.dailyTxCount,
          txDayStamp: wallet.txDayStamp,
          lastTxAt: wallet.lastTxAt,
          createdAt: wallet.createdAt
        }
      });
    },

    /**
     * POST /wallets/:id/withdraw - Withdraw funds from wallet
     */
    async handleWithdraw(req: IncomingMessage, res: ServerResponse, params: Record<string, string>) {
      const walletId = params.id;
      const wallet = walletId ? deps.wallets.get(walletId) : null;
      
      if (!wallet) {
        sendJson(res, { ok: false, reason: 'wallet_not_found' }, 404);
        return;
      }

      const body = await readJsonBody<{ amount?: number }>(req);
      const amount = Math.max(0, Number(body?.amount ?? 0));
      
      if (amount <= 0) {
        sendJson(res, { ok: false, reason: 'invalid_amount' }, 400);
        return;
      }

      const denied = deps.canUseWallet(wallet);
      if (denied) {
        sendJson(res, denied, 403);
        return;
      }

      if (wallet.balance < amount) {
        sendJson(res, { ok: false, reason: 'insufficient_balance' }, 400);
        return;
      }

      wallet.balance -= amount;
      wallet.dailyTxCount += 1;
      wallet.lastTxAt = Date.now();

      sendJson(res, { 
        ok: true, 
        mode: 'runtime', 
        wallet: {
          id: wallet.id,
          ownerProfileId: wallet.ownerProfileId,
          address: wallet.address,
          balance: wallet.balance,
          dailyTxCount: wallet.dailyTxCount,
          txDayStamp: wallet.txDayStamp,
          lastTxAt: wallet.lastTxAt,
          createdAt: wallet.createdAt
        }
      });
    },

    /**
     * POST /wallets/:id/transfer - Transfer funds between wallets
     */
    async handleTransfer(req: IncomingMessage, res: ServerResponse, params: Record<string, string>) {
      const walletId = params.id;
      const source = walletId ? deps.wallets.get(walletId) : null;
      
      if (!source) {
        sendJson(res, { ok: false, reason: 'wallet_not_found' }, 404);
        return;
      }

      const body = await readJsonBody<{ toWalletId?: string; amount?: number }>(req);
      const target = body?.toWalletId ? deps.wallets.get(body.toWalletId) : null;
      const amount = Math.max(0, Number(body?.amount ?? 0));

      if (!target) {
        sendJson(res, { ok: false, reason: 'target_wallet_not_found' }, 404);
        return;
      }
      if (target.id === source.id) {
        sendJson(res, { ok: false, reason: 'same_wallet' }, 400);
        return;
      }
      if (amount <= 0) {
        sendJson(res, { ok: false, reason: 'invalid_amount' }, 400);
        return;
      }

      const sourceDenied = deps.canUseWallet(source);
      if (sourceDenied) {
        sendJson(res, sourceDenied, 403);
        return;
      }

      const targetDenied = deps.canUseWallet(target);
      if (targetDenied) {
        sendJson(res, { ok: false, reason: 'target_wallet_tx_limited' }, 403);
        return;
      }

      if (source.balance < amount) {
        sendJson(res, { ok: false, reason: 'insufficient_balance' }, 400);
        return;
      }

      source.balance -= amount;
      target.balance += amount;
      source.dailyTxCount += 1;
      target.dailyTxCount += 1;
      source.lastTxAt = Date.now();
      target.lastTxAt = Date.now();

      const walletSummary = (w: WalletRecord) => ({
        id: w.id,
        ownerProfileId: w.ownerProfileId,
        address: w.address,
        balance: w.balance,
        dailyTxCount: w.dailyTxCount,
        txDayStamp: w.txDayStamp,
        lastTxAt: w.lastTxAt,
        createdAt: w.createdAt
      });

      sendJson(res, {
        ok: true,
        mode: 'runtime',
        source: walletSummary(source),
        target: walletSummary(target)
      });
    },

    /**
     * POST /wallets/:id/export-key - Export wallet private key
     */
    handleExportKey(req: IncomingMessage, res: ServerResponse, _params: Record<string, string>) {
      void _params;
      // This requires the encryption key from index.ts - stub for now
      sendJson(res, { ok: false, reason: 'not_implemented' }, 501);
    }
  };

  return router;
}
