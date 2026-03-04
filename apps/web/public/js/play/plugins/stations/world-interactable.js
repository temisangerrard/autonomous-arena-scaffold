export const worldInteractableStationPlugin = {
  kind: 'world_interactable',
  renderInteractionCard(ctx) {
    return `<div class="station-ui__title">${ctx?.stationName || 'World Object'}</div>`;
  },
  onStationUiMessage() {},
  getMobileActions() {
    return ['interact', 'target_next'];
  },
  getDirectioningHints(ctx) {
    if (!ctx?.distance) return null;
    return {
      title: `Go to ${ctx.stationName || 'World Object'}`,
      subtitle: `${ctx.distance.toFixed(1)}m away`
    };
  }
};
