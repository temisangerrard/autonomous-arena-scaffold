const state = {
  view: 'mission',
  bootstrap: null,
  incidents: [],
  runbooks: [],
  activity: [],
  pendingConfirmToken: '',
  latestTraceId: '',
  latestSessionId: ''
};

const marketsState = {
  markets: [],
  filter: 'all',
  search: '',
  selectedId: null,
  lastSyncAt: 0
};

const el = {
  statusLine: document.getElementById('status-line'),
  refreshBtn: document.getElementById('refresh'),
  commandInput: document.getElementById('command-input'),
  runBtn: document.getElementById('command-run'),
  quickStatusBtn: document.getElementById('command-status'),
  confirmBtn: document.getElementById('command-confirm'),
  commandReply: document.getElementById('command-reply'),
  graphSteps: document.getElementById('graph-steps'),
  missionCard: document.getElementById('mission-card'),
  liveCard: document.getElementById('live-card'),
  incidentList: document.getElementById('incident-list'),
  runbookList: document.getElementById('runbook-list'),
  toolChips: document.getElementById('tool-chips'),
  activityList: document.getElementById('activity-list'),
  railButtons: [...document.querySelectorAll('.rail-btn')],
  views: [...document.querySelectorAll('.view')],
  toolGroups: [...document.querySelectorAll('[data-tool-group]')],
  marketsSyncStatus: document.getElementById('markets-sync-status'),
  marketsSyncBtn: document.getElementById('markets-sync-btn'),
  marketsAutoActivateBtn: document.getElementById('markets-autoactivate-btn'),
  marketsFilterStatus: document.getElementById('markets-filter-status'),
  marketsSearch: document.getElementById('markets-search'),
  marketsTable: document.getElementById('markets-table'),
  marketsDetail: document.getElementById('markets-detail')
};

const QUICK_TOOLS = {
  default: ['status', 'reconcile bots to 8', 'check sponsor gas', 'sync markets'],
  fleet: ['reconcile bots to 8', 'apply delegation'],
  treasury: ['check sponsor gas', 'refill 2'],
  markets: ['sync markets'],
  users: ['logout user profile_1', 'teleport user profile_1 section 3', 'credit user profile_1 10']
};

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function setStatus(text) {
  if (el.statusLine) el.statusLine.textContent = text;
}

function formatMarketDate(ms) {
  const n = Number(ms || 0);
  if (!Number.isFinite(n) || n <= 0) return '-';
  return new Date(n).toLocaleString();
}

function normalizedMarketFilter(entry) {
  const active = Boolean(entry?.active);
  if (marketsState.filter === 'active') return active;
  if (marketsState.filter === 'inactive') return !active;
  return true;
}

function normalizedMarketSearch(entry) {
  const q = String(marketsState.search || '').trim().toLowerCase();
  if (!q) return true;
  const haystack = `${entry?.question || ''} ${entry?.id || ''} ${entry?.category || ''}`.toLowerCase();
  return haystack.includes(q);
}

async function marketsRequest(pathname, init = {}) {
  const response = await fetch(`/api/admin/runtime${pathname}`, {
    ...init,
    credentials: 'include',
    headers: {
      'content-type': 'application/json',
      ...(init.headers || {})
    }
  });
  if (response.status === 401 || response.status === 403) {
    window.location.href = '/welcome';
    throw new Error('unauthorized');
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(String(payload?.reason || `status_${response.status}`));
  }
  return payload;
}

