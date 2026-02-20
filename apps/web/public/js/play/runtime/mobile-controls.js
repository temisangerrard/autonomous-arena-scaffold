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

  // Dealer pick buttons live inside the interaction card — suppress mobile duplicates when card is open.
  const cardOpen = interactionOpen || interactionVisible;
  const rpsVisible = context === 'active_rps' || (!cardOpen && context === 'dealer_ready_rps');
  const coinflipVisible = context === 'active_coinflip' || (!cardOpen && context === 'dealer_ready_coinflip');
  const diceVisible = context === 'active_dice_duel' || (!cardOpen && context === 'dealer_ready_dice_duel');

  return {
    interact: hasTarget,
    send: context === 'near_player_idle',
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
