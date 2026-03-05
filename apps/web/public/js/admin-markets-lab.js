const el = {
  status: document.getElementById('status'),
  refreshAll: document.getElementById('refresh-all'),
  syncMarkets: document.getElementById('sync-markets'),
  e2eRefresh: document.getElementById('e2e-refresh'),
  e2eStatus: document.getElementById('e2e-status'),
  e2ePlayerMarkets: document.getElementById('e2e-player-markets'),
  e2eNoMarkets: document.getElementById('e2e-no-markets'),
  e2eMarketCount: document.getElementById('e2e-market-count'),
  e2eMarketsBody: document.getElementById('e2e-markets-body'),
  e2eDiagnosis: document.getElementById('e2e-diagnosis'),
  e2eQuoteResult: document.getElementById('e2e-quote-result'),
  e2eQuoteBody: document.getElementById('e2e-quote-body'),
  e2eQuoteClose: document.getElementById('e2e-quote-close'),
  enabledBody: document.getElementById('enabled-body'),
  liveBody: document.getElementById('live-body'),
  liveQuery: document.getElementById('live-query'),
  liveLimit: document.getElementById('live-limit'),
  refreshLive: document.getElementById('refresh-live'),
  kpiEnabled: document.getElementById('kpi-enabled'),
  kpiActive: document.getElementById('kpi-active'),
  kpiLive: document.getElementById('kpi-live'),
  kpiBoth: document.getElementById('kpi-both'),
  kpiRisk: document.getElementById('kpi-risk'),
  simMarket: document.getElementById('sim-market'),
  simSide: document.getElementById('sim-side'),
  simStake: document.getElementById('sim-stake'),
  simRun: document.getElementById('sim-run'),
  simOutput: document.getElementById('sim-output')
};

const state = {
  adminMarkets: [],
  liveMarkets: [],
  liquidityHealth: null,
  eventCounts: []
};

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function setStatus(text, danger = false) {
  if (!el.status) return;
  el.status.textContent = text;
  el.status.style.borderColor = danger ? '#d99f91' : '#d8c8a6';
  el.status.style.color = danger ? '#7a261b' : '#574c3a';
}

async function apiGet(url) {
  const response = await fetch(url, { credentials: 'include' });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(String(payload?.reason || `http_${response.status}`));
  }
  return payload;
}

async function apiPost(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {})
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(String(payload?.reason || `http_${response.status}`));
  }
  return payload;
}

function formatPrice(value) {
  const n = Number(value || 0);
  return `${(Math.max(0, Math.min(1, n)) * 100).toFixed(1)}%`;
}

function formatDate(ts) {
  const n = Number(ts || 0);
  if (!Number.isFinite(n) || n <= 0) return '-';
  return new Date(n).toLocaleString();
}

function renderKpis() {
  const enabled = state.adminMarkets.length;
  const active = state.adminMarkets.filter((entry) => entry.active).length;
  const live = state.liveMarkets.length;
  const both = state.liquidityHealth?.marketsWithBothSides ?? 0;
  const risk = state.liquidityHealth?.refundOnlyRiskMarkets ?? 0;
  if (el.kpiEnabled) el.kpiEnabled.textContent = String(enabled);
  if (el.kpiActive) el.kpiActive.textContent = String(active);
  if (el.kpiLive) el.kpiLive.textContent = String(live);
  if (el.kpiBoth) el.kpiBoth.textContent = String(both);
  if (el.kpiRisk) {
    el.kpiRisk.textContent = String(risk);
    el.kpiRisk.style.color = risk > 0 ? '#a03030' : '';
  }
}

function renderEnabled() {
  if (!el.enabledBody) return;
  if (!Array.isArray(state.adminMarkets) || state.adminMarkets.length === 0) {
    el.enabledBody.innerHTML = '<tr><td colspan="4">No markets in app DB yet. Run sync from Polymarket.</td></tr>';
    return;
  }

  el.enabledBody.innerHTML = state.adminMarkets
    .map((entry) => {
      const marketId = String(entry.id || '');
      return `
        <tr>
          <td>
            <div class="question-text">${escapeHtml(entry.question || marketId)}</div>
            <div class="id-text">${escapeHtml(marketId)}</div>
          </td>
          <td>
            <span class="badge ${entry.active ? 'live' : 'off'}">${entry.active ? 'active' : 'inactive'}</span>
            <div class="mono" style="margin-top:5px;">${escapeHtml(entry.status || '-')} · ${escapeHtml(formatDate(entry.closeAt))}</div>
          </td>
          <td>
            <span class="price-yes">Y ${escapeHtml(formatPrice(entry.yesPrice))}</span>
            &nbsp;<span class="price-no">N ${escapeHtml(formatPrice(entry.noPrice))}</span>
            <div class="mono" style="margin-top:5px;">max ${Number(entry.maxWager || 0).toFixed(0)} · ${Number(entry.houseSpreadBps || 0)} bps</div>
          </td>
          <td>
            <div class="row">
              <button class="btn" data-action="toggle" data-market-id="${escapeHtml(marketId)}" data-active="${entry.active ? '1' : '0'}">${entry.active ? 'Deactivate' : 'Activate'}</button>
              <button class="btn" data-action="adopt" data-market-id="${escapeHtml(marketId)}">Apply Defaults</button>
            </div>
          </td>
        </tr>
      `;
    })
    .join('');
}

