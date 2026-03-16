import {
  setPendingBtn,
  clearPendingBtn,
  flashBtn,
  startTimer,
  clearTimer
} from './helpers.js';

function normalizePredictionRail(rail) {
  return String(rail || 'btc_5m') === 'btc_24h' ? 'btc_24h' : 'btc_5m';
}

function normalizePredictionRound(round) {
  return String(round || 'current') === 'next' ? 'next' : 'current';
}

function marketRail(entry) {
  return String(entry?.rail || '').toLowerCase() === 'btc_24h' ? 'btc_24h' : 'btc_5m';
}

function isPlayableBtcMarket(entry) {
  return (
    String(entry?.oracleSource || '') === 'chainlink_btc_usd'
    && String(entry?.status || 'open') === 'open'
  );
}

function sortPlayableMarkets(a, b) {
  const aRound = String(a?.roundType || 'current') === 'next' ? 1 : 0;
  const bRound = String(b?.roundType || 'current') === 'next' ? 1 : 0;
  return aRound - bRound || Number(a?.slotStart || a?.closeAt || 0) - Number(b?.slotStart || b?.closeAt || 0);
}

function playableMarketsForRail(markets, rail) {
  return markets
    .filter((entry) => marketRail(entry) === rail)
    .sort(sortPlayableMarkets);
}