function marketsRenderTable() {
  if (!el.marketsTable) return;
  const rows = (Array.isArray(marketsState.markets) ? marketsState.markets : [])
    .filter(normalizedMarketFilter)
    .filter(normalizedMarketSearch);
  if (rows.length === 0) {
    el.marketsTable.innerHTML = '<div class="markets-empty">No markets match current filter.</div>';
    return;
  }
  el.marketsTable.innerHTML = rows.map((market) => {
    const id = String(market.id || '');
    const active = Boolean(market.active);
    const dotClass = active ? 'on' : 'off';
    const rowClass = active ? 'markets-row active' : 'markets-row';
    const question = String(market.question || id);
    const closeAt = formatMarketDate(Number(market.closeAt || 0));
    const cat = String(market.category || '-').toUpperCase();
    const yesPrice = Number(market.yesPrice || 0).toFixed(2);
    const noPrice = Number(market.noPrice || 0).toFixed(2);
    return `<div class="${rowClass}" data-market-id="${escapeHtml(id)}">
      <div class="markets-row-main">
        <span class="status-dot ${dotClass}" title="${active ? 'active' : 'inactive'}"></span>
        <span class="markets-question">${escapeHtml(question.slice(0, 120))}</span>
      </div>
      <div class="markets-meta">
        <span class="markets-cat">${escapeHtml(cat)}</span>
        <span class="markets-close">${escapeHtml(closeAt)}</span>
        <span class="markets-price yes">Y ${yesPrice}</span>
        <span class="markets-price no">N ${noPrice}</span>
      </div>
      <div class="markets-actions">
        <button type="button" data-action="toggle" data-market-id="${escapeHtml(id)}" class="${active ? 'btn-deactivate' : 'btn-activate'}">${active ? 'Deactivate' : 'Activate'}</button>
      </div>
    </div>`;
  }).join('');
}

function marketsRenderDetail(market) {
  if (!el.marketsDetail) return;
  if (!market) {
    el.marketsDetail.hidden = true;
    el.marketsDetail.innerHTML = '';
    return;
  }
  const id = String(market.id || '');
  el.marketsDetail.hidden = false;
  el.marketsDetail.innerHTML = `
    <h4>${escapeHtml(String(market.question || id))}</h4>
    <div class="markets-detail-grid">
      <div><strong>Category:</strong> ${escapeHtml(String(market.category || '-'))}</div>
      <div><strong>Status:</strong> ${escapeHtml(String(market.status || '-'))}</div>
      <div><strong>Close:</strong> ${escapeHtml(formatMarketDate(Number(market.closeAt || 0)))}</div>
      <div><strong>Resolve:</strong> ${escapeHtml(formatMarketDate(Number(market.resolveAt || 0)))}</div>
      <div><strong>YES:</strong> ${Number(market.yesPrice || 0).toFixed(4)}</div>
      <div><strong>NO:</strong> ${Number(market.noPrice || 0).toFixed(4)}</div>
    </div>
    <div class="markets-detail-controls">
      <label>Max Wager <input id="market-max-wager" type="number" min="1" max="100000" step="1" value="${Math.max(1, Number(market.maxWager || 100))}" /></label>
      <label>Spread (bps) <input id="market-spread-bps" type="number" min="0" max="10000" step="1" value="${Math.max(0, Number(market.houseSpreadBps || 300))}" /></label>
      <button id="market-save-config" type="button" data-market-id="${escapeHtml(id)}">Save config</button>
    </div>
  `;
}

async function marketsLoad() {
  const payload = await marketsRequest('/admin/markets');
  marketsState.markets = Array.isArray(payload?.markets) ? payload.markets : [];
  marketsState.lastSyncAt = Number(payload?.lastSyncAt || 0);
  if (el.marketsSyncStatus) {
    const syncLabel = marketsState.lastSyncAt > 0
      ? `Last sync: ${new Date(marketsState.lastSyncAt).toLocaleString()}`
      : 'Never synced';
    el.marketsSyncStatus.textContent = syncLabel;
  }
  if (marketsState.selectedId) {
    const selected = marketsState.markets.find((entry) => String(entry.id || '') === marketsState.selectedId) || null;
    marketsRenderDetail(selected);
  }
  marketsRenderTable();
}

async function marketsSync() {
  const payload = await marketsRequest('/admin/markets/sync', {
    method: 'POST',
    body: JSON.stringify({ limit: 60 })
  });
  await marketsLoad();
  return payload;
}

async function marketsAutoActivate() {
  const payload = await marketsRequest('/admin/markets/sync', {
    method: 'POST',
    body: JSON.stringify({ limit: 60, autoActivate: true })
  });
  await marketsLoad();
  return payload;
}

async function marketsSetActive(marketId, active) {
  const endpoint = active ? '/admin/markets/activate' : '/admin/markets/deactivate';
  await marketsRequest(endpoint, {
    method: 'POST',
    body: JSON.stringify({ marketId })
  });
  await marketsLoad();
}

