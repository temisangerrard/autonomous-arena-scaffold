import { setPendingBtn, clearPendingBtn, startTimer, clearTimer } from './helpers.js';

export function mountWorldPanel(params) {
  const {
    state,
    stationUi,
    station,
    interactionTitle,
    sendStationInteract,
    renderGuideStationDetail,
    resolvePredictionRouteStation,
    mountPredictionPanel
  } = params;

  const isMarketBoardStation = String(station.interactionTag || '').includes('world_baked');
  if (isMarketBoardStation) {
    const routeStation = resolvePredictionRouteStation(station);
    if (interactionTitle) {
      interactionTitle.innerHTML = `Market Terminal<span class="interaction-card__subtitle">live board</span>`;
    }
    mountPredictionPanel({ ...params, station: routeStation, kioskMode: true });
    return;
  }

  const localInteraction = station.localInteraction || {};
  const detail = state.ui.world.stationId === station.id
    ? state.ui.world.detail
    : (localInteraction.inspect || 'This host can route you to live action.');
  const actionLabel = state.ui.world.stationId === station.id
    ? state.ui.world.actionLabel
    : (localInteraction.useLabel || 'Open route');
  const npcName = localInteraction.title || station.displayName;

  if (interactionTitle) {
    const tag = station.interactionTag ? station.interactionTag.replace(/_/g, ' ') : 'host';
    interactionTitle.innerHTML = `${npcName}<span class="interaction-card__subtitle">${tag}</span>`;
  }
  stationUi.classList.add('station-ui--npc');
  stationUi.innerHTML = `
    <div class="npc-speech__bubble" id="world-interaction-detail">${detail}</div>
    <div class="station-ui__actions">
      <button id="world-interaction-use" class="btn-gold" type="button">${actionLabel}</button>
    </div>
  `;

  const useBtn = document.getElementById('world-interaction-use');
  const detailEl = document.getElementById('world-interaction-detail');
  if (useBtn) {
    useBtn.onclick = () => {
      void (async () => {
      if (renderGuideStationDetail(station, 'use')) {
        if (String(localInteraction.routeStationId || '').trim()) {
          setPendingBtn(useBtn, 'Opening…');
          return;
        }
        if (detailEl) {
          detailEl.textContent = state.ui.world.detail || 'Interaction complete.';
        }
        setPendingBtn(useBtn, 'Done');
        startTimer('world:use', () => { clearPendingBtn(useBtn, actionLabel); }, 4000);
        return;
      }
      setPendingBtn(useBtn, 'Opening…');
      startTimer('world:use', () => {
        clearPendingBtn(useBtn, actionLabel);
        params.showToast?.('No server response. Try again.', 'error');
      }, 4000);
      const sent = await sendStationInteract(station, 'interact_use', {
        interactionTag: String(station.interactionTag || '')
      });
      if (!sent) {
        clearTimer('world:use');
        clearPendingBtn(useBtn, actionLabel);
        return;
      }
      if (detailEl) {
        detailEl.textContent = 'Opening live route...';
      }
      })();
    };
  }
  if (state.ui.world.stationId !== station.id) {
    renderGuideStationDetail(station, 'inspect');
  }
}
