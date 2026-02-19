// Admin command center.
const runtimeBase = '/api/admin/runtime';
const serverBase = '/api/admin';

const state = {
  activeTab: 'overview',
  loading: false,
  lastLoadedAt: 0,
  latestStatus: null,
  latestChallenges: [],
  latestUsers: [],
  latestMarkets: [],
  latestSuperStatus: null,
  errors: [],
  activity: [],
  pollTimer: null
};

const el = {
  statusBar: document.getElementById('status-bar'),
  tabs: [...document.querySelectorAll('[data-tab]')],
  panels: {
    overview: document.getElementById('panel-overview'),
    super: document.getElementById('panel-super'),
    fleet: document.getElementById('panel-fleet'),
    treasury: document.getElementById('panel-treasury'),
    markets: document.getElementById('panel-markets'),
    users: document.getElementById('panel-users'),
    activity: document.getElementById('panel-activity')
  },
  refreshAllBtn: document.getElementById('refresh-all'),
  overviewKpis: document.getElementById('overview-kpis'),
  runtimeSnapshot: document.getElementById('runtime-snapshot'),
  overviewIncidents: document.getElementById('overview-incidents'),
  activityList: document.getElementById('activity-list'),

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
  marketsSync: document.getElementById('markets-sync'),
  marketsBody: document.getElementById('markets-body')
};

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function nowTimeLabel() {
  return new Date().toLocaleTimeString();
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function addActivity(type, message, details = '') {
  state.activity.unshift({
    at: Date.now(),
    type,
    message,
    details
  });
  if (state.activity.length > 200) {
    state.activity.length = 200;
  }
  renderActivity();
}

function setStatus(text, isError = false) {
  if (!el.statusBar) return;
  el.statusBar.textContent = text;
  el.statusBar.classList.toggle('danger', Boolean(isError));
}

async function apiGetJson(url) {
  const response = await fetch(url, { credentials: 'include' });
  if (response.status === 401 || response.status === 403) {
    window.location.href = '/welcome';
    throw new Error('unauthorized');
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(String(payload?.reason || payload?.error || `status_${response.status}`));
  }
  return payload;
}

async function apiPostJson(url, payload) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload ?? {}),
    credentials: 'include'
  });
  if (response.status === 401 || response.status === 403) {
    window.location.href = '/welcome';
    throw new Error('unauthorized');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(String(data?.reason || data?.error || `status_${response.status}`));
  }
  return data;
}

async function safeFetch(name, fn) {
  try {
    const data = await fn();
    return { name, ok: true, data };
  } catch (error) {
    return { name, ok: false, error: String(error?.message || error) };
  }
}

function formatChallengeLine(entry) {
  const time = new Date(entry.at).toLocaleTimeString();
  const versus = entry.challengerId && entry.opponentId ? `${entry.challengerId} vs ${entry.opponentId}` : 'n/a';
  const gameType = entry.gameType || '-';
  const winner = entry.winnerId ? ` winner=${entry.winnerId}` : '';
  const reason = entry.reason ? ` reason=${entry.reason}` : '';
  return `${time} ${entry.event} ${gameType} ${versus}${winner}${reason}`;
}

