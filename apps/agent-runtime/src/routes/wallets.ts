import { Contract, parseUnits } from 'ethers';
import { readJsonBody, sendJson, type SimpleRouter } from '../lib/http.js';
import type { EscrowLockRecord, WalletDenied, WalletRecord } from '@arena/shared';

type Erc20Api = Contract & {
  transfer: (to: string, amount: bigint) => Promise<{ hash?: string; wait: () => Promise<unknown> }>;
  mint: (to: string, amount: bigint) => Promise<{ hash?: string; wait: () => Promise<unknown> }>;
};

export function registerWalletRoutes(router: SimpleRouter, deps: {
  isInternalAuthorized: (req: import('node:http').IncomingMessage) => boolean;
  wallets: Map<string, WalletRecord>;
  escrowLocks: Map<string, EscrowLockRecord>;
  escrowSettlements: Array<import('@arena/shared').EscrowSettlementRecord>;
  pushEscrowSettlement: (entry: import('@arena/shared').EscrowSettlementRecord) => void;
  pseudoTxHash: (kind: 'lock' | 'resolve' | 'refund', challengeId: string) => string;
  walletSummary: (wallet: WalletRecord | null) => unknown;
  canUseWallet: (wallet: WalletRecord) => WalletDenied | null;
  canLockStake: (wallet: WalletRecord, amount: number) => WalletDenied | null;
  transferFromHouse: (toWalletId: string, amount: number, reason: string) => { ok: true; amount: number } | { ok: false; reason: string };
  refillHouse: (amount: number, reason: string) => { ok: true; amount: number } | { ok: false; reason: string };
  schedulePersistState: () => void;
  onchainProvider: unknown;
  onchainTokenAddress: string;
  onchainEscrowAddress: string;
  onchainTokenDecimals: number;
  ERC20_ABI: string[];
  ensureWalletGas: (address: string) => Promise<string | null>;
  gasFunderSigner: () => import('ethers').Wallet | null;
  signerForWallet: (wallet: WalletRecord) => import('ethers').Wallet | null;
  decryptSecret: (encrypted: string) => string;
  onchainWalletSummary: (wallet: WalletRecord) => Promise<{
    mode: 'runtime' | 'onchain';
    chainId: number | null;
    tokenAddress: string | null;
    tokenSymbol: string | null;
    tokenDecimals: number;
    address: string;
    nativeBalanceEth: string | null;
    tokenBalance: string | null;
    synced: boolean;
  }>;
  prepareWalletForEscrowOnchain: (walletId: string, amount: number) => Promise<{
    ok: boolean;
    reason?: string;
    walletId: string;
    address?: string;
    approved?: boolean;
    minted?: boolean;
    allowance?: string;
    balance?: string;
    nativeBalanceEth?: string;
  }>;
}) {
  router.get('/wallets', (_req, res) => {
    sendJson(res, { wallets: [...deps.wallets.values()].map((entry) => deps.walletSummary(entry)) });
  });

  router.post('/wallets/onchain/prepare-escrow', async (req, res) => {
    if (!deps.isInternalAuthorized(req)) {
      sendJson(res, { ok: false, reason: 'unauthorized_internal' }, 401);
      return;
    }

    const body = await readJsonBody<{
      walletIds?: string[];
      amount?: number;
    }>(req);

    const walletIds = Array.isArray(body?.walletIds)
      ? body.walletIds.map((entry) => String(entry || '').trim()).filter(Boolean)
      : [];
    const amount = Math.max(0, Number(body?.amount ?? 0));
    if (walletIds.length === 0 || amount <= 0) {
      sendJson(res, { ok: false, reason: 'invalid_prepare_payload' }, 400);
      return;
    }

    const results = [] as Array<Awaited<ReturnType<typeof deps.prepareWalletForEscrowOnchain>>>;
    for (const walletId of walletIds) {
      results.push(await deps.prepareWalletForEscrowOnchain(walletId, amount));
    }

    const failed = results.filter((entry) => !entry.ok);
    const failureReason = failed
      .map((entry) => entry.reason)
      .find((r): r is string => typeof r === 'string' && r.length > 0)
      ?? null;
    const chain = deps.onchainProvider
      ? await (async () => {
          const provider = deps.onchainProvider as { getNetwork?: () => Promise<{ chainId?: unknown }> };
          if (!provider?.getNetwork) {
            return null;
          }
          try {
            const net = await provider.getNetwork();
            const id = Number(net?.chainId ?? NaN);
            return Number.isFinite(id) ? { id } : null;
          } catch {
            return null;
          }
        })()
      : null;
    sendJson(res, {
      ok: failed.length === 0,
      reason: failureReason,
      chain,
      tokenAddress: deps.onchainTokenAddress || null,
      escrowAddress: deps.onchainEscrowAddress || null,
      tokenDecimals: deps.onchainTokenDecimals,
      results
    }, failed.length === 0 ? 200 : 400);
  });

  router.post('/wallets/:walletId/fund', async (req, res, params) => {
    const walletId = String(params?.walletId ?? '').trim();
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

    if (deps.onchainProvider && deps.onchainTokenAddress) {
      const funder = deps.gasFunderSigner();
      if (!funder) {
        sendJson(res, { ok: false, reason: 'gas_funder_unavailable' }, 400);
        return;
      }
      const token = new Contract(deps.onchainTokenAddress, deps.ERC20_ABI, funder) as Erc20Api;
      const value = parseUnits(String(amount), deps.onchainTokenDecimals);
      try {
        await deps.ensureWalletGas(wallet.address);
        const mintTx = await token.mint(wallet.address, value);
        await mintTx.wait();
        const summary = await deps.onchainWalletSummary(wallet);
        wallet.dailyTxCount += 1;
        wallet.lastTxAt = Date.now();
        sendJson(res, {
          ok: true,
          mode: 'onchain',
          txHash: mintTx.hash ?? null,
          wallet: deps.walletSummary(wallet),
          onchain: summary
        });
        deps.schedulePersistState();
        return;
      } catch (error) {
        sendJson(res, { ok: false, reason: String((error as Error).message || 'onchain_fund_failed').slice(0, 160) }, 400);
        return;
      }
    }

    wallet.balance += amount;
    wallet.dailyTxCount += 1;
    wallet.lastTxAt = Date.now();
    sendJson(res, { ok: true, mode: 'runtime', wallet: deps.walletSummary(wallet) });
    deps.schedulePersistState();
  });

  router.post('/wallets/:walletId/withdraw', async (req, res, params) => {
    const walletId = String(params?.walletId ?? '').trim();
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

    if (deps.onchainProvider && deps.onchainTokenAddress) {
      const signer = deps.signerForWallet(wallet);
      // keep existing behavior: treasury env var is read in index.ts; use gas funder as fallback.
      const treasury = process.env.WITHDRAW_TREASURY_ADDRESS?.trim() || deps.gasFunderSigner()?.address || '';
      if (!signer || !treasury) {
        sendJson(res, { ok: false, reason: 'withdraw_destination_unavailable' }, 400);
        return;
      }
      const token = new Contract(deps.onchainTokenAddress, deps.ERC20_ABI, signer) as Erc20Api;
      const value = parseUnits(String(amount), deps.onchainTokenDecimals);
      try {
        await deps.ensureWalletGas(wallet.address);
        const tx = await token.transfer(treasury, value);
        await tx.wait();
        const summary = await deps.onchainWalletSummary(wallet);
        wallet.dailyTxCount += 1;
        wallet.lastTxAt = Date.now();
        sendJson(res, {
          ok: true,
          mode: 'onchain',
          txHash: tx.hash ?? null,
          to: treasury,
          wallet: deps.walletSummary(wallet),
          onchain: summary
        });
        deps.schedulePersistState();
        return;
      } catch (error) {
        sendJson(res, { ok: false, reason: String((error as Error).message || 'onchain_withdraw_failed').slice(0, 160) }, 400);
        return;
      }
    }

    if (wallet.balance < amount) {
      sendJson(res, { ok: false, reason: 'insufficient_balance' }, 400);
      return;
    }

    wallet.balance -= amount;
    wallet.dailyTxCount += 1;
    wallet.lastTxAt = Date.now();
    sendJson(res, { ok: true, mode: 'runtime', wallet: deps.walletSummary(wallet) });
    deps.schedulePersistState();
  });

  router.post('/wallets/:walletId/transfer', async (req, res, params) => {
    const walletId = String(params?.walletId ?? '').trim();
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

    if (deps.onchainProvider && deps.onchainTokenAddress) {
      const signer = deps.signerForWallet(source);
      if (!signer) {
        sendJson(res, { ok: false, reason: 'wallet_signer_unavailable' }, 400);
        return;
      }
      const token = new Contract(deps.onchainTokenAddress, deps.ERC20_ABI, signer) as Erc20Api;
      const value = parseUnits(String(amount), deps.onchainTokenDecimals);
      try {
        await deps.ensureWalletGas(source.address);
        const tx = await token.transfer(target.address, value);
        await tx.wait();
        const [sourceOnchain, targetOnchain] = await Promise.all([
          deps.onchainWalletSummary(source),
          deps.onchainWalletSummary(target)
        ]);
        source.dailyTxCount += 1;
        target.dailyTxCount += 1;
        source.lastTxAt = Date.now();
        target.lastTxAt = Date.now();
        sendJson(res, {
          ok: true,
          mode: 'onchain',
          txHash: tx.hash ?? null,
          source: deps.walletSummary(source),
          target: deps.walletSummary(target),
          sourceOnchain,
          targetOnchain
        });
        deps.schedulePersistState();
        return;
      } catch (error) {
        sendJson(res, { ok: false, reason: String((error as Error).message || 'onchain_transfer_failed').slice(0, 160) }, 400);
        return;
      }
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

    sendJson(res, { ok: true, mode: 'runtime', source: deps.walletSummary(source), target: deps.walletSummary(target) });
    deps.schedulePersistState();
  });

  router.get('/wallets/:walletId/summary', async (_req, res, params) => {
    const walletId = String(params?.walletId ?? '').trim();
    const wallet = walletId ? deps.wallets.get(walletId) : null;
    if (!wallet) {
      sendJson(res, { ok: false, reason: 'wallet_not_found' }, 404);
      return;
    }
    try {
      const onchain = await deps.onchainWalletSummary(wallet);
      sendJson(res, { ok: true, wallet: deps.walletSummary(wallet), onchain });
      deps.schedulePersistState();
    } catch (error) {
      sendJson(res, {
        ok: true,
        wallet: deps.walletSummary(wallet),
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
    }
  });

  router.post('/wallets/:walletId/export-key', async (req, res, params) => {
    const walletId = String(params?.walletId ?? '').trim();
    const wallet = walletId ? deps.wallets.get(walletId) : null;
    if (!wallet) {
      sendJson(res, { ok: false, reason: 'wallet_not_found' }, 404);
      return;
    }

    const body = await readJsonBody<{ profileId?: string }>(req);
    if (!body?.profileId || body.profileId !== wallet.ownerProfileId) {
      sendJson(res, { ok: false, reason: 'owner_mismatch' }, 403);
      return;
    }

    const privateKey = deps.decryptSecret(wallet.encryptedPrivateKey);
    sendJson(res, {
      ok: true,
      walletId,
      address: wallet.address,
      privateKey,
      warning: 'Treat this private key as highly sensitive. Move to a vault before production.'
    });
  });

  router.post('/wallets/escrow/lock', async (req, res) => {
    const body = await readJsonBody<{
      challengeId?: string;
      challengerWalletId?: string;
      opponentWalletId?: string;
      amount?: number;
    }>(req);

    const challengeId = body?.challengeId?.trim() ?? '';
    const challengerWalletId = body?.challengerWalletId?.trim() ?? '';
    const opponentWalletId = body?.opponentWalletId?.trim() ?? '';
    const amount = Number(body?.amount ?? 0);

    if (!challengeId || !challengerWalletId || !opponentWalletId || !Number.isFinite(amount) || amount <= 0) {
      sendJson(res, { ok: false, reason: 'invalid_escrow_payload' }, 400);
      return;
    }
    if (challengerWalletId === opponentWalletId) {
      sendJson(res, { ok: false, reason: 'same_wallet' }, 400);
      return;
    }

    const existingLock = deps.escrowLocks.get(challengeId);
    if (existingLock) {
      sendJson(res, { ok: true, challengeId, escrow: existingLock, txHash: existingLock.lockTxHash, idempotent: true });
      return;
    }

    const challenger = deps.wallets.get(challengerWalletId);
    const opponent = deps.wallets.get(opponentWalletId);
    if (!challenger || !opponent) {
      sendJson(res, { ok: false, reason: 'wallet_not_found' }, 404);
      return;
    }

    const challengerDenied = deps.canLockStake(challenger, amount);
    if (challengerDenied) {
      sendJson(res, { ok: false, reason: `challenger_${challengerDenied.reason}` }, 403);
      return;
    }
    const isHouseManagedOpponent = opponent.ownerProfileId.startsWith('system_');
    const isHouseWalletOpponent = opponent.ownerProfileId === 'system_house';
    let opponentDenied = deps.canLockStake(opponent, amount);
    let houseTopupAmount = 0;

    // House-managed wallets should not reject wagers because an NPC wallet is dry.
    if (
      opponentDenied?.reason === 'insufficient_balance'
      && isHouseManagedOpponent
      && opponent.ownerProfileId !== 'system_house'
    ) {
      const needed = Math.max(0, amount - opponent.balance);
      if (needed > 0) {
        const topup = deps.transferFromHouse(opponent.id, needed, `escrow_topup:${challengeId}`);
        if (!topup.ok) {
          sendJson(res, { ok: false, reason: `opponent_${topup.reason}` }, 403);
          return;
        }
        houseTopupAmount = topup.amount;
      }
      opponentDenied = deps.canLockStake(opponent, amount);
    }

    // Dealer bets against the house should always be coverable in testnet/runtime mode.
    // If the house wallet itself is short, refill and retry lock once.
    if (opponentDenied?.reason === 'insufficient_balance' && isHouseWalletOpponent) {
      const needed = Math.max(0, amount - opponent.balance);
      if (needed > 0) {
        const refill = deps.refillHouse(needed, `escrow_house_cover:${challengeId}`);
        if (!refill.ok) {
          sendJson(res, { ok: false, reason: `opponent_${refill.reason}` }, 403);
          return;
        }
        houseTopupAmount = refill.amount;
      }
      opponentDenied = deps.canLockStake(opponent, amount);
    }

    // Max-bet bankroll cap is for player safety; house-managed opponents can take larger bets.
    if (opponentDenied?.reason === 'max_bet_percent_exceeded' && isHouseManagedOpponent) {
      opponentDenied = null;
    }

    if (opponentDenied) {
      sendJson(res, { ok: false, reason: `opponent_${opponentDenied.reason}` }, 403);
      return;
    }

    challenger.balance -= amount;
    opponent.balance -= amount;
    challenger.dailyTxCount += 1;
    opponent.dailyTxCount += 1;
    challenger.lastTxAt = Date.now();
    opponent.lastTxAt = Date.now();

    const lock: EscrowLockRecord = {
      challengeId,
      challengerWalletId,
      opponentWalletId,
      amount,
      createdAt: Date.now(),
      lockTxHash: deps.pseudoTxHash('lock', challengeId)
    };
    deps.escrowLocks.set(challengeId, lock);

    sendJson(res, {
      ok: true,
      challengeId,
      escrow: lock,
      txHash: lock.lockTxHash,
      houseTopupAmount: houseTopupAmount > 0 ? houseTopupAmount : undefined,
      challenger: deps.walletSummary(challenger),
      opponent: deps.walletSummary(opponent)
    });
    deps.schedulePersistState();
  });

  router.post('/wallets/escrow/resolve', async (req, res) => {
    const body = await readJsonBody<{ challengeId?: string; winnerWalletId?: string | null; feeBps?: number }>(req);
    const challengeId = body?.challengeId?.trim() ?? '';
    const winnerWalletId = body?.winnerWalletId?.trim() ?? '';
    const feeBps = Math.max(0, Math.min(10000, Number(body?.feeBps ?? 0)));
    if (!challengeId) {
      sendJson(res, { ok: false, reason: 'challenge_id_required' }, 400);
      return;
    }

    const lock = deps.escrowLocks.get(challengeId);
    if (!lock) {
      sendJson(res, { ok: false, reason: 'escrow_not_found' }, 404);
      return;
    }

    if (!winnerWalletId) {
      sendJson(res, { ok: false, reason: 'winner_wallet_required' }, 400);
      return;
    }
    if (winnerWalletId !== lock.challengerWalletId && winnerWalletId !== lock.opponentWalletId) {
      sendJson(res, { ok: false, reason: 'winner_wallet_not_participant' }, 400);
      return;
    }

    const winner = deps.wallets.get(winnerWalletId);
    if (!winner) {
      sendJson(res, { ok: false, reason: 'wallet_not_found' }, 404);
      return;
    }

    const pot = lock.amount * 2;
    const fee = (pot * feeBps) / 10000;
    const payout = pot - fee;
    const txHash = deps.pseudoTxHash('resolve', challengeId);
    winner.balance += payout;
    winner.dailyTxCount += 1;
    winner.lastTxAt = Date.now();
    deps.escrowLocks.delete(challengeId);
    deps.pushEscrowSettlement({
      challengeId,
      outcome: 'resolved',
      challengerWalletId: lock.challengerWalletId,
      opponentWalletId: lock.opponentWalletId,
      winnerWalletId,
      amount: lock.amount,
      fee,
      payout,
      txHash,
      at: Date.now()
    });

    sendJson(res, { ok: true, challengeId, payout, fee, txHash, winner: deps.walletSummary(winner) });
    deps.schedulePersistState();
  });

  router.post('/wallets/escrow/refund', async (req, res) => {
    const body = await readJsonBody<{ challengeId?: string }>(req);
    const challengeId = body?.challengeId?.trim() ?? '';
    if (!challengeId) {
      sendJson(res, { ok: false, reason: 'challenge_id_required' }, 400);
      return;
    }

    const lock = deps.escrowLocks.get(challengeId);
    if (!lock) {
      sendJson(res, { ok: false, reason: 'escrow_not_found' }, 404);
      return;
    }

    const challenger = deps.wallets.get(lock.challengerWalletId);
    const opponent = deps.wallets.get(lock.opponentWalletId);
    if (!challenger || !opponent) {
      sendJson(res, { ok: false, reason: 'wallet_not_found' }, 404);
      return;
    }

    challenger.balance += lock.amount;
    opponent.balance += lock.amount;
    challenger.lastTxAt = Date.now();
    opponent.lastTxAt = Date.now();
    const txHash = deps.pseudoTxHash('refund', challengeId);
    deps.escrowLocks.delete(challengeId);
    deps.pushEscrowSettlement({
      challengeId,
      outcome: 'refunded',
      challengerWalletId: lock.challengerWalletId,
      opponentWalletId: lock.opponentWalletId,
      winnerWalletId: null,
      amount: lock.amount,
      fee: 0,
      payout: lock.amount * 2,
      txHash,
      at: Date.now()
    });

    sendJson(res, { ok: true, challengeId, txHash, challenger: deps.walletSummary(challenger), opponent: deps.walletSummary(opponent) });
    deps.schedulePersistState();
  });

  router.get('/wallets/escrow/history', (req, res) => {
    const url = new URL(req.url ?? '/wallets/escrow/history', 'http://localhost');
    const limit = Math.max(1, Math.min(200, Number(url.searchParams.get('limit') ?? 60)));
    sendJson(res, { ok: true, recent: deps.escrowSettlements.slice(-limit).reverse() });
  });
}
