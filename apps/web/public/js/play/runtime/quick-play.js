const GAME_ICONS = {
  rps: 'back_hand',
  coinflip: 'toll',
  dice_duel: 'casino',
  blackjack: 'style',
  prediction: 'query_stats'
};

const GAME_DESCRIPTIONS = {
  rps: 'Throw your move against the dealer. Best of three.',
  coinflip: 'Call it — heads or tails. 50/50, settled on-chain.',
  dice_duel: 'Pick a face. High roll takes the pot.',
  blackjack: 'Beat 21. Beat the dealer. Beat the house.',
  prediction: 'Open a live BTC/USD prediction round.'
};

const GAME_ODDS_BADGE = { coinflip: '50/50 ODDS' };

const GAME_START_ACTIONS = {
  rps: 'rps_house_start',
  coinflip: 'coinflip_house_start',
  dice_duel: 'dice_duel_start',
  blackjack: 'blackjack_start',
  prediction: 'prediction_markets_open'
};

const GAME_LABELS = {
  rps: 'Rock Paper Scissors',
  coinflip: 'Coinflip',
  dice_duel: 'Dice Duel',
  blackjack: 'Blackjack',
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
    const isFeatured = station.gameType === 'coinflip';
    const isPrediction = station.gameType === 'prediction';
    const classes = ['qp-card'];
    if (isFeatured) classes.push('qp-card--featured');
    else classes.push('qp-card--standard');
    if (isPrediction) classes.push('qp-card--prediction');
    if (!station.available) classes.push('qp-card--unavailable');
    const card = document.createElement('div');
    card.className = classes.join(' ');

    // Top row: icon + badge
    const top = document.createElement('div');
    top.className = 'qp-card__top';

    const iconBox = document.createElement('div');
    iconBox.className = isFeatured ? 'qp-card__icon-box qp-card__icon-box--featured' : 'qp-card__icon-box';
    const iconSpan = document.createElement('span');
    iconSpan.className = 'material-symbols-outlined';
    iconSpan.textContent = GAME_ICONS[station.gameType] || 'sports_esports';
    iconBox.appendChild(iconSpan);
    top.appendChild(iconBox);

    const oddsBadge = GAME_ODDS_BADGE[station.gameType];
    if (oddsBadge) {
      const badge = document.createElement('span');
      badge.className = 'qp-card__badge';
      badge.textContent = oddsBadge;
      top.appendChild(badge);
    }
    card.appendChild(top);

    // Body: title + description
    const body = document.createElement('div');
    body.className = 'qp-card__body';

    const title = document.createElement('h3');
    title.className = 'qp-card__title';
    title.textContent = GAME_LABELS[station.gameType] || station.displayName;
    body.appendChild(title);

    const desc = document.createElement('p');
    desc.className = 'qp-card__desc';
    desc.textContent = GAME_DESCRIPTIONS[station.gameType] || '';
    body.appendChild(desc);
    card.appendChild(body);

    // Play button
    const action = GAME_START_ACTIONS[station.gameType];
    const playBtn = document.createElement('button');
    playBtn.type = 'button';
    playBtn.className = isFeatured ? 'qp-card__play qp-card__play--featured' : 'qp-card__play';
    playBtn.textContent = !station.available
      ? 'Unavailable'
      : (isPrediction ? 'Open Round' : 'Play');
    playBtn.disabled = !station.available;

    playBtn.addEventListener('click', () => {
      if (!action) { showToast('Unsupported game type.'); return; }
      const launched = openQuickPlayStation?.(station);
      if (!launched) { showToast('Station unavailable.'); return; }
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
    const grid = document.createElement('div');
    grid.className = 'qp-bento-grid';
    for (const station of stations) {
      grid.appendChild(makeCard(station));
    }
    list.appendChild(grid);
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
