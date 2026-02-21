const el = {
  status: document.getElementById('status'),
  refreshAll: document.getElementById('refresh-all'),
  syncMarkets: document.getElementById('sync-markets'),
  enabledBody: document.getElementById('enabled-body'),
  liveBody: document.getElementById('live-body'),
  liveQuery: document.getElementById('live-query'),
  liveLimit: document.getElementById('live-limit'),
  refreshLive: document.getElementById('refresh-live'),
  kpiEnabled: document.getElementById('kpi-enabled'),
  kpiActive: document.getElementById('kpi-active'),
  kpiLive: document.getElementById('kpi-live'),
  simMarket: document.getElementById('sim-market'),
  simSide: document.getElementById('sim-side'),
  simStake: document.getElementById('sim-stake'),
  simRun: document.getElementById('sim-run'),
  simOutput: document.getElementById('sim-output')
};

const state = {
  adminMarkets: [],
  liveMarkets: []
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
  if (el.kpiEnabled) el.kpiEnabled.textContent = String(enabled);
  if (el.kpiActive) el.kpiActive.textContent = String(active);
  if (el.kpiLive) el.kpiLive.textContent = String(live);
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
            <div style="font-weight:650;">${escapeHtml(entry.question || marketId)}</div>
            <div class="mono" style="color:#7a6b57;">${escapeHtml(marketId)}</div>
          </td>
          <td>
            <span class="badge ${entry.active ? 'live' : 'off'}">${entry.active ? 'active' : 'inactive'}</span>
            <div class="mono" style="margin-top:6px; color:#726754;">${escapeHtml(entry.status || '-')}</div>
            <div class="mono" style="margin-top:4px; color:#726754;">close ${escapeHtml(formatDate(entry.closeAt))}</div>
          </td>
          <td>
            <div>YES ${escapeHtml(formatPrice(entry.yesPrice))} / NO ${escapeHtml(formatPrice(entry.noPrice))}</div>
            <div class="mono" style="margin-top:6px; color:#726754;">max ${Number(entry.maxWager || 0).toFixed(0)} · spread ${Number(entry.houseSpreadBps || 0)} bps</div>
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
            <div style="font-weight:650;">${escapeHtml(entry.question || marketId)}</div>
            <div class="mono" style="color:#7a6b57;">${escapeHtml(marketId)}</div>
          </td>
          <td>${escapeHtml(entry.category || '-')}</td>
          <td>YES ${escapeHtml(formatPrice(entry.yesPrice))} / NO ${escapeHtml(formatPrice(entry.noPrice))}</td>
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
    setStatus(`Markets lab updated at ${new Date().toLocaleTimeString()}. Public Polymarket read access is working.`);
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

bindEvents();
void refreshAll();
