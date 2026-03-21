export function createStationInteractionsController(params) {
  const {
    state,
    showToast,
    getSocket,
    resolveStationIdForSend
  } = params;

  function sendStationInteract(station, action, extra = {}) {
    const socket = getSocket();
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      showToast('Arena link is down. Reconnect, then step back to a live host.');
      return false;
    }
    if (station?.source === 'host' && station?.proxyMissing) {
      showToast('That host is off the floor right now. Step to another named table.');
      return false;
    }
    const resolvedStationId = resolveStationIdForSend(station || station?.id || '');
    if (!resolvedStationId) {
      showToast('No live route from this host. Move to a named dealer or cashier.');
      return false;
    }
    const autoQuickPlay = station && typeof station === 'object'
      ? station.source === 'host'
        || station.source === 'baked'
        || (
          state?.ui?.dealer?.quickPlayEnabled === true
          && String(state?.ui?.dealer?.quickPlayStationId || '') === resolvedStationId
        )
      : (
        state?.ui?.dealer?.quickPlayEnabled === true
        && String(state?.ui?.dealer?.quickPlayStationId || '') === resolvedStationId
      );
    socket.send(
      JSON.stringify({
        type: 'station_interact',
        stationId: resolvedStationId,
        action,
        ...extra,
        ...(extra.quickPlay === true || autoQuickPlay ? { quickPlay: true } : {})
      })
    );
    return true;
  }

  function renderGuideStationDetail(station, mode) {
    const local = station?.localInteraction || null;
    if (!local) return false;
    if (mode === 'inspect') {
      state.ui.world.stationId = station.id;
      state.ui.world.interactionTag = String(station.interactionTag || '');
      state.ui.world.title = String(local.title || station.displayName || 'Floor Host');
      state.ui.world.detail = String(local.inspect || 'This host can route you to live action.');
      state.ui.world.actionLabel = String(local.useLabel || 'Open route');
      return true;
    }
    if (mode === 'use') {
      const routeStationId = String(local.routeStationId || '').trim();
      if (routeStationId) {
        state.ui.targetId = routeStationId;
        state.ui.interactionMode = 'station';
      }
      state.ui.world.stationId = station.id;
      state.ui.world.interactionTag = String(station.interactionTag || '');
      state.ui.world.title = String(local.title || station.displayName || 'Floor Host');
      state.ui.world.detail = String(local.use || 'Opening a live route now.');
      state.ui.world.actionLabel = routeStationId ? 'Opening…' : 'Done';
      return true;
    }
    return false;
  }

  function setStationStatus(statusEl, text, tone = 'neutral') {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.classList.toggle('station-ui__meta--warning', tone === 'warning');
    statusEl.classList.toggle('station-ui__meta--success', tone === 'success');
  }

  function makePlayerSeed() {
    try {
      const buf = new Uint8Array(16);
      crypto.getRandomValues(buf);
      return Array.from(buf).map((b) => b.toString(16).padStart(2, '0')).join('');
    } catch {
      return String(Math.random()).slice(2) + String(Date.now());
    }
  }

  return {
    sendStationInteract,
    renderGuideStationDetail,
    setStationStatus,
    makePlayerSeed
  };
}
