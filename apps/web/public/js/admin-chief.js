const state = {
  activeView: 'overview',
  bootstrap: null,
  incidents: [],
  runbooks: [],
  activity: [],
  pendingConfirmToken: '',
  latestTraceId: '',
  latestSessionId: '',
  latestStatus: null,
  latestChallenges: [],
  latestUsers: [],
  latestSuperStatus: null,
  errors: [],
  loading: false,
  lastLoadedAt: 0,
  pollTimer: null
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

  overviewKpis: document.getElementById('overview-kpis'),
  runtimeSnapshot: document.getElementById('runtime-snapshot'),
  overviewIncidents: document.getElementById('overview-incidents'),

  superIdInput: document.getElementById('super-id'),
  superModeInput: document.getElementById('super-mode'),
  superChallengeEnabledInput: document.getElementById('super-challenge-enabled'),
  superCooldownInput: document.getElementById('super-cooldown'),
  superTargetInput: document.getElementById('super-target'),
  bgCountInput: document.getElementById('bg-count'),
  walletEnabledInput: document.getElementById('wallet-enabled'),
  walletSkillsInput: document.getElementById('wallet-skills'),
  openrouterKeyInput: document.getElementById('openrouter-key'),
  saveSuperBtn: document.getElementById('save-super'),
  saveWalletBtn: document.getElementById('save-wallet'),
  saveOpenrouterBtn: document.getElementById('save-openrouter'),
  syncEthskillsBtn: document.getElementById('sync-ethskills'),
  applyDelegationBtn: document.getElementById('apply-delegation'),
  applyBgCountBtn: document.getElementById('apply-bg-count'),
  superChips: document.getElementById('super-chips'),
  superChatInput: document.getElementById('super-chat-input'),
  superChatSendBtn: document.getElementById('super-chat-send'),
  superChatStatusBtn: document.getElementById('super-chat-status'),
  superChatLog: document.getElementById('super-chat-log'),

  newUsernameInput: document.getElementById('new-username'),
  newDisplayNameInput: document.getElementById('new-display-name'),
  newPersonalityInput: document.getElementById('new-personality'),
  newTargetInput: document.getElementById('new-target'),
  createProfileBtn: document.getElementById('create-profile'),
  profilesBody: document.getElementById('profiles-body'),
  botsBody: document.getElementById('bots-body'),

  houseWalletId: document.getElementById('house-wallet-id'),
  houseBalance: document.getElementById('house-balance'),
  houseNpcFloor: document.getElementById('house-npc-floor'),
  houseNpcTopup: document.getElementById('house-npc-topup'),
  houseSuperFloor: document.getElementById('house-super-floor'),
  houseApply: document.getElementById('house-apply'),
  houseRefillAmount: document.getElementById('house-refill-amount'),
  houseRefill: document.getElementById('house-refill'),
  houseTransferWallet: document.getElementById('house-transfer-wallet'),
  houseTransferAmount: document.getElementById('house-transfer-amount'),
  houseTransfer: document.getElementById('house-transfer'),
  houseLedger: document.getElementById('house-ledger'),

  usersBody: document.getElementById('users-body'),

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

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function formatLastSeen(ts) {
  const at = Number(ts ?? 0);
  if (!Number.isFinite(at) || at <= 0) return '-';
  return new Date(at).toLocaleString();
}

function setStatus(text) {
  if (el.statusLine) el.statusLine.textContent = text;
}

function addActivity(typeOrText, message, details = '') {
  const type = message == null ? 'event' : String(typeOrText || 'event');
  const msg = message == null ? String(typeOrText || '') : String(message || '');
  state.activity.unshift({
    at: Date.now(),
    type,
    message: msg,
    details: String(details || '')
  });
  if (state.activity.length > 200) state.activity.length = 200;
  renderActivity();
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
  if (!res.ok) throw new Error(String(payload?.reason || payload?.error || `status_${res.status}`));
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
  if (!res.ok) throw new Error(String(payload?.reason || payload?.error || `status_${res.status}`));
  return payload;
}

async function safeFetch(name, fn) {
  try {
    const data = await fn();
    return { name, ok: true, data };
  } catch (error) {
    return { name, ok: false, error: String(error?.message || error) };
  }
}

function renderViews() {
  for (const btn of el.railButtons) {
    btn.classList.toggle('active', btn.dataset.view === state.activeView);
  }
  for (const view of el.views) {
    view.classList.toggle('active', view.id === `view-${state.activeView}`);
  }
  if (state.activeView === 'markets' && (!Array.isArray(marketsState.markets) || marketsState.markets.length === 0)) {
    void marketsLoad().catch((error) => setStatus(`Markets load failed: ${String(error?.message || error)}`));
  }
  if (!state.lastLoadedAt) {
    void refreshAll({ silent: true });
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
  if (el.superChips) {
    const superCmds = ['status', 'why are games not starting?', 'rebalance bots', 'show disconnected bots', 'apply delegation', 'optimize challenge flow'];
    el.superChips.innerHTML = superCmds.map((cmd) => `<button type="button" class="chip" data-cmd="${escapeHtml(cmd)}">${escapeHtml(cmd)}</button>`).join('');
  }
}

function renderGraph(executionGraph) {
  if (!el.graphSteps) return;
  const steps = Array.isArray(executionGraph?.steps) ? executionGraph.steps : [];
  el.graphSteps.innerHTML = steps.map((step) => `<li><strong>${escapeHtml(step.tool || '-')}</strong> · ${escapeHtml(step.status || '-')}<br>${escapeHtml(step.summary || '')}</li>`).join('') || '<li>No execution steps.</li>';
}

function formatChallengeLine(entry) {
  const at = Number(entry?.at || Date.now());
  const time = new Date(at).toLocaleTimeString();
  const versus = entry?.challengerId && entry?.opponentId ? `${entry.challengerId} vs ${entry.opponentId}` : 'n/a';
  const gameType = entry?.gameType || '-';
  const winner = entry?.winnerId ? ` winner=${entry.winnerId}` : '';
  const reason = entry?.reason ? ` reason=${entry.reason}` : '';
  return `${time} ${entry?.event || '-'} ${gameType} ${versus}${winner}${reason}`;
}

function renderOverview() {
  const status = state.latestStatus || {};
  const houseBalance = Number(status?.house?.wallet?.balance || 0);
  const kpis = [
    ['Configured bots', toNumber(status.configuredBotCount, 0)],
    ['Connected bots', toNumber(status.connectedBotCount, 0)],
    ['Background bots', toNumber(status.backgroundBotCount, 0)],
    ['Profiles', toNumber(status.profiles?.length || 0, 0)],
    ['OpenRouter', status.openRouterConfigured ? 'Yes' : 'No'],
    ['House balance', houseBalance.toFixed(2)]
  ];

  if (el.overviewKpis) {
    el.overviewKpis.innerHTML = kpis
      .map(([label, value]) => `<article class="kpi"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(value)}</div></article>`)
      .join('');
  }

  if (el.runtimeSnapshot) {
    const snapshot = {
      configuredBotCount: status.configuredBotCount,
      connectedBotCount: status.connectedBotCount,
      backgroundBotCount: status.backgroundBotCount,
      profileBotCount: status.profileBotCount,
      profileCount: status.profiles?.length || 0,
      superAgent: status.superAgent,
      house: status.house,
      superAgentStatus: state.latestSuperStatus || null
    };
    el.runtimeSnapshot.textContent = JSON.stringify(snapshot, null, 2);
  }

  if (el.overviewIncidents) {
    const lines = [];
    const disconnected = status.disconnectedBotIds || [];
    if (disconnected.length > 0) {
      lines.push(`Disconnected bots (${disconnected.length}): ${disconnected.join(', ')}`);
    }
    if (Array.isArray(status.lastBotWsErrorAt) && status.lastBotWsErrorAt.length > 0) {
      lines.push(`Bot WS errors: ${JSON.stringify(status.lastBotWsErrorAt)}`);
    }
    const recentChallenges = (state.latestChallenges || []).slice(-6).reverse().map(formatChallengeLine);
    if (recentChallenges.length > 0) {
      lines.push('Recent challenges:');
      lines.push(...recentChallenges);
    }
    for (const err of state.errors.slice(0, 6)) lines.push(`Error: ${err}`);
    el.overviewIncidents.textContent = lines.join('\n') || 'No incidents recorded.';
  }
}

function populateControlValues() {
  const status = state.latestStatus || {};
  const superAgent = status.superAgent || {};
  const walletPolicy = superAgent.walletPolicy || {};

  if (el.superIdInput) el.superIdInput.value = superAgent.id || 'agent_1';
  if (el.superModeInput) el.superModeInput.value = superAgent.mode || 'balanced';
  if (el.superChallengeEnabledInput) el.superChallengeEnabledInput.checked = Boolean(superAgent.challengeEnabled);
  if (el.superCooldownInput) el.superCooldownInput.value = String(toNumber(superAgent.defaultChallengeCooldownMs, 9000));
  if (el.superTargetInput) el.superTargetInput.value = superAgent.workerTargetPreference || 'human_only';
  if (el.bgCountInput) el.bgCountInput.value = String(toNumber(status.backgroundBotCount, 0));
  if (el.walletEnabledInput) el.walletEnabledInput.checked = Boolean(walletPolicy.enabled);
  if (el.walletSkillsInput) {
    el.walletSkillsInput.value = Array.isArray(walletPolicy.allowedSkills) ? walletPolicy.allowedSkills.join(',') : '';
  }

  const house = status.house || {};
  if (el.houseWalletId) el.houseWalletId.value = String(house.wallet?.id || '-');
  if (el.houseBalance) el.houseBalance.value = String(Number(house.wallet?.balance || 0).toFixed(2));
  if (el.houseNpcFloor) el.houseNpcFloor.value = String(toNumber(house.npcWalletFloor, 0));
  if (el.houseNpcTopup) el.houseNpcTopup.value = String(toNumber(house.npcWalletTopupAmount, 0));
  if (el.houseSuperFloor) el.houseSuperFloor.value = String(toNumber(house.superAgentWalletFloor, 0));

  if (el.houseLedger) {
    const lines = (house.recentTransfers || []).slice().reverse().map((entry) => {
      const at = entry?.at ? new Date(Number(entry.at)).toLocaleTimeString() : '--:--:--';
      return `${at} ${Number(entry?.amount || 0).toFixed(2)} -> ${String(entry?.toWalletId || '-')} ${String(entry?.reason || '')}`;
    });
    el.houseLedger.textContent = lines.join('\n') || 'No house transfers yet.';
  }
}

function renderProfiles() {
  if (!el.profilesBody) return;
  const profiles = state.latestStatus?.profiles || [];
  el.profilesBody.innerHTML = '';

  for (const profile of profiles) {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>
        <div>${escapeHtml(profile.displayName || profile.id || '-')}</div>
        <div style="color:var(--text-muted);font-size:11px;">${escapeHtml(profile.id || '-')} · @${escapeHtml(profile.username || '-')}</div>
      </td>
      <td>
        <div class="mono">${escapeHtml(profile.wallet?.id || profile.walletId || 'n/a')}</div>
        <div class="mono" style="color:var(--text-muted);font-size:11px;">${escapeHtml(profile.wallet?.address || 'n/a')}</div>
      </td>
      <td>${Number(profile.wallet?.balance || 0).toFixed(2)}</td>
      <td>${escapeHtml((profile.ownedBotIds || []).join(', '))}</td>
      <td>
        <div class="btn-row">
          <button data-action="fund" data-wallet-id="${escapeHtml(profile.wallet?.id || profile.walletId || '')}" data-amount="10">+10</button>
          <button data-action="withdraw" data-wallet-id="${escapeHtml(profile.wallet?.id || profile.walletId || '')}" data-amount="5">-5</button>
          <button data-action="export" data-wallet-id="${escapeHtml(profile.wallet?.id || profile.walletId || '')}" data-profile-id="${escapeHtml(profile.id || '')}">Export key</button>
        </div>
      </td>
    `;
    el.profilesBody.appendChild(row);
  }
}

function renderBots() {
  if (!el.botsBody) return;
  const bots = state.latestStatus?.bots || [];
  el.botsBody.innerHTML = '';

  for (const bot of bots) {
    const meta = bot.meta || {};
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${escapeHtml(bot.id || '-')}</td>
      <td><input data-bot-id="${escapeHtml(bot.id || '')}" data-field="displayName" type="text" value="${escapeHtml(meta.displayName || bot.id || '')}"></td>
      <td>${escapeHtml(meta.ownerProfileId || 'system')}</td>
      <td>${escapeHtml(meta.duty || 'n/a')}</td>
      <td>${typeof meta.patrolSection === 'number' ? `S${meta.patrolSection + 1}` : '—'}</td>
      <td>${bot.connected ? 'yes' : 'no'}</td>
      <td>
        <select data-bot-id="${escapeHtml(bot.id || '')}" data-field="personality">
          ${['aggressive', 'conservative', 'social'].map((value) => `<option value="${value}" ${bot.behavior?.personality === value ? 'selected' : ''}>${value}</option>`).join('')}
        </select>
      </td>
      <td>
        <select data-bot-id="${escapeHtml(bot.id || '')}" data-field="targetPreference">
          ${['human_only', 'human_first', 'any'].map((value) => `<option value="${value}" ${bot.behavior?.targetPreference === value ? 'selected' : ''}>${value}</option>`).join('')}
        </select>
      </td>
      <td><input data-bot-id="${escapeHtml(bot.id || '')}" data-field="challengeCooldownMs" type="number" min="1200" max="120000" value="${toNumber(bot.behavior?.challengeCooldownMs, 2600)}"></td>
      <td><input data-bot-id="${escapeHtml(bot.id || '')}" data-field="managedBySuperAgent" type="checkbox" ${meta.managedBySuperAgent ? 'checked' : ''}></td>
      <td><button data-action="save-bot" data-bot-id="${escapeHtml(bot.id || '')}">Save</button></td>
    `;
    el.botsBody.appendChild(row);
  }
}

function renderUsers() {
  if (!el.usersBody) return;
  el.usersBody.innerHTML = '';

  for (const user of state.latestUsers || []) {
    const online = Boolean(user.online);
    const dotClass = online ? 'online' : 'offline';
    const walletBalance = Number(user.walletBalance ?? 0);
    const coords = (typeof user.x === 'number' && typeof user.z === 'number')
      ? `x:${Number(user.x).toFixed(1)} z:${Number(user.z).toFixed(1)}`
      : '-';

    const tr = document.createElement('tr');
    tr.dataset.profileId = String(user.profileId || '');
    tr.innerHTML = `
      <td>
        <div style="font-weight:650;">${escapeHtml(user.displayName || user.username || user.profileId)}</div>
        <div class="mono" style="color:var(--text-secondary);">
          @${escapeHtml(user.username || '-')}<br>
          profile ${escapeHtml(user.profileId)}<br>
          player ${escapeHtml(user.playerId)}
        </div>
      </td>
      <td>
        <div class="mono">${escapeHtml(user.subjectHash || '-')}</div>
        <div class="mono" style="color:var(--text-secondary); margin-top:6px;">${escapeHtml(user.continuitySource || 'unknown')}</div>
      </td>
      <td>
        <div class="mono">${escapeHtml(user.walletId || '-')}</div>
        <div class="mono" style="color:var(--text-secondary);">${escapeHtml(user.walletAddress || '')}</div>
        <div style="margin-top:6px;"><span class="badge">Balance ${walletBalance.toFixed(2)}</span></div>
      </td>
      <td>
        <div class="badge"><span class="dot ${dotClass}"></span>${online ? 'Online' : 'Offline'}</div>
        <div class="mono" style="color:var(--text-secondary); margin-top:6px;">
          ${escapeHtml(user.serverId || '-')}<br>
          ${escapeHtml(coords)}<br>
          last ${escapeHtml(formatLastSeen(user.lastSeen))}
        </div>
      </td>
      <td>
        <div class="btn-row" style="display:grid; gap:6px;">
          <select data-field="teleport-section">
            <option value="">Teleport: section…</option>
            <option value="0">S1</option><option value="1">S2</option><option value="2">S3</option><option value="3">S4</option>
            <option value="4">S5</option><option value="5">S6</option><option value="6">S7</option><option value="7">S8</option>
          </select>
          <button type="button" data-action="teleport-section">Teleport To Section</button>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
            <input data-field="teleport-x" type="number" step="0.5" placeholder="x">
            <input data-field="teleport-z" type="number" step="0.5" placeholder="z">
          </div>
          <button type="button" data-action="teleport-coords">Teleport To Coords</button>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
            <select data-field="wallet-direction"><option value="credit">Credit</option><option value="debit">Debit</option></select>
            <input data-field="wallet-amount" type="number" min="0" step="0.01" placeholder="amount">
          </div>
          <input data-field="wallet-reason" type="text" placeholder="reason (optional)">
          <button type="button" class="primary" data-action="wallet-adjust">Adjust Wallet</button>
          <button type="button" data-action="force-logout">Force Logout</button>
        </div>
      </td>
    `;
    el.usersBody.appendChild(tr);
  }
}

function renderActivity() {
  if (!el.activityList) return;

  const challengeEvents = (state.latestChallenges || []).slice(-30).map((entry) => ({
    at: new Date(entry.at).getTime(),
    type: 'challenge',
    message: `${entry.event} ${entry.gameType || '-'} ${entry.challengerId || '-'} vs ${entry.opponentId || '-'}${entry.winnerId ? ` winner=${entry.winnerId}` : ''}`,
    details: entry.reason ? `reason=${entry.reason}` : ''
  }));

  const all = [...state.activity, ...challengeEvents]
    .sort((a, b) => Number(b.at || 0) - Number(a.at || 0))
    .slice(0, 80);

  if (all.length === 0) {
    el.activityList.innerHTML = '<li>No activity yet.</li>';
    return;
  }

  el.activityList.innerHTML = all.map((entry) => {
    const stamp = new Date(Number(entry.at || Date.now())).toLocaleString();
    return `<li><strong>${escapeHtml(stamp)} · ${escapeHtml(entry.type || 'event')}</strong><br>${escapeHtml(entry.message || '')}${entry.details ? `<br><span class="mono" style="color:var(--text-secondary)">${escapeHtml(entry.details)}</span>` : ''}</li>`;
  }).join('');
}

function renderAll() {
  renderViews();
  renderMission();
  renderLive();
  renderIncidents();
  renderRunbooks();
  renderTools();
  renderOverview();
  populateControlValues();
  renderProfiles();
  renderBots();
  renderUsers();
  renderActivity();
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

function gatherBotPatch(botId) {
  const fields = [...document.querySelectorAll(`[data-bot-id="${botId}"]`)];
  const patch = {};

  for (const field of fields) {
    const key = field.getAttribute('data-field');
    if (!key) continue;

    if (field instanceof HTMLInputElement && field.type === 'checkbox') {
      patch[key] = field.checked;
    } else if (field instanceof HTMLInputElement && field.type === 'number') {
      patch[key] = Number(field.value);
    } else if (field instanceof HTMLInputElement) {
      patch[key] = field.value;
    } else if (field instanceof HTMLSelectElement) {
      patch[key] = field.value;
    }
  }

  return patch;
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
}

async function refreshAll({ silent = false } = {}) {
  if (state.loading) return;
  state.loading = true;
  if (!silent) setStatus('Refreshing admin workspace...');

  const [statusRes, challengesRes, usersRes, superRes, bootstrapRes] = await Promise.all([
    safeFetch('status', () => apiGet('/api/admin/runtime/status')),
    safeFetch('challenges', () => apiGet('/api/admin/challenges/recent?limit=80')),
    safeFetch('users', () => apiGet('/api/admin/users')),
    safeFetch('superStatus', () => apiGet('/api/admin/runtime/super-agent/status')),
    safeFetch('bootstrap', () => loadBootstrap())
  ]);

  const failures = [statusRes, challengesRes, usersRes, superRes, bootstrapRes].filter((r) => !r.ok);
  state.errors = failures.map((f) => `${f.name}: ${f.error}`);

  if (statusRes.ok) state.latestStatus = statusRes.data;
  if (challengesRes.ok) state.latestChallenges = challengesRes.data?.recent || [];
  if (usersRes.ok) state.latestUsers = usersRes.data?.users || [];
  if (superRes.ok) state.latestSuperStatus = superRes.data;

  state.lastLoadedAt = Date.now();
  renderAll();

  if (failures.length === 0) {
    if (!silent) setStatus(`Ready. Last refresh ${new Date(state.lastLoadedAt).toLocaleTimeString()}.`);
  } else {
    const msg = failures.map((f) => `${f.name}: ${f.error}`).join(' | ');
    setStatus(`Partial refresh: ${msg}`);
    addActivity('error', 'Partial refresh failure', msg);
  }

  state.loading = false;
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
    addActivity('command', text);
    if (payload.requiresConfirmation) {
      setStatus('Confirmation required for sensitive actions.');
    } else {
      setStatus('Command completed.');
      await refreshAll({ silent: true });
    }
  } catch (error) {
    const msg = String(error?.message || error);
    if (el.commandReply) el.commandReply.textContent = `Command error: ${msg}`;
    setStatus(`Command failed: ${msg}`);
    addActivity('error', 'Command failed', msg);
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
    addActivity('command', 'confirmation executed');
    setStatus('Confirmed action executed.');
    await refreshAll({ silent: true });
  } catch (error) {
    const msg = String(error?.message || error);
    setStatus(`Confirmation failed: ${msg}`);
    addActivity('error', 'Confirmation failed', msg);
  }
}

function appendSuperLog(line) {
  if (!el.superChatLog) return;
  const prev = el.superChatLog.textContent || '';
  const next = `${new Date().toLocaleTimeString()} ${line}`;
  el.superChatLog.textContent = `${next}\n${prev}`.slice(0, 16000);
}

async function runSuperOpsCommand(message) {
  const text = String(message || '').trim();
  if (!text) {
    appendSuperLog('super-agent: message required');
    return;
  }
  appendSuperLog(`you: ${text}`);
  const result = await apiPost('/api/admin/chief/workspace/command', { message: text });
  const actionText = Array.isArray(result.actions)
    ? result.actions.map((entry) => `${entry.tool}:${entry.status}`).join(', ')
    : '';

  appendSuperLog(`super-agent: ${String(result.reply || '').replace(/\n/g, ' | ')}`);
  if (actionText) appendSuperLog(`actions: ${actionText}`);
  if (result.requiresConfirmation) appendSuperLog(`confirm: ${String(result.confirmToken || '')}`);

  addActivity('super-agent', text, actionText || String(result.reply || ''));
  await refreshAll({ silent: true });
}

function bindSuperActions() {
  el.superChips?.addEventListener('click', async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) return;
    const cmd = target.dataset.cmd;
    if (!cmd) return;
    try {
      await runSuperOpsCommand(cmd);
    } catch (error) {
      const msg = String(error?.message || error);
      setStatus(`Command failed: ${msg}`);
      appendSuperLog(`super-agent error: ${msg}`);
      addActivity('error', 'Super agent command failed', msg);
    }
  });

  el.saveSuperBtn?.addEventListener('click', async () => {
    try {
      await apiPost('/api/admin/runtime/super-agent/config', {
        id: String(el.superIdInput?.value || '').trim(),
        mode: String(el.superModeInput?.value || 'balanced'),
        challengeEnabled: Boolean(el.superChallengeEnabledInput?.checked),
        defaultChallengeCooldownMs: Number(el.superCooldownInput?.value || 9000),
        workerTargetPreference: String(el.superTargetInput?.value || 'human_only')
      });
      addActivity('write', 'Applied super-agent config');
      await refreshAll({ silent: true });
      setStatus('Super-agent config applied.');
    } catch (error) {
      setStatus(`Failed: ${String(error?.message || error)}`);
    }
  });

  el.saveWalletBtn?.addEventListener('click', async () => {
    try {
      await apiPost('/api/admin/runtime/capabilities/wallet', {
        enabled: Boolean(el.walletEnabledInput?.checked),
        grandAgentId: String(el.superIdInput?.value || '').trim(),
        skills: String(el.walletSkillsInput?.value || '').split(',').map((v) => v.trim()).filter(Boolean)
      });
      addActivity('write', 'Applied wallet capabilities policy');
      await refreshAll({ silent: true });
      setStatus('Wallet policy applied.');
    } catch (error) {
      setStatus(`Failed: ${String(error?.message || error)}`);
    }
  });

  el.saveOpenrouterBtn?.addEventListener('click', async () => {
    try {
      await apiPost('/api/admin/runtime/secrets/openrouter', { apiKey: String(el.openrouterKeyInput?.value || '').trim() });
      if (el.openrouterKeyInput) el.openrouterKeyInput.value = '';
      addActivity('write', 'Updated OpenRouter secret');
      await refreshAll({ silent: true });
      setStatus('OpenRouter key saved.');
    } catch (error) {
      setStatus(`Failed: ${String(error?.message || error)}`);
    }
  });

  el.syncEthskillsBtn?.addEventListener('click', async () => {
    try {
      appendSuperLog('system: syncing ETHSkills...');
      await apiPost('/api/admin/runtime/super-agent/ethskills/sync', {});
      appendSuperLog('system: ETHSkills sync complete.');
      addActivity('write', 'Synced ETHSkills');
      await refreshAll({ silent: true });
      setStatus('ETHSkills sync complete.');
    } catch (error) {
      setStatus(`Failed: ${String(error?.message || error)}`);
    }
  });

  el.applyDelegationBtn?.addEventListener('click', async () => {
    try {
      await apiPost('/api/admin/runtime/super-agent/delegate/apply', {});
      addActivity('write', 'Applied delegation plan');
      await refreshAll({ silent: true });
      setStatus('Delegation applied.');
    } catch (error) {
      setStatus(`Failed: ${String(error?.message || error)}`);
    }
  });

  el.applyBgCountBtn?.addEventListener('click', async () => {
    const count = Number(el.bgCountInput?.value || 0);
    if (!window.confirm(`Reconcile background bots to ${count}?`)) return;
    try {
      await apiPost('/api/admin/runtime/agents/reconcile', { count });
      addActivity('write', `Reconciled background bot count to ${count}`);
      await refreshAll({ silent: true });
      setStatus('Background bot count applied.');
    } catch (error) {
      setStatus(`Failed: ${String(error?.message || error)}`);
    }
  });

  el.superChatSendBtn?.addEventListener('click', async () => {
    const message = String(el.superChatInput?.value || '').trim();
    if (!message) return;
    try {
      await runSuperOpsCommand(message);
      if (el.superChatInput) el.superChatInput.value = '';
      setStatus('Super-agent command executed.');
    } catch (error) {
      const msg = String(error?.message || error);
      setStatus(`Command failed: ${msg}`);
      appendSuperLog(`super-agent error: ${msg}`);
      addActivity('error', 'Super-agent command failed', msg);
    }
  });

  el.superChatStatusBtn?.addEventListener('click', async () => {
    try {
      await runSuperOpsCommand('status');
      setStatus('Status command executed.');
    } catch (error) {
      const msg = String(error?.message || error);
      setStatus(`Command failed: ${msg}`);
      appendSuperLog(`super-agent error: ${msg}`);
      addActivity('error', 'Status command failed', msg);
    }
  });
}

