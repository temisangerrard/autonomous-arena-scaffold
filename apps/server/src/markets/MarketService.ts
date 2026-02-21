import { randomUUID } from 'node:crypto';
import type { Database, MarketActivationRecord, MarketPositionRecord, MarketRecord } from '../Database.js';
import type { EscrowAdapter } from '../EscrowAdapter.js';
import { METRIC_NAMES, metrics } from '../metrics.js';
import { PolymarketFeed, type PolymarketNormalizedMarket } from './PolymarketFeed.js';

export type MarketView = MarketRecord & {
  active: boolean;
  maxWager: number;
  houseSpreadBps: number;
};

export type QuoteResult = {
  ok: boolean;
  reason?: string;
  reasonCode?: string;
  reasonText?: string;
  market?: MarketView;
  side?: 'yes' | 'no';
  stake?: number;
  price?: number;
  shares?: number;
  potentialPayout?: number;
};

const DEFAULT_MAX_WAGER = Math.max(1, Number(process.env.PREDICTION_MAX_WAGER_DEFAULT || 100));
const DEFAULT_SPREAD_BPS = Math.max(0, Math.min(5000, Number(process.env.PREDICTION_SPREAD_BPS_DEFAULT || 300)));
const MAX_OPEN_POSITIONS_PER_PLAYER = Math.max(1, Number(process.env.PREDICTION_MAX_OPEN_PER_PLAYER || 12));
const ORACLE_STALE_MS = Math.max(30_000, Number(process.env.PREDICTION_ORACLE_STALE_MS || 3 * 60_000));
const FALLBACK_MARKET_ID = (process.env.PREDICTION_FALLBACK_MARKET_ID || 'fallback_train_world_market').trim();
const FALLBACK_MARKET_SLUG = (process.env.PREDICTION_FALLBACK_MARKET_SLUG || 'train-world-house-market').trim();
const FALLBACK_MARKET_QUESTION = (
  process.env.PREDICTION_FALLBACK_MARKET_QUESTION || 'Will Bitcoin (BTC) be higher in 24 hours?'
).trim();
const FALLBACK_MARKET_CATEGORY = (process.env.PREDICTION_FALLBACK_MARKET_CATEGORY || 'train_world').trim();
const FALLBACK_MARKET_CLOSE_MS = Math.max(60 * 60_000, Number(process.env.PREDICTION_FALLBACK_CLOSE_MS || 24 * 60 * 60_000));
const ENSURE_ACTIVE_MARKET_COOLDOWN_MS = Math.max(1_000, Number(process.env.PREDICTION_ENSURE_ACTIVE_COOLDOWN_MS || 5_000));
const PREFERRED_MARKET_TERMS = (process.env.PREDICTION_PREFERRED_MARKET_TERMS || 'bitcoin,btc')
  .split(',')
  .map((token) => token.trim().toLowerCase())
  .filter(Boolean);

export class MarketService {
  private lastSyncAt = 0;
  private ensureActiveMarketInFlight: Promise<void> | null = null;
  private ensureActiveMarketLastRunAt = 0;

  constructor(
    private readonly db: Database,
    private readonly escrowAdapter: EscrowAdapter,
    private readonly feed: PolymarketFeed,
    private readonly getHouseWalletId: () => string | null
  ) {}

  private normalizedPrice(price: number): number {
    return Math.max(0.01, Math.min(0.99, Number(price || 0.5)));
  }

  private payoutFor(stake: number, price: number): number {
    const safeStake = Math.max(0, stake);
    const safePrice = this.normalizedPrice(price);
    return Number((safeStake / safePrice).toFixed(6));
  }

  private async activationMap(): Promise<Map<string, MarketActivationRecord>> {
    const rows = await this.db.listMarketActivations();
    return new Map(rows.map((r) => [r.marketId, r]));
  }

  private marketViewOf(market: MarketRecord, activation: MarketActivationRecord | null): MarketView {
    return {
      ...market,
      active: Boolean(activation?.active),
      maxWager: Number(activation?.maxWager ?? DEFAULT_MAX_WAGER),
      houseSpreadBps: Number(activation?.houseSpreadBps ?? DEFAULT_SPREAD_BPS)
    };
  }

