export const dealerDiceDuelStationPlugin = {
  kind: 'dealer_dice_duel',
  renderInteractionCard(ctx) {
    return `<div class="station-ui__title">${ctx?.stationName || 'Dice Dealer'}</div>`;
  },
  onStationUiMessage() {},
  getMobileActions() {
    return ['interact', 'target_next', 'challenge'];
  },
  getDirectioningHints(ctx) {
    if (!ctx?.distance) return null;
    return {
      title: `Go to ${ctx.stationName || 'Dice Dealer'}`,
      subtitle: `${ctx.distance.toFixed(1)}m away`
    };
  }
};
