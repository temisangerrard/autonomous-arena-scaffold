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
      showToast('Not connected to server.');
      return false;
    }
    if (station?.source === 'host' && station?.proxyMissing) {
      showToast('Station unavailable right now. Please retry in a moment.');
      return false;
    }
    const resolvedStationId = resolveStationIdForSend(station || station?.id || '');
    if (!resolvedStationId) {
      showToast('Station unavailable.');
      return false;
    }
    socket.send(
      JSON.stringify({
        type: 'station_interact',
        stationId: resolvedStationId,
        action,
        ...extra
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
      state.ui.world.title = String(local.title || station.displayName || 'World Interaction');
      state.ui.world.detail = String(local.inspect || 'Interaction ready.');
      state.ui.world.actionLabel = String(local.useLabel || 'Use');
      return true;
    }
    if (mode === 'use') {
      state.ui.world.stationId = station.id;
      state.ui.world.interactionTag = String(station.interactionTag || '');
      state.ui.world.title = String(local.title || station.displayName || 'World Interaction');
      state.ui.world.detail = String(local.use || 'Interaction complete.');
      state.ui.world.actionLabel = 'Used';
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
