const GAME_START_ACTIONS = {
  rps: 'rps_house_start',
  coinflip: 'coinflip_house_start',
  dice_duel: 'dice_duel_start',
  prediction: 'prediction_markets_open'
};

const GAME_LABELS = {
  rps: 'Rock Paper Scissors',
  coinflip: 'Coinflip',
  dice_duel: 'Dice Duel',
  prediction: 'Prediction Markets'
};

export function launchQuickPlayStation(params) {
  const {
    station,
    resolveIncomingStationId,
    setInteractOpen,
    state
  } = params;

  const localTargetId = String(resolveIncomingStationId?.(station?.id) || station?.id || '').trim();
  if (!localTargetId) {
    return '';
  }

  state.ui.targetId = localTargetId;
  state.ui.interactionMode = 'station';
  setInteractOpen(true);
  state.ui.dealer.quickPlayEnabled = true;
  state.ui.dealer.quickPlayStationId = String(station?.id || '').trim();
  return localTargetId;
}

export function createQuickPlayPanel({ openQuickPlayStation, showToast }) {
  const panel = document.getElementById('quick-play-panel');
  const backdrop = document.getElementById('quick-play-backdrop');
  const btn = document.getElementById('topbar-quick-play');
  const list = document.getElementById('quick-play-list');
  const closeBtn = document.getElementById('quick-play-close');

  let stations = [];
  let loading = false;

  function open() {
    if (!panel) return;
    panel.hidden = false;
    if (backdrop) backdrop.hidden = false;
    if (stations.length === 0 && !loading) load();
  }

  function close() {
    if (!panel) return;
    panel.hidden = true;
    if (backdrop) backdrop.hidden = true;
  }

  async function load() {
    loading = true;
    if (list) list.textContent = 'Loading…';
    try {
      const r = await fetch('/api/game/stations/playable');
      if (!r.ok) throw new Error(`quick_play_http_${r.status}`);
      const data = await r.json().catch(() => ({}));
      if (!data?.ok) throw new Error(String(data?.reason || 'quick_play_unavailable'));
      stations = Array.isArray(data?.stations) ? data.stations : [];
      render();
    } catch {
      if (list) list.textContent = 'Could not load games.';
    } finally {
      loading = false;
    }
  }

  function makeCard(station) {
    const card = document.createElement('div');
    card.className = 'qp-card' + (station.available ? '' : ' qp-card--unavailable');

    const title = document.createElement('div');
    title.className = 'qp-card__title';
    title.textContent = GAME_LABELS[station.gameType] || station.displayName;
    card.appendChild(title);

    const action = GAME_START_ACTIONS[station.gameType];
    if (station.displayName && station.displayName !== title.textContent) {
      const subtitle = document.createElement('div');
      subtitle.className = 'qp-card__meta';
      subtitle.textContent = station.displayName;
      card.appendChild(subtitle);
    }

    const playBtn = document.createElement('button');
    playBtn.type = 'button';
    playBtn.className = 'qp-card__play';
    playBtn.textContent = station.available
      ? (station.gameType === 'prediction' ? 'Open Card' : 'Play')
      : 'Unavailable';
    playBtn.disabled = !station.available;

    playBtn.addEventListener('click', () => {
      if (!action) { showToast('Unsupported game type.'); return; }
      const launched = openQuickPlayStation?.(station);
      if (!launched) {
        showToast('Station unavailable.');
        return;
      }
      close();
    });

    card.appendChild(playBtn);
    return card;
  }

  function render() {
    if (!list) return;
    while (list.firstChild) list.removeChild(list.firstChild);
    if (stations.length === 0) {
      list.textContent = 'No games available right now.';
      return;
    }
    for (const station of stations) {
      list.appendChild(makeCard(station));
    }
  }

  btn?.addEventListener('click', () => {
    if (!panel?.hidden) { close(); return; }
    open();
  });

  closeBtn?.addEventListener('click', close);
  backdrop?.addEventListener('click', close);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !panel?.hidden) close();
  });

  return { open, close };
}
