export const dealerStationPlugin = {
  kind: 'dealer_coinflip',
  renderInteractionCard(ctx) {
    return `<div class="station-ui__title">${ctx?.stationName || 'Dealer'}</div>`;
  },
  onStationUiMessage() {},
  getMobileActions() {
    return ['interact', 'target_next', 'challenge'];
  },
  getDirectioningHints(ctx) {
    if (!ctx?.distance) return null;
    return {
      title: `Go to ${ctx.stationName || 'Dealer'}`,
      subtitle: `${ctx.distance.toFixed(1)}m away`
    };
  }
};
