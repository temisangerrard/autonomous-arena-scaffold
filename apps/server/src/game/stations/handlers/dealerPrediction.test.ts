import { describe, expect, it, vi } from 'vitest';
import { handlePredictionStationAction } from './dealerPrediction.js';

describe('handlePredictionStationAction', () => {
  const station = {
    id: 'station_prediction_1',
    kind: 'dealer_prediction',
    displayName: 'BTC Board',
    x: 0,
    z: 0
  } as const;

  it('returns prediction_error when marketService is null', async () => {
    const sent: object[] = [];
    await handlePredictionStationAction({
      playerId: 'p1',
      station,
      payload: { action: 'prediction_markets_open' },
      marketService: null,
      walletIdFor: () => 'w1',
      sendTo: (_, payload) => sent.push(payload)
    });

    expect(sent).toHaveLength(1);
    const view = (sent[0] as { view?: object }).view;
    expect(view).toMatchObject({
      ok: false,
      state: 'prediction_error',
      reason: 'prediction_disabled',
      reasonCode: 'PREDICTION_SERVICE_UNAVAILABLE'
    });
  });

  it('returns prediction_list with markets when prediction_markets_open succeeds', async () => {
    const now = Date.now();
    const mockMarkets = [
      {
        id: 'cl_btc_5m_1',
        slug: 'btc-up-5m-1',
        question: 'Will BTC/USD be higher in 5 minutes?',
        closeAt: now + 5 * 60_000,
        status: 'open',
        oracleSource: 'chainlink_btc_usd',
        rail: 'btc_5m',
        roundType: 'current' as const
      }
    ];
    const marketService = {
      recordPredictionEvent: vi.fn().mockResolvedValue(undefined),
      listActiveMarketsForPlayer: vi.fn().mockResolvedValue(mockMarkets)
    };

    const sent: object[] = [];
    await handlePredictionStationAction({
      playerId: 'p1',
      station,
      payload: { action: 'prediction_markets_open' },
      marketService: marketService as never,
      walletIdFor: () => 'w1',
      sendTo: (_, payload) => sent.push(payload)
    });

    expect(sent).toHaveLength(1);
    const { type, stationId, view } = sent[0] as { type: string; stationId: string; view: object };
    expect(type).toBe('station_ui');
    expect(stationId).toBe(station.id);
    expect(view).toMatchObject({
      ok: true,
      state: 'prediction_list',
      stationId: station.id
    });
    const markets = (view as { markets?: unknown[] }).markets;
    expect(Array.isArray(markets)).toBe(true);
    expect(markets).toHaveLength(1);
    expect(markets![0]).toMatchObject({
      marketId: 'cl_btc_5m_1',
      question: 'Will BTC/USD be higher in 5 minutes?',
      oracleSource: 'chainlink_btc_usd',
      rail: 'btc_5m',
      roundType: 'current'
    });
  });

  it('returns prediction_list with empty markets when service returns none', async () => {
    const marketService = {
      recordPredictionEvent: vi.fn().mockResolvedValue(undefined),
      listActiveMarketsForPlayer: vi.fn().mockResolvedValue([])
    };

    const sent: object[] = [];
    await handlePredictionStationAction({
      playerId: 'p1',
      station,
      payload: { action: 'prediction_markets_open' },
      marketService: marketService as never,
      walletIdFor: () => 'w1',
      sendTo: (_, payload) => sent.push(payload)
    });

    const view = (sent[0] as { view?: object }).view;
    expect(view).toMatchObject({ ok: true, state: 'prediction_list' });
    expect((view as { markets?: unknown[] }).markets).toEqual([]);
  });
});