  private quotePriceForSide(market: MarketView, side: 'yes' | 'no'): number {
    const raw = side === 'yes' ? market.yesPrice : market.noPrice;
    const spread = market.houseSpreadBps / 10_000;
    return this.normalizedPrice(raw + spread);
  }

  private isPlayableNow(market: MarketRecord): boolean {
    if (market.status === 'cancelled' || market.status === 'resolved') return false;
    return market.closeAt > Date.now();
  }

  private async ensureFallbackMarket(activeMaxWager = DEFAULT_MAX_WAGER, activeSpreadBps = DEFAULT_SPREAD_BPS): Promise<void> {
    const now = Date.now();
    await this.db.upsertMarket({
      id: FALLBACK_MARKET_ID,
      slug: FALLBACK_MARKET_SLUG,
      question: FALLBACK_MARKET_QUESTION,
      category: FALLBACK_MARKET_CATEGORY,
      closeAt: now + FALLBACK_MARKET_CLOSE_MS,
      resolveAt: null,
      status: 'open',
      oracleSource: 'polymarket_gamma',
      oracleMarketId: 'fallback_house',
      outcome: null,
      yesPrice: 0.5,
      noPrice: 0.5,
      rawJson: {
        source: 'fallback',
        generatedAt: now
      }
    });
    await this.db.setMarketActivation({
      marketId: FALLBACK_MARKET_ID,
      active: true,
      maxWager: activeMaxWager,
      houseSpreadBps: activeSpreadBps,
      updatedBy: 'system:auto_fallback'
    });
  }

  private preferredMarketScore(market: MarketRecord): number {
    const haystack = `${market.question} ${market.slug} ${market.category}`.toLowerCase();
    let score = 0;
    for (const term of PREFERRED_MARKET_TERMS) {
      if (haystack.includes(term)) score += 1;
    }
    return score;
  }

  private async upsertOracleMarkets(markets: PolymarketNormalizedMarket[]): Promise<void> {
    for (const entry of markets) {
      await this.db.upsertMarket({
        id: entry.id,
        slug: entry.slug,
        question: entry.question,
        category: entry.category,
        closeAt: entry.closeAt,
        resolveAt: entry.resolveAt,
        status: entry.status,
        oracleSource: 'polymarket_gamma',
        oracleMarketId: entry.oracleMarketId,
        outcome: entry.outcome,
        yesPrice: entry.yesPrice,
        noPrice: entry.noPrice,
        rawJson: entry.raw
      });
    }
  }

