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
  toolGroups: [...document.querySelectorAll('[data-tool-group]')]
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
}

async function init() {
  bindEvents();
  renderViews();
  renderTools();
  renderActivity();
  await loadBootstrap();
  setStatus('Chief Ops workspace ready.');
}

init().catch((error) => {
  setStatus(`Init failed: ${String(error?.message || error)}`);
});
