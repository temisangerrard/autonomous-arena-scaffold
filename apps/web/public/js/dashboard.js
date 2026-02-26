import {
  isRequestBackoffActive,
  setRequestBackoffFromError,
  clearRequestBackoff
} from './shared/request-backoff.js';

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
const walletEscrowPanel = document.getElementById('wallet-escrow-panel');
const activityFilterButtons = [...document.querySelectorAll('[data-activity-filter]')];
const exportPrivateKey = document.getElementById('export-private-key');

const botModal = document.getElementById('bot-modal');
const botModalClose = document.getElementById('bot-modal-close');
const botModalTitle = document.getElementById('bot-modal-title');
const botModalSub = document.getElementById('bot-modal-sub');

const sidebarButtons = [...document.querySelectorAll('.sidebar-nav [data-view]')];
const views = [...document.querySelectorAll('.dash-view')];
const quickCommandButtons = [...document.querySelectorAll('[data-quick-cmd]')];
const walletTabButtons = [...document.querySelectorAll('[data-wallet-tab]')];
const walletPanes = [...document.querySelectorAll('[data-wallet-pane]')];

let playerCtx = null;
let bootstrapCtx = null;
let playerDirectory = [];
let selectedBotId = '';
let walletSummaryCtx = null;
let activityEntries = [];
let activityFilter = 'all';
const WALLET_SUMMARY_BACKOFF_KEY = 'dashboard_wallet_summary';

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

function setWalletTab(nextTab) {
  for (const button of walletTabButtons) {
    button.classList.toggle('active', button.getAttribute('data-wallet-tab') === nextTab);
  }
  for (const pane of walletPanes) {
    pane.classList.toggle('active', pane.getAttribute('data-wallet-pane') === nextTab);
  }
}

async function api(path, init = {}) {
  const requestUrl = path.startsWith('/api/')
    ? `${path}${path.includes('?') ? '&' : '?'}t=${Date.now()}`
    : path;
  const headers = new Headers(init.headers || {});
  let response = await fetch(requestUrl, {
    credentials: 'include',
    cache: 'no-store',
    ...init,
    headers
  });
  if (response.status === 401 || response.status === 403) {
    // Netlify edge can occasionally serve a stale auth response; retry once before redirecting.
    response = await fetch(`${requestUrl}${requestUrl.includes('?') ? '&' : '?'}retry=1`, {
      credentials: 'include',
      cache: 'no-store',
      ...init,
      headers
    });
  }
  const payload = await response.json().catch(() => ({}));
  if (response.status === 401 || response.status === 403) {
    try {
      const verify = await fetch(`/api/player/me?optional=1&t=${Date.now()}`, {
        credentials: 'include',
        cache: 'no-store'
      });
      const verifyPayload = await verify.json().catch(() => ({}));
      if (!verify.ok || !verifyPayload?.user) {
        try {
          localStorage.removeItem('arena_ws_auth');
        } catch {
          // ignore
        }
        window.location.href = '/welcome';
        throw new Error('unauthorized');
      }
      const transient = new Error('transient_auth_stale');
      transient.status = Number(response.status || 0);
      transient.reason = 'transient_auth_stale';
      throw transient;
    } catch (error) {
      if (String(error?.message || '') === 'transient_auth_stale') {
        throw error;
      }
      try {
        localStorage.removeItem('arena_ws_auth');
      } catch {
        // ignore
      }
      window.location.href = '/welcome';
      throw new Error('unauthorized');
    }
  }
  if (!response.ok) {
    const reason = String(payload?.reason || `status_${response.status}`);
    const error = new Error(reason);
    error.status = Number(response.status || 0);
    error.reason = reason;
    const retryAfter = response.headers.get('retry-after');
    if (retryAfter) {
      const asSeconds = Number(retryAfter);
      if (Number.isFinite(asSeconds) && asSeconds > 0) {
        error.retryAfterMs = Math.max(1_000, Math.floor(asSeconds * 1_000));
      } else {
        const retryAt = Date.parse(retryAfter);
        if (Number.isFinite(retryAt)) {
          error.retryAfterMs = Math.max(1_000, retryAt - Date.now());
        }
      }
    }
    throw error;
  }
  return payload;
}

function getRequestStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
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
  const walletId = profile?.wallet?.id || profile?.walletId || walletSummaryCtx?.wallet?.id || '-';
  const walletAddress = profile?.wallet?.address || walletSummaryCtx?.onchain?.address || walletSummaryCtx?.wallet?.address || '-';
  const rawOnchainBalance = walletSummaryCtx?.onchain?.tokenBalance;
  const hasOnchainBalance = Number.isFinite(Number(rawOnchainBalance));
  const tokenBalance = hasOnchainBalance ? Number(rawOnchainBalance) : null;
  const tokenSymbol = walletSummaryCtx?.onchain?.tokenSymbol || 'TOKEN';
  const nativeBalance = walletSummaryCtx?.onchain?.nativeBalanceEth || null;
  const onchainMode = walletSummaryCtx?.onchain?.mode === 'onchain';

  if (meEmail) meEmail.textContent = user?.email || '-';
  if (meRole) meRole.textContent = user?.role || '-';
  if (meProfile) meProfile.textContent = profile?.displayName ? `${profile.displayName} (@${profile.username})` : '-';
  if (meWallet) meWallet.textContent = walletId;
  if (meWalletAddress) meWalletAddress.textContent = walletAddress;
  if (walletBalance) walletBalance.textContent = hasOnchainBalance ? Number(tokenBalance).toFixed(4) : '—';
  if (walletBalanceNote) {
    walletBalanceNote.textContent = onchainMode ? tokenSymbol : 'mUSDC';
  }

  // Show gas indicator for onchain wallets
  const gasIndicator = document.getElementById('gas-indicator');
  const gasBalance = document.getElementById('gas-balance');
  if (gasIndicator && gasBalance) {
    if (onchainMode && nativeBalance) {
      gasIndicator.style.display = 'flex';
      gasBalance.textContent = Number(nativeBalance).toFixed(5);
    } else {
      gasIndicator.style.display = 'none';
    }
  }

  if (sidebarName) sidebarName.textContent = profile?.displayName || user?.name || 'Player';
  if (sidebarHandle) sidebarHandle.textContent = `@${profile?.username || 'player'}`;
  if (sidebarWallet) sidebarWallet.textContent = hasOnchainBalance ? Number(tokenBalance).toFixed(2) : '—';

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
    const canSeeDirectory = String(playerCtx?.user?.role || '') === 'admin';
    walletTransferTarget.innerHTML = [canSeeDirectory ? '<option value="">Select a player</option>' : '<option value="">Enter wallet id manually</option>']
      .concat(
        (canSeeDirectory ? playerDirectory : []).map((entry) => {
          const shortAddress = entry.walletAddress ? `${String(entry.walletAddress).slice(0, 8)}...${String(entry.walletAddress).slice(-6)}` : '';
          const label = `${escapeHtml(entry.displayName || entry.username)} (@${escapeHtml(entry.username)})${shortAddress ? ` · ${escapeHtml(shortAddress)}` : ''}`;
          return `<option value="${escapeHtml(entry.walletId)}">${label}</option>`;
        })
      )
      .join('');
  }

  if (onboardingList) {
    const hasUser = Boolean(user?.email);
    const hasProfile = Boolean(profile?.id);
    const hasFunds = hasOnchainBalance && Number(tokenBalance) > 0;
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
      .map(([ok, text]) => `<li>${ok ? '[x]' : '[ ]'} ${escapeHtml(text)}</li>`)
      .join('');
  }

  bindPlayLink();
}