function renderTabState() {
  for (const tabBtn of el.tabs) {
    const id = tabBtn.getAttribute('data-tab') || '';
    tabBtn.classList.toggle('active', id === state.activeTab);
  }
  for (const [id, panel] of Object.entries(el.panels)) {
    panel?.classList.toggle('active', id === state.activeTab);
  }
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
    for (const err of state.errors.slice(0, 6)) {
      lines.push(`Error: ${err}`);
    }
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
  if (el.walletSkillsInput) el.walletSkillsInput.value = Array.isArray(walletPolicy.allowedSkills)
    ? walletPolicy.allowedSkills.join(',')
    : '';

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
        <div class="actions">
          <button class="btn" data-action="fund" data-wallet-id="${escapeHtml(profile.wallet?.id || profile.walletId || '')}" data-amount="10">+10</button>
          <button class="btn" data-action="withdraw" data-wallet-id="${escapeHtml(profile.wallet?.id || profile.walletId || '')}" data-amount="5">-5</button>
          <button class="btn" data-action="export" data-wallet-id="${escapeHtml(profile.wallet?.id || profile.walletId || '')}" data-profile-id="${escapeHtml(profile.id || '')}">Export key</button>
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
      <td><button class="btn" data-action="save-bot" data-bot-id="${escapeHtml(bot.id || '')}">Save</button></td>
    `;
    el.botsBody.appendChild(row);
  }
}

function formatLastSeen(ts) {
  const at = Number(ts ?? 0);
  if (!Number.isFinite(at) || at <= 0) return '-';
  return new Date(at).toLocaleString();
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
        <div class="actions">
          <select data-field="teleport-section">
            <option value="">Teleport: section…</option>
            <option value="0">S1</option><option value="1">S2</option><option value="2">S3</option><option value="3">S4</option>
            <option value="4">S5</option><option value="5">S6</option><option value="6">S7</option><option value="7">S8</option>
          </select>
          <button type="button" class="btn" data-action="teleport-section">Teleport To Section</button>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
            <input data-field="teleport-x" type="number" step="0.5" placeholder="x">
            <input data-field="teleport-z" type="number" step="0.5" placeholder="z">
          </div>
          <button type="button" class="btn" data-action="teleport-coords">Teleport To Coords</button>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
            <select data-field="wallet-direction"><option value="credit">Credit</option><option value="debit">Debit</option></select>
            <input data-field="wallet-amount" type="number" min="0" step="0.01" placeholder="amount">
          </div>
          <input data-field="wallet-reason" type="text" placeholder="reason (optional)">
          <button type="button" class="btn btn-primary" data-action="wallet-adjust">Adjust Wallet</button>
          <button type="button" class="btn" data-action="force-logout">Force Logout</button>
        </div>
      </td>
    `;
    el.usersBody.appendChild(tr);
  }
}

function renderMarkets() {
  if (!el.marketsBody) return;
  const markets = state.latestMarkets || [];
  el.marketsBody.innerHTML = '';
  for (const market of markets) {
    const tr = document.createElement('tr');
    const maxWager = Number(market.maxWager || 100);
    const spread = Number(market.houseSpreadBps || 0);
    tr.innerHTML = `
      <td>
        <div style="font-weight:650;">${escapeHtml(market.question || market.marketId || '-')}</div>
        <div class="mono" style="color:var(--text-secondary);">${escapeHtml(market.marketId || '-')}</div>
      </td>
      <td>${escapeHtml(market.status || 'open')}</td>
      <td>YES ${Number(market.yesPrice || 0).toFixed(2)} · NO ${Number(market.noPrice || 0).toFixed(2)}</td>
      <td>
        <div class="mono">max ${maxWager}</div>
        <div class="mono" style="color:var(--text-secondary);">spread ${spread} bps</div>
      </td>
      <td>${market.active ? 'yes' : 'no'}</td>
      <td>
        <div class="actions">
          <button class="btn" data-action="market-activate" data-market-id="${escapeHtml(market.marketId || '')}">Activate</button>
          <button class="btn" data-action="market-deactivate" data-market-id="${escapeHtml(market.marketId || '')}">Deactivate</button>
        </div>
      </td>
    `;
    el.marketsBody.appendChild(tr);
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
    el.activityList.innerHTML = '<div class="event">No events yet.</div>';
    return;
  }

  el.activityList.innerHTML = all.map((entry) => `
    <article class="event">
      <div class="meta">${escapeHtml(new Date(entry.at).toLocaleString())} · ${escapeHtml(entry.type || 'event')}</div>
      <div>${escapeHtml(entry.message || '')}</div>
      ${entry.details ? `<div class="mono" style="margin-top:4px;color:var(--text-secondary);">${escapeHtml(entry.details)}</div>` : ''}
    </article>
  `).join('');
}

function renderAll() {
  renderTabState();
  renderOverview();
  populateControlValues();
  renderProfiles();
  renderBots();
  renderMarkets();
  renderUsers();
  renderActivity();
}

