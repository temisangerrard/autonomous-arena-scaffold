import { randomUUID } from 'node:crypto';
import type { Database, MarketActivationRecord, MarketPositionRecord, MarketRecord } from '../Database.js';
import type { EscrowAdapter } from '../EscrowAdapter.js';
import { log as rootLog } from '../logger.js';
import { METRIC_NAMES, metrics } from '../metrics.js';
import { PolymarketFeed, type PolymarketNormalizedMarket } from './PolymarketFeed.js';
import type { PolymarketClobClient } from './PolymarketClobClient.js';
import { Contract, JsonRpcProvider, formatUnits } from 'ethers';

const log = rootLog.child({ module: 'market-service' });

export type MarketView = MarketRecord & {
  active: boolean;
  maxWager: number;
  houseSpreadBps: number;
  yesLiquidity?: number;
  noLiquidity?: number;
  netOppositeLiquidity?: number;
  refundOnlyRisk?: boolean;
  rail?: 'btc_5m' | 'btc_24h';
  roundType?: 'current' | 'next';
  slotStart?: number;
  slotEnd?: number;
  currentSpotPrice?: number | null;
  currentSpotUpdatedAt?: number | null;
  currentSpotRoundId?: string | null;
  lockPrice?: number | null;
  lockPriceUpdatedAt?: number | null;
  lockRoundId?: string | null;
  finalPrice?: number | null;
  finalPriceUpdatedAt?: number | null;
  finalRoundId?: string | null;
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
  estimatedPayout?: number;
  minPayout?: number;
  liquidityOpposite?: number;
  liquiditySameSide?: number;
  liquidityWarning?: string;
  positionStatus?: 'scheduled' | 'open';
};

export type LiveMarketPreview = {
  marketId: string;
  slug: string;
  question: string;
  category: string;
  closeAt: number;
  resolveAt: number | null;
  status: 'open' | 'closed' | 'resolved' | 'cancelled';
  outcome: 'yes' | 'no' | null;
  yesPrice: number;
  noPrice: number;
  oracleMarketId: string;
};

const DEFAULT_MAX_WAGER = Math.max(1, Number(process.env.PREDICTION_MAX_WAGER_DEFAULT || 100));
const DEFAULT_SPREAD_BPS = Math.max(0, Math.min(5000, Number(process.env.PREDICTION_SPREAD_BPS_DEFAULT || 300)));
const MAX_OPEN_POSITIONS_PER_PLAYER = Math.max(1, Number(process.env.PREDICTION_MAX_OPEN_PER_PLAYER || 12));
const ORACLE_STALE_MS = Math.max(30_000, Number(process.env.PREDICTION_ORACLE_STALE_MS || 3 * 60_000));
const ENSURE_ACTIVE_MARKET_COOLDOWN_MS = Math.max(1_000, Number(process.env.PREDICTION_ENSURE_ACTIVE_COOLDOWN_MS || 5_000));
const PREFERRED_MARKET_TERMS = (process.env.PREDICTION_PREFERRED_MARKET_TERMS || 'bitcoin,btc')
  .split(',')
  .map((token) => token.trim().toLowerCase())
  .filter(Boolean);
const CHAINLINK_MARKETS_ENABLED = String(process.env.PREDICTION_CHAINLINK_ENABLED ?? 'true').toLowerCase() !== 'false';
const CHAINLINK_BTC_USD_FEED = (process.env.CHAINLINK_BTC_USD_FEED || '0xc907E116054Ad103354f2D350FD2514433D57F6f').trim();
const CHAINLINK_DURATIONS = (process.env.PREDICTION_CHAINLINK_DURATIONS || '5m,24h')
  .split(',')
  .map((token) => token.trim().toLowerCase())
  .filter(Boolean);
const CHAINLINK_RESOLUTION_GRACE_MS = Math.max(0, Number(process.env.PREDICTION_CHAINLINK_RESOLUTION_GRACE_MS || 15_000));
const CHAINLINK_AGGREGATOR_ABI = [
  'function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
  'function decimals() view returns (uint8)'
];
type ChainlinkFeedContract = Contract & {
  latestRoundData: () => Promise<{
    roundId: bigint;
    answer: bigint;
    startedAt: bigint;
    updatedAt: bigint;
    answeredInRound: bigint;
  }>;
  decimals: () => Promise<number | bigint>;
};

export class MarketService {
  private lastSyncAt = 0;
  private ensureActiveMarketInFlight: Promise<void> | null = null;
  private ensureActiveMarketLastRunAt = 0;
  private chainlinkProvider: JsonRpcProvider | null = null;
  private chainlinkFeedContract: ChainlinkFeedContract | null = null;
  private chainlinkDecimals: number | null = null;

