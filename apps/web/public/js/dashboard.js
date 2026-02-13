const statusLine = document.getElementById('dashboard-status');
const playLink = document.getElementById('dashboard-enter-play');

const meEmail = document.getElementById('me-email');
const meRole = document.getElementById('me-role');
const meProfile = document.getElementById('me-profile');
const meWallet = document.getElementById('me-wallet');
const walletBalance = document.getElementById('wallet-balance');
const inviteLink = document.getElementById('invite-link');
const copyInvite = document.getElementById('copy-invite');

const profileDisplayName = document.getElementById('profile-display-name');
const profileUsername = document.getElementById('profile-username');
const profileSave = document.getElementById('profile-save');

const walletFundAmount = document.getElementById('wallet-fund-amount');
const walletWithdrawAmount = document.getElementById('wallet-withdraw-amount');
const walletFund = document.getElementById('wallet-fund');
const walletWithdraw = document.getElementById('wallet-withdraw');

const botPersonality = document.getElementById('bot-personality');
const botTarget = document.getElementById('bot-target');
const botCooldown = document.getElementById('bot-cooldown');
const botSave = document.getElementById('bot-save');
const botList = document.getElementById('bot-list');
const newBotName = document.getElementById('new-bot-name');
const newBotPersonality = document.getElementById('new-bot-personality');
const newBotTarget = document.getElementById('new-bot-target');
const createBot = document.getElementById('create-bot');
const superAgentMessage = document.getElementById('super-agent-message');
const superAgentSend = document.getElementById('super-agent-send');
const superAgentQuickStatus = document.getElementById('super-agent-quick-status');
const superAgentResponse = document.getElementById('super-agent-response');

let playerCtx = null;
let bootstrapCtx = null;

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function setStatus(text) {
  if (statusLine) {
    statusLine.textContent = text;
  }
}

async function api(path, init = {}) {
  const response = await fetch(path, {
    credentials: 'include',
    ...init
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.reason || `status_${response.status}`);
  }
  return payload;
}

function parseAmount(el, fallback = 1) {
  const value = Number(el?.value || fallback);
  return Number.isFinite(value) ? Math.max(0, value) : fallback;
}

function bindPlayLink() {
  if (!playLink || !playerCtx?.profile) {
    return;
  }
  const params = new URLSearchParams({
    world: 'mega',
    name: playerCtx.profile.displayName,
    walletId: playerCtx.profile.wallet?.id || playerCtx.profile.walletId
  });
  playLink.href = `/play?${params.toString()}`;
}

function renderContext() {
  const user = playerCtx?.user;
  const profile = playerCtx?.profile;
  const bots = playerCtx?.bots || [];

  if (meEmail) meEmail.textContent = user?.email || '-';
  if (meRole) meRole.textContent = user?.role || '-';
  if (meProfile) meProfile.textContent = profile?.displayName ? `${profile.displayName} (@${profile.username})` : '-';
  if (meWallet) meWallet.textContent = profile?.wallet?.id || profile?.walletId || '-';
  if (walletBalance) walletBalance.textContent = Number(profile?.wallet?.balance || 0).toFixed(2);

  if (profileDisplayName) profileDisplayName.value = profile?.displayName || '';
  if (profileUsername) profileUsername.value = profile?.username || '';

  if (bots.length === 0) {
    botList.textContent = 'No owner bot found yet.';
  } else {
    botList.innerHTML = bots
      .map((bot) => {
        const section = bot.meta?.patrolSection;
        return `<div class="dashboard-bot" data-bot-id="${escapeHtml(bot.id)}">
          <strong>${escapeHtml(bot.meta?.displayName || bot.id)}</strong>
          <span>id ${escapeHtml(bot.id)} · patrol S${section ?? '-'} · connected ${bot.connected ? 'yes' : 'no'}</span>
          <div class="dashboard-bot-edit">
            <select data-field="personality">
              <option value="aggressive" ${bot.behavior.personality === 'aggressive' ? 'selected' : ''}>Aggressive</option>
              <option value="social" ${bot.behavior.personality === 'social' ? 'selected' : ''}>Social</option>
              <option value="conservative" ${bot.behavior.personality === 'conservative' ? 'selected' : ''}>Conservative</option>
            </select>
            <select data-field="targetPreference">
              <option value="human_first" ${bot.behavior.targetPreference === 'human_first' ? 'selected' : ''}>Human first</option>
              <option value="human_only" ${bot.behavior.targetPreference === 'human_only' ? 'selected' : ''}>Human only</option>
              <option value="any" ${bot.behavior.targetPreference === 'any' ? 'selected' : ''}>Any</option>
            </select>
            <input data-field="challengeCooldownMs" type="number" min="1200" step="100" value="${Number(bot.behavior.challengeCooldownMs || 2600)}">
            <button class="btn btn--ghost dashboard-bot-save" data-action="save-bot">Save</button>
          </div>
        </div>`;
      })
      .join('');

    const first = bots[0];
    if (botPersonality) botPersonality.value = first.behavior.personality;
    if (botTarget) botTarget.value = first.behavior.targetPreference;
    if (botCooldown) botCooldown.value = String(first.behavior.challengeCooldownMs || 2600);
  }

  bindPlayLink();
  if (inviteLink) {
    inviteLink.value = bootstrapCtx?.invite?.playUrl ? `${window.location.origin}${bootstrapCtx.invite.playUrl}` : '';
  }
}

async function refreshContext() {
  const [ctx, bootstrap] = await Promise.all([
    api('/api/player/me'),
    api('/api/player/bootstrap?world=mega')
  ]);
  playerCtx = ctx;
  bootstrapCtx = bootstrap;
  renderContext();
}