function appendSuperLog(line) {
  if (!el.superChatLog) return;
  const prev = el.superChatLog.textContent || '';
  const next = `${nowTimeLabel()} ${line}`;
  el.superChatLog.textContent = `${next}\n${prev}`.slice(0, 16000);
}

async function refreshAll({ silent = false } = {}) {
  if (state.loading) return;
  state.loading = true;
  if (!silent) {
    setStatus('Refreshing command center...');
  }

  const [statusRes, challengesRes, usersRes, superRes, marketsRes] = await Promise.all([
    safeFetch('status', () => apiGetJson(`${runtimeBase}/status`)),
    safeFetch('challenges', () => apiGetJson(`${serverBase}/challenges/recent?limit=80`)),
    safeFetch('users', () => apiGetJson(`${serverBase}/users`)),
    safeFetch('superStatus', () => apiGetJson(`${runtimeBase}/super-agent/status`)),
    safeFetch('markets', () => apiGetJson(`${runtimeBase}/markets`))
  ]);

  const failures = [statusRes, challengesRes, usersRes, superRes, marketsRes].filter((r) => !r.ok);
  state.errors = failures.map((f) => `${f.name}: ${f.error}`);

  if (statusRes.ok) state.latestStatus = statusRes.data;
  if (challengesRes.ok) state.latestChallenges = challengesRes.data?.recent || [];
  if (usersRes.ok) state.latestUsers = usersRes.data?.users || [];
  if (superRes.ok) state.latestSuperStatus = superRes.data;
  if (marketsRes.ok) state.latestMarkets = Array.isArray(marketsRes.data?.markets) ? marketsRes.data.markets : [];

  state.lastLoadedAt = Date.now();
  renderAll();

  if (failures.length === 0) {
    setStatus(`Ready. Last refresh ${new Date(state.lastLoadedAt).toLocaleTimeString()}.`);
  } else {
    const msg = failures.map((f) => `${f.name}: ${f.error}`).join(' | ');
    setStatus(`Partial refresh: ${msg}`, true);
    addActivity('error', 'Partial refresh failure', msg);
  }

  state.loading = false;
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

async function runChiefCommand(message) {
  if (!message.trim()) {
    appendSuperLog('super-agent: message required');
    return;
  }
  appendSuperLog(`you: ${message}`);

  const confirmMatch = message.match(/^confirm\s+([a-z0-9_:-]+)$/i);
  const payload = confirmMatch?.[1]
    ? { confirmToken: confirmMatch[1] }
    : { message, context: { page: 'admin' } };

  const result = await apiPostJson('/api/chief/v1/chat', payload);
  const actionText = Array.isArray(result.actions)
    ? result.actions.map((entry) => `${entry.tool}:${entry.status}`).join(', ')
    : '';

  appendSuperLog(`super-agent: ${String(result.reply || '').replace(/\n/g, ' | ')}`);
  if (actionText) appendSuperLog(`actions: ${actionText}`);
  if (result.requiresConfirmation) appendSuperLog(`confirm: confirm ${String(result.confirmToken || '')}`);

  addActivity('super-agent', message, actionText || String(result.reply || ''));
  await refreshAll({ silent: true });
}

function bindTabs() {
  for (const button of el.tabs) {
    button.addEventListener('click', () => {
      const tabId = button.getAttribute('data-tab') || 'overview';
      state.activeTab = tabId;
      renderTabState();
      schedulePolling(true);
    });
  }
}

function bindSuperChips() {
  if (!el.superChips) return;
  const chips = [
    'status',
    'why are games not starting?',
    'rebalance bots',
    'show disconnected bots',
    'apply delegation',
    'optimize challenge flow'
  ];
  el.superChips.innerHTML = chips.map((chip) => `<button type="button" class="chip" data-cmd="${escapeHtml(chip)}">${escapeHtml(chip)}</button>`).join('');
  el.superChips.addEventListener('click', async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) return;
    const cmd = target.dataset.cmd;
    if (!cmd) return;
    try {
      await runChiefCommand(cmd);
    } catch (error) {
      const msg = String(error?.message || error);
      setStatus(`Command failed: ${msg}`, true);
      appendSuperLog(`super-agent error: ${msg}`);
      addActivity('error', 'Super agent command failed', msg);
    }
  });
}

