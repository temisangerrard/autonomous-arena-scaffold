/**
 * Interaction card orchestrator – dispatches to panel modules by station kind.
 * Uses plugin registry for station metadata when available.
 */
import {
  setPendingBtn,
  clearPendingBtn,
  flashBtn,
  startTimer,
  clearTimer,
  hideNpcInfoPanel,
  showNpcInfoPanel
} from './helpers.js';
import { mountCoinflipPanel, updateCoinflipLive } from './coinflip-panel.js';
import { mountRpsDicePanel, updateRpsDiceLive } from './rps-dice-panel.js';
import { mountBlackjackPanel, updateBlackjackLive } from './blackjack-panel.js';
import { mountPredictionPanel, updatePredictionLive } from './prediction-panel.js';
import { mountCashierPanel } from './cashier-panel.js';
import { mountWorldPanel } from './world-panel.js';

export { showNpcInfoPanel, hideNpcInfoPanel, setPendingBtn, clearPendingBtn, flashBtn, clearTimer } from './helpers.js';

export function resolvePredictionRouteStation(state, fromStation) {
  const allPredictionStations = state.stations instanceof Map
    ? [...state.stations.values()].filter((entry) => entry && entry.kind === 'dealer_prediction')
    : [];
  if (allPredictionStations.length === 0) return null;
  const explicitProxy = String(fromStation?.proxyStationId || '').trim();
  if (explicitProxy) {
    const proxied = allPredictionStations.find((entry) => entry.id === explicitProxy);
    if (proxied) return proxied;
  }
  const me = state.playerId ? state.players.get(state.playerId) : null;
  const originX = Number(me?.x ?? me?.displayX ?? fromStation?.x ?? 0);
  const originZ = Number(me?.z ?? me?.displayZ ?? fromStation?.z ?? 0);
  let best = allPredictionStations[0] || null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const entry of allPredictionStations) {
    const dist = Math.hypot(Number(entry.x || 0) - originX, Number(entry.z || 0) - originZ);
    const score = dist + (entry.source === 'server' ? 0 : 1000);
    if (score < bestScore) {
      best = entry;
      bestScore = score;
    }
  }
  return best;
}

function getStationHelpContent(station) {
  if (!station) return null;
  if (station.kind === 'cashier_bank') {
    return 'Cashier lets you <strong>fund</strong>, <strong>withdraw</strong>, or <strong>transfer</strong>. Use small test amounts first.';
  }
  return 'This station supports local interactions. Press <strong>Inspect</strong> for context or <strong>Use</strong> for the primary action.';
}

