// Admin ops must be routed through the web server (session + role checks).
const runtimeBase = '/api/admin/runtime';
const serverBase = '/api/admin';

const statusSummary = document.getElementById('status-summary');
const challengeLogEl = document.getElementById('challenge-log');
const profilesBody = document.getElementById('profiles-body');
const botsBody = document.getElementById('bots-body');

const superIdInput = document.getElementById('super-id');
const superModeInput = document.getElementById('super-mode');
const superChallengeEnabledInput = document.getElementById('super-challenge-enabled');
const superCooldownInput = document.getElementById('super-cooldown');
const superTargetInput = document.getElementById('super-target');
const walletEnabledInput = document.getElementById('wallet-enabled');
const walletSkillsInput = document.getElementById('wallet-skills');
const openrouterKeyInput = document.getElementById('openrouter-key');

const saveSuperBtn = document.getElementById('save-super');
const saveWalletBtn = document.getElementById('save-wallet');
const saveOpenrouterBtn = document.getElementById('save-openrouter');
const syncEthskillsBtn = document.getElementById('sync-ethskills');
const applyDelegationBtn = document.getElementById('apply-delegation');

const newUsernameInput = document.getElementById('new-username');
const newDisplayNameInput = document.getElementById('new-display-name');
const newPersonalityInput = document.getElementById('new-personality');
const newTargetInput = document.getElementById('new-target');
const createProfileBtn = document.getElementById('create-profile');

const bgCountInput = document.getElementById('bg-count');
const applyBgCountBtn = document.getElementById('apply-bg-count');
const refreshAllBtn = document.getElementById('refresh-all');
const superChatInput = document.getElementById('super-chat-input');
const superChatSendBtn = document.getElementById('super-chat-send');
const superChatStatusBtn = document.getElementById('super-chat-status');
const superChatLog = document.getElementById('super-chat-log');

let latestStatus = null;

async function getJson(url) {
  const response = await fetch(url, { credentials: 'include' });
  if (response.status === 401 || response.status === 403) {
    window.location.href = '/welcome';
    throw new Error('unauthorized');
  }
  if (!response.ok) {
    throw new Error(`GET ${url} failed (${response.status})`);
  }
  return response.json();
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    credentials: 'include'
  });

  const data = await response.json().catch(() => ({}));
  if (response.status === 401 || response.status === 403) {
    window.location.href = '/welcome';
    throw new Error('unauthorized');
  }
  if (!response.ok) {
    const reason = data?.reason || data?.error || `status_${response.status}`;
    throw new Error(String(reason));
  }

  return data;
}

function summarizeStatus(status) {
  return JSON.stringify(
    {
      configuredBotCount: status.configuredBotCount,
      connectedBotCount: status.connectedBotCount,
      backgroundBotCount: status.backgroundBotCount,
      profileBotCount: status.profileBotCount,
      profileCount: status.profiles?.length || 0,
      openRouterConfigured: status.openRouterConfigured,
      superAgent: status.superAgent
    },
    null,
    2
  );
}

function renderProfiles(status) {
  profilesBody.innerHTML = '';

  for (const profile of status.profiles || []) {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>
        <div>${profile.displayName}</div>
        <div style="color:var(--text-muted);font-size:11px;">${profile.id} · @${profile.username}</div>
      </td>
      <td>
        <div>${profile.wallet?.id || 'n/a'}</div>
        <div style="color:var(--text-muted);font-size:11px;">${profile.wallet?.address || 'n/a'}</div>
      </td>
      <td>${Number(profile.wallet?.balance || 0).toFixed(2)}</td>
      <td>${(profile.ownedBotIds || []).join(', ')}</td>
      <td>
        <div class="actions">
          <button data-action="fund" data-wallet-id="${profile.wallet?.id}" data-amount="10">+10</button>
          <button data-action="withdraw" data-wallet-id="${profile.wallet?.id}" data-amount="5">-5</button>
          <button data-action="export" data-wallet-id="${profile.wallet?.id}" data-profile-id="${profile.id}">Export key</button>
        </div>
      </td>
    `;
    profilesBody.appendChild(row);
  }
}

function renderBots(status) {
  botsBody.innerHTML = '';

  for (const bot of status.bots || []) {
    const meta = bot.meta || {};

    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${bot.id}</td>
      <td><input data-bot-id="${bot.id}" data-field="displayName" type="text" value="${meta.displayName || bot.id}"></td>
      <td>${meta.ownerProfileId || 'system'}</td>
      <td>${meta.duty || 'n/a'}</td>
      <td>${typeof meta.patrolSection === 'number' ? `S${meta.patrolSection + 1}` : '—'}</td>
      <td>${bot.connected ? 'yes' : 'no'}</td>
      <td>
        <select data-bot-id="${bot.id}" data-field="personality">
          ${['aggressive', 'conservative', 'social']
            .map((value) => `<option value="${value}" ${bot.behavior.personality === value ? 'selected' : ''}>${value}</option>`)
            .join('')}
        </select>
      </td>
      <td>
        <select data-bot-id="${bot.id}" data-field="targetPreference">
          ${['human_only', 'human_first', 'any']
            .map((value) => `<option value="${value}" ${bot.behavior.targetPreference === value ? 'selected' : ''}>${value}</option>`)
            .join('')}
        </select>
      </td>
      <td><input data-bot-id="${bot.id}" data-field="challengeCooldownMs" type="number" min="1200" max="120000" value="${bot.behavior.challengeCooldownMs}"></td>
      <td><input data-bot-id="${bot.id}" data-field="managedBySuperAgent" type="checkbox" ${meta.managedBySuperAgent ? 'checked' : ''}></td>
      <td><button data-action="save-bot" data-bot-id="${bot.id}">Save</button></td>
    `;
    botsBody.appendChild(row);
  }
}

