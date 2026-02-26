import { Contract, Interface, formatEther, formatUnits, id, parseUnits, zeroPadValue } from 'ethers';
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
  const transferTopic = id('Transfer(address,address,uint256)');
  const transferInterface = new Interface([
    'event Transfer(address indexed from, address indexed to, uint256 value)'
  ]);
  const erc20TxInterface = new Interface([
    'function transfer(address to, uint256 amount)',
    'function approve(address spender, uint256 amount)',
    'function transferFrom(address from, address to, uint256 amount)',
    'function mint(address to, uint256 amount)'
  ]);
  const escrowTxInterface = new Interface([
    'function createBet(bytes32 betId, address challenger, address opponent, uint256 amount)',
    'function resolveBet(bytes32 betId, address winner)',
    'function refundBet(bytes32 betId)',
    'function createOracleBet(bytes32 betId, bytes32 marketId, bool isUp, uint256 amount, uint256 resolveAfter)',
    'function resolveBetFromOracle(bytes32 betId)',
    'function setFeeConfig(address recipient, uint16 bps)'
  ]);

  router.get('/onchain/status', async (req, res) => {
    if (!deps.isInternalAuthorized(req)) {
      sendJson(res, { ok: false, reason: 'unauthorized_internal' }, 401);
      return;
    }

    const configured = Boolean(deps.onchainProvider && deps.onchainTokenAddress && deps.onchainEscrowAddress);
    if (!configured) {
      sendJson(res, {
        ok: true,
        configured: false,
        chainId: null,
        tokenAddress: deps.onchainTokenAddress || null,
        escrowAddress: deps.onchainEscrowAddress || null,
        tokenDecimals: deps.onchainTokenDecimals,
        tokenSymbol: null,
        sponsorAddress: deps.gasFunderSigner()?.address || null,
        sponsorBalanceEth: null,
        escrowBalanceEth: null,
        wallets: [...deps.wallets.values()].map((wallet) => ({
          id: wallet.id,
          ownerProfileId: wallet.ownerProfileId,
          address: wallet.address,
          runtimeBalance: wallet.balance,
          onchain: null
        }))
      });
      return;
    }

    const provider = deps.onchainProvider as {
      getNetwork?: () => Promise<{ chainId?: unknown }>;
      getBalance?: (address: string) => Promise<bigint>;
    };
    if (!provider?.getNetwork || !provider?.getBalance) {
      sendJson(res, { ok: false, reason: 'onchain_provider_unavailable' }, 503);
      return;
    }
    const chainId = await provider.getNetwork().then((net) => Number(net.chainId ?? NaN)).catch(() => null);
    const token = new Contract(deps.onchainTokenAddress, deps.ERC20_ABI, deps.onchainProvider as any) as Contract & { symbol: () => Promise<string> };
    const sponsorAddress = deps.gasFunderSigner()?.address || null;
    const [tokenSymbol, sponsorBalanceEth, escrowBalanceEth, walletOnchain] = await Promise.all([
      token.symbol().catch(() => 'TOKEN'),
      sponsorAddress ? provider.getBalance(sponsorAddress).then((v) => formatEther(v)).catch(() => null) : Promise.resolve(null),
      provider.getBalance(deps.onchainEscrowAddress).then((v) => formatEther(v)).catch(() => null),
      Promise.all(
        [...deps.wallets.values()].map(async (wallet) => ({
          id: wallet.id,
          ownerProfileId: wallet.ownerProfileId,
          address: wallet.address,
          runtimeBalance: wallet.balance,
          onchain: await deps.onchainWalletSummary(wallet).catch(() => null)
        }))
      )
    ]);

    sendJson(res, {
      ok: true,
      configured: true,
      chainId: Number.isFinite(chainId) ? chainId : null,
      tokenAddress: deps.onchainTokenAddress,
      escrowAddress: deps.onchainEscrowAddress,
      tokenDecimals: deps.onchainTokenDecimals,
      tokenSymbol: tokenSymbol || 'TOKEN',
      sponsorAddress,
      sponsorBalanceEth,
      escrowBalanceEth,
      wallets: walletOnchain
    });
  });

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
    if (!deps.onchainProvider || !deps.onchainTokenAddress) {
      sendJson(res, { ok: false, reason: 'onchain_unavailable' }, 503);
      return;
    }
    try {
      const onchain = await deps.onchainWalletSummary(wallet);
      sendJson(res, { ok: true, wallet: deps.walletSummary(wallet), onchain });
      deps.schedulePersistState();
    } catch (error) {
      sendJson(res, {
        ok: false,
        reason: 'onchain_unavailable',
        detail: String((error as Error).message || 'onchain_summary_failed').slice(0, 160)
      }, 503);
    }
  });

  router.get('/wallets/:walletId/activity', async (req, res, params) => {
    if (!deps.isInternalAuthorized(req)) {
      sendJson(res, { ok: false, reason: 'unauthorized_internal' }, 401);
      return;
    }
    const walletId = String(params?.walletId ?? '').trim();
    const wallet = walletId ? deps.wallets.get(walletId) : null;
    if (!wallet) {
      sendJson(res, { ok: false, reason: 'wallet_not_found' }, 404);
      return;
    }
    if (!deps.onchainProvider || !deps.onchainTokenAddress) {
      sendJson(res, { ok: false, reason: 'onchain_unavailable' }, 503);
      return;
    }

    const url = new URL(req.url ?? `/wallets/${walletId}/activity`, 'http://localhost');
    const limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit') ?? 20)));
    const lookbackBlocks = Math.max(500, Math.min(500_000, Number(process.env.WALLET_ACTIVITY_LOOKBACK_BLOCKS ?? 50_000)));
    const provider = deps.onchainProvider as {
      getNetwork?: () => Promise<{ chainId?: unknown }>;
      getBlockNumber?: () => Promise<number>;
      getLogs?: (filter: {
        address: string;
        fromBlock: number;
        toBlock: number | 'latest';
        topics: Array<string | null>;
      }) => Promise<Array<{
        transactionHash: string;
        blockNumber: number;
        index: number;
        topics: string[];
        data: string;
      }>>;
      getBlock?: (blockNumber: number) => Promise<{ timestamp?: number | bigint } | null>;
      getTransaction?: (txHash: string) => Promise<{
        hash?: string;
        from?: string;
        to?: string | null;
        data?: string;
        value?: bigint;
      } | null>;
    };
    if (!provider.getBlockNumber || !provider.getLogs || !provider.getBlock || !provider.getNetwork || !provider.getTransaction) {
      sendJson(res, { ok: false, reason: 'onchain_provider_unavailable' }, 503);
      return;
    }
    const getNetwork = provider.getNetwork.bind(provider);
    const getBlockNumber = provider.getBlockNumber.bind(provider);
    const getLogs = provider.getLogs.bind(provider);
    const getBlock = provider.getBlock.bind(provider);
    const getTransaction = provider.getTransaction.bind(provider);

    try {
      const [chain, latestBlock] = await Promise.all([
        getNetwork(),
        getBlockNumber()
      ]);
      const chainId = Number(chain?.chainId ?? NaN);
      const toBlock = Number.isFinite(latestBlock) ? latestBlock : 0;
      const fromBlock = Math.max(0, toBlock - lookbackBlocks);
      const indexed = zeroPadValue(wallet.address, 32).toLowerCase();

      const [outLogs, inLogs, tokenSymbol] = await Promise.all([
        getLogs({
          address: deps.onchainTokenAddress,
          fromBlock,
          toBlock,
          topics: [transferTopic, indexed]
        }),
        getLogs({
          address: deps.onchainTokenAddress,
          fromBlock,
          toBlock,
          topics: [transferTopic, null, indexed]
        }),
        (new Contract(deps.onchainTokenAddress, deps.ERC20_ABI, deps.onchainProvider as any) as Contract & { symbol: () => Promise<string> })
          .symbol()
          .catch(() => 'TOKEN')
      ]);

      const dedup = new Map<string, (typeof inLogs)[number]>();
      for (const logEntry of [...outLogs, ...inLogs]) {
        const key = `${String(logEntry.transactionHash || '').toLowerCase()}:${Number(logEntry.index ?? -1)}`;
        dedup.set(key, logEntry);
      }
      const logs = [...dedup.values()]
        .sort((a, b) => {
          const bn = Number(b.blockNumber ?? 0) - Number(a.blockNumber ?? 0);
          if (bn !== 0) return bn;
          return Number(b.index ?? 0) - Number(a.index ?? 0);
        })
        .slice(0, limit);

      const blockNos = [...new Set(logs.map((entry) => Number(entry.blockNumber ?? 0)).filter((n) => Number.isFinite(n) && n >= 0))];
      const blockTimes = new Map<number, number>();
      await Promise.all(blockNos.map(async (blockNo) => {
        const block = await getBlock(blockNo).catch(() => null);
        const tsRaw = block?.timestamp;
        const seconds = typeof tsRaw === 'bigint' ? Number(tsRaw) : Number(tsRaw ?? 0);
        if (Number.isFinite(seconds) && seconds > 0) {
          blockTimes.set(blockNo, seconds * 1000);
        }
      }));

      const walletLower = wallet.address.toLowerCase();
      const txHashes = [...new Set(logs.map((entry) => String(entry.transactionHash || '').toLowerCase()).filter(Boolean))];
      const txByHash = new Map<string, {
        hash?: string;
        from?: string;
        to?: string | null;
        data?: string;
        value?: bigint;
      }>();
      await Promise.all(txHashes.map(async (txHash) => {
        const tx = await getTransaction(txHash).catch(() => null);
        if (tx) txByHash.set(txHash, tx);
      }));
      const recent = logs.map((entry) => {
        let from = '';
        let to = '';
        let amount = '0';
        try {
          const parsed = transferInterface.parseLog({
            data: String(entry.data || '0x'),
            topics: entry.topics
          });
          if (parsed) {
            from = String(parsed.args[0] || '').toLowerCase();
            to = String(parsed.args[1] || '').toLowerCase();
            amount = formatUnits(parsed.args[2] as bigint, deps.onchainTokenDecimals);
          }
        } catch {
          // ignore malformed log; preserve tx metadata
        }
        const direction = from === walletLower && to === walletLower
          ? 'self'
          : from === walletLower
            ? 'out'
            : 'in';
        const txHash = String(entry.transactionHash || '').toLowerCase();
        const tx = txByHash.get(txHash);
        const txTo = String(tx?.to || '').toLowerCase();
        const txData = String(tx?.data || '');
        const txFrom = String(tx?.from || '').toLowerCase();
        let method = '';
        let methodLabel = 'transfer';
        try {
          if (txTo && txTo === String(deps.onchainTokenAddress || '').toLowerCase()) {
            const parsedTx = erc20TxInterface.parseTransaction({ data: txData });
            method = String(parsedTx?.name || '');
            if (method) methodLabel = `erc20.${method}`;
          } else if (txTo && txTo === String(deps.onchainEscrowAddress || '').toLowerCase()) {
            const parsedTx = escrowTxInterface.parseTransaction({ data: txData });
            method = String(parsedTx?.name || '');
            if (method) methodLabel = `escrow.${method}`;
          } else if ((txData === '0x' || txData.length <= 2) && (tx?.value || 0n) > 0n) {
            method = 'native_transfer';
            methodLabel = 'native.transfer';
          } else if (txData && txData.length >= 10) {
            method = `0x${txData.slice(2, 10)}`;
            methodLabel = `call.${method}`;
          }
        } catch {
          if (txData && txData.length >= 10) {
            method = `0x${txData.slice(2, 10)}`;
            methodLabel = `call.${method}`;
          }
        }
        const blockNo = Number(entry.blockNumber ?? 0);
        return {
          kind: 'erc20_transfer',
          direction,
          txHash: String(entry.transactionHash || ''),
          blockNumber: blockNo,
          logIndex: Number(entry.index ?? 0),
          timestampMs: blockTimes.get(blockNo) ?? null,
          tokenAddress: deps.onchainTokenAddress,
          tokenSymbol: String(tokenSymbol || 'TOKEN'),
          tokenDecimals: deps.onchainTokenDecimals,
          amount,
          from,
          to,
          txFrom: txFrom || null,
          txTo: txTo || null,
          method: method || null,
          methodLabel,
          nativeValueEth: tx?.value != null ? formatEther(tx.value) : null
        };
      });

      sendJson(res, {
        ok: true,
        walletId,
        address: wallet.address,
        chainId: Number.isFinite(chainId) ? chainId : null,
        tokenAddress: deps.onchainTokenAddress,
        tokenSymbol: String(tokenSymbol || 'TOKEN'),
        tokenDecimals: deps.onchainTokenDecimals,
        lookbackBlocks,
        recent
      });
    } catch (error) {
      sendJson(res, {
        ok: false,
        reason: 'onchain_activity_failed',
        detail: String((error as Error).message || 'activity_lookup_failed').slice(0, 180)
      }, 503);
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
