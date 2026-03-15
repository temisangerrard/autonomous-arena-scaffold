import {
  setPendingBtn,
  clearPendingBtn,
  flashBtn,
  startTimer,
  clearTimer,
  DEALER_PREFLIGHT_TIMEOUT_MS,
  DEALER_PICK_TIMEOUT_MS
} from './helpers.js';

const RED_SUITS = new Set(['♥', '♦']);

function cardSuit(card) {
  // Card format: rank + suit symbol (e.g. "A♥", "10♠", "K♦")
  return card ? card.slice(-1) : '';
}

function renderCard(card) {
  if (!card || card === '?') {
    return '<span class="bj-card bj-card--hole">?</span>';
  }
  const suit = cardSuit(card);
  const cls = RED_SUITS.has(suit) ? 'bj-card bj-card--red' : 'bj-card';
  return `<span class="${cls}">${card}</span>`;
}

function renderHand(cards) {
  if (!cards || !cards.length) return '';
  return cards.map(renderCard).join('');
}

export function mountBlackjackPanel(params) {
  const { state, stationUi, station, sendStationInteract, makePlayerSeed, showToast } = params;

  state.ui.dealer.gameType = 'blackjack';
  const curWager = Math.max(0, Math.min(10000, Number(state.ui.dealer.wager || 1)));
  stationUi.innerHTML = `
    <div class="game-panel">
      <div class="game-panel__title">Blackjack</div>
      <div class="game-panel__rule">Beat the dealer — get closer to 21 without going over.</div>
      <div class="game-panel__wager-row">
        <label class="game-panel__wager-label" for="station-wager">Wager <span class="game-panel__currency">USDC</span></label>
        <input class="game-panel__wager-input" id="station-wager" type="number" min="0" max="10000" step="1" value="${curWager}" />
      </div>
      <div class="game-panel__stage" id="station-stage">
        <button id="bj-deal-btn" class="game-panel__play-btn" type="button">
          <span class="game-panel__play-icon">▶</span> Deal
        </button>
      </div>
      <div id="bj-hands" class="bj-hands" style="display:none;">
        <div class="bj-hand-row">
          <div class="bj-hand-label">Dealer <span id="bj-dealer-val" class="bj-hand-value"></span></div>
          <div class="bj-cards" id="bj-dealer-cards"></div>
        </div>
        <div class="bj-hand-row">
          <div class="bj-hand-label">You <span id="bj-player-val" class="bj-hand-value"></span></div>
          <div class="bj-cards" id="bj-player-cards"></div>
        </div>
      </div>
      <div class="bj-actions" id="bj-actions" style="display:none;">
        <button id="bj-hit-btn" class="game-panel__pick-btn" type="button">HIT</button>
        <button id="bj-stand-btn" class="game-panel__pick-btn" type="button">STAND</button>
      </div>
      <div class="game-panel__status" id="station-status">Set your wager and press Deal.</div>
    </div>
  `;

  const wagerEl = document.getElementById('station-wager');
  const dealBtn = document.getElementById('bj-deal-btn');
  const stageEl = document.getElementById('station-stage');
  const handsEl = document.getElementById('bj-hands');
  const actionsEl = document.getElementById('bj-actions');
  const statusEl = document.getElementById('station-status');
  const hitBtn = document.getElementById('bj-hit-btn');
  const standBtn = document.getElementById('bj-stand-btn');

  function setStatus(text, tone) {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.className = 'game-panel__status' + (tone ? ` game-panel__status--${tone}` : '');
  }

  function setActionsLocked(locked) {
    if (hitBtn) hitBtn.disabled = locked;
    if (standBtn) standBtn.disabled = locked;
  }

  function onTimeout() {
    clearTimer('dealer:preflight');
    clearTimer('dealer:pick');
    state.ui.dealer.state = 'error';
    state.ui.dealer.reasonText = 'No server response. Try again.';
    clearPendingBtn(dealBtn, '▶ Deal');
    flashBtn(dealBtn, 'is-failed');
    clearPendingBtn(hitBtn, 'HIT');
    clearPendingBtn(standBtn, 'STAND');
    setActionsLocked(false);
    if (actionsEl) actionsEl.style.display = 'none';
    if (stageEl) stageEl.style.display = 'flex';
    setStatus('No server response. Try again.', 'error');
    showToast?.('Station timed out. Retry.', 'error');
  }

  function sendDeal() {
    const wager = Math.max(0, Math.min(10000, Number(wagerEl?.value || 0)));
    if (!sendStationInteract(station, 'blackjack_start', { wager, playerSeed: makePlayerSeed() })) return;
    state.ui.dealer.state = 'preflight';
    state.ui.dealer.wager = wager;
    if (wagerEl) wagerEl.disabled = true;
    setPendingBtn(dealBtn, 'Dealing…');
    setStatus('Dealing cards…', 'loading');
    if (handsEl) handsEl.style.display = 'none';
    if (actionsEl) actionsEl.style.display = 'none';
    startTimer('dealer:preflight', onTimeout, DEALER_PREFLIGHT_TIMEOUT_MS);
  }

  function sendHit() {
    if (!sendStationInteract(station, 'blackjack_hit', {})) return;
    state.ui.dealer.state = 'dealing';
    setActionsLocked(true);
    setStatus('Drawing card…', 'loading');
    startTimer('dealer:pick', onTimeout, DEALER_PICK_TIMEOUT_MS);
  }

  function sendStand() {
    if (!sendStationInteract(station, 'blackjack_stand', {})) return;
    state.ui.dealer.state = 'dealing';
    setActionsLocked(true);
    setStatus('Dealer drawing…', 'loading');
    startTimer('dealer:pick', onTimeout, DEALER_PICK_TIMEOUT_MS);
  }

  if (dealBtn) dealBtn.onclick = () => sendDeal();
  if (hitBtn) hitBtn.onclick = () => { setPendingBtn(hitBtn, 'HIT…'); sendHit(); };
  if (standBtn) standBtn.onclick = () => { setPendingBtn(standBtn, 'STAND…'); sendStand(); };
}