async function marketsSetConfig(marketId, maxWager, spreadBps) {
  await marketsRequest('/admin/markets/config', {
    method: 'POST',
    body: JSON.stringify({
      marketId,
      active: true,
      maxWager: Math.max(1, Number(maxWager || 100)),
      houseSpreadBps: Math.max(0, Number(spreadBps || 300))
    })
  });
  await marketsLoad();
}

async function apiGet(path) {
  const res = await fetch(path, { credentials: 'include' });
  if (res.status === 401 || res.status === 403) {
    window.location.href = '/welcome';
    throw new Error('unauthorized');
  }
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(String(payload?.reason || `status_${res.status}`));
  return payload;
}

async function apiPost(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body || {})
  });
  if (res.status === 401 || res.status === 403) {
    window.location.href = '/welcome';
    throw new Error('unauthorized');
  }
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(String(payload?.reason || `status_${res.status}`));
  return payload;
}

function addActivity(text) {
  state.activity.unshift({ at: Date.now(), text });
  if (state.activity.length > 120) state.activity.length = 120;
  renderActivity();
}

function renderViews() {
  for (const btn of el.railButtons) {
    btn.classList.toggle('active', btn.dataset.view === state.view);
  }
  for (const view of el.views) {
    view.classList.toggle('active', view.id === `view-${state.view}`);
  }
  if (state.view === 'markets' && (!Array.isArray(marketsState.markets) || marketsState.markets.length === 0)) {
    void marketsLoad().catch((error) => setStatus(`Markets load failed: ${String(error?.message || error)}`));
  }
}

function renderMission() {
  const mission = state.bootstrap?.mission || {};
  const telemetry = state.bootstrap?.telemetry || {};
  if (!el.missionCard) return;
  el.missionCard.textContent = JSON.stringify({
    mission,
    telemetry,
    latestTraceId: state.latestTraceId,
    latestSessionId: state.latestSessionId
  }, null, 2);
}

function renderLive() {
  if (!el.liveCard) return;
  const live = state.bootstrap?.liveState || {};
  el.liveCard.textContent = JSON.stringify(live, null, 2);
}

function renderIncidents() {
  if (!el.incidentList) return;
  const items = state.incidents || [];
  el.incidentList.innerHTML = items.map((entry) => {
    const sev = String(entry.severity || 'low');
    return `<li>
      <strong>${escapeHtml(entry.title || 'Incident')}</strong>
      <span class="tag ${escapeHtml(sev)}">${escapeHtml(sev)}</span>
      <div>${escapeHtml(entry.detail || '')}</div>
      <small>${new Date(Number(entry.at || Date.now())).toLocaleString()} · ${escapeHtml(entry.status || 'open')}</small>
    </li>`;
  }).join('') || '<li>No incidents recorded.</li>';
}

function renderRunbooks() {
  if (!el.runbookList) return;
  const items = state.runbooks || [];
  el.runbookList.innerHTML = items.map((entry) => `<li>
    <strong>${escapeHtml(entry.title || entry.id || 'Runbook')}</strong>
    <div>${escapeHtml(entry.description || '')}</div>
    <small>${escapeHtml(entry.id || '')} · ${escapeHtml(entry.safety || 'read_only')}</small>
  </li>`).join('') || '<li>No runbooks.</li>';
}

function renderTools() {
  if (el.toolChips) {
    el.toolChips.innerHTML = QUICK_TOOLS.default.map((cmd) => `<button type="button" data-cmd="${escapeHtml(cmd)}">${escapeHtml(cmd)}</button>`).join('');
  }
  for (const group of el.toolGroups) {
    const key = String(group.getAttribute('data-tool-group') || 'default');
    const cmds = QUICK_TOOLS[key] || [];
    group.innerHTML = cmds.map((cmd) => `<button type="button" data-cmd="${escapeHtml(cmd)}">${escapeHtml(cmd)}</button>`).join('');
  }
}

function renderGraph(executionGraph) {
  if (!el.graphSteps) return;
  const steps = Array.isArray(executionGraph?.steps) ? executionGraph.steps : [];
  el.graphSteps.innerHTML = steps.map((step) => `<li><strong>${escapeHtml(step.tool || '-')}</strong> · ${escapeHtml(step.status || '-')}<br>${escapeHtml(step.summary || '')}</li>`).join('') || '<li>No execution steps.</li>';
}