function bindFleetActions() {
  el.createProfileBtn?.addEventListener('click', async () => {
    try {
      await apiPost('/api/admin/runtime/profiles/create', {
        username: String(el.newUsernameInput?.value || '').trim(),
        displayName: String(el.newDisplayNameInput?.value || '').trim(),
        personality: String(el.newPersonalityInput?.value || 'social'),
        targetPreference: String(el.newTargetInput?.value || 'human_only')
      });
      if (el.newUsernameInput) el.newUsernameInput.value = '';
      if (el.newDisplayNameInput) el.newDisplayNameInput.value = '';
      addActivity('write', 'Created profile bundle');
      await refreshAll({ silent: true });
      setStatus('Profile bundle created.');
    } catch (error) {
      setStatus(`Failed: ${String(error?.message || error)}`);
    }
  });

  el.profilesBody?.addEventListener('click', async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) return;

    const action = target.dataset.action;
    const walletId = target.dataset.walletId;
    const profileId = target.dataset.profileId;
    if (!action || !walletId) return;

    try {
      if (action === 'fund') {
        await apiPost(`/api/admin/runtime/wallets/${encodeURIComponent(walletId)}/fund`, { amount: Number(target.dataset.amount || 10) });
        addActivity('write', `Funded wallet ${walletId}`);
        await refreshAll({ silent: true });
        setStatus('Wallet funded.');
        return;
      }

      if (action === 'withdraw') {
        await apiPost(`/api/admin/runtime/wallets/${encodeURIComponent(walletId)}/withdraw`, { amount: Number(target.dataset.amount || 5) });
        addActivity('write', `Withdrew from wallet ${walletId}`);
        await refreshAll({ silent: true });
        setStatus('Wallet withdrawn.');
        return;
      }

      if (action === 'export' && profileId) {
        if (!window.confirm(`Export private key for wallet ${walletId}?`)) return;
        const result = await apiPost(`/api/admin/runtime/wallets/${encodeURIComponent(walletId)}/export-key`, { profileId });
        window.alert(`Wallet ${walletId}\nAddress: ${result.address}\nPrivate key: ${result.privateKey}`);
        addActivity('write', `Exported private key for wallet ${walletId}`);
      }
    } catch (error) {
      setStatus(`Failed: ${String(error?.message || error)}`);
    }
  });

  el.botsBody?.addEventListener('click', async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) return;
    if (target.dataset.action !== 'save-bot') return;

    const botId = target.dataset.botId;
    if (!botId) return;

    try {
      await apiPost(`/api/admin/runtime/agents/${encodeURIComponent(botId)}/config`, gatherBotPatch(botId));
      addActivity('write', `Saved bot config ${botId}`);
      await refreshAll({ silent: true });
      setStatus('Bot config saved.');
    } catch (error) {
      setStatus(`Failed: ${String(error?.message || error)}`);
    }
  });
}

