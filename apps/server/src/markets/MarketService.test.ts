import { describe, expect, it } from 'vitest';
import type { MarketActivationRecord, MarketRecord } from '../Database.js';
import { MarketService } from './MarketService.js';

function buildServiceState(input?: {
  markets?: MarketRecord[];
  activations?: MarketActivationRecord[];
}) {
  const markets = [...(input?.markets || [])];
  const activations = new Map((input?.activations || []).map((entry) => [entry.marketId, entry]));
  const now = Date.now();
  let upsertCount = 0;

  const db = {
    async listMarkets() {
      return [...markets];
    },
    async listOpenMarketPositions() {
      return [];
    },
    async insertMarketInteractionEvent() {
      return;
    },
    async listMarketInteractionCounts() {
      return [];
    },
    async listMarketActivations() {
      return [...activations.values()];
    },
    async setMarketActivation(params: {
      marketId: string;
      active: boolean;
      maxWager: number;
      houseSpreadBps: number;
      updatedBy?: string | null;
    }) {
      activations.set(params.marketId, {
        marketId: params.marketId,
        active: params.active,
        maxWager: params.maxWager,
        houseSpreadBps: params.houseSpreadBps,
        updatedBy: params.updatedBy ?? null,
        updatedAt: Date.now()
      });
    },
    async upsertMarket(params: {
      id: string;
      slug: string;
      question: string;
      category: string;
      closeAt: number;
      resolveAt: number | null;
      status: 'open' | 'closed' | 'resolved' | 'cancelled';
      oracleSource: string;
      oracleMarketId: string;
      outcome: 'yes' | 'no' | null;
      yesPrice: number;
      noPrice: number;
      rawJson: unknown;
    }) {
      upsertCount += 1;
      const idx = markets.findIndex((entry) => entry.id === params.id);
      const record: MarketRecord = {
        id: params.id,
        slug: params.slug,
        question: params.question,
        category: params.category,
        closeAt: params.closeAt,
        resolveAt: params.resolveAt,
        status: params.status,
        oracleSource: params.oracleSource,
        oracleMarketId: params.oracleMarketId,
        outcome: params.outcome,
        yesPrice: params.yesPrice,
        noPrice: params.noPrice,
        rawJson: (params.rawJson as Record<string, unknown>) || null
      };
      if (idx >= 0) markets[idx] = record;
      else markets.push(record);
    },
    async getMarketById(marketId: string) {
      return markets.find((entry) => entry.id === marketId) || null;
    }
  };

  return {
    now,
    db,
    getUpsertCount: () => upsertCount
  };
}

