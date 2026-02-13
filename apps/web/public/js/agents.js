const runtimeBase = 'http://localhost:4100';
const serverBase = 'http://localhost:4000';

const botCountInput = document.getElementById('bot-count');
const applyCountButton = document.getElementById('apply-count');
const refreshButton = document.getElementById('refresh');
const openRouterKeyInput = document.getElementById('openrouter-key');
const saveOpenRouterButton = document.getElementById('save-openrouter');
const walletEnabledInput = document.getElementById('wallet-enabled');
const grandAgentInput = document.getElementById('grand-agent');
const walletSkillsInput = document.getElementById('wallet-skills');
const saveWalletButton = document.getElementById('save-wallet');

const superModeInput = document.getElementById('super-mode');
const superChallengeEnabledInput = document.getElementById('super-challenge-enabled');
const superCooldownInput = document.getElementById('super-cooldown');
const superTargetInput = document.getElementById('super-target');
const applySuperButton = document.getElementById('apply-super');
const applyDelegationButton = document.getElementById('apply-delegation');

const summaryEl = document.getElementById('summary');
const botsBody = document.getElementById('bots-body');
const challengeLogEl = document.getElementById('challenge-log');

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    throw new Error(`Request failed (${response.status})`);
  }
  return response.json();
}

function renderBots(status) {
  botsBody.innerHTML = '';

  for (const bot of status.bots || []) {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${bot.id}</td>
      <td>${bot.connected ? 'yes' : 'no'}</td>
      <td>
        <select data-id="${bot.id}" data-field="personality">
          ${['aggressive', 'conservative', 'social']
            .map((value) => `<option value="${value}" ${bot.behavior.personality === value ? 'selected' : ''}>${value}</option>`)
            .join('')}
        </select>
      </td>
      <td><input type="number" min="1000" max="60000" data-id="${bot.id}" data-field="challengeCooldownMs" value="${bot.behavior.challengeCooldownMs}" style="width:90px;" /></td>
      <td><input type="checkbox" data-id="${bot.id}" data-field="challengeEnabled" ${bot.behavior.challengeEnabled ? 'checked' : ''} /></td>
      <td>
        <select data-id="${bot.id}" data-field="targetPreference">
          ${['human_only', 'human_first', 'any']
            .map((value) => `<option value="${value}" ${bot.behavior.targetPreference === value ? 'selected' : ''}>${value}</option>`)
            .join('')}
        </select>
      </td>
      <td>${bot.nearbyCount}</td>
      <td>${bot.stats.challengesWon}/${bot.stats.challengesLost}</td>
      <td><button data-id="${bot.id}" data-action="save">Save</button></td>
    `;
    botsBody.appendChild(row);
  }
}

function collectBotPatch(botId) {
  const fields = [...document.querySelectorAll(`[data-id="${botId}"]`)];
  const patch = {};

  for (const field of fields) {
    const key = field.getAttribute('data-field');
    if (!key) {
      continue;
    }

    if (field.type === 'checkbox') {
      patch[key] = Boolean(field.checked);
    } else if (field.type === 'number') {
      patch[key] = Number(field.value);
    } else {
      patch[key] = field.value;
    }
  }

  return patch;
}

async function load() {
  const [statusResponse, challengeResponse] = await Promise.all([
    fetch(`${runtimeBase}/status`).then((res) => res.json()),
    fetch(`${serverBase}/challenges/recent?limit=30`).then((res) => res.json())
  ]);

  const superAgent = statusResponse.superAgent || {};

  summaryEl.textContent = JSON.stringify(
    {
      configuredBotCount: statusResponse.configuredBotCount,
      connectedBotCount: statusResponse.connectedBotCount,
      openRouterConfigured: statusResponse.openRouterConfigured,
      superAgent,
      walletPolicy: superAgent.walletPolicy,
      llmPolicy: superAgent.llmPolicy
    },
    null,
    2
  );

  botCountInput.value = String(statusResponse.configuredBotCount ?? 0);
  walletEnabledInput.checked = Boolean(superAgent.walletPolicy?.enabled);
  grandAgentInput.value = superAgent.id ?? 'agent_1';
  walletSkillsInput.value = Array.isArray(superAgent.walletPolicy?.allowedSkills)
    ? superAgent.walletPolicy.allowedSkills.join(',')
    : '';

  superModeInput.value = superAgent.mode ?? 'balanced';
  superChallengeEnabledInput.checked = Boolean(superAgent.challengeEnabled);
  superCooldownInput.value = String(superAgent.defaultChallengeCooldownMs ?? 9000);
  superTargetInput.value = superAgent.workerTargetPreference ?? 'human_only';

  renderBots(statusResponse);

  const lines = (challengeResponse.recent || [])
    .slice()
    .reverse()
    .map((entry) => {
      const ts = new Date(entry.at).toLocaleTimeString();
      const winner = entry.winnerId ? ` winner=${entry.winnerId}` : '';
      const pair = entry.challengerId && entry.opponentId ? ` ${entry.challengerId} vs ${entry.opponentId}` : '';
      const reason = entry.reason ? ` reason=${entry.reason}` : '';
      return `${ts} ${entry.event}${pair}${winner}${reason}`;
    });

  challengeLogEl.textContent = lines.join('\n') || 'No challenge events yet.';
}

applyCountButton.addEventListener('click', async () => {
  await postJson(`${runtimeBase}/agents/reconcile`, { count: Number(botCountInput.value) });
  await load();
});

saveOpenRouterButton.addEventListener('click', async () => {
  await postJson(`${runtimeBase}/secrets/openrouter`, { apiKey: openRouterKeyInput.value.trim() });
  openRouterKeyInput.value = '';
  await load();
});

saveWalletButton.addEventListener('click', async () => {
  await postJson(`${runtimeBase}/capabilities/wallet`, {
    enabled: walletEnabledInput.checked,
    grandAgentId: grandAgentInput.value.trim(),
    skills: walletSkillsInput.value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  });
  await load();
});

applySuperButton.addEventListener('click', async () => {
  await postJson(`${runtimeBase}/super-agent/config`, {
    id: grandAgentInput.value.trim(),
    mode: superModeInput.value,
    challengeEnabled: superChallengeEnabledInput.checked,
    defaultChallengeCooldownMs: Number(superCooldownInput.value),
    workerTargetPreference: superTargetInput.value
  });
  await load();
});

applyDelegationButton.addEventListener('click', async () => {
  await postJson(`${runtimeBase}/super-agent/delegate/apply`, {});
  await load();
});

refreshButton.addEventListener('click', () => {
  load();
});

botsBody.addEventListener('click', async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement)) {
    return;
  }

  if (target.dataset.action !== 'save') {
    return;
  }

  const botId = target.dataset.id;
  if (!botId) {
    return;
  }

  const patch = collectBotPatch(botId);
  await postJson(`${runtimeBase}/agents/${botId}/config`, patch);
  await load();
});

load().catch((err) => {
  summaryEl.textContent = `Failed to load control panel: ${String(err)}`;
});
setInterval(() => {
  load().catch(() => undefined);
}, 5000);