function renderActivity() {
  if (!el.activityList) return;
  el.activityList.innerHTML = state.activity.map((entry) => `<li>${new Date(entry.at).toLocaleTimeString()} · ${escapeHtml(entry.text)}</li>`).join('') || '<li>No activity yet.</li>';
}

function bindToolClicks(container) {
  container?.addEventListener('click', async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const cmd = String(target.getAttribute('data-cmd') || '').trim();
    if (!cmd) return;
    if (el.commandInput) el.commandInput.value = cmd;
    await runCommand(cmd);
  });
}

async function loadBootstrap() {
  const [bootstrap, incidents, runbooks] = await Promise.all([
    apiGet('/api/admin/chief/workspace/bootstrap'),
    apiGet('/api/admin/chief/workspace/incidents'),
    apiGet('/api/admin/chief/workspace/runbooks')
  ]);
  state.bootstrap = bootstrap;
  state.incidents = incidents?.incidents || [];
  state.runbooks = runbooks?.runbooks || [];
  renderMission();
  renderLive();
  renderIncidents();
  renderRunbooks();
}

async function runCommand(message) {
  const text = String(message || '').trim();
  if (!text) {
    setStatus('Command required.');
    return;
  }
  setStatus('Executing command...');
  try {
    const payload = await apiPost('/api/admin/chief/workspace/command', { message: text });
    state.latestTraceId = String(payload.traceId || '');
    state.latestSessionId = String(payload.sessionId || '');
    state.pendingConfirmToken = payload.requiresConfirmation ? String(payload.confirmToken || '') : '';
    if (el.confirmBtn) {
      el.confirmBtn.hidden = !state.pendingConfirmToken;
      el.confirmBtn.textContent = state.pendingConfirmToken ? `Confirm (${state.pendingConfirmToken})` : 'Confirm Pending Action';
    }
    if (el.commandReply) {
      const actionText = Array.isArray(payload.actions)
        ? payload.actions.map((entry) => `${entry.tool}:${entry.status}`).join(', ')
        : '';
      el.commandReply.textContent = `${String(payload.reply || 'No reply')}\n\nTrace: ${state.latestTraceId}\nSession: ${state.latestSessionId}${actionText ? `\nActions: ${actionText}` : ''}`;
    }
    renderGraph(payload.executionGraph);
    addActivity(`command: ${text}`);
    if (payload.requiresConfirmation) {
      setStatus('Confirmation required for sensitive actions.');
    } else {
      setStatus('Command completed.');
      await loadBootstrap();
    }
  } catch (error) {
    const msg = String(error?.message || error);
    if (el.commandReply) el.commandReply.textContent = `Command error: ${msg}`;
    setStatus(`Command failed: ${msg}`);
    addActivity(`error: ${msg}`);
  }
}

async function confirmPending() {
  if (!state.pendingConfirmToken) {
    setStatus('No pending confirmation token.');
    return;
  }
  setStatus('Confirming action...');
  try {
    const payload = await apiPost('/api/admin/chief/workspace/command', { confirmToken: state.pendingConfirmToken });
    state.pendingConfirmToken = '';
    if (el.confirmBtn) el.confirmBtn.hidden = true;
    state.latestTraceId = String(payload.traceId || '');
    state.latestSessionId = String(payload.sessionId || '');
    if (el.commandReply) {
      el.commandReply.textContent = `${String(payload.reply || 'No reply')}\n\nTrace: ${state.latestTraceId}\nSession: ${state.latestSessionId}`;
    }
    renderGraph(payload.executionGraph);
    addActivity('confirmation: executed');
    setStatus('Confirmed action executed.');
    await loadBootstrap();
  } catch (error) {
    const msg = String(error?.message || error);
    setStatus(`Confirmation failed: ${msg}`);
    addActivity(`error: ${msg}`);
  }
}

