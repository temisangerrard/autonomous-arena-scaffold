function getStreakTier(n) {
  if (n >= 20) return { label: 'Legend', color: '#eab308', pulse: true };
  if (n >= 10) return { label: 'Unstoppable', color: '#ef4444', pulse: false };
  if (n >= 5)  return { label: 'On Fire', color: '#f97316', pulse: false };
  if (n >= 3)  return { label: 'Hot', color: '#2976c7', pulse: false };
  return null;
}

export function renderTopHud(state, dom, opts = {}) {
  const { hud, topbarName, topbarWallet, topbarStreak, topbarBot, topbarLfg } = dom;
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
  const tier = getStreakTier(state.streak);
  topbarStreak.textContent = tier ? `${tier.label} · ${state.streak}` : `Streak ${state.streak}`;
  topbarStreak.style.color = tier?.color || '';
  topbarStreak.classList.toggle('streak--pulse', Boolean(tier?.pulse));
  topbarBot.textContent = `Bot: ${modeLabel}`;
  topbarBot.classList.toggle('manual', approvalMode !== 'auto');
  if (topbarLfg) {
    const ready = Boolean(state.pvpReady);
    topbarLfg.textContent = ready ? 'READY' : 'LFG';
    topbarLfg.classList.toggle('lfg-active', ready);
    if (typeof opts.togglePvpReady === 'function' && !topbarLfg._lfgBound) {
      topbarLfg._lfgBound = true;
      topbarLfg.addEventListener('click', () => opts.togglePvpReady());
    }
  }
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