function renderEscrowHistory(entries, errorMessage = '') {
  if (!escrowHistory) {
    return;
  }
  if (walletEscrowPanel) {
    walletEscrowPanel.style.display = '';
  }
  if (errorMessage) {
    escrowHistory.innerHTML = '';
    if (walletEscrowPanel) walletEscrowPanel.style.display = 'none';
    return;
  }
  const sourceEntries = Array.isArray(entries) ? entries : [];
  const visibleEntries = sourceEntries.filter((entry) => {
    const kind = String(entry?.kind || 'escrow');
    if (activityFilter === 'onchain') return kind === 'onchain_transfer';
    if (activityFilter === 'escrow') return kind === 'escrow';
    if (activityFilter === 'markets') return kind === 'market_position';
    return true;
  });
  if (sourceEntries.length === 0) {
    escrowHistory.innerHTML = '<div class="escrow-empty">No wallet activity yet.</div>';
    return;
  }
  if (visibleEntries.length === 0) {
    const filterLabel = activityFilter === 'onchain'
      ? 'onchain'
      : activityFilter === 'escrow'
        ? 'escrow'
        : activityFilter === 'markets'
          ? 'market'
          : 'wallet';
    escrowHistory.innerHTML = `<div class="escrow-empty">No ${escapeHtml(filterLabel)} activity yet.</div>`;
    return;
  }
  escrowHistory.innerHTML = visibleEntries
    .map((entry) => {
      const kind = String(entry?.kind || 'escrow');
      const at = entry?.at ? new Date(Number(entry.at)).toLocaleString() : '--';
      const txHash = String(entry?.txHash || '');
      const shortTx = txHash ? `${txHash.slice(0, 10)}...${txHash.slice(-8)}` : 'n/a';
      const txUrl = String(entry?.txUrl || '').trim();
      const txRef = txUrl
        ? `<a href="${escapeHtml(txUrl)}" target="_blank" rel="noopener noreferrer">tx ${escapeHtml(shortTx)}</a>`
        : `tx ${escapeHtml(shortTx)}`;

      if (kind === 'onchain_transfer') {
        const direction = String(entry?.direction || 'unknown');
        const token = String(entry?.tokenSymbol || 'TOKEN');
        const amount = String(entry?.amount || '0');
        const methodLabel = String(entry?.methodLabel || entry?.method || 'transfer');
        const nativeValueEth = String(entry?.nativeValueEth || '').trim();
        const emoji = direction === 'in' ? '↗' : direction === 'out' ? '↘' : '↔';
        const signClass = direction === 'in' ? 'positive' : direction === 'out' ? 'negative' : '';
        const label = direction === 'in' ? 'Onchain receive' : direction === 'out' ? 'Onchain send' : 'Onchain transfer';
        const trail = [`method ${methodLabel}`, nativeValueEth ? `${nativeValueEth} ETH` : ''].filter(Boolean).join(' · ');
        return `<div class="tx-item">
          <div class="tx-icon ${direction === 'in' ? 'in' : 'out'}">${emoji}</div>
          <div class="tx-details">
            <div class="tx-type">${escapeHtml(label)} · ${escapeHtml(token)}</div>
            <div class="tx-time">${escapeHtml(at)} · ${txRef}${trail ? ` · ${escapeHtml(trail)}` : ''}</div>
          </div>
          <div class="tx-amount ${signClass}">${escapeHtml(amount)} ${escapeHtml(token)}</div>
        </div>`;
      }

      if (kind === 'market_position') {
        const status = String(entry?.status || 'open');
        const side = String(entry?.side || '').toUpperCase();
        const question = String(entry?.marketQuestion || entry?.marketId || 'Market');
        const stake = Number(entry?.stake ?? 0);
        const payoutValue = Number(entry?.payout ?? 0);
        const signClass = status === 'won'
          ? 'positive'
          : status === 'lost'
            ? 'negative'
            : '';
        const emoji = status === 'won'
          ? '↗'
          : status === 'lost'
            ? '↘'
            : '•';
        const statusLabel = status === 'won'
          ? 'Market WIN'
          : status === 'lost'
            ? 'Market LOSS'
            : status === 'voided'
              ? 'Market VOID'
              : 'Market OPEN';
        const clobOrderId = String(entry?.clobOrderId || '').trim();
        const reason = String(entry?.settlementReason || '').trim();
        const trail = [clobOrderId ? `order ${clobOrderId}` : '', reason].filter(Boolean).join(' · ');
        return `<div class="tx-item">
          <div class="tx-icon ${status === 'won' ? 'in' : 'out'}">${emoji}</div>
          <div class="tx-details">
            <div class="tx-type">${escapeHtml(statusLabel)} · ${escapeHtml(side)} · ${escapeHtml(question)}</div>
            <div class="tx-time">${escapeHtml(at)}${trail ? ` · ${escapeHtml(trail)}` : ''}</div>
          </div>
          <div class="tx-amount ${signClass}">${escapeHtml(stake.toFixed(2))} / ${escapeHtml((Number.isFinite(payoutValue) ? payoutValue : 0).toFixed(2))}</div>
        </div>`;
      }

      const outcome = String(entry?.outcome || entry?.phase || 'unknown');
      const challengeId = String(entry?.challengeId || 'n/a');
      const amountValue = Number(entry?.amount ?? entry?.wager ?? 0);
      const amount = Number.isFinite(amountValue) ? amountValue.toFixed(2) : '0.00';
      const payoutValue = Number(entry?.payout ?? 0);
      const payout = Number.isFinite(payoutValue) ? payoutValue.toFixed(2) : '0.00';
      const ok = entry?.ok === false ? 'failed' : 'ok';
      const signClass = payoutValue > 0 ? 'positive' : 'negative';
      const emoji = payoutValue > 0 ? '↗' : '↘';
      const source = String(entry?.activitySource || '');
      const sourceLabel =
        source === 'house_station'
          ? 'house station'
          : source === 'owner_bot_autoplay'
            ? 'your bot autoplay'
            : source === 'player_pvp'
              ? 'player pvp'
              : 'unknown source';
      const botBits = [entry?.challengerBotId, entry?.opponentBotId]
        .filter((item) => typeof item === 'string' && item.trim().length > 0)
        .map((item) => String(item).replace(/^agent_/, '@'))
        .join(' vs ');
      const sourceLine = botBits ? `${sourceLabel} · ${botBits}` : sourceLabel;
      return `<div class="tx-item">
        <div class="tx-icon ${ok === 'ok' ? 'in' : 'out'}">${emoji}</div>
        <div class="tx-details">
          <div class="tx-type">${escapeHtml(outcome)} · ${escapeHtml(challengeId)}</div>
          <div class="tx-time">${escapeHtml(at)} · ${txRef} · ${escapeHtml(sourceLine)}</div>
        </div>
        <div class="tx-amount ${signClass}">${escapeHtml(amount)} / ${escapeHtml(payout)}</div>
      </div>`;
    })
    .join('');
}