export function renderInteractionCardTemplate(params) {
  const {
    state,
    interactionCard,
    interactionTitle,
    interactionHelpToggle,
    interactionHelp,
    interactionNpcInfo,
    stationUi,
    stateful,
    setInteractOpen,
    getUiTargetId,
    isStation,
    labelFor,
    challengeController,
    normalizedChallengeGameType,
    normalizedChallengeWager,
    formatWagerInline,
    formatUsdAmount,
    formatPredictionPrice,
    formatPredictionClose,
    buildSessionHeaders,
    syncWalletSummary,
    showToast,
    ensureEscrowApproval,
    sendStationInteract,
    renderGuideStationDetail,
    setStationStatus,
    renderDealerRevealStatus,
    makePlayerSeed,
    pluginRegistry
  } = params;

  let interactionStationRenderKey = String(stateful?.interactionStationRenderKey || '');
  let interactionPlayerRenderKey = String(stateful?.interactionPlayerRenderKey || '');

  const baseParams = {
    state,
    stationUi,
    sendStationInteract,
    makePlayerSeed,
    showToast,
    buildSessionHeaders,
    syncWalletSummary,
    formatUsdAmount,
    formatPredictionClose,
    setStationStatus,
    renderDealerRevealStatus
  };

  try {
    if (!interactionCard || !interactionTitle) return;

    const active = state.activeChallenge;
    const inMatch = Boolean(active && active.status === 'active');
    const isHouseChallenge = Boolean(
      active && (active.challengerId === 'system_house' || active.opponentId === 'system_house')
    );
    if (inMatch && !isHouseChallenge && state.ui.interactionMode !== 'station') {
      setInteractOpen(false);
      return;
    }
    if (!state.ui.interactOpen) return;

    const targetId = getUiTargetId();
    if (!targetId) {
      setInteractOpen(false);
      return;
    }

    const station = isStation(targetId) && state.stations instanceof Map ? state.stations.get(targetId) : null;
    const targetPlayer = state.players.get(targetId);

    const dealerKinds = ['dealer_coinflip', 'dealer_rps', 'dealer_dice_duel', 'dealer_prediction', 'dealer_blackjack'];
    const showHelpToggle = Boolean(station && !dealerKinds.includes(station.kind));
    if (interactionHelpToggle) interactionHelpToggle.hidden = !showHelpToggle;
    if (interactionHelp) {
      if (!showHelpToggle) {
        interactionHelp.hidden = true;
        interactionHelpToggle?.setAttribute('aria-expanded', 'false');
      } else {
        const helpContent = getStationHelpContent(station);
        interactionHelp.innerHTML = helpContent || 'Use this station.';
      }
    }

    if (station && state.ui.interactionMode !== 'station') state.ui.interactionMode = 'station';
    if (!station && targetPlayer && state.ui.interactionMode !== 'player') state.ui.interactionMode = 'player';

    const stationRenderKey = station
      ? `${station.id}:${station.kind}:${station.proxyStationId || ''}:${station.proxyMissing ? 'missing' : 'ready'}`
      : '';

    hideNpcInfoPanel(interactionNpcInfo);
    if (!stationUi) return;

    if (station && state.ui.interactionMode === 'station') {
      interactionPlayerRenderKey = '';
      interactionTitle.textContent = station.displayName || 'Station';
      stationUi.hidden = false;
      stationUi.style.display = 'grid';

      if (interactionStationRenderKey !== stationRenderKey) {
        interactionStationRenderKey = stationRenderKey;
        stationUi.dataset.predictionMode = '';

        if (station.source === 'host' && station.proxyMissing) {
          stationUi.innerHTML = `
            <div class="station-ui__title">${station.displayName || 'Station'}</div>
            <div class="station-ui__meta station-ui__meta--warning">
              Station unavailable right now. Server station mapping is missing; retry shortly.
            </div>
          `;
          if (stateful && typeof stateful === 'object') {
            stateful.interactionStationRenderKey = interactionStationRenderKey;
            stateful.interactionPlayerRenderKey = interactionPlayerRenderKey;
          }
          return;
        }

        function dealerStationMatches(st) {
          const dsid = String(state.ui.dealer.stationId || '');
          return dsid === st.id || dsid === String(st.proxyStationId || '');
        }

        const resolvePredictionRouteStationForMount = (fromStation) =>
          resolvePredictionRouteStation(state, fromStation);

        if (station.kind === 'dealer_blackjack') {
          mountBlackjackPanel({ ...baseParams, station });
        } else if (station.kind === 'dealer_coinflip') {
          mountCoinflipPanel({ ...baseParams, station });
        } else if (station.kind === 'dealer_rps' || station.kind === 'dealer_dice_duel') {
          mountRpsDicePanel({ ...baseParams, station });
        } else if (station.kind === 'dealer_prediction') {
          mountPredictionPanel({ ...baseParams, station, kioskMode: false });
        } else if (station.kind === 'cashier_bank') {
          mountCashierPanel(baseParams);
        } else if (station.kind === 'world_interactable') {
          mountWorldPanel({
            ...baseParams,
            station,
            interactionTitle,
            resolvePredictionRouteStation: resolvePredictionRouteStationForMount,
            mountPredictionPanel: (opts) => mountPredictionPanel({ ...baseParams, ...opts })
          });
        } else {
          stationUi.innerHTML = `<div class="station-ui__meta">Unknown station.</div>`;
        }
      }

      if (station.kind === 'dealer_blackjack') {
        updateBlackjackLive({
          ...baseParams,
          station,
          setPendingBtn,
          clearPendingBtn,
          flashBtn,
          clearTimer
        });
      } else if (station.kind === 'dealer_coinflip') {
        updateCoinflipLive({
          ...baseParams,
          station,
          setPendingBtn,
          clearPendingBtn,
          flashBtn,
          clearTimer
        });
      } else if (station.kind === 'dealer_rps' || station.kind === 'dealer_dice_duel') {
        updateRpsDiceLive({
          ...baseParams,
          station,
          clearPendingBtn,
          flashBtn,
          clearTimer
        });
      } else if (station.kind === 'dealer_prediction' || stationUi.dataset.predictionMode === 'kiosk') {
        updatePredictionLive({
          ...baseParams,
          clearPendingBtn,
          flashBtn,
          clearTimer
        });
      }

      if (stateful && typeof stateful === 'object') {
        stateful.interactionStationRenderKey = interactionStationRenderKey;
        stateful.interactionPlayerRenderKey = interactionPlayerRenderKey;
      }
      return;
    }

    stationUi.hidden = true;
    stationUi.style.display = 'none';
    stationUi.innerHTML = '';
    stationUi.dataset.predictionMode = '';
    stationUi.classList.remove('station-ui--npc');
    interactionStationRenderKey = '';

    if (interactionNpcInfo && targetPlayer && state.ui.interactionMode === 'player') {
      interactionTitle.textContent = `Challenge: ${labelFor(targetId)}`;
      showNpcInfoPanel(interactionNpcInfo);

      const incoming = challengeController.currentIncomingChallenge();
      const playerView = String(state.ui?.playerView || 'encounter');
      const outgoingPending = Boolean(state.outgoingChallengeId);
      const targetNearby = state.nearbyIds instanceof Set && state.nearbyIds.has(targetId);
      const canSendBase = state.wsConnected && !state.respondingIncoming && !outgoingPending && targetId !== state.playerId && targetNearby;
      const selectedGame = normalizedChallengeGameType(state.ui?.challenge?.gameType || 'rps');
      const selectedWager = normalizedChallengeWager(state.ui?.challenge?.wager ?? 1, 1);
      const approvalMode = String(state.escrowApproval?.mode || 'manual');
      const approvalModeAuto = approvalMode === 'auto';
      const approvalState = String(state.ui?.challenge?.approvalState || 'idle');
      const approvalMessage = String(state.ui?.challenge?.approvalMessage || '').trim();
      const approvalCap = Number(state.walletEscrowApprovalCapUsdc || 0);
      const approvalCapLabel = approvalCap > 0 ? `Approve ${formatUsdAmount(approvalCap)} Cap` : 'Approve Escrow';
      const approvalReady = approvalState === 'ready' && Number(state.ui?.challenge?.approvalWager || 0) >= selectedWager;
      const canSend = canSendBase && (selectedWager <= 0 || approvalModeAuto || approvalReady);
      const approvalHint = selectedWager > 0
        ? (approvalModeAuto
            ? 'Super Agent Approval Active (Testnet). Wagered challenges are prepared automatically.'
            : (approvalMessage || (approvalReady
                ? `Escrow approval ready for wagers up to ${formatUsdAmount(Number(state.ui?.challenge?.approvalWager || selectedWager))}.`
                : (approvalCap > 0
                    ? `Approve a ${formatUsdAmount(approvalCap)} escrow cap to enable wagers and autoplay.`
                    : `Approve escrow to place wager (${formatUsdAmount(selectedWager)}).`))))
        : 'Free wager selected. No escrow approval needed.';
      const incomingLabel = incoming
        ? `${labelFor(incoming.challengerId)} challenged you (${incoming.gameType.toUpperCase()}, ${formatWagerInline(incoming.wager)}).`
        : '';

      const challengeMsg = String(state.playerChallengeMessage || '');
      const playerRenderKey = [
        targetId,
        selectedGame,
        selectedWager,
        approvalMode,
        approvalState,
        approvalMessage,
        Number(state.ui?.challenge?.approvalWager || 0),
        incoming?.id || '',
        incoming?.challengerId || '',
        incoming?.gameType || '',
        incoming?.wager || '',
        outgoingPending ? 'outgoing' : 'idle',
        targetNearby ? 'nearby' : 'far',
        canSend ? 'send' : 'blocked',
        challengeMsg
      ].join('|');

      if (interactionPlayerRenderKey !== playerRenderKey) {
        interactionPlayerRenderKey = playerRenderKey;
        const showApprove = selectedWager > 0 && !approvalModeAuto;
        const recentMsg = !outgoingPending && !incoming && challengeMsg ? challengeMsg : '';
        const statusLine = incomingLabel
          || recentMsg
          || (targetNearby ? 'Pick a game and send a challenge.' : 'Move closer to challenge.')
          + (outgoingPending ? ' Challenge already pending.' : '');
        const approvalMeta = approvalModeAuto
          ? '<div class="station-ui__meta">Super Agent active — wager approvals handled automatically.</div>'
          : (selectedWager > 0 ? `<div class="station-ui__meta">${approvalHint}</div>` : '');

        const isTouch = typeof window !== 'undefined' && Boolean(window.matchMedia?.('(pointer: coarse)').matches || navigator.maxTouchPoints > 0);
        const gameIcons = { rps: '✊', coinflip: '🪙', dice_duel: '🎲' };
        const gameLabels = { rps: 'RPS', coinflip: 'Coin Flip', dice_duel: 'Dice Duel' };
        const roleLabel = targetPlayer.role === 'agent' ? 'Bot' : 'Player';
        const movementLabel = Number(targetPlayer.speed || 0) > 0.2 ? 'Active' : 'Parked';
        const proximityLabel = targetNearby ? 'In range' : 'Out of range';

        if (!incoming && !outgoingPending && playerView !== 'challenge') {
          interactionNpcInfo.innerHTML = `
            <div class="player-encounter-card">
              <div class="player-encounter-card__head">
                <div>
                  <div class="station-ui__title">Encounter</div>
                  <div class="player-encounter-card__name">${labelFor(targetId)}</div>
                </div>
                <div class="player-encounter-card__badges">
                  <span class="player-encounter-card__badge">${roleLabel}</span>
                  <span class="player-encounter-card__badge">${movementLabel}</span>
                  <span class="player-encounter-card__badge ${targetNearby ? 'is-live' : 'is-muted'}">${proximityLabel}</span>
                </div>
              </div>
              <div class="station-ui__meta">
                ${targetNearby
                  ? `You are in range of ${labelFor(targetId)}. Open the challenge composer when you are ready to play.`
                  : `${labelFor(targetId)} moved out of range. Stay locked here or move closer to challenge.`}
              </div>
              <div class="station-ui__actions">
                <button id="player-encounter-challenge" class="btn-lock-in" type="button" ${targetNearby ? '' : 'disabled'}>Open Challenge</button>
              </div>
            </div>
          `;

          const encounterChallengeBtn = document.getElementById('player-encounter-challenge');
          if (encounterChallengeBtn instanceof HTMLButtonElement) {
            encounterChallengeBtn.onclick = () => {
              state.ui.playerView = 'challenge';
            };
          }
          if (stateful && typeof stateful === 'object') {
            stateful.interactionStationRenderKey = interactionStationRenderKey;
            stateful.interactionPlayerRenderKey = interactionPlayerRenderKey;
          }
          return;
        }

        interactionNpcInfo.innerHTML = `
          <div class="station-ui__title">${labelFor(targetId)}</div>

          ${incoming ? `
          <div class="challenge-incoming">
            <div class="challenge-incoming__label">⚡ Incoming challenge</div>
            <div class="challenge-incoming__desc">
              ${labelFor(incoming.challengerId)} wants to play
              <strong>${gameLabels[incoming.gameType] || incoming.gameType.toUpperCase()}</strong>
              — wager <strong>${formatWagerInline(incoming.wager)}</strong> each
            </div>
            <div class="challenge-incoming__actions">
              <button id="player-challenge-accept" class="btn-accept" type="button" ${!state.respondingIncoming ? '' : 'disabled'}>${isTouch ? 'Accept' : 'Accept (Y)'}</button>
              <button id="player-challenge-decline" class="btn-decline" type="button" ${!state.respondingIncoming ? '' : 'disabled'}>${isTouch ? 'Decline' : 'Decline (N)'}</button>
            </div>
          </div>
          ` : ''}

          ${outgoingPending ? `
          <div class="challenge-pending-badge">
            <div class="challenge-pending-badge__dot"></div>
            Challenge sent — waiting for response…
          </div>
          ` : `
          <div class="station-ui__actions">
            <button id="player-challenge-back" class="btn-decline" type="button">Back</button>
          </div>
          <div class="challenge-game-picker">
            <button class="challenge-game-btn ${selectedGame === 'rps' ? 'is-selected' : ''}" data-game="rps" type="button">
              <span class="challenge-game-btn__icon">${gameIcons.rps}</span>RPS
            </button>
            <button class="challenge-game-btn ${selectedGame === 'coinflip' ? 'is-selected' : ''}" data-game="coinflip" type="button">
              <span class="challenge-game-btn__icon">${gameIcons.coinflip}</span>Coin Flip
            </button>
            <button class="challenge-game-btn ${selectedGame === 'dice_duel' ? 'is-selected' : ''}" data-game="dice_duel" type="button">
              <span class="challenge-game-btn__icon">${gameIcons.dice_duel}</span>Dice Duel
            </button>
          </div>

          <div class="challenge-wager-row">
            <span class="challenge-wager-label">Wager USDC</span>
            <input id="player-challenge-wager" class="challenge-wager-input" type="number" min="0" max="10000" step="1" value="${selectedWager}" />
          </div>

          ${showApprove ? `<button id="player-challenge-approve" class="btn-approve-escrow" type="button" ${approvalState !== 'checking' ? '' : 'disabled'}>${approvalState === 'checking' ? 'Checking escrow…' : approvalCapLabel}</button>` : ''}

          <div class="challenge-status ${approvalHint.includes('ready') || selectedWager <= 0 ? 'challenge-status--ok' : (showApprove && !approvalReady ? 'challenge-status--warn' : '')}">${recentMsg || statusLine}</div>

          <button id="player-challenge-send" class="btn-lock-in" type="button" ${canSend ? '' : 'disabled'}>${isTouch ? 'Lock In Challenge' : 'Lock In Challenge (C)'}</button>
          `}
        `;

        const renderedTargetId = targetId;
        const wagerEl = document.getElementById('player-challenge-wager');
        const approveBtn = document.getElementById('player-challenge-approve');
        const sendBtn = document.getElementById('player-challenge-send');
        const backBtn = document.getElementById('player-challenge-back');
        const acceptBtn = document.getElementById('player-challenge-accept');
        const declineBtn = document.getElementById('player-challenge-decline');

        const lockInLabel = isTouch ? 'Lock In Challenge' : 'Lock In Challenge (C)';
        if (outgoingPending || state.challengeStatus === 'active') {
          clearTimer('challenge:send');
          clearPendingBtn(sendBtn, lockInLabel);
        }
        if (!state.respondingIncoming) {
          clearTimer('challenge:respond');
          clearPendingBtn(acceptBtn, 'Accept (Y)');
          clearPendingBtn(declineBtn, 'Decline (N)');
        }

        // Game picker buttons
        interactionNpcInfo.querySelectorAll('.challenge-game-btn').forEach((btn) => {
          btn.addEventListener('click', () => {
            const game = btn.dataset.game;
            if (!game) return;
            state.ui.challenge.gameType = normalizedChallengeGameType(game);
            interactionNpcInfo.querySelectorAll('.challenge-game-btn').forEach((b) => {
              b.classList.toggle('is-selected', b.dataset.game === game);
            });
          });
        });

        if (wagerEl instanceof HTMLInputElement) {
          wagerEl.oninput = () => {
            const wager = normalizedChallengeWager(wagerEl.value, 1);
            state.ui.challenge.wager = wager;
            if (wager <= 0) {
              state.ui.challenge.approvalState = 'idle';
              state.ui.challenge.approvalMessage = '';
              state.ui.challenge.approvalWager = 0;
              return;
            }
            if (approvalModeAuto) {
              state.ui.challenge.approvalState = 'ready';
              state.ui.challenge.approvalWager = wager;
              state.ui.challenge.approvalMessage = 'Testnet mode: approvals handled automatically.';
              return;
            }
            if (Number(state.ui.challenge.approvalWager || 0) < wager) {
              state.ui.challenge.approvalState = 'required';
            }
          };
        }
        if (approveBtn instanceof HTMLButtonElement) {
          approveBtn.onclick = () => {
            const wager = wagerEl instanceof HTMLInputElement ? wagerEl.value : state.ui.challenge.wager;
            void ensureEscrowApproval(wager);
          };
        }
        if (backBtn instanceof HTMLButtonElement) {
          backBtn.onclick = () => {
            state.ui.playerView = 'encounter';
          };
        }
        if (sendBtn instanceof HTMLButtonElement) {
          sendBtn.onclick = () => {
            const wager = wagerEl instanceof HTMLInputElement ? wagerEl.value : state.ui.challenge.wager;
            const gameType = state.ui.challenge.gameType;
            setPendingBtn(sendBtn, 'Locking In…');
            startTimer('challenge:send', () => {
              clearPendingBtn(sendBtn, 'Lock In Challenge (C)');
              showToast('No server response. Try again.', 'error');
            }, 7000);
            const sent = challengeController.sendChallenge(renderedTargetId, gameType, wager);
            if (!sent) {
              clearTimer('challenge:send');
              clearPendingBtn(sendBtn, 'Lock In Challenge (C)');
            }
          };
        }
        if (acceptBtn instanceof HTMLButtonElement) {
          acceptBtn.onclick = () => {
            setPendingBtn(acceptBtn, 'Accepting…');
            startTimer('challenge:respond', () => {
              clearPendingBtn(acceptBtn, 'Accept (Y)');
              showToast('No server response. Try again.', 'error');
            }, 7000);
            const sent = challengeController.respondToIncoming(true);
            if (!sent) {
              clearTimer('challenge:respond');
              clearPendingBtn(acceptBtn, 'Accept (Y)');
            }
          };
        }
        if (declineBtn instanceof HTMLButtonElement) {
          declineBtn.onclick = () => {
            setPendingBtn(declineBtn, 'Declining…');
            startTimer('challenge:respond', () => {
              clearPendingBtn(declineBtn, 'Decline (N)');
              showToast('No server response. Try again.', 'error');
            }, 7000);
            const sent = challengeController.respondToIncoming(false);
            if (!sent) {
              clearTimer('challenge:respond');
              clearPendingBtn(declineBtn, 'Decline (N)');
            }
          };
        }
      }
    } else {
      interactionPlayerRenderKey = '';
    }

    if (stateful && typeof stateful === 'object') {
      stateful.interactionStationRenderKey = interactionStationRenderKey;
      stateful.interactionPlayerRenderKey = interactionPlayerRenderKey;
    }
  } finally {
    if (stateful && typeof stateful === 'object') {
      stateful.interactionStationRenderKey = interactionStationRenderKey;
      stateful.interactionPlayerRenderKey = interactionPlayerRenderKey;
    }
  }
}
