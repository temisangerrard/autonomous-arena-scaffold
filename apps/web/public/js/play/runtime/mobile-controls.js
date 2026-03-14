export function isTouchLikeDevice(win = window) {
  return Boolean(
    (typeof win.matchMedia === 'function' && (win.matchMedia('(pointer: coarse)').matches || win.matchMedia('(hover: none)').matches))
    || Number(win.navigator?.maxTouchPoints || 0) > 0
  );
}

export function computeMobileControlVisibility(params) {
  const context = String(params.context || 'idle');
  const dealerState = String(params.dealerState || '');
  const hasTarget = Boolean(params.hasTarget);
  const interactionOpen = Boolean(params.interactionOpen);
  const interactionVisible = Boolean(params.interactionVisible);
  const { pluginRegistry, getUiTargetId, isStation } = params;

  let interact = hasTarget && !interactionOpen;
  let send = context === 'near_player_idle';
  if (hasTarget && pluginRegistry && getUiTargetId && isStation) {
    const targetId = getUiTargetId();
    if (targetId && isStation(targetId)) {
      send = false;
      const station = params.stations instanceof Map ? params.stations.get(targetId) : null;
      if (station) {
        const plugin = pluginRegistry.station(station.kind);
        const actions = plugin?.getMobileActions?.() ?? [];
        if (actions.length > 0) {
          interact = !interactionOpen && actions.includes('interact');
        }
      }
    }
  }

  // Dealer pick buttons live exclusively inside the interaction card.
  // Mobile move duplicates are only for player-vs-player active matches.
  // Hide all move buttons while the interaction card is open to avoid overlap.
  const rpsVisible = !interactionOpen && context === 'active_rps';
  const coinflipVisible = !interactionOpen && context === 'active_coinflip';
  const diceVisible = !interactionOpen && context === 'active_dice_duel';

  return {
    interact,
    send,
    accept: context === 'incoming_challenge',
    decline: context === 'incoming_challenge',
    movesVisible: rpsVisible || coinflipVisible || diceVisible,
    rpsVisible,
    coinflipVisible,
    diceVisible,
    mapShouldHide: Boolean(
      interactionOpen
      || interactionVisible
      || rpsVisible
      || coinflipVisible
      || diceVisible
      || dealerState === 'ready'
      || dealerState === 'preflight'
      || dealerState === 'dealing'
      || dealerState === 'reveal'
    )
  };
}