function renderChallengeLog(challengeData) {
  const lines = (challengeData.recent || [])
    .slice()
    .reverse()
    .map((entry) => {
      const time = new Date(entry.at).toLocaleTimeString();
      const versus = entry.challengerId && entry.opponentId ? `${entry.challengerId} vs ${entry.opponentId}` : 'n/a';
      const gameType = entry.gameType || '-';
      const winner = entry.winnerId ? ` winner=${entry.winnerId}` : '';
      const reason = entry.reason ? ` reason=${entry.reason}` : '';
      return `${time} ${entry.event} ${gameType} ${versus}${winner}${reason}`;
    });

  challengeLogEl.textContent = lines.join('\n') || 'No challenge activity yet.';
}

function populateControlValues(status) {
  superIdInput.value = status.superAgent?.id || 'agent_1';
  superModeInput.value = status.superAgent?.mode || 'balanced';
  superChallengeEnabledInput.checked = Boolean(status.superAgent?.challengeEnabled);
  superCooldownInput.value = String(status.superAgent?.defaultChallengeCooldownMs || 9000);
  superTargetInput.value = status.superAgent?.workerTargetPreference || 'human_only';
  walletEnabledInput.checked = Boolean(status.superAgent?.walletPolicy?.enabled);
  walletSkillsInput.value = Array.isArray(status.superAgent?.walletPolicy?.allowedSkills)
    ? status.superAgent.walletPolicy.allowedSkills.join(',')
    : '';
  bgCountInput.value = String(status.backgroundBotCount || 0);
}

function appendSuperChat(line) {
  if (!superChatLog) {
    return;
  }
  const prev = superChatLog.textContent || '';
  const next = `${new Date().toLocaleTimeString()} ${line}`;
  superChatLog.textContent = `${next}\n${prev}`.slice(0, 12000);
}

async function load() {
  const [status, challengeData] = await Promise.all([
    getJson(`${runtimeBase}/status`),
    getJson(`${serverBase}/challenges/recent?limit=60`)
  ]);

  latestStatus = status;
  statusSummary.textContent = summarizeStatus(status);
  populateControlValues(status);
  renderProfiles(status);
  renderBots(status);
  renderChallengeLog(challengeData);
}

saveSuperBtn.addEventListener('click', async () => {
  await postJson(`${runtimeBase}/super-agent/config`, {
    id: superIdInput.value.trim(),
    mode: superModeInput.value,
    challengeEnabled: superChallengeEnabledInput.checked,
    defaultChallengeCooldownMs: Number(superCooldownInput.value),
    workerTargetPreference: superTargetInput.value
  });
  await load();
});

saveWalletBtn.addEventListener('click', async () => {
  await postJson(`${runtimeBase}/capabilities/wallet`, {
    enabled: walletEnabledInput.checked,
    grandAgentId: superIdInput.value.trim(),
    skills: walletSkillsInput.value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  });
  await load();
});