describe('MarketService active market guarantee', () => {
  it('fetches live oracle markets before fallback and activates BTC market', async () => {
    const now = Date.now();
    const state = buildServiceState({ markets: [] });
    const feed = {
      async fetchMarkets() {
        return [
          {
            id: 'poly_weather_1',
            slug: 'will-nyc-rain-this-week',
            question: 'Will NYC get rain this week?',
            category: 'weather',
            closeAt: now + 60 * 60_000,
            resolveAt: null,
            status: 'open' as const,
            outcome: null,
            yesPrice: 0.5,
            noPrice: 0.5,
            oracleMarketId: 'weather_1',
            raw: {}
          },
          {
            id: 'poly_btc_live_1',
            slug: 'will-bitcoin-close-above-100k',
            question: 'Will Bitcoin close above $100k?',
            category: 'crypto',
            closeAt: now + 90 * 60_000,
            resolveAt: null,
            status: 'open' as const,
            outcome: null,
            yesPrice: 0.52,
            noPrice: 0.48,
            oracleMarketId: 'btc_1',
            raw: {}
          }
        ];
      }
    };
    const service = new MarketService(state.db as never, {} as never, feed as never, () => 'house_wallet');

    const markets = await service.listActiveMarketsForPlayer();

    expect(markets.length).toBe(1);
    expect(markets[0]?.id).toBe('poly_btc_live_1');
    expect(state.getUpsertCount()).toBeGreaterThan(0);
  });

  it('prefers BTC markets when auto-activating', async () => {
    const now = Date.now();
    const state = buildServiceState({
      markets: [
        {
          id: 'poly_weather_1',
          slug: 'will-nyc-rain-this-week',
          question: 'Will NYC get rain this week?',
          category: 'weather',
          closeAt: now + 30 * 60_000,
          resolveAt: null,
          status: 'open',
          oracleSource: 'polymarket_gamma',
          oracleMarketId: 'poly_weather_1',
          outcome: null,
          yesPrice: 0.4,
          noPrice: 0.6
        },
        {
          id: 'poly_btc_1',
          slug: 'will-bitcoin-be-above-100k-tomorrow',
          question: 'Will Bitcoin be above $100k tomorrow?',
          category: 'crypto',
          closeAt: now + 60 * 60_000,
          resolveAt: null,
          status: 'open',
          oracleSource: 'polymarket_gamma',
          oracleMarketId: 'poly_btc_1',
          outcome: null,
          yesPrice: 0.5,
          noPrice: 0.5
        }
      ]
    });
    const service = new MarketService(state.db as never, {} as never, {} as never, () => 'house_wallet');

    const markets = await service.listActiveMarketsForPlayer();

    expect(markets.length).toBe(1);
    expect(markets[0]?.id).toBe('poly_btc_1');
    expect(markets[0]?.active).toBe(true);
  });

  it('activates an existing open market when none are active', async () => {
    const now = Date.now();
    const state = buildServiceState({
      markets: [
        {
          id: 'poly_open_1',
          slug: 'will-btc-close-higher-today',
          question: 'Will BTC close higher today?',
          category: 'crypto',
          closeAt: now + 30 * 60_000,
          resolveAt: null,
          status: 'open',
          oracleSource: 'polymarket_gamma',
          oracleMarketId: 'poly_1',
          outcome: null,
          yesPrice: 0.52,
          noPrice: 0.48
        }
      ]
    });
    const service = new MarketService(state.db as never, {} as never, {} as never, () => 'house_wallet');

    const markets = await service.listActiveMarketsForPlayer();

    expect(markets.length).toBeGreaterThan(0);
    expect(markets[0]?.id).toBe('poly_open_1');
    expect(markets[0]?.active).toBe(true);
    expect(state.getUpsertCount()).toBe(0);
  });

  it('creates a fallback market when there are no playable markets', async () => {
    const serviceState = buildServiceState({
      markets: []
    });
    const service = new MarketService(serviceState.db as never, {} as never, {} as never, () => 'house_wallet');

    const markets = await service.listActiveMarketsForPlayer();

    expect(markets.length).toBeGreaterThan(0);
    expect(markets[0]?.id).toBe('fallback_train_world_market');
    expect(markets[0]?.active).toBe(true);
    expect(serviceState.getUpsertCount()).toBe(1);
  });
});

describe('MarketService settlement liquidity behavior', () => {
  it('refunds winning positions when no opposite liquidity exists', async () => {
    const now = Date.now();
    const settled: Array<{ positionId: string; status: string; payout?: number | null; settlementReason?: string | null }> = [];
    const db = {
      async listOpenMarketPositions() {
        return [
          {
            id: 'pos_1',
            marketId: 'm_1',
            playerId: 'p_1',
            walletId: 'w_1',
            side: 'yes' as const,
            stake: 10,
            price: 0.5,
            shares: 20,
            status: 'open' as const,
            escrowBetId: 'bet_1',
            estimatedPayoutAtOpen: 10,
            minPayoutAtOpen: 10,
            payout: null,
            settlementReason: null,
            createdAt: now,
            settledAt: null
          }
        ];
      },
      async listMarkets() {
        return [
          {
            id: 'm_1',
            slug: 'm_1',
            question: 'Will X happen?',
            category: 'test',
            closeAt: now - 1000,
            resolveAt: now,
            status: 'resolved' as const,
            oracleSource: 'polymarket_gamma',
            oracleMarketId: 'm_1',
            outcome: 'yes' as const,
            yesPrice: 0.5,
            noPrice: 0.5
          }
        ];
      },
      async settleMarketPosition(params: { positionId: string; status: string; payout?: number | null; settlementReason?: string | null }) {
        settled.push(params);
      },
      async insertMarketInteractionEvent() {
        return;
      }
    };
    const escrow = {
      async refund() {
        return { ok: true };
      },
      async resolve() {
        return { ok: false };
      }
    };
    const service = new MarketService(db as never, escrow as never, {} as never, () => 'house_wallet');

    const result = await service.settleResolvedMarkets();

    expect(result.settled).toBe(1);
    expect(settled[0]?.status).toBe('won');
    expect(settled[0]?.settlementReason).toBe('won_refund_only');
    expect(settled[0]?.payout).toBe(10);
  });

  it('voids positions for cancelled markets', async () => {
    const now = Date.now();
    const settled: Array<{ positionId: string; status: string; payout?: number | null; settlementReason?: string | null }> = [];
    const db = {
      async listOpenMarketPositions() {
        return [
          {
            id: 'pos_c_1',
            marketId: 'm_c_1',
            playerId: 'p_2',
            walletId: 'w_2',
            side: 'no' as const,
            stake: 12,
            price: 0.5,
            shares: 24,
            status: 'open' as const,
            escrowBetId: 'bet_c_1',
            estimatedPayoutAtOpen: 12,
            minPayoutAtOpen: 12,
            payout: null,
            settlementReason: null,
            createdAt: now,
            settledAt: null
          }
        ];
      },
      async listMarkets() {
        return [
          {
            id: 'm_c_1',
            slug: 'm_c_1',
            question: 'Cancelled market',
            category: 'test',
            closeAt: now - 1000,
            resolveAt: now,
            status: 'cancelled' as const,
            oracleSource: 'polymarket_gamma',
            oracleMarketId: 'm_c_1',
            outcome: null,
            yesPrice: 0.5,
            noPrice: 0.5
          }
        ];
      },
      async settleMarketPosition(params: { positionId: string; status: string; payout?: number | null; settlementReason?: string | null }) {
        settled.push(params);
      },
      async insertMarketInteractionEvent() {
        return;
      }
    };
    const escrow = {
      async refund() {
        return { ok: true };
      }
    };
    const service = new MarketService(db as never, escrow as never, {} as never, () => 'house_wallet');

    const result = await service.settleResolvedMarkets();

    expect(result.settled).toBe(1);
    expect(settled[0]?.status).toBe('voided');
    expect(settled[0]?.settlementReason).toBe('voided');
    expect(settled[0]?.payout).toBe(12);
  });
});