async function refreshContext() {
  const requestStorage = getRequestStorage();
  const walletSummaryPromise = isRequestBackoffActive(requestStorage, WALLET_SUMMARY_BACKOFF_KEY)
    ? Promise.resolve(null)
    : api('/api/player/wallet/summary')
      .then((payload) => {
        clearRequestBackoff(requestStorage, WALLET_SUMMARY_BACKOFF_KEY);
        return payload;
      })
      .catch((error) => {
        setRequestBackoffFromError(requestStorage, WALLET_SUMMARY_BACKOFF_KEY, error);
        return null;
      });
  const [ctx, bootstrap, walletSummary] = await Promise.all([
    api('/api/player/me'),
    api('/api/player/bootstrap?world=mega'),
    walletSummaryPromise
  ]);
  const canSeeDirectory = String(ctx?.user?.role || '') === 'admin';
  const directory = canSeeDirectory
    ? await api('/api/player/directory').catch(() => ({ players: [] }))
    : { players: [] };
  let nextActivityEntries = [];
  let escrowError = '';
  try {
    const activity = await api('/api/player/activity?limit=30');
    nextActivityEntries = Array.isArray(activity?.activity) ? activity.activity : [];
  } catch (error) {
    escrowError = String(error?.message || error);
  }
  playerCtx = ctx;
  bootstrapCtx = bootstrap;
  playerDirectory = Array.isArray(directory?.players) ? directory.players : [];
  walletSummaryCtx = walletSummary;
  activityEntries = nextActivityEntries;
  renderEscrowHistory(activityEntries, escrowError);
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
    const msg = String(error.message || error);
    if (msg.includes('runtime_unavailable')) {
      setStatus('Wallet service is currently unavailable. You can still play free matches (set wager to 0).');
    } else {
      setStatus(`Wallet fund failed: ${msg}`);
    }
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
    const msg = String(error.message || error);
    if (msg.includes('runtime_unavailable')) {
      setStatus('Wallet service is currently unavailable. You can still play free matches (set wager to 0).');
    } else {
      setStatus(`Wallet withdraw failed: ${msg}`);
    }
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
    const msg = String(error.message || error);
    if (msg.includes('runtime_unavailable')) {
      setStatus('Wallet service is currently unavailable. You can still play free matches (set wager to 0).');
    } else {
      setStatus(`Wallet transfer failed: ${msg}`);
    }
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
  const trimmed = String(message || '').trim();
  const confirmMatch = trimmed.match(/^confirm\s+([a-z0-9_:-]+)$/i);
  const payload = confirmMatch?.[1]
    ? { confirmToken: confirmMatch[1] }
    : { message: trimmed };

  const result = await api('/api/chief/v1/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const actions = Array.isArray(result?.actions)
    ? result.actions.map((entry) => `${entry.tool} (${entry.status})`).join(', ')
    : '';
  const confirmation = result?.requiresConfirmation
    ? `\n\nConfirmation required. Re-send with token:\nconfirm ${String(result?.confirmToken || '').trim()}`
    : '';
  const reply = String(result?.reply || 'No reply.')
    + (actions ? `\n\nActions: ${actions}` : '')
    + confirmation;
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

for (const button of walletTabButtons) {
  button.addEventListener('click', () => {
    const tab = String(button.getAttribute('data-wallet-tab') || 'overview');
    setWalletTab(tab);
  });
}

for (const button of activityFilterButtons) {
  button.addEventListener('click', () => {
    const nextFilter = String(button.getAttribute('data-activity-filter') || 'all').trim() || 'all';
    activityFilter = nextFilter;
    for (const candidate of activityFilterButtons) {
      const active = String(candidate.getAttribute('data-activity-filter') || '') === activityFilter;
      candidate.classList.toggle('active', active);
      candidate.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
    renderEscrowHistory(activityEntries);
  });
}

(async function init() {
  try {
    setWalletTab('overview');
    await refreshContext();
    setStatus('');
  } catch (error) {
    setStatus(`Unable to load player context: ${String(error.message || error)}`);
  }
})();
