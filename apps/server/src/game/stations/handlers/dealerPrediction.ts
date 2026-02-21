import type { SnapshotStation, StationUiView } from '@arena/shared';
import type { MarketService } from '../../../markets/MarketService.js';
import { toMarketView, toPredictionViewPosition } from '../../../markets/MarketService.js';

type PredictionPayload =
  | { action: 'prediction_markets_open' }
  | { action: 'prediction_positions_open' }
  | { action: 'prediction_market_quote'; marketId: string; side: 'yes' | 'no'; stake: number }
  | { action: 'prediction_market_buy_yes' | 'prediction_market_buy_no'; marketId: string; stake: number };

function toPredictionError(input: {
  reason?: string;
  reasonCode?: string;
  reasonText?: string;
}): StationUiView {
  return {
    ok: false,
    state: 'prediction_error',
    reason: input.reason || 'prediction_request_failed',
    reasonCode: input.reasonCode,
    reasonText: input.reasonText
  };
}

export async function handlePredictionStationAction(params: {
  playerId: string;
  station: SnapshotStation;
  payload: PredictionPayload;
  marketService: MarketService | null;
  walletIdFor: (playerId: string) => string | null;
  sendTo: (playerId: string, payload: object) => void;
}): Promise<void> {
  const { playerId, station, payload, marketService, walletIdFor, sendTo } = params;
  const respond = (view: StationUiView) => {
    sendTo(playerId, {
      type: 'station_ui',
      stationId: station.id,
      view
    });
  };

  if (!marketService) {
    respond(
      toPredictionError({
        reason: 'prediction_disabled',
        reasonCode: 'PREDICTION_SERVICE_UNAVAILABLE',
        reasonText: 'Prediction markets are currently unavailable.'
      })
    );
    return;
  }

  if (payload.action === 'prediction_markets_open') {
    await marketService.recordPredictionEvent({
      playerId,
      stationId: station.id,
      eventType: 'prediction_markets_open'
    });
    const markets = await marketService.listActiveMarketsForPlayer();
    respond({
      ok: true,
      state: 'prediction_list',
      stationId: station.id,
      markets: markets.map((entry) => toMarketView(entry))
    });
    return;
  }

  if (payload.action === 'prediction_positions_open') {
    await marketService.recordPredictionEvent({
      playerId,
      stationId: station.id,
      eventType: 'prediction_positions_open'
    });
    const [positions, marketState] = await Promise.all([
      marketService.listPlayerPositions(playerId),
      marketService.getAdminState()
    ]);
    const marketById = new Map(marketState.markets.map((entry) => [entry.id, entry]));
    respond({
      ok: true,
      state: 'prediction_positions',
      stationId: station.id,
      positions: positions.map((position) =>
        toPredictionViewPosition({
          position,
          market: marketById.get(position.marketId) || null
        })
      )
    });
    return;
  }

  if (payload.action === 'prediction_market_quote') {
    await marketService.recordPredictionEvent({
      playerId,
      stationId: station.id,
      marketId: payload.marketId,
      eventType: 'prediction_quote_requested',
      side: payload.side,
      stake: payload.stake
    });
    const quoted = await marketService.quote({
      marketId: payload.marketId,
      side: payload.side,
      stake: payload.stake
    });
    if (!quoted.ok || !quoted.market) {
      await marketService.recordPredictionEvent({
        playerId,
        stationId: station.id,
        marketId: payload.marketId,
        eventType: 'prediction_quote_failed',
        side: payload.side,
        stake: payload.stake,
        reason: quoted.reason,
        reasonCode: quoted.reasonCode
      });
      respond(
        toPredictionError({
          reason: quoted.reason,
          reasonCode: quoted.reasonCode,
          reasonText: quoted.reasonText || 'Unable to quote market right now.'
        })
      );
      return;
    }
    respond({
      ok: true,
      state: 'prediction_quote',
      stationId: station.id,
      marketId: quoted.market.id,
      side: quoted.side,
      price: quoted.price,
      shares: quoted.shares,
      potentialPayout: quoted.potentialPayout,
      estimatedPayout: quoted.estimatedPayout,
      minPayout: quoted.minPayout,
      liquidityOpposite: quoted.liquidityOpposite,
      liquiditySameSide: quoted.liquiditySameSide,
      liquidityWarning: quoted.liquidityWarning,
      markets: [toMarketView(quoted.market)]
    });
    await marketService.recordPredictionEvent({
      playerId,
      stationId: station.id,
      marketId: quoted.market.id,
      eventType: 'prediction_quote_returned',
      side: payload.side,
      stake: quoted.stake,
      oppositeLiquidityAtCommit: quoted.liquidityOpposite ?? null,
      closeAt: quoted.market.closeAt,
      metaJson: {
        estimatedPayout: quoted.estimatedPayout ?? null,
        minPayout: quoted.minPayout ?? null
      }
    });
    return;
  }

  const walletId = walletIdFor(playerId);
  if (!walletId) {
    respond(
      toPredictionError({
        reason: 'wallet_required',
        reasonCode: 'PLAYER_SIGNER_UNAVAILABLE',
        reasonText: 'Connect wallet to place a market order.'
      })
    );
    return;
  }

  const side = payload.action === 'prediction_market_buy_yes' ? 'yes' : 'no';
  await marketService.recordPredictionEvent({
    playerId,
    stationId: station.id,
    marketId: payload.marketId,
    eventType: 'prediction_commit_requested',
    side,
    stake: payload.stake
  });
  respond({
    ok: true,
    state: 'prediction_order_pending',
    stationId: station.id,
    marketId: payload.marketId,
    side
  });

  const opened = await marketService.openPosition({
    playerId,
    walletId,
    marketId: payload.marketId,
    side,
    stake: payload.stake,
    stationId: station.id
  });
  if (!opened.ok || !opened.position || !opened.quote?.market) {
    await marketService.recordPredictionEvent({
      playerId,
      stationId: station.id,
      marketId: payload.marketId,
      eventType: 'prediction_commit_failed',
      side,
      stake: payload.stake,
      reason: opened.reason,
      reasonCode: opened.reasonCode
    });
    respond(
      toPredictionError({
        reason: opened.reason,
        reasonCode: opened.reasonCode,
        reasonText: opened.reasonText || 'Failed to place market order.'
      })
    );
    return;
  }

  respond({
    ok: true,
    state: 'prediction_order_filled',
    stationId: station.id,
    marketId: opened.position.marketId,
    side: opened.position.side,
    price: opened.position.price,
    shares: opened.position.shares,
    potentialPayout: Number((opened.position.stake / Math.max(0.01, opened.position.price)).toFixed(6)),
    estimatedPayout: opened.quote.estimatedPayout,
    minPayout: opened.quote.minPayout,
    liquidityOpposite: opened.quote.liquidityOpposite,
    liquiditySameSide: opened.quote.liquiditySameSide,
    liquidityWarning: opened.quote.liquidityWarning,
    positionStatus: opened.position.status,
    markets: [toMarketView(opened.quote.market)],
    positions: [
      toPredictionViewPosition({
        position: opened.position,
        market: opened.quote.market
      })
    ]
  });
}
