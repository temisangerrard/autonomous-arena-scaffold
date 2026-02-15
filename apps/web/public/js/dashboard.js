const statusLine = document.getElementById('dashboard-status');
const playLink = document.getElementById('dashboard-enter-play');

const meEmail = document.getElementById('me-email');
const meRole = document.getElementById('me-role');
const meProfile = document.getElementById('me-profile');
const meWallet = document.getElementById('me-wallet');
const meWalletAddress = document.getElementById('me-wallet-address');
const walletBalance = document.getElementById('wallet-balance');
const walletBalanceNote = document.getElementById('wallet-balance-note');
const inviteLink = document.getElementById('invite-link');
const copyInvite = document.getElementById('copy-invite');
const copyWallet = document.getElementById('copy-wallet');
const copyWalletAddress = document.getElementById('copy-wallet-address');

const sidebarName = document.getElementById('sidebar-name');
const sidebarHandle = document.getElementById('sidebar-handle');
const sidebarWallet = document.getElementById('sidebar-wallet');

const profileDisplayName = document.getElementById('profile-display-name');
const profileUsername = document.getElementById('profile-username');
const profileSave = document.getElementById('profile-save');

const walletFundAmount = document.getElementById('wallet-fund-amount');
const walletWithdrawAmount = document.getElementById('wallet-withdraw-amount');
const walletFund = document.getElementById('wallet-fund');
const walletWithdraw = document.getElementById('wallet-withdraw');
const walletTransferTarget = document.getElementById('wallet-transfer-target');
const walletTransferWalletId = document.getElementById('wallet-transfer-wallet-id');
const walletTransferAmount = document.getElementById('wallet-transfer-amount');
const walletTransfer = document.getElementById('wallet-transfer');
const walletPlayerList = document.getElementById('wallet-player-list');

const botPersonality = document.getElementById('bot-personality');
const botTarget = document.getElementById('bot-target');
const botCooldown = document.getElementById('bot-cooldown');
const botMode = document.getElementById('bot-mode');
const botBaseWager = document.getElementById('bot-base-wager');
const botMaxWager = document.getElementById('bot-max-wager');
const botSave = document.getElementById('bot-save');
const botList = document.getElementById('bot-list');
// Bot creation is intentionally disabled: one player == one character bot.
const createBot = null;

const superAgentMessage = document.getElementById('super-agent-message');
const superAgentSend = document.getElementById('super-agent-send');
const superAgentQuickStatus = document.getElementById('super-agent-quick-status');
const superAgentResponse = document.getElementById('super-agent-response');

const superAgentMessageAlt = document.getElementById('super-agent-message-alt');
const superAgentSendAlt = document.getElementById('super-agent-send-alt');
const superAgentQuickStatusAlt = document.getElementById('super-agent-quick-status-alt');
const superAgentResponseAlt = document.getElementById('super-agent-response-alt');

const onboardingList = document.getElementById('onboarding-list');
const escrowHistory = document.getElementById('escrow-history');
const exportPrivateKey = document.getElementById('export-private-key');

const botModal = document.getElementById('bot-modal');
const botModalClose = document.getElementById('bot-modal-close');
const botModalTitle = document.getElementById('bot-modal-title');
const botModalSub = document.getElementById('bot-modal-sub');

const sidebarButtons = [...document.querySelectorAll('.sidebar-nav [data-view]')];
const views = [...document.querySelectorAll('.dash-view')];
const quickCommandButtons = [...document.querySelectorAll('[data-quick-cmd]')];

let playerCtx = null;
let bootstrapCtx = null;
let playerDirectory = [];
let selectedBotId = '';
let walletSummaryCtx = null;

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

function setView(nextView) {
  for (const button of sidebarButtons) {
    button.classList.toggle('active', button.getAttribute('data-view') === nextView);
  }
  for (const view of views) {
    view.classList.toggle('active', view.id === `view-${nextView}`);
  }
}

