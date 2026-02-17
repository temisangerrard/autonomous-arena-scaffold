export function renderTopHud(state, dom) {
  const { hud, topbarName, topbarWallet, topbarStreak } = dom;
  if (!hud || !topbarName || !topbarWallet || !topbarStreak) {
    return;
  }
  const me = state.playerId ? state.players.get(state.playerId) : null;
  topbarName.textContent = me?.displayName || 'Player';
  topbarWallet.textContent = Number.isFinite(Number(state.walletBalance))
    ? `$${Number(state.walletBalance).toFixed(2)}`
    : '$—';
  topbarStreak.textContent = `Streak ${state.streak}`;
}

export function renderNextActionLine(state, el, labelFor) {
  if (!el) return;
  if (!state.wsConnected) {
    el.textContent = state.challengeMessage || 'Disconnected from game server. Reconnecting...';
    return;
  }
  if (state.incomingChallengeId && state.activeChallenge) {
    el.textContent = `Accept challenge from ${labelFor(state.activeChallenge.challengerId)}.`;
    return;
  }
  const active = state.activeChallenge;
  if (active && active.status === 'active') {
    el.textContent = `Match active: ${String(active.gameType || '').toUpperCase()}`;
    return;
  }
  if (state.challengeMessage) {
    el.textContent = state.challengeMessage;
    return;
  }
  el.textContent = 'Find a nearby target and start a challenge.';
}
