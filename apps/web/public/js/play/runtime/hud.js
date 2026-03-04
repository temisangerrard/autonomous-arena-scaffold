export function renderTopHud(state, dom) {
  const { hud, topbarName, topbarWallet, topbarStreak, topbarBot } = dom;
  if (!hud || !topbarName || !topbarWallet || !topbarStreak || !topbarBot) {
    return;
  }
  const me = state.playerId ? state.players.get(state.playerId) : null;
  topbarName.textContent = me?.displayName || 'Player';
  topbarWallet.textContent = Number.isFinite(Number(state.walletBalance))
    ? `$${Number(state.walletBalance).toFixed(2)}`
    : '$—';
  const approvalMode = String(state.escrowApproval?.mode || 'manual');
  const modeLabel = approvalMode === 'auto' ? 'AUTO' : 'MANUAL';
  topbarStreak.textContent = `Streak ${state.streak}`;
  topbarBot.textContent = `Bot: ${modeLabel}`;
  topbarBot.classList.toggle('manual', approvalMode !== 'auto');
}

export function renderNextActionLine(state, el, labelFor, opts = {}) {
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
  if (String(state.escrowApproval?.mode || 'manual') === 'auto') {
    el.textContent = 'Testnet mode: approvals handled automatically for wagered challenges.';
    return;
  }
  const { pluginRegistry, getUiTargetId, isStation } = opts;
  const targetId = typeof getUiTargetId === 'function' ? getUiTargetId() : '';
  if (targetId && pluginRegistry && isStation && isStation(targetId)) {
    const station = state.stations instanceof Map ? state.stations.get(targetId) : null;
    const distance = Number(state.nearbyDistances?.get?.(targetId));
    if (station && Number.isFinite(distance)) {
      const plugin = pluginRegistry.station(station.kind);
      if (plugin?.getDirectioningHints) {
        const hints = plugin.getDirectioningHints({ station, distance });
        if (hints?.title) {
          el.textContent = hints.subtitle ? `${hints.title} — ${hints.subtitle}` : hints.title;
          return;
        }
      }
    }
  }
  el.textContent = 'Find a nearby target and start a challenge.';
}
