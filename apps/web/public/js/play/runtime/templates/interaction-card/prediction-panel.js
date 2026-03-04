import {
  setPendingBtn,
  clearPendingBtn,
  flashBtn,
  startTimer,
  clearTimer
} from './helpers.js';

export function mountPredictionPanel(params) {
  const {
    state,
    stationUi,
    station: routeStation,
    kioskMode = false,
    sendStationInteract,
    formatUsdAmount,
    formatPredictionClose,
    showToast,
    setStationStatus
  } = params;

  const unavailable = !routeStation;
  stationUi.classList.remove('station-ui--npc');
  stationUi.dataset.predictionMode = kioskMode ? 'kiosk' : 'dealer';
  stationUi.innerHTML = `
    <div class="prediction-panel">
      <div class="prediction-header">
        <span class="prediction-header__source">Arena Oracle</span>
        <span class="prediction-header__label">${kioskMode ? 'BTC board' : 'BTC rails'}</span>
      </div>
      <div class="station-ui__meta">Base Mainnet • USDC</div>
      <div class="prediction-tabs" role="tablist" aria-label="BTC market duration">
        <button id="prediction-tab-5m" class="prediction-tab" type="button" role="tab" aria-selected="true">BTC 5m</button>
        <button id="prediction-tab-24h" class="prediction-tab" type="button" role="tab" aria-selected="false">BTC 24h</button>
      </div>
      <div class="prediction-tabs prediction-tabs--round" role="tablist" aria-label="BTC market round">
        <button id="prediction-round-current" class="prediction-tab" type="button" role="tab" aria-selected="true">Current</button>
        <button id="prediction-round-next" class="prediction-tab" type="button" role="tab" aria-selected="false">Next</button>
      </div>
      <div class="prediction-market-status" id="prediction-market-status" aria-live="polite"></div>
      <div class="prediction-market-preview" id="prediction-market-preview" aria-live="polite"></div>
      <div class="station-ui__meta" id="prediction-market-timing"></div>
      <div class="station-ui__meta" id="prediction-market-prices"></div>
      <div class="station-ui__row">
        <label for="prediction-stake">Stake <span class="game-panel__currency">USDC</span></label>
        <input id="prediction-stake" type="number" min="1" max="10000" step="1" value="1" class="game-panel__wager-input" />
      </div>
      <div class="prediction-sides">
        <button id="prediction-btc-yes" class="prediction-side prediction-side--yes" type="button">BTC Up</button>
        <button id="prediction-btc-no" class="prediction-side prediction-side--no" type="button">BTC Down</button>
      </div>
      <div class="station-ui__meta">If your side wins without opposite liquidity, your stake is refunded. Next-round commitments lock immediately.</div>
      <div class="station-ui__meta" id="prediction-status">${unavailable ? 'No prediction dealer mapped from this station yet.' : 'Fetching markets…'}</div>
    </div>
  `;

  const stakeEl = document.getElementById('prediction-stake');
  const tab5mBtn = document.getElementById('prediction-tab-5m');
  const tab24hBtn = document.getElementById('prediction-tab-24h');
  const roundCurrentBtn = document.getElementById('prediction-round-current');
  const roundNextBtn = document.getElementById('prediction-round-next');
  const btcYesBtn = document.getElementById('prediction-btc-yes');
  const btcNoBtn = document.getElementById('prediction-btc-no');
  const timingEl = document.getElementById('prediction-market-timing');
  const marketStatusEl = document.getElementById('prediction-market-status');
  const pricesEl = document.getElementById('prediction-market-prices');

  function marketRail(entry) {
    return String(entry?.rail || '').toLowerCase() === 'btc_24h' ? 'btc_24h' : 'btc_5m';
  }

  function selectedRail() {
    const rail = String(state.ui?.prediction?.selectedRail || 'btc_5m');
    return rail === 'btc_24h' ? 'btc_24h' : 'btc_5m';
  }

  function setSelectedRail(rail) {
    state.ui.prediction.selectedRail = rail === 'btc_24h' ? 'btc_24h' : 'btc_5m';
    const nextMarket = selectedBtcMarket();
    state.ui.prediction.selectedMarketId = String(nextMarket?.marketId || '');
    renderPredictionRail();
  }

  function selectedRound() {
    const round = String(state.ui?.prediction?.selectedRound || 'current');
    return round === 'next' ? 'next' : 'current';
  }

  function setSelectedRound(round) {
    state.ui.prediction.selectedRound = round === 'next' ? 'next' : 'current';
    const nextMarket = selectedBtcMarket();
    state.ui.prediction.selectedMarketId = String(nextMarket?.marketId || '');
    renderPredictionRail();
  }

  function currentStake() {
    return Math.max(1, Math.min(10_000, Number(stakeEl?.value || 1)));
  }

  function activeBtcMarkets() {
    const markets = Array.isArray(state.ui?.prediction?.markets) ? state.ui.prediction.markets : [];
    return markets.filter((entry) => (
      String(entry?.oracleSource || '') === 'chainlink_btc_usd'
      && String(entry?.status || 'open') === 'open'
    ));
  }

  function activeBtcMarketsForRail(rail = selectedRail()) {
    return activeBtcMarkets()
      .filter((entry) => marketRail(entry) === rail)
      .sort((a, b) => {
        const aRound = String(a?.roundType || 'current') === 'next' ? 1 : 0;
        const bRound = String(b?.roundType || 'current') === 'next' ? 1 : 0;
        return aRound - bRound || Number(a?.slotStart || a?.closeAt || 0) - Number(b?.slotStart || b?.closeAt || 0);
      });
  }

  function railDurationMs(rail = selectedRail()) {
    return rail === 'btc_24h' ? 24 * 60 * 60_000 : 5 * 60_000;
  }

  function railQuestion(rail = selectedRail()) {
    return rail === 'btc_24h'
      ? 'Will BTC/USD close higher 24 hours from lock?'
      : 'Will BTC/USD close higher 5 minutes from lock?';
  }

  function nextRoundText(rail = selectedRail()) {
    const durationMs = railDurationMs(rail);
    const remainingMs = durationMs - (Date.now() % durationMs);
    const remainingMinutes = Math.max(1, Math.ceil(remainingMs / 60_000));
    return `Next round in ${remainingMinutes}m`;
  }

  function marketStateLabel(market, rail = selectedRail()) {
    if (!market) return nextRoundText(rail);
    if (String(market?.roundType || 'current') === 'next') return 'Available for early commit';
    const closeAt = Number(market.closeAt || 0);
    const remainingMs = Math.max(0, closeAt - Date.now());
    const closingSoonThreshold = rail === 'btc_24h' ? 30 * 60_000 : 60_000;
    if (remainingMs <= closingSoonThreshold) return 'Closing soon';
    return 'Live';
  }

  function selectedBtcMarket() {
    const btcMarkets = activeBtcMarketsForRail();
    const round = selectedRound();
    const selectedMarketId = String(state.ui?.prediction?.selectedMarketId || '');
    return (
      btcMarkets.find((entry) => String(entry.marketId || '') === selectedMarketId && String(entry?.roundType || 'current') === round)
      || btcMarkets.find((entry) => String(entry?.roundType || 'current') === round)
      || btcMarkets[0]
      || null
    );
  }

  function renderPredictionRail() {
    const rail = selectedRail();
    const rail5mActive = rail === 'btc_5m';
    const round = selectedRound();
    if (tab5mBtn) {
      tab5mBtn.classList.toggle('is-active', rail5mActive);
      tab5mBtn.setAttribute('aria-selected', rail5mActive ? 'true' : 'false');
    }
    if (tab24hBtn) {
      tab24hBtn.classList.toggle('is-active', !rail5mActive);
      tab24hBtn.setAttribute('aria-selected', rail5mActive ? 'false' : 'true');
    }
    if (roundCurrentBtn) {
      roundCurrentBtn.classList.toggle('is-active', round === 'current');
      roundCurrentBtn.setAttribute('aria-selected', round === 'current' ? 'true' : 'false');
    }
    if (roundNextBtn) {
      roundNextBtn.classList.toggle('is-active', round === 'next');
      roundNextBtn.setAttribute('aria-selected', round === 'next' ? 'true' : 'false');
    }

    const matched = selectedBtcMarket();
    const label = rail5mActive ? 'BTC 5m' : 'BTC 24h';
    if (marketStatusEl) {
      marketStatusEl.textContent = `${label} • ${round === 'next' ? 'Next round' : 'Current round'} • ${marketStateLabel(matched, rail)}`;
    }
    if (timingEl) {
      timingEl.textContent = matched
        ? `Locks: ${formatPredictionClose(Number(matched.closeAt || 0))} • Settles: ${formatPredictionClose(Number(matched.resolveAt || matched.closeAt || 0))}`
        : `Locks: ${nextRoundText(rail)} • Settles: Pending`;
    }
    if (pricesEl) {
      const spot = matched?.currentSpotPrice ? Number(matched.currentSpotPrice) : null;
      const lock = matched?.lockPrice ? Number(matched.lockPrice) : null;
      const final = matched?.finalPrice ? Number(matched.finalPrice) : null;
      let spotText = spot ? `BTC now: ${formatUsdAmount(spot)}` : 'BTC now: Pending';
      if (spot && lock) {
        const pct = ((spot - lock) / lock) * 100;
        const arrow = pct >= 0 ? '▲' : '▼';
        spotText += ` ${arrow} ${pct >= 0 ? '+' : ''}${pct.toFixed(2)}% from lock`;
      }
      const lockText = lock
        ? `Lock: ${formatUsdAmount(lock)}`
        : (round === 'next' ? 'Lock: sets at open' : 'Lock: pending');
      const finalText = final ? `Final: ${formatUsdAmount(final)}` : '';
      pricesEl.textContent = [spotText, lockText, finalText].filter(Boolean).join(' • ');
    }
    const previewEl = document.getElementById('prediction-market-preview');
    if (!previewEl) return;
    if (!matched) {
      previewEl.hidden = false;
      previewEl.textContent = railQuestion(rail);
      previewEl.removeAttribute('title');
      return;
    }
    const question = String(matched.question || matched.marketId || 'BTC market');
    previewEl.hidden = false;
    previewEl.textContent = question;
    previewEl.title = question;
  }

  function dispatchPrediction(action, extra = {}) {
    if (!routeStation) {
      showToast('Prediction dealer is unavailable right now.');
      return false;
    }
    return sendStationInteract(routeStation, action, extra);
  }

  function validatePredictionOrder() {
    const market = selectedBtcMarket();
    if (!market) {
      return selectedRound() === 'next'
        ? 'No next BTC market is available right now.'
        : 'No current BTC market is live right now.';
    }
    if (String(market.status || 'open') !== 'open' || Number(market.closeAt || 0) <= Date.now()) {
      return 'Selected BTC market is no longer open.';
    }
    const stake = currentStake();
    const balance = Number(state.walletBalance);
    if (Number.isFinite(balance) && stake > balance) {
      return 'Insufficient USDC balance for this stake.';
    }
    return '';
  }

  function clearPredictionBuyBtns() {
    clearPendingBtn(btcYesBtn, 'BTC Up');
    clearPendingBtn(btcNoBtn, 'BTC Down');
  }

  function submitPredictionOrder(side) {
    const failure = validatePredictionOrder();
    if (failure) {
      state.ui.prediction.state = 'error';
      state.ui.prediction.lastReason = 'prediction_precheck_failed';
      state.ui.prediction.lastReasonText = failure;
      clearPredictionBuyBtns();
      showToast(failure, 'warning');
      return;
    }
    const market = selectedBtcMarket();
    const marketId = String(market?.marketId || '');
    if (!marketId) return;

    state.ui.prediction.selectedMarketId = marketId;
    const button = side === 'yes' ? btcYesBtn : btcNoBtn;
    const otherButton = side === 'yes' ? btcNoBtn : btcYesBtn;
    if (button) {
      state.ui.prediction.state = 'pending';
      setPendingBtn(button, 'Confirming…');
    }
    if (otherButton) otherButton.disabled = true;

    startTimer('prediction:buy', () => {
      clearPredictionBuyBtns();
      state.ui.prediction.state = 'error';
      state.ui.prediction.lastReason = 'prediction_timeout';
      state.ui.prediction.lastReasonText = 'No server response. Try again.';
      showToast('No server response. Try again.', 'error');
    }, 7000);

    const action = side === 'yes' ? 'prediction_market_buy_yes' : 'prediction_market_buy_no';
    const sent = dispatchPrediction(action, { marketId, stake: currentStake() });
    if (!sent) {
      clearTimer('prediction:buy');
      clearPredictionBuyBtns();
      state.ui.prediction.state = 'error';
    }
  }

  if (tab5mBtn) tab5mBtn.onclick = () => setSelectedRail('btc_5m');
  if (tab24hBtn) tab24hBtn.onclick = () => setSelectedRail('btc_24h');
  if (roundCurrentBtn) roundCurrentBtn.onclick = () => setSelectedRound('current');
  if (roundNextBtn) roundNextBtn.onclick = () => setSelectedRound('next');
  if (btcYesBtn) btcYesBtn.onclick = () => submitPredictionOrder('yes');
  if (btcNoBtn) btcNoBtn.onclick = () => submitPredictionOrder('no');

  if (!state.ui?.prediction?.selectedRail) state.ui.prediction.selectedRail = 'btc_5m';
  if (!state.ui?.prediction?.selectedRound) state.ui.prediction.selectedRound = 'current';
  renderPredictionRail();

  if (!Array.isArray(state.ui.prediction.markets) || state.ui.prediction.markets.length === 0) {
    dispatchPrediction('prediction_markets_open');
  } else if (!selectedBtcMarket()) {
    state.ui.prediction.lastReason = 'prediction_no_live_btc_market';
    state.ui.prediction.lastReasonText = 'No BTC market is available for this rail and round.';
  }
}