function bindPrimaryActions() {
  el.refreshAllBtn?.addEventListener('click', () => {
    void refreshAll();
  });

  el.saveSuperBtn?.addEventListener('click', async () => {
    try {
      await apiPostJson(`${runtimeBase}/super-agent/config`, {
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
      setStatus(`Failed: ${String(error?.message || error)}`, true);
    }
  });

  el.saveWalletBtn?.addEventListener('click', async () => {
    try {
      await apiPostJson(`${runtimeBase}/capabilities/wallet`, {
        enabled: Boolean(el.walletEnabledInput?.checked),
        grandAgentId: String(el.superIdInput?.value || '').trim(),
        skills: String(el.walletSkillsInput?.value || '').split(',').map((v) => v.trim()).filter(Boolean)
      });
      addActivity('write', 'Applied wallet capabilities policy');
      await refreshAll({ silent: true });
      setStatus('Wallet policy applied.');
    } catch (error) {
      setStatus(`Failed: ${String(error?.message || error)}`, true);
    }
  });

  el.saveOpenrouterBtn?.addEventListener('click', async () => {
    try {
      await apiPostJson(`${runtimeBase}/secrets/openrouter`, { apiKey: String(el.openrouterKeyInput?.value || '').trim() });
      if (el.openrouterKeyInput) el.openrouterKeyInput.value = '';
      addActivity('write', 'Updated OpenRouter secret');
      await refreshAll({ silent: true });
      setStatus('OpenRouter key saved.');
    } catch (error) {
      setStatus(`Failed: ${String(error?.message || error)}`, true);
    }
  });

  el.syncEthskillsBtn?.addEventListener('click', async () => {
    try {
      appendSuperLog('system: syncing ETHSkills...');
      await apiPostJson(`${runtimeBase}/super-agent/ethskills/sync`, {});
      appendSuperLog('system: ETHSkills sync complete.');
      addActivity('write', 'Synced ETHSkills');
      await refreshAll({ silent: true });
      setStatus('ETHSkills sync complete.');
    } catch (error) {
      setStatus(`Failed: ${String(error?.message || error)}`, true);
    }
  });

  el.applyDelegationBtn?.addEventListener('click', async () => {
    try {
      await apiPostJson(`${runtimeBase}/super-agent/delegate/apply`, {});
      addActivity('write', 'Applied delegation plan');
      await refreshAll({ silent: true });
      setStatus('Delegation applied.');
    } catch (error) {
      setStatus(`Failed: ${String(error?.message || error)}`, true);
    }
  });

  el.applyBgCountBtn?.addEventListener('click', async () => {
    const count = Number(el.bgCountInput?.value || 0);
    if (!window.confirm(`Reconcile background bots to ${count}?`)) return;
    try {
      await apiPostJson(`${runtimeBase}/agents/reconcile`, { count });
      addActivity('write', `Reconciled background bot count to ${count}`);
      await refreshAll({ silent: true });
      setStatus('Background bot count applied.');
    } catch (error) {
      setStatus(`Failed: ${String(error?.message || error)}`, true);
    }
  });

  el.superChatSendBtn?.addEventListener('click', async () => {
    const message = String(el.superChatInput?.value || '').trim();
    if (!message) return;
    try {
      await runChiefCommand(message);
      if (el.superChatInput) el.superChatInput.value = '';
      setStatus('Super-agent command executed.');
    } catch (error) {
      const msg = String(error?.message || error);
      setStatus(`Command failed: ${msg}`, true);
      appendSuperLog(`super-agent error: ${msg}`);
      addActivity('error', 'Super-agent command failed', msg);
    }
  });

  el.superChatStatusBtn?.addEventListener('click', async () => {
    try {
      await runChiefCommand('status');
      setStatus('Status command executed.');
    } catch (error) {
      const msg = String(error?.message || error);
      setStatus(`Command failed: ${msg}`, true);
      appendSuperLog(`super-agent error: ${msg}`);
      addActivity('error', 'Status command failed', msg);
    }
  });

  el.createProfileBtn?.addEventListener('click', async () => {
    try {
      await apiPostJson(`${runtimeBase}/profiles/create`, {
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
      setStatus(`Failed: ${String(error?.message || error)}`, true);
    }
  });

  el.houseApply?.addEventListener('click', async () => {
    try {
      await apiPostJson(`${runtimeBase}/house/config`, {
        npcWalletFloor: Number(el.houseNpcFloor?.value || 0),
        npcWalletTopupAmount: Number(el.houseNpcTopup?.value || 0),
        superAgentWalletFloor: Number(el.houseSuperFloor?.value || 0)
      });
      addActivity('write', 'Applied house policy');
      await refreshAll({ silent: true });
      setStatus('House policy applied.');
    } catch (error) {
      setStatus(`Failed: ${String(error?.message || error)}`, true);
    }
  });

  el.houseRefill?.addEventListener('click', async () => {
    const amount = Number(el.houseRefillAmount?.value || 0);
    if (amount <= 0) {
      setStatus('Refill amount must be > 0.', true);
      return;
    }
    if (!window.confirm(`Refill house wallet by ${amount}?`)) return;
    try {
      await apiPostJson(`${runtimeBase}/house/refill`, { amount, reason: 'ops_ui' });
      addActivity('write', `House refill ${amount}`);
      await refreshAll({ silent: true });
      setStatus('House refilled.');
    } catch (error) {
      setStatus(`Failed: ${String(error?.message || error)}`, true);
    }
  });

  el.houseTransfer?.addEventListener('click', async () => {
    const toWalletId = String(el.houseTransferWallet?.value || '').trim();
    const amount = Number(el.houseTransferAmount?.value || 0);
    if (!toWalletId || amount <= 0) {
      setStatus('Transfer requires wallet id and amount > 0.', true);
      return;
    }
    if (!window.confirm(`Transfer ${amount} to ${toWalletId}?`)) return;
    try {
      await apiPostJson(`${runtimeBase}/house/transfer`, { toWalletId, amount, reason: 'ops_ui' });
      if (el.houseTransferWallet) el.houseTransferWallet.value = '';
      addActivity('write', `House transfer ${amount} -> ${toWalletId}`);
      await refreshAll({ silent: true });
      setStatus('House transfer complete.');
    } catch (error) {
      setStatus(`Failed: ${String(error?.message || error)}`, true);
    }
  });

  el.marketsSync?.addEventListener('click', async () => {
    try {
      await apiPostJson(`${runtimeBase}/markets/sync`, {});
      addActivity('write', 'Synced prediction markets');
      await refreshAll({ silent: true });
      setStatus('Prediction markets synced.');
    } catch (error) {
      setStatus(`Failed: ${String(error?.message || error)}`, true);
    }
  });
}

function bindTableActions() {
  el.profilesBody?.addEventListener('click', async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) return;

    const action = target.dataset.action;
    const walletId = target.dataset.walletId;
    const profileId = target.dataset.profileId;
    if (!action || !walletId) return;

    try {
      if (action === 'fund') {
        await apiPostJson(`${runtimeBase}/wallets/${encodeURIComponent(walletId)}/fund`, { amount: Number(target.dataset.amount || 10) });
        addActivity('write', `Funded wallet ${walletId}`);
        await refreshAll({ silent: true });
        setStatus('Wallet funded.');
        return;
      }

      if (action === 'withdraw') {
        await apiPostJson(`${runtimeBase}/wallets/${encodeURIComponent(walletId)}/withdraw`, { amount: Number(target.dataset.amount || 5) });
        addActivity('write', `Withdrew from wallet ${walletId}`);
        await refreshAll({ silent: true });
        setStatus('Wallet withdrawn.');
        return;
      }

      if (action === 'export' && profileId) {
        if (!window.confirm(`Export private key for wallet ${walletId}?`)) return;
        const result = await apiPostJson(`${runtimeBase}/wallets/${encodeURIComponent(walletId)}/export-key`, { profileId });
        window.alert(`Wallet ${walletId}\nAddress: ${result.address}\nPrivate key: ${result.privateKey}`);
        addActivity('write', `Exported private key for wallet ${walletId}`);
      }
    } catch (error) {
      setStatus(`Failed: ${String(error?.message || error)}`, true);
    }
  });

  el.botsBody?.addEventListener('click', async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) return;
    if (target.dataset.action !== 'save-bot') return;

    const botId = target.dataset.botId;
    if (!botId) return;

    try {
      await apiPostJson(`${runtimeBase}/agents/${encodeURIComponent(botId)}/config`, gatherBotPatch(botId));
      addActivity('write', `Saved bot config ${botId}`);
      await refreshAll({ silent: true });
      setStatus('Bot config saved.');
    } catch (error) {
      setStatus(`Failed: ${String(error?.message || error)}`, true);
    }
  });

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
          setStatus('Pick a section (S1..S8).', true);
          return;
        }
        await apiPostJson(`/api/admin/users/${encodeURIComponent(profileId)}/teleport`, { section });
        addActivity('write', `Teleported user ${profileId} to section ${section + 1}`);
        await refreshAll({ silent: true });
        setStatus('User teleported to section.');
        return;
      }

      if (action === 'teleport-coords') {
        const x = Number(getField('teleport-x')?.value ?? NaN);
        const z = Number(getField('teleport-z')?.value ?? NaN);
        if (!Number.isFinite(x) || !Number.isFinite(z)) {
          setStatus('Enter numeric x and z.', true);
          return;
        }
        await apiPostJson(`/api/admin/users/${encodeURIComponent(profileId)}/teleport`, { x, z });
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
          setStatus('Amount must be > 0.', true);
          return;
        }
        await apiPostJson(`/api/admin/users/${encodeURIComponent(profileId)}/wallet/adjust`, { direction, amount, reason });
        addActivity('write', `Wallet ${direction} ${amount} for ${profileId}`, reason);
        await refreshAll({ silent: true });
        setStatus('Wallet adjusted.');
        return;
      }

      if (action === 'force-logout') {
        await apiPostJson(`/api/admin/users/${encodeURIComponent(profileId)}/logout`, {});
        addActivity('write', `Forced logout for ${profileId}`);
        await refreshAll({ silent: true });
        setStatus('Forced logout completed.');
      }
    } catch (error) {
      setStatus(`Failed: ${String(error?.message || error)}`, true);
    }
  });

  el.marketsBody?.addEventListener('click', async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) return;
    const action = String(target.dataset.action || '');
    const marketId = String(target.dataset.marketId || '').trim();
    if (!action || !marketId) return;
    try {
      if (action === 'market-activate') {
        await apiPostJson(`${runtimeBase}/markets/activate`, { marketId });
        addActivity('write', `Activated market ${marketId}`);
      } else if (action === 'market-deactivate') {
        await apiPostJson(`${runtimeBase}/markets/deactivate`, { marketId });
        addActivity('write', `Deactivated market ${marketId}`);
      } else {
        return;
      }
      await refreshAll({ silent: true });
      setStatus(`Updated market ${marketId}.`);
    } catch (error) {
      setStatus(`Failed: ${String(error?.message || error)}`, true);
    }
  });
}

function pollingIntervalMs() {
  if (state.activeTab === 'super' || state.activeTab === 'activity') return 7000;
  if (state.activeTab === 'markets') return 9000;
  if (state.activeTab === 'users') return 8000;
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
    } finally {
      schedulePolling(true);
    }
  }, ms);
}

function init() {
  bindTabs();
  bindSuperChips();
  bindPrimaryActions();
  bindTableActions();

  addActivity('system', 'Admin command center initialized');
  void refreshAll().then(() => {
    schedulePolling(true);
  }).catch((error) => {
    const msg = String(error?.message || error);
    setStatus(`Initial load failed: ${msg}`, true);
    addActivity('error', 'Initial load failed', msg);
    schedulePolling(true);
  });
}

init();