function renderLive() {
  if (!el.liveBody) return;
  if (!Array.isArray(state.liveMarkets) || state.liveMarkets.length === 0) {
    el.liveBody.innerHTML = '<tr><td colspan="5">No live markets returned for this query.</td></tr>';
    return;
  }

  el.liveBody.innerHTML = state.liveMarkets
    .map((entry) => {
      const marketId = String(entry.marketId || '');
      return `
        <tr>
          <td>
            <div class="question-text">${escapeHtml(entry.question || marketId)}</div>
            <div class="id-text">${escapeHtml(marketId)}</div>
          </td>
          <td><span class="mono">${escapeHtml((entry.category || '-').toUpperCase())}</span></td>
          <td><span class="price-yes">Y ${escapeHtml(formatPrice(entry.yesPrice))}</span> &nbsp;<span class="price-no">N ${escapeHtml(formatPrice(entry.noPrice))}</span></td>
          <td class="mono">${escapeHtml(formatDate(entry.closeAt))}</td>
          <td><button class="btn btn-gold" data-action="promote" data-market-id="${escapeHtml(marketId)}">Enable In App</button></td>
        </tr>
      `;
    })
    .join('');
}

function renderSimulatorMarkets() {
  if (!el.simMarket) return;
  const options = state.adminMarkets.map((entry) => {
    const id = String(entry.id || '');
    const label = `${String(entry.question || id).slice(0, 84)} (${id})`;
    return `<option value="${escapeHtml(id)}">${escapeHtml(label)}</option>`;
  });
  el.simMarket.innerHTML = options.join('');
}

function simulateQuote() {
  const marketId = String(el.simMarket?.value || '');
  const side = String(el.simSide?.value || 'yes') === 'no' ? 'no' : 'yes';
  const stake = Math.max(1, Math.min(10000, Number(el.simStake?.value || 1)));
  const market = state.adminMarkets.find((entry) => String(entry.id || '') === marketId);
  if (!market) {
    if (el.simOutput) el.simOutput.textContent = 'Select a valid market first.';
    return;
  }
  const spread = Math.max(0, Number(market.houseSpreadBps || 0)) / 10000;
  const base = side === 'yes' ? Number(market.yesPrice || 0.5) : Number(market.noPrice || 0.5);
  const price = Math.max(0.01, Math.min(0.99, base + spread));
  const shares = stake / price;
  const payout = stake / price;
  if (el.simOutput) {
    el.simOutput.textContent = [
      `Market: ${market.question}`,
      `Side: ${side.toUpperCase()} · Stake: ${stake.toFixed(2)} USDC`,
      `Quoted price: ${(price * 100).toFixed(2)}% (base ${(base * 100).toFixed(2)}% + spread ${(spread * 100).toFixed(2)}%)`,
      `Estimated shares: ${shares.toFixed(6)}`,
      `Potential payout: ${payout.toFixed(6)} USDC`
    ].join(' | ');
  }
}

async function loadEnabled() {
  const payload = await apiGet('/api/admin/runtime/markets');
  state.adminMarkets = Array.isArray(payload?.markets) ? payload.markets : [];
  state.liquidityHealth = payload?.liquidityHealth ?? null;
  state.eventCounts = Array.isArray(payload?.eventCounts) ? payload.eventCounts : [];
}

async function loadLive() {
  const query = String(el.liveQuery?.value || '').trim();
  const limit = Math.max(1, Math.min(200, Number(el.liveLimit?.value || 50)));
  const params = new URLSearchParams({ limit: String(limit) });
  if (query) params.set('query', query);
  const payload = await apiGet(`/api/admin/runtime/markets/live?${params.toString()}`);
  state.liveMarkets = Array.isArray(payload?.markets) ? payload.markets : [];
}