export function updateBlackjackLive(params) {
  const { state, station, renderDealerRevealStatus, clearPendingBtn, flashBtn, clearTimer } = params;

  function dealerStationMatches(st) {
    const dsid = String(state.ui.dealer.stationId || '');
    return dsid === st.id || dsid === String(st.proxyStationId || '');
  }

  const dealBtn = document.getElementById('bj-deal-btn');
  const stageEl = document.getElementById('station-stage');
  const handsEl = document.getElementById('bj-hands');
  const actionsEl = document.getElementById('bj-actions');
  const statusEl = document.getElementById('station-status');
  const hitBtn = document.getElementById('bj-hit-btn');
  const standBtn = document.getElementById('bj-stand-btn');
  const dealerCardsEl = document.getElementById('bj-dealer-cards');
  const playerCardsEl = document.getElementById('bj-player-cards');
  const dealerValEl = document.getElementById('bj-dealer-val');
  const playerValEl = document.getElementById('bj-player-val');
  const wagerEl = document.getElementById('station-wager');

  function setStatus(text, tone) {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.className = 'game-panel__status' + (tone ? ` game-panel__status--${tone}` : '');
  }

  function updateHandDisplay() {
    const ph = state.ui.dealer.playerHand || [];
    const dh = state.ui.dealer.dealerHand || [];
    const pv = Number(state.ui.dealer.playerHandValue || 0);
    const dsv = Number(state.ui.dealer.dealerShowValue || 0);
    const dvFull = Number(state.ui.dealer.dealerHandValue || 0);
    const ds = state.ui.dealer.state;
    const isBust = pv > 21;

    if (playerCardsEl) playerCardsEl.innerHTML = renderHand(ph);
    if (dealerCardsEl) dealerCardsEl.innerHTML = renderHand(dh);
    if (playerValEl) {
      playerValEl.textContent = pv > 0 ? `(${pv}${isBust ? ' BUST' : (state.ui.dealer.isSoft ? ' soft' : '')})` : '';
      playerValEl.className = 'bj-hand-value' + (isBust ? ' bj-hand-value--bust' : '');
    }
    if (dealerValEl) {
      const showVal = ds === 'reveal' ? dvFull : dsv;
      dealerValEl.textContent = showVal > 0 ? `(${showVal}${ds === 'reveal' && dvFull > 21 ? ' BUST' : ''})` : '';
      dealerValEl.className = 'bj-hand-value' + (ds === 'reveal' && dvFull > 21 ? ' bj-hand-value--bust' : '');
    }
  }

  const ds = state.ui.dealer.state;
  if (ds !== 'preflight') clearTimer('dealer:preflight');

  if (ds === 'ready' && dealerStationMatches(station)) {
    clearTimer('dealer:preflight');
    clearTimer('dealer:pick');
    if (dealBtn) delete dealBtn.dataset.panelState;
    clearPendingBtn(dealBtn, '▶ Deal');
    if (hitBtn) { hitBtn.disabled = false; clearPendingBtn(hitBtn, 'HIT'); }
    if (standBtn) { standBtn.disabled = false; clearPendingBtn(standBtn, 'STAND'); }
    if (stageEl) stageEl.style.display = 'none';
    if (handsEl) handsEl.style.display = 'grid';
    if (actionsEl) actionsEl.style.display = 'flex';
    if (wagerEl) wagerEl.disabled = true;
    updateHandDisplay();
    const pv = Number(state.ui.dealer.playerHandValue || 0);
    setStatus(`Your total: ${pv}${state.ui.dealer.isSoft ? ' (soft)' : ''} — HIT or STAND?`, 'prompt');
  } else if (ds === 'preflight' || ds === 'dealing') {
    if (dealBtn) delete dealBtn.dataset.panelState;
    if (hitBtn) hitBtn.disabled = true;
    if (standBtn) standBtn.disabled = true;
    setStatus('Waiting…', 'loading');
  } else if (ds === 'error') {
    clearTimer('dealer:preflight');
    clearTimer('dealer:pick');
    if (dealBtn) delete dealBtn.dataset.panelState;
    clearPendingBtn(dealBtn, '▶ Deal');
    flashBtn(dealBtn, 'is-failed');
    clearPendingBtn(hitBtn, 'HIT');
    clearPendingBtn(standBtn, 'STAND');
    if (actionsEl) actionsEl.style.display = 'none';
    if (handsEl) handsEl.style.display = 'none';
    if (stageEl) stageEl.style.display = 'flex';
    if (wagerEl) wagerEl.disabled = false;
    setStatus(state.ui.dealer.reasonText || 'Something went wrong. Try again.', 'error');
  } else if (ds === 'reveal') {
    clearTimer('dealer:preflight');
    clearTimer('dealer:pick');
    clearPendingBtn(hitBtn, 'HIT');
    clearPendingBtn(standBtn, 'STAND');
    if (hitBtn) hitBtn.disabled = true;
    if (standBtn) standBtn.disabled = true;
    if (actionsEl) actionsEl.style.display = 'none';
    if (stageEl) stageEl.style.display = 'flex';
    if (handsEl) handsEl.style.display = 'grid';
    if (dealBtn && dealBtn.dataset.panelState !== 'reveal') {
      clearPendingBtn(dealBtn, '▶ Play Again');
      dealBtn.innerHTML = '<span class="game-panel__play-icon">▶</span> Play Again';
      flashBtn(dealBtn, 'is-success');
      dealBtn.dataset.panelState = 'reveal';
    }
    if (wagerEl) wagerEl.disabled = false;
    updateHandDisplay();
    if (statusEl) {
      const delta = Number(state.ui.dealer.payoutDelta || 0);
      const tone = delta > 0 ? 'success' : delta < 0 ? 'error' : '';
      const tx = state.ui.dealer.escrowTx?.resolve || state.ui.dealer.escrowTx?.refund || state.ui.dealer.escrowTx?.lock || '';
      const revealKey = `${state.ui.dealer.playerHandValue}|${state.ui.dealer.dealerHandValue}|${delta}|${tx}`;
      if (statusEl.dataset.revealKey !== revealKey) {
        statusEl.dataset.revealKey = revealKey;
        statusEl.className = `game-panel__status${tone ? ` game-panel__status--${tone}` : ''}`;
        renderDealerRevealStatus(statusEl, {
          gameType: 'blackjack',
          playerHandValue: state.ui.dealer.playerHandValue,
          dealerHandValue: state.ui.dealer.dealerHandValue,
          delta,
          txHash: tx,
          walletBalance: state.walletBalance,
          chainId: state.walletChainId
        });
      }
    }
  }
}