async function api(path, init = {}) {
  const response = await fetch(path, {
    credentials: 'include',
    ...init
  });
  const payload = await response.json().catch(() => ({}));
  if (response.status === 401 || response.status === 403) {
    try {
      localStorage.removeItem('arena_ws_auth');
    } catch {
      // ignore
    }
    window.location.href = '/welcome';
    throw new Error('unauthorized');
  }
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
  if (!playLink) {
    return;
  }
  if (bootstrapCtx?.links?.play) {
    playLink.href = bootstrapCtx.links.play;
    return;
  }
  playLink.href = '/play?world=mega';
}

function getBotById(botId) {
  return (playerCtx?.bots || []).find((entry) => entry.id === botId) || null;
}

function statusClassForBot(bot) {
  if (!bot.connected) {
    return 'disconnected';
  }
  if (bot.behavior?.mode === 'passive' || bot.behavior?.challengeEnabled === false) {
    return 'idle';
  }
  return 'active';
}

function statusTextForBot(bot) {
  const cls = statusClassForBot(bot);
  if (cls === 'active') return 'Active';
  if (cls === 'idle') return 'Idle';
  return 'Disconnected';
}

function renderBotCards() {
  const bots = playerCtx?.bots || [];
  if (!botList) {
    return;
  }

  if (bots.length === 0) {
    botList.innerHTML = '<article class="panel"><p class="muted" style="margin:0;">No owner bot found yet.</p></article>';
    return;
  }

  botList.innerHTML = bots
    .map((bot) => {
      const section = bot.meta?.patrolSection;
      const personality = String(bot.behavior?.personality || 'social');
      const target = String(bot.behavior?.targetPreference || 'human_first').replace(/_/g, ' ');
      const cooldown = Number(bot.behavior?.challengeCooldownMs || 2600);
      const badgeClass = statusClassForBot(bot);
      const badgeText = statusTextForBot(bot);
      const botWalletId = String(bot.walletId || playerCtx?.profile?.wallet?.id || playerCtx?.profile?.walletId || '-');
      const botWalletAddress = String(bot.walletAddress || playerCtx?.profile?.wallet?.address || '-');

      return `<article class="bot-card" data-bot-id="${escapeHtml(bot.id)}" data-action="edit-bot">
        <div class="bot-card__head">
          <i class="bot-avatar personality-${escapeHtml(personality)}"></i>
          <div>
            <h3 class="bot-name">${escapeHtml(bot.meta?.displayName || bot.id)}</h3>
            <p class="bot-sub">${escapeHtml(bot.id)} · S${section ?? '-'} · wallet ${escapeHtml(botWalletId)}</p>
          </div>
          <span class="badge ${badgeClass}">${badgeText}</span>
        </div>
        <div class="pill-row">
          <span class="pill">${escapeHtml(personality)}</span>
          <span class="pill">${escapeHtml(target)}</span>
          <span class="pill">${cooldown}ms</span>
        </div>
        <div class="wager-box">Wager Range: ${Number(bot.behavior?.baseWager || 1)} to ${Number(bot.behavior?.maxWager || 3)}<br><span class="mono">${escapeHtml(botWalletAddress)}</span></div>
      </article>`;
    })
    .join('');
}