function bindTreasuryActions() {
  el.houseApply?.addEventListener('click', async () => {
    try {
      await apiPost('/api/admin/runtime/house/config', {
        npcWalletFloor: Number(el.houseNpcFloor?.value || 0),
        npcWalletTopupAmount: Number(el.houseNpcTopup?.value || 0),
        superAgentWalletFloor: Number(el.houseSuperFloor?.value || 0)
      });
      addActivity('write', 'Applied house policy');
      await refreshAll({ silent: true });
      setStatus('House policy applied.');
    } catch (error) {
      setStatus(`Failed: ${String(error?.message || error)}`);
    }
  });

  el.houseRefill?.addEventListener('click', async () => {
    const amount = Number(el.houseRefillAmount?.value || 0);
    if (amount <= 0) {
      setStatus('Refill amount must be > 0.');
      return;
    }
    if (!window.confirm(`Refill house wallet by ${amount}?`)) return;
    try {
      await apiPost('/api/admin/runtime/house/refill', { amount, reason: 'ops_ui' });
      addActivity('write', `House refill ${amount}`);
      await refreshAll({ silent: true });
      setStatus('House refilled.');
    } catch (error) {
      setStatus(`Failed: ${String(error?.message || error)}`);
    }
  });

  el.houseTransfer?.addEventListener('click', async () => {
    const toWalletId = String(el.houseTransferWallet?.value || '').trim();
    const amount = Number(el.houseTransferAmount?.value || 0);
    if (!toWalletId || amount <= 0) {
      setStatus('Transfer requires wallet id and amount > 0.');
      return;
    }
    if (!window.confirm(`Transfer ${amount} to ${toWalletId}?`)) return;
    try {
      await apiPost('/api/admin/runtime/house/transfer', { toWalletId, amount, reason: 'ops_ui' });
      if (el.houseTransferWallet) el.houseTransferWallet.value = '';
      addActivity('write', `House transfer ${amount} -> ${toWalletId}`);
      await refreshAll({ silent: true });
      setStatus('House transfer complete.');
    } catch (error) {
      setStatus(`Failed: ${String(error?.message || error)}`);
    }
  });
}