  constructor(
    private readonly db: Database,
    private readonly escrowAdapter: EscrowAdapter,
    private readonly feed: PolymarketFeed,
    private readonly getHouseWalletId: () => string | null,
    private readonly clobClient?: PolymarketClobClient
  ) {}

  private normalizedPrice(price: number): number {
    return Math.max(0.01, Math.min(0.99, Number(price || 0.5)));
  }

  private payoutFor(stake: number, price: number): number {
    const safeStake = Math.max(0, stake);
    const safePrice = this.normalizedPrice(price);
    return Number((safeStake / safePrice).toFixed(6));
  }

  private async trackInteractionEvent(params: {
    playerId: string;
    stationId: string;
    marketId?: string | null;
    eventType: string;
    side?: 'yes' | 'no' | null;
    stake?: number | null;
    oppositeLiquidityAtCommit?: number | null;
    closeAt?: number | null;
    reason?: string | null;
    reasonCode?: string | null;
    metaJson?: Record<string, unknown> | null;
  }): Promise<void> {
    await this.db.insertMarketInteractionEvent({
      id: `mke_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
      playerId: params.playerId,
      stationId: params.stationId,
      marketId: params.marketId ?? null,
      eventType: params.eventType,
      side: params.side ?? null,
      stake: params.stake ?? null,
      oppositeLiquidityAtCommit: params.oppositeLiquidityAtCommit ?? null,
      closeAt: params.closeAt ?? null,
      reason: params.reason ?? null,
      reasonCode: params.reasonCode ?? null,
      metaJson: params.metaJson ?? null
    });
  }

  private async liquidityByMarketId(): Promise<Map<string, { yes: number; no: number }>> {
    const open = await this.db.listActiveMarketPositions(4000);
    const map = new Map<string, { yes: number; no: number }>();
    for (const entry of open) {
      const current = map.get(entry.marketId) || { yes: 0, no: 0 };
      if (entry.side === 'yes') current.yes += Number(entry.stake || 0);
      else current.no += Number(entry.stake || 0);
      map.set(entry.marketId, current);
    }
    return map;
  }

  private async activationMap(): Promise<Map<string, MarketActivationRecord>> {
    const rows = await this.db.listMarketActivations();
    return new Map(rows.map((r) => [r.marketId, r]));
  }

  private marketViewOf(market: MarketRecord, activation: MarketActivationRecord | null): MarketView {
    const raw = (market.rawJson || {}) as Record<string, unknown>;
    const slotStart = Number(raw.slotStart ?? Number.NaN);
    const slotEnd = Number(raw.slotEnd ?? market.closeAt);
    const durationToken = String(raw.durationToken || '').toLowerCase();
    const rail = durationToken === '24h' ? 'btc_24h' : durationToken ? 'btc_5m' : undefined;
    const roundType = Number.isFinite(slotStart) && slotStart > Date.now() ? 'next' : 'current';
    return {
      ...market,
      active: Boolean(activation?.active),
      maxWager: Number(activation?.maxWager ?? DEFAULT_MAX_WAGER),
      houseSpreadBps: Number(activation?.houseSpreadBps ?? DEFAULT_SPREAD_BPS),
      rail,
      roundType,
      slotStart: Number.isFinite(slotStart) ? slotStart : undefined,
      slotEnd: Number.isFinite(slotEnd) ? slotEnd : undefined,
      currentSpotPrice: raw.currentSpotPrice != null ? Number(raw.currentSpotPrice) : null,
      currentSpotUpdatedAt: raw.currentSpotUpdatedAt != null ? Number(raw.currentSpotUpdatedAt) : null,
      currentSpotRoundId: raw.currentSpotRoundId != null ? String(raw.currentSpotRoundId) : null,
      lockPrice: raw.entryPrice != null ? Number(raw.entryPrice) : null,
      lockPriceUpdatedAt: raw.entryUpdatedAt != null ? Number(raw.entryUpdatedAt) : null,
      lockRoundId: raw.entryRoundId != null ? String(raw.entryRoundId) : null,
      finalPrice: raw.resolvedPrice != null ? Number(raw.resolvedPrice) : null,
      finalPriceUpdatedAt: raw.resolvedUpdatedAt != null ? Number(raw.resolvedUpdatedAt) : null,
      finalRoundId: raw.resolvedRoundId != null ? String(raw.resolvedRoundId) : null
    };
  }

  private quotePriceForSide(market: MarketView, side: 'yes' | 'no'): number {
    const raw = side === 'yes' ? market.yesPrice : market.noPrice;
    const halfSpread = (market.houseSpreadBps / 10_000) / 2;
    return this.normalizedPrice(raw + halfSpread);
  }

  private isPlayableNow(market: MarketRecord): boolean {
    if (market.status === 'cancelled' || market.status === 'resolved') return false;
    return market.closeAt > Date.now();
  }

  private isFutureRound(market: MarketRecord | MarketView): boolean {
    const raw = (market.rawJson || {}) as Record<string, unknown>;
    const slotStart = Number(raw.slotStart ?? (market as MarketView).slotStart ?? Number.NaN);
    return Number.isFinite(slotStart) && slotStart > Date.now();
  }

  private async promoteScheduledPositionsForCurrentMarkets(markets: MarketRecord[]): Promise<void> {
    const promotable = markets.filter((market) => !this.isFutureRound(market));
    await Promise.all(promotable.map((market) => this.db.promoteScheduledMarketPositions(market.id)));
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

  private durationMsFromToken(token: string): number | null {
    if (token === '5m') return 5 * 60_000;
    if (token === '24h') return 24 * 60 * 60_000;
    const minuteMatch = token.match(/^(\d+)m$/);
    if (minuteMatch) return Math.max(60_000, Number(minuteMatch[1]) * 60_000);
    const hourMatch = token.match(/^(\d+)h$/);
    if (hourMatch) return Math.max(60 * 60_000, Number(hourMatch[1]) * 60 * 60_000);
    return null;
  }

  private durationLabel(token: string): string {
    if (token === '5m') return '5 minutes';
    if (token === '24h') return '24 hours';
    const minuteMatch = token.match(/^(\d+)m$/);
    if (minuteMatch) return `${Number(minuteMatch[1])} minutes`;
    const hourMatch = token.match(/^(\d+)h$/);
    if (hourMatch) return `${Number(hourMatch[1])} hours`;
    return token;
  }

  private async latestBtcUsd(): Promise<{ price: number; updatedAt: number; roundId: string } | null> {
    if (!CHAINLINK_MARKETS_ENABLED || !CHAINLINK_BTC_USD_FEED) return null;
    const rpcUrl = String(process.env.CHAIN_RPC_URL || '').trim();
    if (!rpcUrl) return null;
    if (!this.chainlinkProvider) {
      this.chainlinkProvider = new JsonRpcProvider(rpcUrl);
    }
    if (!this.chainlinkFeedContract) {
      this.chainlinkFeedContract = new Contract(
        CHAINLINK_BTC_USD_FEED,
        CHAINLINK_AGGREGATOR_ABI,
        this.chainlinkProvider
      ) as ChainlinkFeedContract;
    }
    const feed = this.chainlinkFeedContract;
    if (this.chainlinkDecimals == null) {
      const decimalsRaw = await feed.decimals();
      this.chainlinkDecimals = Number(decimalsRaw);
    }
    const decimals = Number(this.chainlinkDecimals);
    const latest = await feed.latestRoundData();
    const answerRaw = latest?.answer as bigint;
    const updatedAtRaw = latest?.updatedAt as bigint;
    const roundIdRaw = latest?.roundId as bigint;
    const price = Number(formatUnits(answerRaw, decimals));
    const updatedAt = Number(updatedAtRaw) * 1000;
    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(updatedAt) || updatedAt <= 0) {
      return null;
    }
    return {
      price,
      updatedAt,
      roundId: String(roundIdRaw)
    };
  }

  private async ensureChainlinkBtcMarkets(): Promise<void> {
    if (!CHAINLINK_MARKETS_ENABLED) return;
    const oracle = await this.latestBtcUsd().catch(() => null);
    if (!oracle) return;
    const now = Date.now();
    const activation = await this.activationMap();
    for (const token of CHAINLINK_DURATIONS) {
      const durationMs = this.durationMsFromToken(token);
      if (!durationMs) continue;
      const currentSlotStart = Math.floor(now / durationMs) * durationMs;
      for (const slotStart of [currentSlotStart, currentSlotStart + durationMs]) {
        const slotEnd = slotStart + durationMs;
        const marketId = `cl_btc_${token}_${Math.floor(slotStart / 1000)}`;
        const label = this.durationLabel(token);
        const question = `Will BTC/USD be higher in ${label}?`;
        const existing = await this.db.getMarketById(marketId);
        const existingRaw = (existing?.rawJson || {}) as Record<string, unknown>;
        const isCurrentSlot = slotStart <= now;
        const entryPrice = existingRaw.entryPrice ?? (isCurrentSlot ? oracle.price : null);
        const entryRoundId = existingRaw.entryRoundId ?? (isCurrentSlot ? oracle.roundId : null);
        const entryUpdatedAt = existingRaw.entryUpdatedAt ?? (isCurrentSlot ? oracle.updatedAt : null);
        await this.db.upsertMarket({
          id: marketId,
          slug: `btc-up-${token}-${Math.floor(slotStart / 1000)}`,
          question,
          category: 'chainlink_btc',
          closeAt: slotEnd,
          resolveAt: slotEnd,
          status: 'open',
          oracleSource: 'chainlink_btc_usd',
          oracleMarketId: `chainlink:${token}:${Math.floor(slotStart / 1000)}`,
          outcome: null,
          yesPrice: 0.5,
          noPrice: 0.5,
          rawJson: {
            ...existingRaw,
            source: 'chainlink_btc_usd',
            durationToken: token,
            durationMs,
            slotStart,
            slotEnd,
            currentSpotPrice: oracle.price,
            currentSpotRoundId: oracle.roundId,
            currentSpotUpdatedAt: oracle.updatedAt,
            entryPrice,
            entryRoundId,
            entryUpdatedAt
          }
        });
        const existingActivation = activation.get(marketId);
        await this.db.setMarketActivation({
          marketId,
          active: Boolean(existingActivation?.active ?? true),
          maxWager: Number(existingActivation?.maxWager ?? DEFAULT_MAX_WAGER),
          houseSpreadBps: Number(existingActivation?.houseSpreadBps ?? DEFAULT_SPREAD_BPS),
          updatedBy: existingActivation?.updatedBy ?? 'system:chainlink_auto'
        });
      }
    }
  }

  private async resolveChainlinkMarkets(): Promise<void> {
    if (!CHAINLINK_MARKETS_ENABLED) return;
    const now = Date.now();
    const oracle = await this.latestBtcUsd().catch(() => null);
    if (!oracle) return;
    const markets = await this.db.listMarkets(400);
    for (const market of markets) {
      if (market.oracleSource !== 'chainlink_btc_usd') continue;
      if (market.status === 'resolved' || market.status === 'cancelled') continue;
      const resolveAt = Number(market.resolveAt ?? market.closeAt);
      if (!Number.isFinite(resolveAt) || resolveAt + CHAINLINK_RESOLUTION_GRACE_MS > now) continue;
      const raw = (market.rawJson || {}) as Record<string, unknown>;
      const entryPrice = Number(raw.entryPrice ?? Number.NaN);
      if (!Number.isFinite(entryPrice) || entryPrice <= 0) continue;
      let status: MarketRecord['status'] = 'resolved';
      let outcome: MarketRecord['outcome'] = null;
      let yesPrice = market.yesPrice;
      let noPrice = market.noPrice;
      if (oracle.price > entryPrice) {
        outcome = 'yes';
        yesPrice = 0.99;
        noPrice = 0.01;
      } else if (oracle.price < entryPrice) {
        outcome = 'no';
        yesPrice = 0.01;
        noPrice = 0.99;
      } else {
        status = 'cancelled';
      }
      await this.db.upsertMarket({
        id: market.id,
        slug: market.slug,
        question: market.question,
        category: market.category,
        closeAt: market.closeAt,
        resolveAt: market.resolveAt,
        status,
        oracleSource: market.oracleSource,
        oracleMarketId: market.oracleMarketId,
        outcome,
        yesPrice,
        noPrice,
        rawJson: {
          ...raw,
          resolvedPrice: oracle.price,
          resolvedRoundId: oracle.roundId,
          resolvedUpdatedAt: oracle.updatedAt,
          resolvedAt: now
        }
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
      await this.ensureChainlinkBtcMarkets();
      const [markets, activation] = await Promise.all([this.db.listMarkets(200), this.activationMap()]);
      await this.promoteScheduledPositionsForCurrentMarkets(markets);
      const activePlayable = markets
        .map((market) => this.marketViewOf(market, activation.get(market.id) || null))
        .some((market) => market.active && market.oracleSource === 'chainlink_btc_usd' && this.isPlayableNow(market));
      if (activePlayable) return;

      const defaultActivation = activation.values().next().value || null;
      const maxWager = Number(defaultActivation?.maxWager ?? DEFAULT_MAX_WAGER);
      const houseSpreadBps = Number(defaultActivation?.houseSpreadBps ?? DEFAULT_SPREAD_BPS);
      const candidatePool = markets.filter((market) =>
        market.oracleSource === 'chainlink_btc_usd' && this.isPlayableNow(market)
      );
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
    })()
      .catch(() => undefined)
      .finally(() => {
        this.ensureActiveMarketLastRunAt = Date.now();
        this.ensureActiveMarketInFlight = null;
      });

    await this.ensureActiveMarketInFlight;
  }

  async refreshMarketOutcomes(): Promise<void> {
    await this.resolveChainlinkMarkets();
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

  async syncAndAutoActivate(limit = 60): Promise<{ ok: boolean; synced: number; activated: number; error?: string }> {
    const syncResult = await this.syncFromOracle(limit);
    if (!syncResult.ok) {
      return {
        ok: false,
        synced: 0,
        activated: 0,
        error: syncResult.error || 'oracle_sync_failed'
      };
    }

    try {
      const [allMarkets, activations] = await Promise.all([
        this.db.listMarkets(300),
        this.activationMap()
      ]);
      const now = Date.now();
      let activated = 0;

      for (const market of allMarkets) {
        // Preserve manual overrides if this market already has an activation record.
        if (activations.has(market.id)) continue;
        if (market.status !== 'open' || market.closeAt <= now) continue;
        await this.db.setMarketActivation({
          marketId: market.id,
          active: true,
          maxWager: DEFAULT_MAX_WAGER,
          houseSpreadBps: DEFAULT_SPREAD_BPS,
          updatedBy: 'auto-sync'
        });
        activated += 1;
      }

      return { ok: true, synced: syncResult.synced, activated };
    } catch (error) {
      return {
        ok: false,
        synced: syncResult.synced,
        activated: 0,
        error: String((error as Error)?.message || error)
      };
    }
  }

  async previewLiveMarkets(params?: { limit?: number; query?: string }): Promise<{
    ok: boolean;
    source: 'polymarket_gamma';
    count: number;
    markets: LiveMarketPreview[];
    error?: string;
  }> {
    const limit = Math.max(1, Math.min(200, Number(params?.limit || 60)));
    const query = String(params?.query || '').trim().toLowerCase();
    try {
      const fetched = await this.feed.fetchMarkets(limit);
      const filtered = query
        ? fetched.filter((entry) => {
            const haystack = `${entry.question} ${entry.slug} ${entry.category}`.toLowerCase();
            return haystack.includes(query);
          })
        : fetched;
      const markets = filtered.map((entry) => ({
        marketId: entry.id,
        slug: entry.slug,
        question: entry.question,
        category: entry.category,
        closeAt: entry.closeAt,
        resolveAt: entry.resolveAt,
        status: entry.status,
        outcome: entry.outcome,
        yesPrice: entry.yesPrice,
        noPrice: entry.noPrice,
        oracleMarketId: entry.oracleMarketId
      }));
      return {
        ok: true,
        source: 'polymarket_gamma',
        count: markets.length,
        markets
      };
    } catch (error) {
      return {
        ok: false,
        source: 'polymarket_gamma',
        count: 0,
        markets: [],
        error: String((error as Error)?.message || error)
      };
    }
  }

  async getAdminState(): Promise<{
    ok: true;
    lastSyncAt: number;
    staleMs: number;
    markets: MarketView[];
    liquidityHealth: {
      marketsWithBothSides: number;
      activeMarkets: number;
      refundOnlyRiskMarkets: number;
    };
    eventCounts: Array<{ eventType: string; count: number }>;
  }> {
    await this.ensureAtLeastOneActiveMarket();
    const [markets, activation, liquidityByMarket] = await Promise.all([
      this.db.listMarkets(300),
      this.activationMap(),
      this.liquidityByMarketId()
    ]);
    const views = markets
      .map((m) => {
        const view = this.marketViewOf(m, activation.get(m.id) || null);
        const liquidity = liquidityByMarket.get(m.id) || { yes: 0, no: 0 };
        const winningPoolEstimate = Math.max(liquidity.yes, liquidity.no);
        const oppositePoolEstimate = Math.min(liquidity.yes, liquidity.no);
        return {
          ...view,
          yesLiquidity: Number(liquidity.yes.toFixed(6)),
          noLiquidity: Number(liquidity.no.toFixed(6)),
          netOppositeLiquidity: Number(oppositePoolEstimate.toFixed(6)),
          refundOnlyRisk: winningPoolEstimate > 0 && oppositePoolEstimate <= 0
        };
      })
      .sort((a, b) => {
        const aPlayable = this.isPlayableNow(a) ? 1 : 0;
        const bPlayable = this.isPlayableNow(b) ? 1 : 0;
        if (a.active !== b.active) return a.active ? -1 : 1;
        if (aPlayable !== bPlayable) return bPlayable - aPlayable;
        if (a.closeAt !== b.closeAt) return a.closeAt - b.closeAt;
        return String(a.question || '').localeCompare(String(b.question || ''));
      });
    return {
      ok: true,
      lastSyncAt: this.lastSyncAt,
      staleMs: this.lastSyncAt > 0 ? Math.max(0, Date.now() - this.lastSyncAt) : Number.MAX_SAFE_INTEGER,
      markets: views,
      liquidityHealth: {
        marketsWithBothSides: views.filter((v) => Number(v.yesLiquidity || 0) > 0 && Number(v.noLiquidity || 0) > 0).length,
        activeMarkets: views.filter((v) => v.active).length,
        refundOnlyRiskMarkets: views.filter((v) => Boolean(v.refundOnlyRisk)).length
      },
      eventCounts: await this.db.listMarketInteractionCounts(24)
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
    const [markets, activation, liquidityByMarket] = await Promise.all([
      this.db.listMarkets(200),
      this.activationMap(),
      this.liquidityByMarketId()
    ]);
    const now = Date.now();
    return markets
      .map((m) => {
        const view = this.marketViewOf(m, activation.get(m.id) || null);
        const liquidity = liquidityByMarket.get(m.id) || { yes: 0, no: 0 };
        return {
          ...view,
          yesLiquidity: Number(liquidity.yes.toFixed(6)),
          noLiquidity: Number(liquidity.no.toFixed(6))
        };
      })
      .filter((m) => m.active)
      .filter((m) => m.oracleSource === 'chainlink_btc_usd')
      .filter((m) => m.status !== 'cancelled')
      .filter((m) => m.closeAt > now)
      .sort((a, b) => {
        const aRail = a.rail === 'btc_24h' ? 1 : 0;
        const bRail = b.rail === 'btc_24h' ? 1 : 0;
        const aRound = a.roundType === 'next' ? 1 : 0;
        const bRound = b.roundType === 'next' ? 1 : 0;
        const aScore = this.preferredMarketScore(a);
        const bScore = this.preferredMarketScore(b);
        return aRail - bRail || aRound - bRound || bScore - aScore || a.closeAt - b.closeAt;
      })
      .slice(0, 8);
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
    const pools = await this.liquidityByMarketId();
    const liquidity = pools.get(view.id) || { yes: 0, no: 0 };
    const liquiditySameSide = params.side === 'yes' ? liquidity.yes : liquidity.no;
    const liquidityOpposite = params.side === 'yes' ? liquidity.no : liquidity.yes;
    const futureWinningPool = liquiditySameSide + stake;
    const netOppositePool = liquidityOpposite * Math.max(0, 1 - (view.houseSpreadBps / 10_000));
    const estimatedProfit = futureWinningPool > 0 ? (netOppositePool * (stake / futureWinningPool)) : 0;
    const estimatedPayout = Number((stake + estimatedProfit).toFixed(6));
    const minPayout = Number(stake.toFixed(6));
    const liquidityWarning = liquidityOpposite <= 0
      ? 'No opposite liquidity yet. If this side wins without counter-liquidity, stake is refunded.'
      : '';
    const positionStatus = this.isFutureRound(view) ? 'scheduled' : 'open';
    return {
      ok: true,
      market: view,
      side: params.side,
      stake,
      price,
      shares,
      potentialPayout,
      estimatedPayout,
      minPayout,
      liquidityOpposite: Number(liquidityOpposite.toFixed(6)),
      liquiditySameSide: Number(liquiditySameSide.toFixed(6)),
      liquidityWarning,
      positionStatus
    };
  }

  async openPosition(params: {
    playerId: string;
    walletId: string;
    marketId: string;
    side: 'yes' | 'no';
    stake: number;
    stationId?: string;
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

    const openPositions = (await this.db.listPlayerMarketPositions(params.playerId, 200)).filter((p) => p.status === 'open' || p.status === 'scheduled');
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
      status: quote.positionStatus || 'open',
      escrowBetId,
      estimatedPayoutAtOpen: quote.estimatedPayout ?? quote.potentialPayout ?? null,
      minPayoutAtOpen: quote.minPayout ?? quote.stake ?? null
    });

    if (params.stationId) {
      await this.trackInteractionEvent({
        playerId: params.playerId,
        stationId: params.stationId,
        marketId: quote.market.id,
        eventType: quote.positionStatus === 'scheduled' ? 'prediction_commit_scheduled' : 'prediction_commit_filled',
        side: params.side,
        stake: quote.stake,
        oppositeLiquidityAtCommit: quote.liquidityOpposite ?? null,
        closeAt: quote.market.closeAt,
        metaJson: {
          positionStatus: quote.positionStatus || 'open',
          currentSpotPrice: quote.market.currentSpotPrice ?? null,
          lockPrice: quote.market.lockPrice ?? null,
          estimatedPayout: quote.estimatedPayout ?? null,
          minPayout: quote.minPayout ?? null,
          price: quote.price,
          shares: quote.shares
        }
      });
    }

    metrics.incrementCounter(METRIC_NAMES.marketOrdersTotal, { side: params.side, market: quote.market.id });

    const created = (await this.db.listPlayerMarketPositions(params.playerId, 10)).find((p) => p.id === positionId) || null;
    if (!created) {
      return { ok: false, reason: 'position_create_failed', reasonText: 'Position write failed.' };
    }

    // Fire-and-forget hedge on Polymarket CLOB — never blocks or fails the player response
    if (this.clobClient && quote.market?.oracleMarketId && quote.positionStatus !== 'scheduled') {
      const conditionId = quote.market.oracleMarketId;
      const createdId   = created.id;
      this.clobClient
        .placeHedge(conditionId, params.side, quote.stake)
        .then(({ orderId }) => this.db.setPositionClobOrder(createdId, orderId))
        .catch((err: unknown) => log.warn({ err, positionId: createdId }, 'clob hedge failed (non-fatal)'));
    }

    return { ok: true, position: created, quote };
  }

  async listPlayerPositions(playerId: string): Promise<MarketPositionRecord[]> {
    await this.ensureAtLeastOneActiveMarket();
    return this.db.listPlayerMarketPositions(playerId, 120);
  }

  async settleResolvedMarkets(): Promise<{ checked: number; settled: number; failed: number }> {
    await this.ensureAtLeastOneActiveMarket();
    const [openPositions, markets] = await Promise.all([
      this.db.listActiveMarketPositions(2000),
      this.db.listMarkets(500)
    ]);
    const marketById = new Map(markets.map((m) => [m.id, m]));

    let settled = 0;
    let failed = 0;

    const positionsByMarket = new Map<string, MarketPositionRecord[]>();
    for (const position of openPositions) {
      const rows = positionsByMarket.get(position.marketId) || [];
      rows.push(position);
      positionsByMarket.set(position.marketId, rows);
    }

    for (const [marketId, rows] of positionsByMarket.entries()) {
      const market = marketById.get(marketId);
      if (!market) continue;
      if (market.status !== 'resolved' && market.status !== 'cancelled') continue;

      const yesPool = rows.filter((p) => p.side === 'yes').reduce((sum, p) => sum + Number(p.stake || 0), 0);
      const noPool = rows.filter((p) => p.side === 'no').reduce((sum, p) => sum + Number(p.stake || 0), 0);
      const losingPool = market.outcome === 'yes' ? noPool : market.outcome === 'no' ? yesPool : 0;
      const winningPool = market.outcome === 'yes' ? yesPool : market.outcome === 'no' ? noPool : 0;

      for (const position of rows) {
        const isCancelled = market.status === 'cancelled' || !market.outcome;
        const isWinner = !isCancelled && position.side === market.outcome;
        const noOppositeLiquidity = !isCancelled && losingPool <= 0;
        const insufficientOppositeLiquidity = !isCancelled && losingPool > 0 && losingPool < winningPool;
        let finalStatus: 'won' | 'lost' | 'voided' = 'voided';
        let settlementReason = 'voided';
        let payout: number | null = null;

        if (isCancelled) {
          const refunded = await this.escrowAdapter.refund(position.escrowBetId);
          if (!refunded.ok) {
            failed += 1;
            metrics.incrementCounter(METRIC_NAMES.marketSettlementFailureTotal, { market: market.id, status: 'voided' });
            continue;
          }
          finalStatus = 'voided';
          settlementReason = 'voided';
          payout = Number(position.stake || 0);
        } else if (isWinner && noOppositeLiquidity) {
          // No losing-side liquidity at all — refund the winner's stake
          const refunded = await this.escrowAdapter.refund(position.escrowBetId);
          if (!refunded.ok) {
            failed += 1;
            metrics.incrementCounter(METRIC_NAMES.marketSettlementFailureTotal, { market: market.id, status: 'won' });
            continue;
          }
          finalStatus = 'won';
          settlementReason = 'won_refund_only';
          payout = Number(position.stake || 0);
        } else if (isWinner && insufficientOppositeLiquidity) {
          // Partial losing-side liquidity — pay out stake + proportional share of the losing pool
          const winnerWalletId = position.walletId;
          if (!winnerWalletId) {
            failed += 1;
            continue;
          }
          const resolved = await this.escrowAdapter.resolve({
            challengeId: position.escrowBetId,
            winnerWalletId
          });
          if (!resolved.ok) {
            failed += 1;
            metrics.incrementCounter(METRIC_NAMES.marketSettlementFailureTotal, { market: market.id, status: 'won' });
            continue;
          }
          const stake = Number(position.stake || 0);
          const share = winningPool > 0 ? stake / winningPool : 0;
          const partialWinnings = losingPool * share;
          finalStatus = 'won';
          settlementReason = 'won_partial_liquidity';
          payout = Number(resolved.payout ?? (stake + partialWinnings));
        } else {
          const winnerWalletId = isWinner ? position.walletId : this.getHouseWalletId();
          if (!winnerWalletId) {
            failed += 1;
            continue;
          }
          const resolved = await this.escrowAdapter.resolve({
            challengeId: position.escrowBetId,
            winnerWalletId
          });
          if (!resolved.ok) {
            failed += 1;
            metrics.incrementCounter(METRIC_NAMES.marketSettlementFailureTotal, { market: market.id, status: isWinner ? 'won' : 'lost' });
            continue;
          }
          finalStatus = isWinner ? 'won' : 'lost';
          settlementReason = isWinner ? 'won_profit' : 'lost';
          payout = isWinner ? Number(resolved.payout ?? this.payoutFor(position.stake, position.price)) : 0;
        }

        await this.db.settleMarketPosition({
          positionId: position.id,
          status: finalStatus,
          payout,
          settlementReason
        });
        settled += 1;
        metrics.incrementCounter(METRIC_NAMES.marketSettlementSuccessTotal, { market: market.id, status: finalStatus });
        await this.trackInteractionEvent({
          playerId: position.playerId,
          stationId: 'settlement_worker',
          marketId: position.marketId,
          eventType: finalStatus === 'voided'
            ? 'prediction_settlement_voided'
            : (finalStatus === 'lost'
                ? 'prediction_settlement_lost'
                : (settlementReason === 'won_refund_only' ? 'prediction_settlement_won_refund_only' : 'prediction_settlement_won_profit')),
          side: position.side,
          stake: position.stake,
          closeAt: market.closeAt,
          reason: settlementReason,
          metaJson: { payout, marketOutcome: market.outcome, yesPool, noPool }
        });
      }
    }

    return { checked: openPositions.length, settled, failed };
  }

  async recordPredictionEvent(params: {
    playerId: string;
    stationId: string;
    marketId?: string | null;
    eventType: string;
    side?: 'yes' | 'no' | null;
    stake?: number | null;
    oppositeLiquidityAtCommit?: number | null;
    closeAt?: number | null;
    reason?: string | null;
    reasonCode?: string | null;
    metaJson?: Record<string, unknown> | null;
  }): Promise<void> {
    await this.trackInteractionEvent(params);
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
  estimatedPayout: number;
  minPayout: number;
  payout: number;
  settlementReason: string | null;
  liquidityFloor: number;
  status: 'scheduled' | 'open' | 'won' | 'lost' | 'voided';
  createdAt: number;
  settledAt: number | null;
  roundType?: 'current' | 'next';
  currentSpotPrice?: number | null;
  lockPrice?: number | null;
  finalPrice?: number | null;
} {
  const { position, market } = input;
  const raw = (market?.rawJson || {}) as Record<string, unknown>;
  const slotStart = Number(raw.slotStart ?? Number.NaN);
  const potentialPayout = Number((position.stake / Math.max(0.01, position.price)).toFixed(6));
  const estimatedPayout = position.estimatedPayoutAtOpen ?? potentialPayout;
  const minPayout = position.minPayoutAtOpen ?? Number(position.stake.toFixed(6));
  return {
    positionId: position.id,
    marketId: position.marketId,
    question: market?.question || position.marketId,
    side: position.side,
    stake: position.stake,
    price: position.price,
    shares: position.shares,
    potentialPayout,
    estimatedPayout,
    minPayout,
    payout: position.payout ?? 0,
    settlementReason: position.settlementReason,
    liquidityFloor: minPayout,
    status: position.status,
    createdAt: position.createdAt,
    settledAt: position.settledAt,
    roundType: Number.isFinite(slotStart) && slotStart > Date.now() ? 'next' : 'current',
    currentSpotPrice: raw.currentSpotPrice != null ? Number(raw.currentSpotPrice) : null,
    lockPrice: raw.entryPrice != null ? Number(raw.entryPrice) : null,
    finalPrice: raw.resolvedPrice != null ? Number(raw.resolvedPrice) : null
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
    maxWager: market.maxWager,
    yesLiquidity: market.yesLiquidity ?? 0,
    noLiquidity: market.noLiquidity ?? 0,
    oracleSource: market.oracleSource,
    oracleMarketId: market.oracleMarketId,
    rail: market.rail,
    roundType: market.roundType,
    slotStart: market.slotStart ?? 0,
    slotEnd: market.slotEnd ?? market.closeAt,
    currentSpotPrice: market.currentSpotPrice ?? null,
    currentSpotUpdatedAt: market.currentSpotUpdatedAt ?? null,
    currentSpotRoundId: market.currentSpotRoundId ?? null,
    lockPrice: market.lockPrice ?? null,
    lockPriceUpdatedAt: market.lockPriceUpdatedAt ?? null,
    lockRoundId: market.lockRoundId ?? null,
    finalPrice: market.finalPrice ?? null,
    finalPriceUpdatedAt: market.finalPriceUpdatedAt ?? null,
    finalRoundId: market.finalRoundId ?? null
  };
}