export function updatePredictionLive(params) {
  const {
    state,
    formatUsdAmount,
    formatPredictionClose,
    setStationStatus,
    clearPendingBtn,
    flashBtn,
    clearTimer
  } = params;

  const prediction = state.ui.prediction || {};
  const allMarkets = (Array.isArray(prediction.markets) ? prediction.markets : []).filter((market) => (
    String(market?.oracleSource || '') === 'chainlink_btc_usd'
    && String(market?.status || 'open') === 'open'
  ));
  const railOf = (market) => (String(market?.rail || '').toLowerCase() === 'btc_24h' ? 'btc_24h' : 'btc_5m');
  const railDurationMs = (rail) => (rail === 'btc_24h' ? 24 * 60 * 60_000 : 5 * 60_000);
  const railQuestion = (rail) => (
    rail === 'btc_24h'
      ? 'Will BTC/USD close higher 24 hours from lock?'
      : 'Will BTC/USD close higher 5 minutes from lock?'
  );
  const nextRoundText = (rail) => {
    const durationMs = railDurationMs(rail);
    const remainingMs = durationMs - (Date.now() % durationMs);
    const remainingMinutes = Math.max(1, Math.ceil(remainingMs / 60_000));
    return `Next round in ${remainingMinutes}m`;
  };
  const marketStateLabel = (market, rail) => {
    if (!market) return nextRoundText(rail);
    if (String(market?.roundType || 'current') === 'next') return 'Available for early commit';
    const closeAt = Number(market.closeAt || 0);
    const remainingMs = Math.max(0, closeAt - Date.now());
    const closingSoonThreshold = rail === 'btc_24h' ? 30 * 60_000 : 60_000;
    if (remainingMs <= closingSoonThreshold) return 'Closing soon';
    return 'Live';
  };

  const selectedRail = String(prediction.selectedRail || 'btc_5m') === 'btc_24h' ? 'btc_24h' : 'btc_5m';
  const selectedRound = String(prediction.selectedRound || 'current') === 'next' ? 'next' : 'current';
  const markets = allMarkets
    .filter((market) => railOf(market) === selectedRail)
    .sort((a, b) => {
      const aRound = String(a?.roundType || 'current') === 'next' ? 1 : 0;
      const bRound = String(b?.roundType || 'current') === 'next' ? 1 : 0;
      return aRound - bRound || Number(a?.slotStart || a?.closeAt || 0) - Number(b?.slotStart || b?.closeAt || 0);
    });
  const selectedMarketId = String(prediction.selectedMarketId || '');
  const selected = (
    markets.find((market) => String(market.marketId || '') === selectedMarketId && String(market?.roundType || 'current') === selectedRound)
    || markets.find((market) => String(market?.roundType || 'current') === selectedRound)
    || markets[0]
    || null
  );

  const previewEl = document.getElementById('prediction-market-preview');
  const statusEl = document.getElementById('prediction-status');
  const marketStatusEl = document.getElementById('prediction-market-status');
  const timingEl = document.getElementById('prediction-market-timing');
  const pricesEl = document.getElementById('prediction-market-prices');
  const tab5mBtn = document.getElementById('prediction-tab-5m');
  const tab24hBtn = document.getElementById('prediction-tab-24h');
  const roundCurrentBtn = document.getElementById('prediction-round-current');
  const roundNextBtn = document.getElementById('prediction-round-next');

  if (tab5mBtn) {
    tab5mBtn.classList.toggle('is-active', selectedRail === 'btc_5m');
    tab5mBtn.setAttribute('aria-selected', selectedRail === 'btc_5m' ? 'true' : 'false');
  }
  if (tab24hBtn) {
    tab24hBtn.classList.toggle('is-active', selectedRail === 'btc_24h');
    tab24hBtn.setAttribute('aria-selected', selectedRail === 'btc_24h' ? 'true' : 'false');
  }
  if (roundCurrentBtn) {
    roundCurrentBtn.classList.toggle('is-active', selectedRound === 'current');
    roundCurrentBtn.setAttribute('aria-selected', selectedRound === 'current' ? 'true' : 'false');
  }
  if (roundNextBtn) {
    roundNextBtn.classList.toggle('is-active', selectedRound === 'next');
    roundNextBtn.setAttribute('aria-selected', selectedRound === 'next' ? 'true' : 'false');
  }
  if (previewEl) {
    if (!selected) {
      previewEl.hidden = false;
      previewEl.textContent = railQuestion(selectedRail);
    } else {
      const question = String(selected.question || selected.marketId || 'Untitled market');
      previewEl.hidden = false;
      previewEl.textContent = question;
      previewEl.title = question;
    }
  }
  if (marketStatusEl) {
    marketStatusEl.textContent = `${selectedRail === 'btc_24h' ? 'BTC 24h' : 'BTC 5m'} • ${selectedRound === 'next' ? 'Next round' : 'Current round'} • ${marketStateLabel(selected, selectedRail)}`;
  }
  if (timingEl) {
    timingEl.textContent = selected
      ? `Locks: ${formatPredictionClose(Number(selected.closeAt || 0))} • Settles: ${formatPredictionClose(Number(selected.resolveAt || selected.closeAt || 0))}`
      : `Locks: ${nextRoundText(selectedRail)} • Settles: Pending`;
  }
  if (pricesEl) {
    const spot = selected?.currentSpotPrice ? Number(selected.currentSpotPrice) : null;
    const lock = selected?.lockPrice ? Number(selected.lockPrice) : null;
    const final = selected?.finalPrice ? Number(selected.finalPrice) : null;
    let spotText = spot ? `BTC now: ${formatUsdAmount(spot)}` : 'BTC now: Pending';
    if (spot && lock) {
      const pct = ((spot - lock) / lock) * 100;
      const arrow = pct >= 0 ? '▲' : '▼';
      spotText += ` ${arrow} ${pct >= 0 ? '+' : ''}${pct.toFixed(2)}% from lock`;
    }
    const lockText = lock
      ? `Lock: ${formatUsdAmount(lock)}`
      : (selectedRound === 'next' ? 'Lock: sets at open' : 'Lock: pending');
    const finalText = final ? `Final: ${formatUsdAmount(final)}` : '';
    pricesEl.textContent = [spotText, lockText, finalText].filter(Boolean).join(' • ');
  }
  if (statusEl) {
    const mode = String(prediction.state || 'idle');
    const _btcYes = document.getElementById('prediction-btc-yes');
    const _btcNo = document.getElementById('prediction-btc-no');
    if (mode === 'pending') {
      setStationStatus(statusEl, 'Submitting order...', 'neutral');
    } else if (mode === 'error') {
      clearTimer('prediction:buy');
      if (_btcYes) { flashBtn(_btcYes, 'is-failed'); clearPendingBtn(_btcYes, 'BTC Up'); }
      if (_btcNo) { flashBtn(_btcNo, 'is-failed'); clearPendingBtn(_btcNo, 'BTC Down'); }
      setStationStatus(statusEl, String(prediction.lastReasonText || 'Prediction request failed.'), 'warning');
    } else if (mode === 'filled') {
      clearTimer('prediction:buy');
      if (_btcYes) { flashBtn(_btcYes, 'is-success'); clearPendingBtn(_btcYes, 'BTC Up'); }
      if (_btcNo) { flashBtn(_btcNo, 'is-success'); clearPendingBtn(_btcNo, 'BTC Down'); }
      setStationStatus(statusEl, String(prediction.positionStatus || '') === 'scheduled' ? 'Committed to next round. Funds are locked.' : 'Order filled.', 'success');
    } else {
      if (markets.length === 0) {
        setStationStatus(statusEl, selectedRound === 'next' ? 'No next BTC market is available right now.' : 'No current BTC market is live right now.', 'warning');
      } else {
        setStationStatus(statusEl, 'Choose BTC Up or BTC Down.', 'neutral');
      }
    }
  }
}
