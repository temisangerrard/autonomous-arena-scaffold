export const dealerRpsStationPlugin = {
  kind: 'dealer_rps',
  renderInteractionCard(ctx) {
    return `<div class="station-ui__title">${ctx?.stationName || 'RPS Dealer'}</div>`;
  },
  onStationUiMessage() {},
  getMobileActions() {
    return ['interact', 'target_next', 'challenge'];
  },
  getDirectioningHints(ctx) {
    if (!ctx?.distance) return null;
    return {
      title: `Go to ${ctx.stationName || 'RPS Dealer'}`,
      subtitle: `${ctx.distance.toFixed(1)}m away`
    };
  }
};