function renderContext() {
  const user = playerCtx?.user;
  const profile = playerCtx?.profile;
  const bots = playerCtx?.bots || [];
  const runtimeBalanceValue = Number(profile?.wallet?.balance || 0).toFixed(2);
  const walletId = profile?.wallet?.id || profile?.walletId || walletSummaryCtx?.wallet?.id || '-';
  const walletAddress = profile?.wallet?.address || walletSummaryCtx?.onchain?.address || walletSummaryCtx?.wallet?.address || '-';
  const tokenBalance = walletSummaryCtx?.onchain?.tokenBalance ?? runtimeBalanceValue;
  const tokenSymbol = walletSummaryCtx?.onchain?.tokenSymbol || 'TOKEN';
  const nativeBalance = walletSummaryCtx?.onchain?.nativeBalanceEth || null;
  const onchainMode = walletSummaryCtx?.onchain?.mode === 'onchain';

  if (meEmail) meEmail.textContent = user?.email || '-';
  if (meRole) meRole.textContent = user?.role || '-';
  if (meProfile) meProfile.textContent = profile?.displayName ? `${profile.displayName} (@${profile.username})` : '-';
  if (meWallet) meWallet.textContent = walletId;
  if (meWalletAddress) meWalletAddress.textContent = walletAddress;
  if (walletBalance) walletBalance.textContent = Number(tokenBalance || 0).toFixed(4);
  if (walletBalanceNote) {
    walletBalanceNote.textContent = onchainMode
      ? `${tokenSymbol} onchain${nativeBalance ? ` · gas ${Number(nativeBalance).toFixed(5)} ETH` : ''}`
      : `Runtime wallet balance (scaffold mode) · ${tokenSymbol}`;
  }

  if (sidebarName) sidebarName.textContent = profile?.displayName || user?.name || 'Player';
  if (sidebarHandle) sidebarHandle.textContent = `@${profile?.username || 'player'}`;
  if (sidebarWallet) sidebarWallet.textContent = `◆ ${Number(tokenBalance || 0).toFixed(2)}`;

  if (profileDisplayName) profileDisplayName.value = profile?.displayName || '';
  if (profileUsername) profileUsername.value = profile?.username || '';

  renderBotCards();

  const first = bots[0];
  if (first && !selectedBotId) {
    selectedBotId = first.id;
  }

  if (inviteLink) {
    inviteLink.value = bootstrapCtx?.invite?.playUrl ? `${window.location.origin}${bootstrapCtx.invite.playUrl}` : '';
  }

  if (walletTransferTarget) {
    walletTransferTarget.innerHTML = ['<option value="">Select a player</option>']
      .concat(
        playerDirectory.map((entry) => {
          const shortAddress = entry.walletAddress ? `${String(entry.walletAddress).slice(0, 8)}...${String(entry.walletAddress).slice(-6)}` : '';
          const label = `${escapeHtml(entry.displayName || entry.username)} (@${escapeHtml(entry.username)})${shortAddress ? ` · ${escapeHtml(shortAddress)}` : ''}`;
          return `<option value="${escapeHtml(entry.walletId)}">${label}</option>`;
        })
      )
      .join('');
  }

  if (walletPlayerList) {
    if (!playerDirectory.length) {
      walletPlayerList.innerHTML = '<div>No other players found yet.</div>';
    } else {
      walletPlayerList.innerHTML = playerDirectory
        .map((entry) => {
          const address = entry.walletAddress || '-';
          return `<div><strong>${escapeHtml(entry.displayName || entry.username)}</strong><br><span class="mono">${escapeHtml(entry.walletId)}</span><br><span class="mono">${escapeHtml(address)}</span></div>`;
        })
        .join('');
    }
  }

  if (onboardingList) {
    const hasUser = Boolean(user?.email);
    const hasProfile = Boolean(profile?.id);
    const hasFunds = Number(profile?.wallet?.balance || 0) > 0;
    const hasBot = bots.length > 0;
    const hasActiveBot = bots.some((entry) => entry.behavior?.mode !== 'passive' && entry.behavior?.challengeEnabled !== false);
    const hasPlayLink = Boolean(inviteLink?.value);
    const rows = [
      [hasUser, 'Signed in'],
      [hasProfile, 'Player profile provisioned'],
      [hasFunds, 'Wallet funded'],
      [hasBot, 'Character bot provisioned'],
      [hasActiveBot, 'Bot in active mode'],
      [hasPlayLink, 'Play link ready to share']
    ];
    onboardingList.innerHTML = rows
      .map(([ok, text]) => `<li>${ok ? '✓' : '○'} ${escapeHtml(text)}</li>`)
      .join('');
  }

  bindPlayLink();
}

function renderEscrowHistory(entries) {
  if (!escrowHistory) {
    return;
  }
  if (!Array.isArray(entries) || entries.length === 0) {
    escrowHistory.textContent = 'No escrow activity yet.';
    return;
  }
  escrowHistory.textContent = entries
    .map((entry) => {
      const at = entry?.at ? new Date(Number(entry.at)).toLocaleTimeString() : '--:--:--';
      const outcome = String(entry?.outcome || 'unknown');
      const challengeId = String(entry?.challengeId || 'n/a');
      const amount = Number(entry?.amount || 0).toFixed(2);
      const payout = Number(entry?.payout || 0).toFixed(2);
      const txHash = String(entry?.txHash || '');
      const shortTx = txHash ? `${txHash.slice(0, 10)}...${txHash.slice(-8)}` : 'n/a';
      return `${at} ${outcome} ${challengeId} amount=${amount} payout=${payout} tx=${shortTx}`;
    })
    .join('\n');
}