profileSave?.addEventListener('click', async () => {
  const displayName = profileDisplayName?.value.trim() || '';
  const username = profileUsername?.value.trim() || '';
  if (!displayName || !username) {
    setStatus('Display name and username are required.');
    return;
  }
  try {
    setStatus('Saving profile...');
    await api('/api/player/profile', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ displayName, username })
    });
    await refreshContext();
    setStatus('Profile updated.');
  } catch (error) {
    setStatus(`Profile update failed: ${String(error.message || error)}`);
  }
});

walletFund?.addEventListener('click', async () => {
  try {
    const amount = parseAmount(walletFundAmount, 10);
    if (amount <= 0) {
      setStatus('Fund amount must be greater than 0.');
      return;
    }
    setStatus('Funding wallet...');
    await api('/api/player/wallet/fund', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ amount })
    });
    await refreshContext();
    setStatus(`Wallet funded +${amount}.`);
  } catch (error) {
    setStatus(`Wallet fund failed: ${String(error.message || error)}`);
  }
});

walletWithdraw?.addEventListener('click', async () => {
  try {
    const amount = parseAmount(walletWithdrawAmount, 5);
    if (amount <= 0) {
      setStatus('Withdraw amount must be greater than 0.');
      return;
    }
    setStatus('Withdrawing wallet...');
    await api('/api/player/wallet/withdraw', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ amount })
    });
    await refreshContext();
    setStatus(`Wallet withdrew -${amount}.`);
  } catch (error) {
    setStatus(`Wallet withdraw failed: ${String(error.message || error)}`);
  }
});

botSave?.addEventListener('click', async () => {
  try {
    const cooldown = Math.max(1200, Number(botCooldown?.value || 2600));
    setStatus('Saving bot behavior...');
    await api('/api/player/bot/config', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        personality: botPersonality?.value || 'social',
        targetPreference: botTarget?.value || 'human_first',
        challengeCooldownMs: cooldown
      })
    });
    await refreshContext();
    setStatus('Bot behavior updated.');
  } catch (error) {
    setStatus(`Bot update failed: ${String(error.message || error)}`);
  }
});

createBot?.addEventListener('click', async () => {
  try {
    setStatus('Creating bot...');
    await api('/api/player/bots/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        displayName: String(newBotName?.value || '').trim() || undefined,
        personality: newBotPersonality?.value || 'social',
        targetPreference: newBotTarget?.value || 'human_first',
        managedBySuperAgent: true
      })
    });
    if (newBotName) {
      newBotName.value = '';
    }
    await refreshContext();
    setStatus('Bot created.');
  } catch (error) {
    setStatus(`Bot create failed: ${String(error.message || error)}`);
  }
});

botList?.addEventListener('click', async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }
  if (target.getAttribute('data-action') !== 'save-bot') {
    return;
  }
  const container = target.closest('[data-bot-id]');
  if (!(container instanceof HTMLElement)) {
    return;
  }
  const botId = container.getAttribute('data-bot-id');
  if (!botId) {
    return;
  }

  const personalityEl = container.querySelector('[data-field="personality"]');
  const targetEl = container.querySelector('[data-field="targetPreference"]');
  const cooldownEl = container.querySelector('[data-field="challengeCooldownMs"]');
  const personality = personalityEl instanceof HTMLSelectElement ? personalityEl.value : 'social';
  const targetPreference = targetEl instanceof HTMLSelectElement ? targetEl.value : 'human_first';
  const challengeCooldownMs = cooldownEl instanceof HTMLInputElement ? Math.max(1200, Number(cooldownEl.value || 2600)) : 2600;

  try {
    setStatus(`Saving ${botId}...`);
    await api(`/api/player/bots/${encodeURIComponent(botId)}/config`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ personality, targetPreference, challengeCooldownMs })
    });
    await refreshContext();
    setStatus(`Saved ${botId}.`);
  } catch (error) {
    setStatus(`Bot save failed: ${String(error.message || error)}`);
  }
});

async function sendSuperAgent(message) {
  const result = await api('/api/super-agent/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message, includeStatus: false })
  });
  if (superAgentResponse) {
    superAgentResponse.textContent = String(result?.reply || 'No reply.');
  }
}

superAgentSend?.addEventListener('click', async () => {
  const message = String(superAgentMessage?.value || '').trim();
  if (!message) {
    setStatus('Enter a message for Super Agent.');
    return;
  }
  try {
    setStatus('Super Agent thinking...');
    await sendSuperAgent(message);
    setStatus('Super Agent replied.');
  } catch (error) {
    setStatus(`Super Agent error: ${String(error.message || error)}`);
  }
});

superAgentQuickStatus?.addEventListener('click', async () => {
  try {
    setStatus('Fetching Super Agent status...');
    await sendSuperAgent('status');
    setStatus('Status loaded.');
  } catch (error) {
    setStatus(`Super Agent error: ${String(error.message || error)}`);
  }
});

copyInvite?.addEventListener('click', async () => {
  const value = String(inviteLink?.value || '').trim();
  if (!value) {
    setStatus('No invite link available.');
    return;
  }
  try {
    await navigator.clipboard.writeText(value);
    setStatus('Invite link copied.');
  } catch {
    setStatus('Could not copy automatically. Copy from the field manually.');
  }
});

(async function init() {
  try {
    await refreshContext();
    setStatus('Player context loaded.');
  } catch (error) {
    setStatus(`Unable to load player context: ${String(error.message || error)}`);
  }
})();