function bindUsersActions() {
  el.usersBody?.addEventListener('click', async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const action = target.dataset.action;
    if (!action) return;

    const row = target.closest('tr');
    const profileId = row?.dataset.profileId || '';
    if (!profileId) return;

    const getField = (name) => row?.querySelector(`[data-field="${name}"]`);

    try {
      if (action === 'teleport-section') {
        const section = Number(getField('teleport-section')?.value ?? NaN);
        if (!Number.isFinite(section)) {
          setStatus('Pick a section (S1..S8).');
          return;
        }
        await apiPost(`/api/admin/users/${encodeURIComponent(profileId)}/teleport`, { section });
        addActivity('write', `Teleported user ${profileId} to section ${section + 1}`);
        await refreshAll({ silent: true });
        setStatus('User teleported to section.');
        return;
      }

      if (action === 'teleport-coords') {
        const x = Number(getField('teleport-x')?.value ?? NaN);
        const z = Number(getField('teleport-z')?.value ?? NaN);
        if (!Number.isFinite(x) || !Number.isFinite(z)) {
          setStatus('Enter numeric x and z.');
          return;
        }
        await apiPost(`/api/admin/users/${encodeURIComponent(profileId)}/teleport`, { x, z });
        addActivity('write', `Teleported user ${profileId} to x=${x} z=${z}`);
        await refreshAll({ silent: true });
        setStatus('User teleported to coordinates.');
        return;
      }

      if (action === 'wallet-adjust') {
        const direction = String(getField('wallet-direction')?.value || 'credit');
        const amount = Math.max(0, Number(getField('wallet-amount')?.value ?? 0));
        const reason = String(getField('wallet-reason')?.value || '').trim();
        if (amount <= 0) {
          setStatus('Amount must be > 0.');
          return;
        }
        await apiPost(`/api/admin/users/${encodeURIComponent(profileId)}/wallet/adjust`, { direction, amount, reason });
        addActivity('write', `Wallet ${direction} ${amount} for ${profileId}`, reason);
        await refreshAll({ silent: true });
        setStatus('Wallet adjusted.');
        return;
      }

      if (action === 'force-logout') {
        await apiPost(`/api/admin/users/${encodeURIComponent(profileId)}/logout`, {});
        addActivity('write', `Forced logout for ${profileId}`);
        await refreshAll({ silent: true });
        setStatus('Forced logout completed.');
      }
    } catch (error) {
      setStatus(`Failed: ${String(error?.message || error)}`);
    }
  });
}