async function refreshContext() {
  const [ctx, bootstrap, directory, escrow, walletSummary] = await Promise.all([
    api('/api/player/me'),
    api('/api/player/bootstrap?world=mega'),
    api('/api/player/directory').catch(() => ({ players: [] })),
    api('/api/player/wallet/escrow-history?limit=20').catch(() => ({ recent: [] })),
    api('/api/player/wallet/summary').catch(() => null)
  ]);
  playerCtx = ctx;
  bootstrapCtx = bootstrap;
  playerDirectory = Array.isArray(directory?.players) ? directory.players : [];
  walletSummaryCtx = walletSummary;
  renderEscrowHistory(Array.isArray(escrow?.recent) ? escrow.recent : []);
  renderContext();
}

function openBotModal(botId) {
  const bot = getBotById(botId);
  if (!bot || !botModal) {
    return;
  }
  selectedBotId = botId;
  if (botModalTitle) {
    botModalTitle.textContent = `Edit ${bot.meta?.displayName || bot.id}`;
  }
  if (botModalSub) {
    botModalSub.textContent = `${bot.id} · patrol S${bot.meta?.patrolSection ?? '-'} · ${bot.connected ? 'connected' : 'disconnected'}`;
  }
  if (botPersonality) botPersonality.value = bot.behavior.personality;
  if (botTarget) botTarget.value = bot.behavior.targetPreference;
  if (botCooldown) botCooldown.value = String(bot.behavior.challengeCooldownMs || 2600);
  if (botMode) botMode.value = bot.behavior.mode || 'active';
  if (botBaseWager) botBaseWager.value = String(bot.behavior.baseWager || 1);
  if (botMaxWager) botMaxWager.value = String(bot.behavior.maxWager || 3);
  botModal.classList.add('open');
  botModal.setAttribute('aria-hidden', 'false');
}

function closeBotModal() {
  if (!botModal) {
    return;
  }
  botModal.classList.remove('open');
  botModal.setAttribute('aria-hidden', 'true');
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
    const amount = parseAmount(walletWithdrawAmount, parseAmount(walletFundAmount, 5));
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

walletTransfer?.addEventListener('click', async () => {
  try {
    const selectedWalletId = String(walletTransferTarget?.value || '').trim();
    const manualWalletId = String(walletTransferWalletId?.value || '').trim();
    const toWalletId = manualWalletId || selectedWalletId;
    const amount = parseAmount(walletTransferAmount, 2);
    if (!toWalletId) {
      setStatus('Select a target player or enter target wallet id.');
      return;
    }
    if (amount <= 0) {
      setStatus('Transfer amount must be greater than 0.');
      return;
    }
    setStatus('Transferring...');
    await api('/api/player/wallet/transfer', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ toWalletId, amount })
    });
    if (walletTransferWalletId) {
      walletTransferWalletId.value = '';
    }
    await refreshContext();
    setStatus(`Transferred ${amount} to ${toWalletId}.`);
  } catch (error) {
    setStatus(`Wallet transfer failed: ${String(error.message || error)}`);
  }
});

botSave?.addEventListener('click', async () => {
  try {
    const botId = selectedBotId || playerCtx?.bots?.[0]?.id;
    if (!botId) {
      setStatus('No bot selected.');
      return;
    }

    const cooldown = Math.max(1200, Number(botCooldown?.value || 2600));
    const baseWager = Math.max(1, Number(botBaseWager?.value || 1));
    const maxWager = Math.max(baseWager, Number(botMaxWager?.value || baseWager));

    setStatus(`Saving ${botId}...`);
    await api(`/api/player/bots/${encodeURIComponent(botId)}/config`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        personality: botPersonality?.value || 'social',
        targetPreference: botTarget?.value || 'human_first',
        challengeCooldownMs: cooldown,
        mode: botMode?.value || 'active',
        baseWager,
        maxWager
      })
    });
    await refreshContext();
    closeBotModal();
    setStatus(`Saved ${botId}.`);
  } catch (error) {
    setStatus(`Bot save failed: ${String(error.message || error)}`);
  }
});