async function refreshAll() {
  setStatus('Refreshing enabled + live markets...');
  try {
    await Promise.all([loadEnabled(), loadLive()]);
    renderEnabled();
    renderLive();
    renderKpis();
    renderSimulatorMarkets();
    simulateQuote();
    setStatus(`Markets lab updated at ${new Date().toLocaleTimeString()}.`);
  } catch (error) {
    setStatus(`Refresh failed: ${String(error?.message || error)}`, true);
  }
}

async function syncNow() {
  setStatus('Syncing app market DB from Polymarket...');
  try {
    const payload = await apiPost('/api/admin/runtime/markets/sync', { limit: 80 });
    await refreshAll();
    setStatus(`Sync complete. ${Number(payload?.synced || 0)} markets upserted.`);
  } catch (error) {
    setStatus(`Sync failed: ${String(error?.message || error)}`, true);
  }
}

async function setMarketConfig(marketId, active) {
  await apiPost('/api/admin/runtime/markets/config', {
    marketId,
    active,
    maxWager: 100,
    houseSpreadBps: 300,
    updatedBy: 'admin_markets_lab'
  });
}

function bindEvents() {
  el.refreshAll?.addEventListener('click', () => { void refreshAll(); });
  el.refreshLive?.addEventListener('click', () => { void loadLive().then(() => { renderLive(); renderKpis(); }).catch((err) => setStatus(String(err?.message || err), true)); });
  el.syncMarkets?.addEventListener('click', () => { void syncNow(); });
  el.simRun?.addEventListener('click', () => simulateQuote());
  el.simSide?.addEventListener('change', () => simulateQuote());
  el.simMarket?.addEventListener('change', () => simulateQuote());
  el.simStake?.addEventListener('input', () => simulateQuote());

  el.enabledBody?.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const action = String(target.getAttribute('data-action') || '');
    const marketId = String(target.getAttribute('data-market-id') || '');
    if (!marketId || !action) return;

    if (action === 'toggle') {
      const active = String(target.getAttribute('data-active') || '') !== '1';
      setStatus(`${active ? 'Activating' : 'Deactivating'} ${marketId}...`);
      void setMarketConfig(marketId, active)
        .then(() => refreshAll())
        .catch((err) => setStatus(String(err?.message || err), true));
      return;
    }

    if (action === 'adopt') {
      setStatus(`Applying defaults to ${marketId}...`);
      void setMarketConfig(marketId, true)
        .then(() => refreshAll())
        .catch((err) => setStatus(String(err?.message || err), true));
    }
  });

  el.liveBody?.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const action = String(target.getAttribute('data-action') || '');
    const marketId = String(target.getAttribute('data-market-id') || '');
    if (action !== 'promote' || !marketId) return;
    setStatus(`Enabling live market ${marketId} in app...`);
    void setMarketConfig(marketId, true)
      .then(() => refreshAll())
      .catch((err) => setStatus(String(err?.message || err), true));
  });
}

// ── E2E Station Test ─────────────────────────────────────────────────────────

function setE2eStatus(text, danger = false) {
  if (!el.e2eStatus) return;
  el.e2eStatus.textContent = text;
  el.e2eStatus.style.borderColor = danger ? '#d99f91' : '#d8c8a6';
  el.e2eStatus.style.color = danger ? '#7a261b' : '#574c3a';
}

