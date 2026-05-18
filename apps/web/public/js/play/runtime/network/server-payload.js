export function applyServerPayload(params) {
  const {
    payload,
    state,
    showToast,
    dealerReasonLabel,
    resolveIncomingStationId
  } = params;

  if (!payload || payload.type !== 'station_ui' || typeof payload.stationId !== 'string') {
    return false;
  }

  const localStationId = resolveIncomingStationId(payload.stationId);
  const view = payload.view || {};
  const ok = Boolean(view.ok);
  const reason = String(view.reason || '');
  const reasonCode = String(view.reasonCode || '');
  const reasonText = String(view.reasonText || '');
  const stateName = String(view.state || '');
  const station = state.stations instanceof Map ? state.stations.get(localStationId) : null;

  if (station?.kind === 'dealer_prediction' || stateName.startsWith('prediction_')) {
    const prediction = state.ui.prediction || (state.ui.prediction = {
      stationId: '',
      state: 'idle',
      markets: [],
      positions: [],
      selectedRail: 'btc_5m',
      selectedRound: 'current',
      selectedMarketId: '',
      positionStatus: '',
      lastReason: '',
      lastReasonText: ''
    });
    prediction.stationId = localStationId || payload.stationId;
    if (!ok) {
      const resolvedReasonText = reasonText || dealerReasonLabel(reason, reasonCode) || 'Prediction request failed. Please retry.';
      prediction.state = 'error';
      prediction.lastReason = reason || 'prediction_request_failed';
      prediction.lastReasonText = resolvedReasonText;
      showToast(resolvedReasonText, 'warning');
      return true;
    }
    if (stateName === 'prediction_list') {
      prediction.state = 'list';
      prediction.markets = Array.isArray(view.markets) ? view.markets : [];
      if (!prediction.selectedMarketId && prediction.markets[0]?.marketId) {
        prediction.selectedMarketId = String(prediction.markets[0].marketId);
      }
      prediction.lastReason = '';
      prediction.lastReasonText = '';
      return true;
    }
    if (stateName === 'prediction_order_pending') {
      prediction.state = 'pending';
      prediction.selectedMarketId = String(view.marketId || prediction.selectedMarketId || '');
      return true;
    }
    if (stateName === 'prediction_order_filled') {
      prediction.state = 'filled';
      prediction.selectedMarketId = String(view.marketId || prediction.selectedMarketId || '');
      prediction.positions = Array.isArray(view.positions) ? view.positions : prediction.positions;
      return true;
    }
  }

  state.ui.dealer.stationId = localStationId || payload.stationId;
  state.ui.dealer.state = stateName || (ok ? 'dealer_ready' : 'dealer_error');
  state.ui.dealer.gameType = String(view.gameType || state.ui.dealer.gameType || '');
  state.ui.dealer.commitHash = String(view.commitHash || '');
  state.ui.dealer.method = String(view.method || '');
  state.ui.dealer.challengeId = String(view.challengeId || '');
  state.ui.dealer.playerPick = String(view.playerPick || '');
  state.ui.dealer.opponentPick = String(view.opponentPick || '');
  state.ui.dealer.coinflipResult = String(view.coinflipResult || '');
  state.ui.dealer.diceResult = Number(view.diceResult || 0);
  state.ui.dealer.payoutDelta = Number(view.payoutDelta || 0);
  state.ui.dealer.escrowTx = view.escrowTx || null;
  state.ui.dealer.reason = reason;
  state.ui.dealer.reasonCode = reasonCode;
  state.ui.dealer.reasonText = reasonText;
  state.ui.dealer.preflight = view.preflight || null;
  state.ui.dealer.playerHand = Array.isArray(view.playerHand) ? view.playerHand : [];
  state.ui.dealer.dealerHand = Array.isArray(view.dealerHand) ? view.dealerHand : [];
  state.ui.dealer.playerHandValue = Number(view.playerHandValue || 0);
  state.ui.dealer.dealerHandValue = Number(view.dealerHandValue || 0);
  state.ui.dealer.dealerShowValue = Number(view.dealerShowValue || 0);
  state.ui.dealer.isSoft = Boolean(view.isSoft);

  if (!ok) {
    showToast(reasonText || dealerReasonLabel(reason, reasonCode) || 'Dealer request failed.', 'warning');
  }
  return true;
}
