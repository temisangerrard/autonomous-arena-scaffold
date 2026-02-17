export const cashierStationPlugin = {
  kind: 'cashier_bank',
  renderInteractionCard() {
    return '<div class="station-ui__title">Cashier</div>';
  },
  onStationUiMessage() {},
  getMobileActions() {
    return ['interact', 'target_next'];
  },
  getDirectioningHints(ctx) {
    if (!ctx?.distance) return null;
    return {
      title: 'Go to Cashier',
      subtitle: `${ctx.distance.toFixed(1)}m away`
    };
  }
};