function renderE2eMarkets(markets) {
  if (!el.e2eMarketsBody) return;
  if (!Array.isArray(markets) || markets.length === 0) {
    el.e2eMarketsBody.innerHTML = '<tr><td colspan="6">No markets returned.</td></tr>';
    return;
  }
  el.e2eMarketsBody.innerHTML = markets.map((m) => {
    const marketId = escapeHtml(String(m.marketId || m.id || ''));
    const question = escapeHtml(String(m.question || marketId).slice(0, 70));
    const rail = escapeHtml(String(m.rail || '-'));
    const round = escapeHtml(String(m.roundType || 'current'));
    const status = escapeHtml(String(m.status || '-'));
    const closeAt = formatDate(m.closeAt);
    const spotPrice = m.currentSpotPrice ? `Spot $${Number(m.currentSpotPrice).toFixed(0)}` : '';
    const lockPrice = m.lockPrice ? `Lock $${Number(m.lockPrice).toFixed(0)}` : '';
    const prices = escapeHtml([spotPrice, lockPrice].filter(Boolean).join(' · ') || '-');
    return `<tr>
      <td>
        <div class="question-text">${question}</div>
        <div class="id-text">${marketId}</div>
      </td>
      <td class="mono">${rail} / ${round}</td>
      <td><span class="badge live">${status}</span></td>
      <td class="mono">${escapeHtml(closeAt)}</td>
      <td class="mono">${prices}</td>
      <td>
        <div class="row">
          <button class="btn btn-gold" data-e2e-quote="yes" data-market-id="${marketId}" type="button">Test YES</button>
          <button class="btn" data-e2e-quote="no" data-market-id="${marketId}" type="button">Test NO</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

async function runE2ePlayerViewCheck() {
  setE2eStatus('Calling listActiveMarketsForPlayer() on server…');
  if (el.e2ePlayerMarkets) el.e2ePlayerMarkets.hidden = true;
  if (el.e2eNoMarkets) el.e2eNoMarkets.hidden = true;
  if (el.e2eQuoteResult) el.e2eQuoteResult.hidden = true;

  try {
    const payload = await apiGet('/api/admin/runtime/markets/player-view');
    const markets = Array.isArray(payload?.markets) ? payload.markets : [];
    const count = Number(payload?.count ?? markets.length);

    if (el.e2eMarketCount) {
      el.e2eMarketCount.textContent = `${count} market${count !== 1 ? 's' : ''}`;
      el.e2eMarketCount.className = `badge ${count > 0 ? 'live' : 'off'}`;
    }

    if (markets.length === 0) {
      if (el.e2eNoMarkets) el.e2eNoMarkets.hidden = false;
      // Fetch admin state for diagnosis
      const adminState = await apiGet('/api/admin/runtime/markets').catch(() => null);
      if (el.e2eDiagnosis && adminState) {
        const all = Array.isArray(adminState.markets) ? adminState.markets : [];
        const active = all.filter((m) => m.active);
        const chainlink = active.filter((m) => m.oracleSource === 'chainlink_btc_usd');
        const notCancelled = chainlink.filter((m) => m.status !== 'cancelled');
        const notExpired = notCancelled.filter((m) => Number(m.closeAt || 0) > Date.now());
        el.e2eDiagnosis.textContent = [
          `Admin DB: ${all.length} total markets`,
          `Active: ${active.length}`,
          `Chainlink BTC: ${chainlink.length}`,
          `Not cancelled: ${notCancelled.length}`,
          `closeAt > now (playable): ${notExpired.length}`,
          notExpired.length === 0 ? '⚠ All chainlink markets are expired — run Sync to regenerate slots' : ''
        ].filter(Boolean).join(' → ');
      }
      setE2eStatus('Player would see: no markets. Station shows "No current BTC market is live".', true);
    } else {
      renderE2eMarkets(markets);
      if (el.e2ePlayerMarkets) el.e2ePlayerMarkets.hidden = false;
      setE2eStatus(`Player station shows ${count} market${count !== 1 ? 's' : ''}. Click Test YES/NO to run a quote.`);
    }
  } catch (error) {
    setE2eStatus(`Player view check failed: ${String(error?.message || error)}`, true);
  }
}

async function runE2eQuote(marketId, side) {
  const stake = 10;
  setE2eStatus(`Getting ${side.toUpperCase()} quote for market ${marketId} stake=${stake} USDC…`);
  try {
    const payload = await apiPost('/api/admin/runtime/markets/quote', { marketId, side, stake });
    if (el.e2eQuoteBody) {
      el.e2eQuoteBody.textContent = JSON.stringify(payload, null, 2);
    }
    if (el.e2eQuoteResult) el.e2eQuoteResult.hidden = false;
    if (payload?.ok) {
      setE2eStatus(`Quote OK — price ${((payload.price || 0) * 100).toFixed(2)}%, est payout ${Number(payload.estimatedPayout || 0).toFixed(4)} USDC, status: ${payload.positionStatus || '?'}`);
    } else {
      setE2eStatus(`Quote failed: ${String(payload?.reason || payload?.reasonText || 'unknown')}`, true);
    }
  } catch (error) {
    setE2eStatus(`Quote error: ${String(error?.message || error)}`, true);
  }
}

el.e2eRefresh?.addEventListener('click', () => { void runE2ePlayerViewCheck(); });
el.e2eQuoteClose?.addEventListener('click', () => { if (el.e2eQuoteResult) el.e2eQuoteResult.hidden = true; });
document.getElementById('e2e-panel')?.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const side = target.getAttribute('data-e2e-quote');
  const marketId = target.getAttribute('data-market-id');
  if (side && marketId) {
    void runE2eQuote(marketId, side);
  }
});

// ── End E2E ───────────────────────────────────────────────────────────────────

bindEvents();
void refreshAll();
void runE2ePlayerViewCheck();
