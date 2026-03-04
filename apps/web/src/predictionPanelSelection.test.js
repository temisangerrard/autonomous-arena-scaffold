import { describe, expect, it } from 'vitest';
import { resolvePlayablePredictionSelection } from '../public/js/play/runtime/templates/interaction-card/prediction-panel.js';

function market(overrides = {}) {
  return {
    marketId: 'cl_btc_24h_current',
    slug: 'btc-up-24h-current',
    question: 'Will BTC/USD be higher in 24 hours?',
    category: 'chainlink_btc',
    closeAt: Date.now() + 60 * 60_000,
    resolveAt: Date.now() + 60 * 60_000,
    status: 'open',
    outcome: null,
    yesPrice: 0.5,
    noPrice: 0.5,
    maxWager: 100,
    yesLiquidity: 0,
    noLiquidity: 0,
    oracleSource: 'chainlink_btc_usd',
    oracleMarketId: 'chainlink:24h:current',
    rail: 'btc_24h',
    roundType: 'current',
    slotStart: Date.now() - 60_000,
    slotEnd: Date.now() + 60 * 60_000,
    currentSpotPrice: 100000,
    currentSpotUpdatedAt: Date.now(),
    currentSpotRoundId: '123',
    lockPrice: 99500,
    lockPriceUpdatedAt: Date.now() - 60_000,
    lockRoundId: '122',
    finalPrice: null,
    finalPriceUpdatedAt: null,
    finalRoundId: null,
    ...overrides
  };
}

describe('resolvePlayablePredictionSelection', () => {
  it('falls back to the available rail when the stored rail has no live market', () => {
    const selection = resolvePlayablePredictionSelection({
      markets: [market()],
      selectedRail: 'btc_5m',
      selectedRound: 'current',
      selectedMarketId: ''
    });

    expect(selection.selectedRail).toBe('btc_24h');
    expect(selection.selectedRound).toBe('current');
    expect(selection.selectedMarketId).toBe('cl_btc_24h_current');
    expect(selection.selected?.marketId).toBe('cl_btc_24h_current');
  });
});