// Bot creation intentionally disabled.

botList?.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }
  const card = target.closest('[data-action="edit-bot"]');
  if (!(card instanceof HTMLElement)) {
    return;
  }
  const botId = String(card.getAttribute('data-bot-id') || '').trim();
  if (!botId) {
    return;
  }
  openBotModal(botId);
});

botModalClose?.addEventListener('click', closeBotModal);
botModal?.addEventListener('click', (event) => {
  if (event.target === botModal) {
    closeBotModal();
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    closeBotModal();
  }
});

async function sendSuperAgent(message) {
  const result = await api('/api/player/chief/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message, includeStatus: false })
  });

  const reply = String(result?.reply || 'No reply.');
  if (superAgentResponse) {
    superAgentResponse.textContent = reply;
  }
  if (superAgentResponseAlt) {
    superAgentResponseAlt.textContent = reply;
  }
}

function getSuperMessage() {
  const primary = String(superAgentMessage?.value || '').trim();
  const alternate = String(superAgentMessageAlt?.value || '').trim();
  return primary || alternate;
}

function setSuperMessage(value) {
  if (superAgentMessage) {
    superAgentMessage.value = value;
  }
  if (superAgentMessageAlt) {
    superAgentMessageAlt.value = value;
  }
}

async function runSuperCommand(inputValue) {
  const message = String(inputValue || '').trim();
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
}

superAgentSend?.addEventListener('click', async () => {
  await runSuperCommand(getSuperMessage());
});

superAgentSendAlt?.addEventListener('click', async () => {
  await runSuperCommand(getSuperMessage());
});

superAgentQuickStatus?.addEventListener('click', async () => {
  setSuperMessage('status');
  await runSuperCommand('status');
});

superAgentQuickStatusAlt?.addEventListener('click', async () => {
  setSuperMessage('status');
  await runSuperCommand('status');
});

for (const button of quickCommandButtons) {
  button.addEventListener('click', async () => {
    const cmd = String(button.getAttribute('data-quick-cmd') || '').trim();
    if (!cmd) {
      return;
    }
    setSuperMessage(cmd);
    await runSuperCommand(cmd);
  });
}

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

copyWallet?.addEventListener('click', async () => {
  const value = String(meWallet?.textContent || '').trim();
  if (!value || value === '-') {
    setStatus('No wallet id available.');
    return;
  }
  try {
    await navigator.clipboard.writeText(value);
    setStatus('Wallet id copied.');
  } catch {
    setStatus('Could not copy wallet automatically.');
  }
});

copyWalletAddress?.addEventListener('click', async () => {
  const value = String(meWalletAddress?.textContent || '').trim();
  if (!value || value === '-') {
    setStatus('No wallet address available.');
    return;
  }
  try {
    await navigator.clipboard.writeText(value);
    setStatus('Wallet address copied.');
  } catch {
    setStatus('Could not copy wallet address automatically.');
  }
});

exportPrivateKey?.addEventListener('click', async () => {
  const approved = window.confirm('Export private key? Keep it offline and secure.');
  if (!approved) {
    return;
  }
  try {
    setStatus('Exporting private key...');
    const result = await api('/api/player/wallet/export-key', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}'
    });

    const key = String(result?.privateKey || '');
    const walletId = String(result?.walletId || meWallet?.textContent || '-');
    if (!key) {
      setStatus('Private key export unavailable.');
      return;
    }

    const text = `Wallet: ${walletId}\nPrivate Key: ${key}`;
    try {
      await navigator.clipboard.writeText(text);
      setStatus('Private key copied to clipboard. Move it to secure storage now.');
    } catch {
      window.alert(text);
      setStatus('Private key exported to screen. Store it safely.');
    }
  } catch (error) {
    setStatus(`Private key export failed: ${String(error.message || error)}`);
  }
});

for (const button of sidebarButtons) {
  button.addEventListener('click', () => {
    const view = String(button.getAttribute('data-view') || 'bots');
    setView(view);
  });
}

(async function init() {
  try {
    await refreshContext();
    setStatus('Player context loaded.');
  } catch (error) {
    setStatus(`Unable to load player context: ${String(error.message || error)}`);
  }
})();