describe('MarketService Chainlink markets', () => {
  it('creates active BTC chainlink markets for 5m and 24h durations', async () => {
    const state = buildServiceState({ markets: [] });
    const service = new MarketService(state.db as never, {} as never, {} as never, () => 'house_wallet');
    (service as any).latestBtcUsd = async () => ({
      price: 100_000.12,
      updatedAt: Date.now(),
      roundId: '12345'
    });

    const markets = await service.listActiveMarketsForPlayer();
    const chainlinkMarkets = markets.filter((entry) => entry.oracleSource === 'chainlink_btc_usd');

    expect(chainlinkMarkets.length).toBeGreaterThanOrEqual(2);
    expect(chainlinkMarkets.some((entry) => entry.id.includes('cl_btc_5m_'))).toBe(true);
    expect(chainlinkMarkets.some((entry) => entry.id.includes('cl_btc_24h_'))).toBe(true);
    expect(chainlinkMarkets.every((entry) => entry.active)).toBe(true);
  });

  it('resolves expired chainlink markets from latest BTC oracle price', async () => {
    const now = Date.now();
    const state = buildServiceState({
      markets: [
        {
          id: 'cl_btc_5m_1',
          slug: 'btc-up-5m-1',
          question: 'Will BTC/USD be higher in 5 minutes?',
          category: 'chainlink_btc',
          closeAt: now - 10 * 60_000,
          resolveAt: now - 10 * 60_000,
          status: 'open',
          oracleSource: 'chainlink_btc_usd',
          oracleMarketId: 'chainlink:5m:1',
          outcome: null,
          yesPrice: 0.5,
          noPrice: 0.5,
          rawJson: {
            source: 'chainlink_btc_usd',
            durationToken: '5m',
            entryPrice: 90_000
          }
        }
      ],
      activations: [
        {
          marketId: 'cl_btc_5m_1',
          active: true,
          maxWager: 100,
          houseSpreadBps: 300,
          updatedBy: 'test',
          updatedAt: now
        }
      ]
    });
    const service = new MarketService(state.db as never, {} as never, {} as never, () => 'house_wallet');
    (service as any).latestBtcUsd = async () => ({
      price: 95_000,
      updatedAt: now,
      roundId: '12346'
    });

    await service.refreshMarketOutcomes();
    const updated = await (state.db as any).getMarketById('cl_btc_5m_1');

    expect(updated).not.toBeNull();
    expect(updated.status).toBe('resolved');
    expect(updated.outcome).toBe('yes');
    expect(Number(updated.yesPrice)).toBeGreaterThan(Number(updated.noPrice));
  });
});