saveOpenrouterBtn.addEventListener('click', async () => {
  await postJson(`${runtimeBase}/secrets/openrouter`, {
    apiKey: openrouterKeyInput.value.trim()
  });
  openrouterKeyInput.value = '';
  await load();
});

applyDelegationBtn.addEventListener('click', async () => {
  await postJson(`${runtimeBase}/super-agent/delegate/apply`, {});
  await load();
});

syncEthskillsBtn?.addEventListener('click', async () => {
  appendSuperChat('system: syncing ETHSkills...');
  await postJson(`${runtimeBase}/super-agent/ethskills/sync`, {});
  await load();
  appendSuperChat('system: ETHSkills sync complete.');
});

createProfileBtn.addEventListener('click', async () => {
  await postJson(`${runtimeBase}/profiles/create`, {
    username: newUsernameInput.value.trim(),
    displayName: newDisplayNameInput.value.trim(),
    personality: newPersonalityInput.value,
    targetPreference: newTargetInput.value
  });

  newUsernameInput.value = '';
  newDisplayNameInput.value = '';
  await load();
});

applyBgCountBtn.addEventListener('click', async () => {
  await postJson(`${runtimeBase}/agents/reconcile`, {
    count: Number(bgCountInput.value)
  });
  await load();
});

refreshAllBtn.addEventListener('click', () => {
  load().catch((err) => {
    statusSummary.textContent = `Refresh failed: ${String(err)}`;
  });
});

superChatSendBtn?.addEventListener('click', async () => {
  const message = (superChatInput?.value || '').trim();
  if (!message) {
    appendSuperChat('super-agent: message required');
    return;
  }
  try {
    appendSuperChat(`you: ${message}`);
    const result = await postJson(`${runtimeBase}/super-agent/chat`, {
      message,
      includeStatus: true
    });
    appendSuperChat(`super-agent: ${String(result.reply || '').replace(/\n/g, ' | ')}`);
    if (result.status) {
      latestStatus = result.status;
      statusSummary.textContent = summarizeStatus(result.status);
      populateControlValues(result.status);
      renderProfiles(result.status);
      renderBots(result.status);
    }
    superChatInput.value = '';
  } catch (error) {
    appendSuperChat(`super-agent error: ${String(error.message || error)}`);
  }
});

superChatStatusBtn?.addEventListener('click', async () => {
  try {
    const result = await postJson(`${runtimeBase}/super-agent/chat`, {
      message: 'status',
      includeStatus: true
    });
    appendSuperChat(`super-agent: ${String(result.reply || '').replace(/\n/g, ' | ')}`);
    if (result.status) {
      latestStatus = result.status;
      statusSummary.textContent = summarizeStatus(result.status);
      populateControlValues(result.status);
      renderProfiles(result.status);
      renderBots(result.status);
    }
  } catch (error) {
    appendSuperChat(`super-agent error: ${String(error.message || error)}`);
  }
});

profilesBody.addEventListener('click', async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement)) {
    return;
  }

  const action = target.dataset.action;
  const walletId = target.dataset.walletId;
  const profileId = target.dataset.profileId;

  if (action === 'fund' && walletId) {
    await postJson(`${runtimeBase}/wallets/${walletId}/fund`, { amount: Number(target.dataset.amount || 10) });
    await load();
    return;
  }

  if (action === 'withdraw' && walletId) {
    await postJson(`${runtimeBase}/wallets/${walletId}/withdraw`, { amount: Number(target.dataset.amount || 5) });
    await load();
    return;
  }

  if (action === 'export' && walletId && profileId) {
    const result = await postJson(`${runtimeBase}/wallets/${walletId}/export-key`, { profileId });
    window.alert(`Wallet ${walletId}\nAddress: ${result.address}\nPrivate key: ${result.privateKey}`);
    return;
  }
});

botsBody.addEventListener('click', async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement)) {
    return;
  }

  if (target.dataset.action !== 'save-bot') {
    return;
  }

  const botId = target.dataset.botId;
  if (!botId) {
    return;
  }

  const fields = [...document.querySelectorAll(`[data-bot-id="${botId}"]`)];
  const patch = {};

  for (const field of fields) {
    const key = field.getAttribute('data-field');
    if (!key) {
      continue;
    }

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

  await postJson(`${runtimeBase}/agents/${botId}/config`, patch);
  await load();
});

load().catch((err) => {
  statusSummary.textContent = `Load failed: ${String(err)}`;
});
setInterval(() => {
  load().catch(() => undefined);
}, 6000);