  private choosePreferredMarket<T extends { question: string; slug: string; category: string; closeAt: number }>(markets: T[]): T | null {
    return (
      markets
        .map((market) => ({
          market,
          score: this.preferredMarketScore({
            id: 'x',
            slug: market.slug,
            question: market.question,
            category: market.category,
            closeAt: market.closeAt,
            resolveAt: null,
            status: 'open',
            oracleSource: '',
            oracleMarketId: '',
            outcome: null,
            yesPrice: 0.5,
            noPrice: 0.5
          })
        }))
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score || a.market.closeAt - b.market.closeAt)[0]?.market || null
    );
  }

  private async ensureAtLeastOneActiveMarket(): Promise<void> {
    const now = Date.now();
    if (this.ensureActiveMarketInFlight) {
      await this.ensureActiveMarketInFlight;
      return;
    }
    if (now - this.ensureActiveMarketLastRunAt < ENSURE_ACTIVE_MARKET_COOLDOWN_MS) return;
    this.ensureActiveMarketInFlight = (async () => {
      const [markets, activation] = await Promise.all([this.db.listMarkets(200), this.activationMap()]);
      const activePlayable = markets
        .map((market) => this.marketViewOf(market, activation.get(market.id) || null))
        .some((market) => market.active && this.isPlayableNow(market));
      if (activePlayable) return;

      const defaultActivation = activation.values().next().value || null;
      const maxWager = Number(defaultActivation?.maxWager ?? DEFAULT_MAX_WAGER);
      const houseSpreadBps = Number(defaultActivation?.houseSpreadBps ?? DEFAULT_SPREAD_BPS);
      const candidatePool = markets.filter((market) => market.id !== FALLBACK_MARKET_ID && this.isPlayableNow(market));
      const preferred = this.choosePreferredMarket(candidatePool);
      const candidate = preferred || candidatePool[0];
      if (candidate) {
        await this.db.setMarketActivation({
          marketId: candidate.id,
          active: true,
          maxWager,
          houseSpreadBps,
          updatedBy: 'system:auto_activate'
        });
        return;
      }

      // API-first path: pull fresh oracle markets and try to activate a BTC/preferred market.
      try {
        const oracleMarkets = await this.feed.fetchMarkets(80);
        if (oracleMarkets.length > 0) {
          await this.upsertOracleMarkets(oracleMarkets);
          const openOracle = oracleMarkets.filter((market) => market.status === 'open' && market.closeAt > Date.now());
          const preferredOracle = this.choosePreferredMarket(openOracle);
          const oracleCandidate = preferredOracle || openOracle[0];
          if (oracleCandidate) {
            await this.db.setMarketActivation({
              marketId: oracleCandidate.id,
              active: true,
              maxWager,
              houseSpreadBps,
              updatedBy: 'system:auto_activate_oracle'
            });
            return;
          }
        }
      } catch {
        // If oracle fetch fails, fallback market keeps station usable.
      }

      await this.ensureFallbackMarket(maxWager, houseSpreadBps);
    })()
      .catch(() => undefined)
      .finally(() => {
        this.ensureActiveMarketLastRunAt = Date.now();
        this.ensureActiveMarketInFlight = null;
      });

    await this.ensureActiveMarketInFlight;
  }

  async syncFromOracle(limit = 60): Promise<{ ok: boolean; synced: number; error?: string }> {
    try {
      const markets = await this.feed.fetchMarkets(limit);
      for (const entry of markets) {
        await this.db.upsertMarket({
          id: entry.id,
          slug: entry.slug,
          question: entry.question,
          category: entry.category,
          closeAt: entry.closeAt,
          resolveAt: entry.resolveAt,
          status: entry.status,
          oracleSource: 'polymarket_gamma',
          oracleMarketId: entry.oracleMarketId,
          outcome: entry.outcome,
          yesPrice: entry.yesPrice,
          noPrice: entry.noPrice,
          rawJson: entry.raw
        });
      }
      this.lastSyncAt = Date.now();
      return { ok: true, synced: markets.length };
    } catch (error) {
      return { ok: false, synced: 0, error: String((error as Error)?.message || error) };
    }
  }

  async getAdminState(): Promise<{ ok: true; lastSyncAt: number; staleMs: number; markets: MarketView[] }> {
    await this.ensureAtLeastOneActiveMarket();
    const [markets, activation] = await Promise.all([
      this.db.listMarkets(300),
      this.activationMap()
    ]);
    const views = markets.map((m) => this.marketViewOf(m, activation.get(m.id) || null));
    return {
      ok: true,
      lastSyncAt: this.lastSyncAt,
      staleMs: this.lastSyncAt > 0 ? Math.max(0, Date.now() - this.lastSyncAt) : Number.MAX_SAFE_INTEGER,
      markets: views
    };
  }

  async activateMarket(params: {
    marketId: string;
    active: boolean;
    maxWager?: number;
    houseSpreadBps?: number;
    updatedBy?: string | null;
  }): Promise<{ ok: boolean; reason?: string }> {
    const market = await this.db.getMarketById(params.marketId);
    if (!market) return { ok: false, reason: 'market_not_found' };
    await this.db.setMarketActivation({
      marketId: params.marketId,
      active: params.active,
      maxWager: Number(params.maxWager ?? DEFAULT_MAX_WAGER),
      houseSpreadBps: Number(params.houseSpreadBps ?? DEFAULT_SPREAD_BPS),
      updatedBy: params.updatedBy ?? null
    });
    return { ok: true };
  }

  async listActiveMarketsForPlayer(): Promise<MarketView[]> {
    await this.ensureAtLeastOneActiveMarket();
    const [markets, activation] = await Promise.all([
      this.db.listMarkets(200),
      this.activationMap()
    ]);
    const now = Date.now();
    return markets
      .map((m) => this.marketViewOf(m, activation.get(m.id) || null))
      .filter((m) => m.active)
      .filter((m) => m.status !== 'cancelled')
      .filter((m) => m.status === 'resolved' || m.closeAt > now)
      .slice(0, 60);
  }

  async quote(params: {
    marketId: string;
    side: 'yes' | 'no';
    stake: number;
  }): Promise<QuoteResult> {
    await this.ensureAtLeastOneActiveMarket();
    const [market, activation] = await Promise.all([
      this.db.getMarketById(params.marketId),
      this.activationMap()
    ]);
    if (!market) return { ok: false, reason: 'market_not_found' };
    const view = this.marketViewOf(market, activation.get(market.id) || null);
    if (!view.active) {
      return { ok: false, reason: 'market_inactive', reasonText: 'This market is not active right now.' };
    }
    if (this.lastSyncAt > 0 && Date.now() - this.lastSyncAt > ORACLE_STALE_MS) {
      return { ok: false, reason: 'oracle_unavailable', reasonText: 'Market feed is stale. Retry shortly.' };
    }
    if (view.status === 'resolved' || view.status === 'cancelled' || view.closeAt <= Date.now()) {
      return { ok: false, reason: 'market_closed', reasonText: 'This market is closed for new orders.' };
    }
    const stake = Math.max(1, Number(params.stake || 0));
    if (stake > view.maxWager) {
      return { ok: false, reason: 'wager_too_high', reasonText: `Max wager is ${view.maxWager}.` };
    }

    const price = this.quotePriceForSide(view, params.side);
    const shares = Number((stake / price).toFixed(6));
    const potentialPayout = this.payoutFor(stake, price);
    return {
      ok: true,
      market: view,
      side: params.side,
      stake,
      price,
      shares,
      potentialPayout
    };
  }

  async openPosition(params: {
    playerId: string;
    walletId: string;
    marketId: string;
    side: 'yes' | 'no';
    stake: number;
  }): Promise<{
    ok: boolean;
    reason?: string;
    reasonCode?: string;
    reasonText?: string;
    position?: MarketPositionRecord;
    quote?: QuoteResult;
    preflight?: { playerOk: boolean; houseOk: boolean };
  }> {
    const houseWalletId = this.getHouseWalletId();
    if (!houseWalletId) {
      return {
        ok: false,
        reason: 'wallet_required',
        reasonCode: 'HOUSE_SIGNER_UNAVAILABLE',
        reasonText: 'House wallet unavailable.'
      };
    }

    const quote = await this.quote({
      marketId: params.marketId,
      side: params.side,
      stake: params.stake
    });
    if (!quote.ok || !quote.market || !quote.stake || !quote.price || !quote.shares) {
      return {
        ok: false,
        reason: quote.reason || 'quote_failed',
        reasonCode: quote.reasonCode,
        reasonText: quote.reasonText,
        quote
      };
    }

    const openPositions = (await this.db.listPlayerMarketPositions(params.playerId, 200)).filter((p) => p.status === 'open');
    if (openPositions.length >= MAX_OPEN_POSITIONS_PER_PLAYER) {
      return {
        ok: false,
        reason: 'too_many_open_positions',
        reasonText: `Maximum open positions reached (${MAX_OPEN_POSITIONS_PER_PLAYER}).`
      };
    }

    const preflight = await this.escrowAdapter.preflightStake({
      challengerWalletId: params.walletId,
      opponentWalletId: houseWalletId,
      amount: quote.stake
    });
    if (!preflight.ok) {
      return {
        ok: false,
        reason: preflight.reason || 'wallet_prepare_failed',
        reasonCode: preflight.reasonCode,
        reasonText: preflight.reasonText,
        preflight: preflight.preflight
      };
    }

    const positionId = `mp_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
    const escrowBetId = `mkt_${quote.market.id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 22)}_${positionId.slice(3)}`;

    const locked = await this.escrowAdapter.lockStake({
      challengeId: escrowBetId,
      challengerWalletId: params.walletId,
      opponentWalletId: houseWalletId,
      amount: quote.stake
    });
    if (!locked.ok) {
      return {
        ok: false,
        reason: locked.reason || 'escrow_lock_failed',
        reasonCode: String((locked.raw as { reasonCode?: unknown } | undefined)?.reasonCode || ''),
        reasonText: String((locked.raw as { reasonText?: unknown } | undefined)?.reasonText || '') || 'Escrow lock failed.'
      };
    }

    await this.db.createMarketPosition({
      id: positionId,
      marketId: quote.market.id,
      playerId: params.playerId,
      walletId: params.walletId,
      side: params.side,
      stake: quote.stake,
      price: quote.price,
      shares: quote.shares,
      escrowBetId
    });

    metrics.incrementCounter(METRIC_NAMES.marketOrdersTotal, { side: params.side, market: quote.market.id });

    const created = (await this.db.listPlayerMarketPositions(params.playerId, 10)).find((p) => p.id === positionId) || null;
    if (!created) {
      return { ok: false, reason: 'position_create_failed', reasonText: 'Position write failed.' };
    }

    return { ok: true, position: created, quote };
  }

  async listPlayerPositions(playerId: string): Promise<MarketPositionRecord[]> {
    return this.db.listPlayerMarketPositions(playerId, 120);
  }

  async settleResolvedMarkets(): Promise<{ checked: number; settled: number; failed: number }> {
    const [openPositions, markets] = await Promise.all([
      this.db.listOpenMarketPositions(2000),
      this.db.listMarkets(500)
    ]);
    const marketById = new Map(markets.map((m) => [m.id, m]));

    let settled = 0;
    let failed = 0;

    for (const position of openPositions) {
      const market = marketById.get(position.marketId);
      if (!market) continue;
      if (market.status !== 'resolved' && market.status !== 'cancelled') continue;

      let targetWalletId: string | null = null;
      let finalStatus: 'won' | 'lost' | 'voided' = 'voided';

      if (market.status === 'cancelled' || !market.outcome) {
        targetWalletId = position.walletId;
        finalStatus = 'voided';
      } else if (position.side === market.outcome) {
        targetWalletId = position.walletId;
        finalStatus = 'won';
      } else {
        targetWalletId = this.getHouseWalletId();
        finalStatus = 'lost';
      }

      if (!targetWalletId) {
        failed += 1;
        continue;
      }

      const resolved = await this.escrowAdapter.resolve({
        challengeId: position.escrowBetId,
        winnerWalletId: targetWalletId
      });
      if (!resolved.ok) {
        failed += 1;
        metrics.incrementCounter(METRIC_NAMES.marketSettlementFailureTotal, { market: market.id, status: finalStatus });
        continue;
      }

      await this.db.settleMarketPosition({
        positionId: position.id,
        status: finalStatus
      });
      settled += 1;
      metrics.incrementCounter(METRIC_NAMES.marketSettlementSuccessTotal, { market: market.id, status: finalStatus });
    }

    return { checked: openPositions.length, settled, failed };
  }
}

export function toPredictionViewPosition(input: {
  position: MarketPositionRecord;
  market: MarketRecord | null;
}): {
  positionId: string;
  marketId: string;
  question: string;
  side: 'yes' | 'no';
  stake: number;
  price: number;
  shares: number;
  potentialPayout: number;
  status: 'open' | 'won' | 'lost' | 'voided';
  createdAt: number;
  settledAt: number | null;
} {
  const { position, market } = input;
  const potentialPayout = Number((position.stake / Math.max(0.01, position.price)).toFixed(6));
  return {
    positionId: position.id,
    marketId: position.marketId,
    question: market?.question || position.marketId,
    side: position.side,
    stake: position.stake,
    price: position.price,
    shares: position.shares,
    potentialPayout,
    status: position.status,
    createdAt: position.createdAt,
    settledAt: position.settledAt
  };
}

export function toMarketView(market: MarketView) {
  return {
    marketId: market.id,
    slug: market.slug,
    question: market.question,
    category: market.category,
    closeAt: market.closeAt,
    resolveAt: market.resolveAt || 0,
    status: market.status,
    outcome: market.outcome,
    yesPrice: market.yesPrice,
    noPrice: market.noPrice,
    maxWager: market.maxWager
  };
}
