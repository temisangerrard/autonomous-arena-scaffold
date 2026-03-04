export const dealerPredictionStationPlugin = {
  kind: 'dealer_prediction',
  renderInteractionCard(ctx) {
    return `<div class="station-ui__title">${ctx?.stationName || 'Prediction Dealer'}</div>`;
  },
  onStationUiMessage() {},
  getMobileActions() {
    return ['interact', 'target_next'];
  },
  getDirectioningHints(ctx) {
    if (!ctx?.distance) return null;
    return {
      title: `Go to ${ctx.stationName || 'Prediction Dealer'}`,
      subtitle: `${ctx.distance.toFixed(1)}m away`
    };
  }
};