function bindEvents() {
  for (const btn of el.railButtons) {
    btn.addEventListener('click', () => {
      state.view = String(btn.dataset.view || 'mission');
      renderViews();
    });
  }
  el.refreshBtn?.addEventListener('click', async () => {
    setStatus('Refreshing workspace...');
    try {
      await loadBootstrap();
      setStatus('Workspace refreshed.');
    } catch (error) {
      setStatus(`Refresh failed: ${String(error?.message || error)}`);
    }
  });
  el.runBtn?.addEventListener('click', async () => {
    await runCommand(String(el.commandInput?.value || ''));
  });
  el.quickStatusBtn?.addEventListener('click', async () => {
    if (el.commandInput) el.commandInput.value = 'status';
    await runCommand('status');
  });
  el.confirmBtn?.addEventListener('click', async () => {
    await confirmPending();
  });

  bindToolClicks(el.toolChips);
  for (const group of el.toolGroups) bindToolClicks(group);

  el.marketsSyncBtn?.addEventListener('click', async () => {
    setStatus('Syncing markets from Polymarket...');
    try {
      const payload = await marketsSync();
      setStatus(`Markets synced (${Number(payload?.synced || 0)}).`);
    } catch (error) {
      setStatus(`Markets sync failed: ${String(error?.message || error)}`);
    }
  });
  el.marketsAutoActivateBtn?.addEventListener('click', async () => {
    setStatus('Sync + auto-activate open markets...');
    try {
      const payload = await marketsAutoActivate();
      setStatus(`Auto-activate complete (synced=${Number(payload?.synced || 0)}, activated=${Number(payload?.activated || 0)}).`);
    } catch (error) {
      setStatus(`Auto-activate failed: ${String(error?.message || error)}`);
    }
  });
  el.marketsFilterStatus?.addEventListener('change', () => {
    marketsState.filter = String(el.marketsFilterStatus?.value || 'all');
    marketsRenderTable();
  });
  el.marketsSearch?.addEventListener('input', () => {
    marketsState.search = String(el.marketsSearch?.value || '');
    marketsRenderTable();
  });
  el.marketsTable?.addEventListener('click', async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const toggleBtn = target.closest('[data-action="toggle"]');
    if (toggleBtn instanceof HTMLElement) {
      const marketId = String(toggleBtn.getAttribute('data-market-id') || '');
      if (!marketId) return;
      const market = marketsState.markets.find((entry) => String(entry.id || '') === marketId) || null;
      if (!market) return;
      setStatus(`${market.active ? 'Deactivating' : 'Activating'} ${marketId}...`);
      try {
        await marketsSetActive(marketId, !market.active);
        setStatus(`Market ${!market.active ? 'activated' : 'deactivated'}: ${marketId}`);
      } catch (error) {
        setStatus(`Market toggle failed: ${String(error?.message || error)}`);
      }
      return;
    }
    const row = target.closest('[data-market-id]');
    if (!(row instanceof HTMLElement)) return;
    const marketId = String(row.getAttribute('data-market-id') || '');
    const market = marketsState.markets.find((entry) => String(entry.id || '') === marketId) || null;
    marketsState.selectedId = marketId || null;
    marketsRenderDetail(market);
  });
  el.marketsDetail?.addEventListener('click', async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.id !== 'market-save-config') return;
    const marketId = String(target.getAttribute('data-market-id') || '');
    if (!marketId) return;
    const maxWagerInput = document.getElementById('market-max-wager');
    const spreadInput = document.getElementById('market-spread-bps');
    const maxWager = Number((maxWagerInput instanceof HTMLInputElement ? maxWagerInput.value : '100') || 100);
    const spreadBps = Number((spreadInput instanceof HTMLInputElement ? spreadInput.value : '300') || 300);
    setStatus(`Saving market config (${marketId})...`);
    try {
      await marketsSetConfig(marketId, maxWager, spreadBps);
      const refreshed = marketsState.markets.find((entry) => String(entry.id || '') === marketId) || null;
      marketsRenderDetail(refreshed);
      setStatus(`Market config saved: ${marketId}`);
    } catch (error) {
      setStatus(`Config save failed: ${String(error?.message || error)}`);
    }
  });
}

async function init() {
  bindEvents();
  renderViews();
  renderTools();
  renderActivity();
  await loadBootstrap();
  try {
    await marketsLoad();
  } catch {
    // lazy retry when user enters markets view
  }
  setStatus('Chief Ops workspace ready.');
}

init().catch((error) => {
  setStatus(`Init failed: ${String(error?.message || error)}`);
});