export function resolvePlayablePredictionSelection(params) {
  const requestedRail = normalizePredictionRail(params?.selectedRail);
  const requestedRound = normalizePredictionRound(params?.selectedRound);
  const requestedMarketId = String(params?.selectedMarketId || '');
  const allMarkets = (Array.isArray(params?.markets) ? params.markets : [])
    .filter(isPlayableBtcMarket);
  const railMarkets = playableMarketsForRail(allMarkets, requestedRail);
  const selectedFromRequestedRail = (
    railMarkets.find((entry) => String(entry.marketId || '') === requestedMarketId && normalizePredictionRound(entry?.roundType) === requestedRound)
    || railMarkets.find((entry) => normalizePredictionRound(entry?.roundType) === requestedRound)
    || railMarkets[0]
    || null
  );
  if (selectedFromRequestedRail) {
    return {
      markets: allMarkets,
      railMarkets,
      selected: selectedFromRequestedRail,
      selectedRail: requestedRail,
      selectedRound: requestedRound,
      selectedMarketId: String(selectedFromRequestedRail.marketId || '')
    };
  }

  const fallback = (
    allMarkets.find((entry) => normalizePredictionRound(entry?.roundType) === requestedRound)
    || allMarkets.find((entry) => normalizePredictionRound(entry?.roundType) === 'current')
    || allMarkets[0]
    || null
  );
  const fallbackRail = normalizePredictionRail(fallback?.rail);
  const fallbackRound = normalizePredictionRound(fallback?.roundType);
  const fallbackRailMarkets = playableMarketsForRail(allMarkets, fallbackRail);
  const selectedFallback = (
    fallbackRailMarkets.find((entry) => String(entry.marketId || '') === String(fallback?.marketId || ''))
    || fallbackRailMarkets[0]
    || null
  );
  return {
    markets: allMarkets,
    railMarkets: fallbackRailMarkets,
    selected: selectedFallback,
    selectedRail: fallback ? fallbackRail : requestedRail,
    selectedRound: fallback ? fallbackRound : requestedRound,
    selectedMarketId: String(selectedFallback?.marketId || '')
  };
}

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
      <div class="prediction-panel__tabs-row">
        <div class="prediction-tabs" role="tablist" aria-label="BTC market duration">
          <button id="prediction-tab-5m" class="prediction-tab" type="button" role="tab" aria-selected="true">5m</button>
          <button id="prediction-tab-24h" class="prediction-tab" type="button" role="tab" aria-selected="false">24h</button>
        </div>
        <div class="prediction-tabs prediction-tabs--round" role="tablist" aria-label="BTC market round">
          <button id="prediction-round-current" class="prediction-tab" type="button" role="tab" aria-selected="true">Now</button>
          <button id="prediction-round-next" class="prediction-tab" type="button" role="tab" aria-selected="false">Next</button>
        </div>
        <span class="prediction-market-status prediction-market-status--inline" id="prediction-market-status" aria-live="polite"></span>
      </div>
      <div class="prediction-market-preview" id="prediction-market-preview" aria-live="polite"></div>
      <div class="prediction-panel__info" id="prediction-market-timing"></div>
      <div class="prediction-panel__prices" id="prediction-market-prices"></div>
      <div class="station-ui__row">
        <label for="prediction-stake">Stake <span class="game-panel__currency">USDC</span></label>
        <input id="prediction-stake" type="number" min="1" max="10000" step="1" value="1" class="game-panel__wager-input" />
      </div>
      <div class="prediction-sides">
        <button id="prediction-btc-yes" class="prediction-side prediction-side--yes" type="button">BTC Up</button>
        <button id="prediction-btc-no" class="prediction-side prediction-side--no" type="button">BTC Down</button>
      </div>
      <div class="prediction-panel__disclaimer">If your side wins without opposite liquidity, your stake is refunded.</div>
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

  function selectedRail() {
    return normalizePredictionRail(state.ui?.prediction?.selectedRail);
  }

  function setSelectedRail(rail) {
    state.ui.prediction.selectedRail = rail === 'btc_24h' ? 'btc_24h' : 'btc_5m';
    const nextMarket = selectedBtcMarket();
    state.ui.prediction.selectedMarketId = String(nextMarket?.marketId || '');
    renderPredictionRail();
  }

  function selectedRound() {
    return normalizePredictionRound(state.ui?.prediction?.selectedRound);
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
    return markets.filter(isPlayableBtcMarket);
  }

  function activeBtcMarketsForRail(rail = selectedRail()) {
    return playableMarketsForRail(activeBtcMarkets(), rail);
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
    const selection = resolvePlayablePredictionSelection({
      markets: activeBtcMarkets(),
      selectedRail: selectedRail(),
      selectedRound: selectedRound(),
      selectedMarketId: state.ui?.prediction?.selectedMarketId
    });
    state.ui.prediction.selectedRail = selection.selectedRail;
    state.ui.prediction.selectedRound = selection.selectedRound;
    state.ui.prediction.selectedMarketId = selection.selectedMarketId;
    return selection.selected;
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

  function isAutoRefreshablePredictionFailure(reasonText) {
    return reasonText === 'Selected BTC market is no longer open.'
      || reasonText === 'No current BTC market is live right now.'
      || reasonText === 'No next BTC market is available right now.';
  }

  function clearPredictionBuyBtns() {
    clearPendingBtn(btcYesBtn, 'BTC Up');
    clearPendingBtn(btcNoBtn, 'BTC Down');
  }

  function submitPredictionOrder(side) {
    const failure = validatePredictionOrder();
    if (failure) {
      if (isAutoRefreshablePredictionFailure(failure)) {
        state.ui.prediction.state = 'list';
        dispatchPrediction('prediction_markets_open');
      }
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
      state.ui.prediction.state = 'pending';
      state.ui.prediction.lastReason = 'prediction_processing';
      state.ui.prediction.lastReasonText = 'Still confirming order…';
      showToast('Still confirming order…', 'warning');
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
    state.ui.prediction.state = 'requesting';
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
  const selection = resolvePlayablePredictionSelection({
    markets: prediction.markets,
    selectedRail: prediction.selectedRail,
    selectedRound: prediction.selectedRound,
    selectedMarketId: prediction.selectedMarketId
  });
  prediction.selectedRail = selection.selectedRail;
  prediction.selectedRound = selection.selectedRound;
  prediction.selectedMarketId = selection.selectedMarketId;
  const allMarkets = selection.markets;
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

  const selectedRail = selection.selectedRail;
  const selectedRound = selection.selectedRound;
  const markets = selection.railMarkets;
  const selected = selection.selected;

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
    if (mode === 'requesting') {
      setStationStatus(statusEl, 'Loading markets…', 'neutral');
    } else if (mode === 'pending') {
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