function bindMarketsActions() {
  el.marketsSyncBtn?.addEventListener('click', async () => {
    setStatus('Syncing markets from Polymarket...');
    try {
      const payload = await marketsSync();
      addActivity('write', 'Synced prediction markets', `synced=${Number(payload?.synced || 0)}`);
      setStatus(`Markets synced (${Number(payload?.synced || 0)}).`);
    } catch (error) {
      setStatus(`Markets sync failed: ${String(error?.message || error)}`);
    }
  });

  el.marketsAutoActivateBtn?.addEventListener('click', async () => {
    setStatus('Sync + auto-activate open markets...');
    try {
      const payload = await marketsAutoActivate();
      addActivity('write', 'Auto-activate markets', `synced=${Number(payload?.synced || 0)}, activated=${Number(payload?.activated || 0)}`);
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

function pollingIntervalMs() {
  if (state.activeView === 'super' || state.activeView === 'activity') return 7000;
  if (state.activeView === 'markets') return 9000;
  if (state.activeView === 'users') return 8000;
  return 12000;
}

function schedulePolling(reset = false) {
  if (reset && state.pollTimer) {
    clearTimeout(state.pollTimer);
    state.pollTimer = null;
  }
  const ms = pollingIntervalMs();
  state.pollTimer = window.setTimeout(async () => {
    try {
      await refreshAll({ silent: true });
      if (state.activeView === 'markets') await marketsLoad();
    } finally {
      schedulePolling(true);
    }
  }, ms);
}

function bindEvents() {
  for (const btn of el.railButtons) {
    btn.addEventListener('click', () => {
      state.activeView = String(btn.dataset.view || 'overview');
      renderViews();
      schedulePolling(true);
    });
  }

  el.refreshBtn?.addEventListener('click', async () => {
    setStatus('Refreshing workspace...');
    try {
      await refreshAll();
      if (state.activeView === 'markets') await marketsLoad();
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

  bindSuperActions();
  bindFleetActions();
  bindTreasuryActions();
  bindUsersActions();
  bindMarketsActions();
}

async function init() {
  bindEvents();
  renderViews();
  renderTools();
  renderActivity();
  addActivity('system', 'Admin chief initialized');
  await refreshAll();
  try {
    await marketsLoad();
  } catch {
    // lazy retry when user opens markets
  }
  schedulePolling(true);
  setStatus('Chief Ops workspace ready.');
}

init().catch((error) => {
  setStatus(`Init failed: ${String(error?.message || error)}`);
});
