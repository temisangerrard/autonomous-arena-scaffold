import {
  limitPlayerShellActivity,
  mergePlayerShell,
  playerShellFromBootstrap,
  shouldRefreshPlayerShell
} from '../../shared/player-shell.js';
import { saveStoredPlayerShell } from '../../shared/player-shell-storage.js';
const DEFAULT_EMBEDDED_FUNDING_HREF = 'https://www.coinbase.com/buy';
const DEFAULT_EXTERNAL_FUNDING_HREF = 'https://www.moonpay.com/buy/usdc';
const FALLBACK_AUTOPLAY_GAMES = ['rps', 'coinflip', 'dice_duel', 'blackjack'];
const GAME_LABELS = {
  rps: 'RPS',
  coinflip: 'Coin Flip',
  dice_duel: 'Dice Duel',
  blackjack: 'Blackjack'
};
const READINESS_LABELS = {
  ready: 'Ready',
  all_checks_passed: 'Ready',
  needs_approval: 'Needs Approval',
  needs_gas: 'Needs Gas',
  insufficient_usdc: 'Low Funds',
  unsupported_provider: 'Unsupported Wallet'
};

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatUsd(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '--';
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(amount);
}

function formatShortAddress(value) {
  const address = String(value || '').trim();
  if (address.length <= 12) return address || '--';
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatRelativeTime(timestampMs) {
  const at = Number(timestampMs);
  if (!Number.isFinite(at) || at <= 0) return 'just now';
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export function limitDrawerActivity(entries, limit = 5) {
  return limitPlayerShellActivity(entries, limit);
}

export function resolveFundingRoute({
  walletProvider,
  walletAddress,
  externalAddress,
  embeddedHref = DEFAULT_EMBEDDED_FUNDING_HREF,
  externalHref = DEFAULT_EXTERNAL_FUNDING_HREF
} = {}) {
  const provider = String(walletProvider || '').toLowerCase();
  const depositAddress = String(externalAddress || walletAddress || '').trim();
  if (provider === 'coinbase_embedded') {
    return {
      kind: 'embedded_onramp',
      href: embeddedHref,
      depositAddress
    };
  }
  return {
    kind: 'external_onramp',
    href: externalHref,
    depositAddress
  };
}

export function buildAutoplayConfigPayload({ bot, autoplay }) {
  const behavior = bot?.behavior && typeof bot.behavior === 'object' ? bot.behavior : {};
  const rawGames = Array.isArray(autoplay?.allowedGames)
    ? autoplay.allowedGames
    : Array.isArray(autoplay?.games)
      ? autoplay.games
      : ['rps', 'coinflip'];
  return {
    ...behavior,
    autoplay: autoplay && autoplay.enabled ? {
      enabled: true,
      allowedGames: rawGames.filter(Boolean),
      wagerMode: String(autoplay.wagerMode || 'fixed'),
      walletPercent: Math.max(1, Math.min(100, Number(autoplay.walletPercent ?? autoplay.walletPct ?? 5))),
      martingaleMultiplier: Math.max(1.1, Number(autoplay.martingaleMultiplier ?? autoplay.martingaleMult ?? 2)),
      baseWager: Math.max(1, Number(autoplay.baseWager ?? behavior.baseWager ?? 1)),
      maxWager: Math.max(
        Math.max(1, Number(autoplay.baseWager ?? behavior.baseWager ?? 1)),
        Number(autoplay.maxWager ?? behavior.maxWager ?? 3)
      ),
      sessionLossLimit: Math.max(0, Number(autoplay.sessionLossLimit ?? behavior.sessionLossLimit ?? 0)),
      sessionWinTarget: Math.max(0, Number(autoplay.sessionWinTarget ?? behavior.sessionWinTarget ?? 0)),
      cooldownMs: Math.max(1000, Number(autoplay.cooldownMs || 3000))
    } : null
  };
}

export function deriveWalletReadinessLabel(readiness) {
  if (!readiness || typeof readiness !== 'object') return 'Wallet status unavailable';
  const status = String(readiness.status || '').trim().toLowerCase();
  if (status && READINESS_LABELS[status]) {
    return READINESS_LABELS[status];
  }
  if (readiness.ready) return 'Ready';
  return String(readiness.reason || readiness.reasonCode || 'Needs attention');
}

function readinessTone(readiness) {
  const status = String(readiness?.status || '').trim().toLowerCase();
  if (status === 'ready' || status === 'all_checks_passed') return 'ready';
  if (status === 'needs_approval' || status === 'needs_gas') return 'warning';
  if (status === 'insufficient_usdc' || status === 'unsupported_provider') return 'error';
  return 'muted';
}

function networkLabel(chainId) {
  const id = Number(chainId);
  if (id === 8453) return 'Base Mainnet';
  if (id === 84532) return 'Base Sepolia';
  return 'Base';
}

function normalizeAutoplay(bot) {
  const source = bot?.behavior?.autoplay;
  const enabled = Boolean(source?.enabled);
  const games = Array.isArray(source?.games) && source.games.length > 0
    ? source.games.map((item) => String(item))
    : Array.isArray(source?.allowedGames) && source.allowedGames.length > 0
      ? source.allowedGames.map((item) => String(item))
    : ['rps', 'coinflip', 'dice_duel'];
  return {
    enabled,
    games,
    wagerMode: String(source?.wagerMode || 'fixed'),
    walletPct: Math.max(1, Math.min(100, Number(source?.walletPct ?? source?.walletPercent ?? 5))),
    martingaleMult: Math.max(1.1, Number(source?.martingaleMult ?? source?.martingaleMultiplier ?? 2)),
    cooldownMs: Math.max(1000, Number(source?.cooldownMs || 3000))
  };
}

function summarizeActivity(entry) {
  const kind = String(entry?.kind || entry?.activityType || '');
  if (kind === 'match') {
    return {
      tone: 'neutral',
      badges: ['match'],
      amountLabel: '',
      title: String(entry?.title || 'Match'),
      detail: String(entry?.detail || 'Arena match')
    };
  }
  if (kind === 'escrow') {
    const outcome = String(entry?.outcome || entry?.phase || 'update').replaceAll('_', ' ');
    const wager = Number(entry?.wager ?? 0);
    const payout = Number(entry?.payout ?? 0);
    const gameType = String(entry?.gameType || 'game').replaceAll('_', ' ');
    const phase = String(entry?.phase || '').toLowerCase();
    const badges = [gameType];
    let tone = 'neutral';
    if (phase === 'resolve' && payout > 0) {
      tone = 'positive';
      badges.push('win');
    } else if (phase === 'resolve' && payout === 0) {
      tone = 'negative';
      badges.push('loss');
    } else if (phase === 'refund') {
      badges.push('refund');
    } else if (phase === 'lock') {
      badges.push('locked');
    }
    return {
      tone,
      badges,
      amountLabel: payout > 0 ? formatUsd(payout) : wager > 0 ? formatUsd(wager) : '',
      title: `${gameType.charAt(0).toUpperCase()}${gameType.slice(1)} ${outcome}`,
      detail: wager > 0 ? `Wager ${formatUsd(wager)}${payout > 0 ? ` · Return ${formatUsd(payout)}` : ''}` : 'Escrow update'
    };
  }
  if (kind === 'market_position') {
    const question = String(entry?.marketQuestion || 'Market');
    const status = String(entry?.status || 'open').replaceAll('_', ' ');
    return {
      tone: status === 'won' ? 'positive' : status === 'lost' ? 'negative' : 'neutral',
      badges: ['market', status],
      amountLabel: Number.isFinite(Number(entry?.payout)) ? formatUsd(entry?.payout) : '',
      title: question,
      detail: `Position ${status}`
    };
  }
  const direction = String(entry?.direction || 'transfer').replaceAll('_', ' ');
  const amount = entry?.amount != null ? `${entry.amount} ${entry?.tokenSymbol || 'TOKEN'}` : 'Transfer';
  return {
    tone: direction === 'in' ? 'positive' : direction === 'out' ? 'negative' : 'neutral',
    badges: [direction],
    amountLabel: entry?.amount != null ? String(amount) : '',
    title: direction.charAt(0).toUpperCase() + direction.slice(1),
    detail: amount
  };
}

function describeControlMode(bot, readiness) {
  const status = String(readiness?.status || '').trim().toLowerCase();
  if (status === 'insufficient_usdc') return 'Low Funds';
  const mode = String(bot?.controlMode || '').trim().toLowerCase();
  if (mode === 'human_active') return 'Human controlling';
  if (mode === 'bot_active') return 'Bot roaming';
  if (mode === 'idle_offline') return 'Bot paused';
  if (bot?.behavior?.autoplay?.enabled) return 'Autoplay armed';
  return 'Offline';
}

function describeActorClass(bot) {
  const actorClass = String(bot?.actorClass || '').trim().toLowerCase();
  if (actorClass === 'owner') return 'Player Bot';
  if (actorClass === 'background') return 'House Bot';
  if (actorClass === 'house') return 'House Dealer';
  return 'Arena Actor';
}

export function deriveWalletSummaryView({ summary, player, readiness, funding }) {
  const onchain = summary?.onchain && typeof summary.onchain === 'object' ? summary.onchain : {};
  const wallet = summary?.wallet && typeof summary.wallet === 'object' ? summary.wallet : {};
  const profileWallet = player?.profile?.wallet && typeof player.profile.wallet === 'object' ? player.profile.wallet : {};
  const walletAddress = String(
    profileWallet?.address
    || onchain?.address
    || wallet?.address
    || wallet?.walletAddress
    || ''
  ).trim();
  const depositAddress = String(
    funding?.depositAddress
    || wallet?.externalWalletAddress
    || walletAddress
    || ''
  ).trim();
  return {
    displayName: String(player?.displayName || player?.name || player?.username || 'Arena Player'),
    handle: player?.profile?.username ? `@${player.profile.username}` : '',
    balanceLabel: formatUsd(onchain?.tokenBalance),
    walletAddress,
    walletAddressShort: formatShortAddress(walletAddress || depositAddress),
    depositAddress,
    networkLabel: networkLabel(onchain?.chainId),
    tokenLabel: String(onchain?.tokenSymbol || 'USDC'),
    readinessLabel: deriveWalletReadinessLabel(readiness),
    readinessTone: readinessTone(readiness),
    providerLabel: String(wallet?.walletProvider || '').replaceAll('_', ' ')
  };
}

export function seedDrawerDataFromRuntime({ state, dom } = {}) {
  const displayName = String(dom?.topbarName?.textContent || 'Player').trim() || 'Player';
  const walletSummary = {
    onchain: {
      tokenBalance: Number.isFinite(Number(state?.walletBalance)) ? Number(state.walletBalance) : null,
      chainId: Number.isFinite(Number(state?.walletChainId)) ? Number(state.walletChainId) : null,
      tokenSymbol: state?.walletTokenSymbol ? String(state.walletTokenSymbol) : 'USDC'
    },
    wallet: {
      walletProvider: state?.walletProvider ? String(state.walletProvider) : null,
      externalWalletAddress: state?.walletExternalAddress ? String(state.walletExternalAddress) : null
    }
  };
  const funding = resolveFundingRoute({
    walletProvider: state?.walletProvider,
    externalAddress: state?.walletExternalAddress
  });
  return {
    player: {
        displayName,
        profile: null
    },
    walletSummary,
    bot: null,
    readiness: null,
    activityPreview: [],
    funding,
    loadedAt: Date.now()
  };
}

function createDrawerMarkup({ walletSummary, player, bot, readiness, funding, activityPreview }) {
  const walletView = deriveWalletSummaryView({ summary: walletSummary, player, readiness, funding });
  const autoplay = normalizeAutoplay(bot);
  const controlModeLabel = describeControlMode(bot, readiness);
  const actorClassLabel = describeActorClass(bot);
  const activityItems = limitDrawerActivity(activityPreview).map((entry) => {
    const summaryBits = summarizeActivity(entry);
    return `
      <li class="player-drawer__activity-item player-drawer__activity-item--${escapeHtml(summaryBits.tone || 'neutral')}">
        <div class="player-drawer__activity-topline">
          <div class="player-drawer__activity-badges">${(summaryBits.badges || []).map((badge) => `<span class="player-drawer__activity-badge">${escapeHtml(badge)}</span>`).join('')}</div>
          ${summaryBits.amountLabel ? `<div class="player-drawer__activity-amount">${escapeHtml(summaryBits.amountLabel)}</div>` : ''}
        </div>
        <div class="player-drawer__activity-title">${escapeHtml(summaryBits.title)}</div>
        <div class="player-drawer__activity-detail">${escapeHtml(summaryBits.detail)}</div>
        <div class="player-drawer__activity-time">${escapeHtml(formatRelativeTime(entry?.at))}</div>
      </li>`;
  }).join('');
  const gameToggles = FALLBACK_AUTOPLAY_GAMES.map((game) => `
    <label class="player-drawer__choice">
      <input type="checkbox" data-field="autoplay-game" value="${escapeHtml(game)}"${autoplay.games.includes(game) ? ' checked' : ''}>
      <span>${escapeHtml(GAME_LABELS[game] || game.replaceAll('_', ' '))}</span>
    </label>
  `).join('');
  const providerMeta = walletView.providerLabel ? `${walletView.providerLabel} wallet` : 'Wallet';

  return `
    <section class="player-drawer__section player-drawer__section--hero">
      <div class="player-drawer__eyebrow">Your Arena</div>
      <div class="player-drawer__headline">${escapeHtml(walletView.displayName)}</div>
      <div class="player-drawer__meta-row">
        <span class="player-drawer__meta">${escapeHtml(walletView.handle || providerMeta)}</span>
        <span class="player-drawer__badge player-drawer__badge--${escapeHtml(walletView.readinessTone)}">${escapeHtml(walletView.readinessLabel)}</span>
      </div>
      <div class="player-drawer__meta-row">
        <span class="player-drawer__meta">${escapeHtml(actorClassLabel)} · ${escapeHtml(controlModeLabel)}</span>
      </div>
      <div class="player-drawer__balance">${escapeHtml(walletView.balanceLabel)}</div>
      <div class="player-drawer__wallet-row">
        <div>
          <div class="player-drawer__meta">Wallet</div>
          <div class="player-drawer__wallet-address">${escapeHtml(walletView.walletAddressShort)}</div>
        </div>
        <div>
          <div class="player-drawer__meta">Network</div>
          <div class="player-drawer__wallet-address">${escapeHtml(walletView.networkLabel)} · ${escapeHtml(walletView.tokenLabel)}</div>
        </div>
      </div>
    </section>
    <section class="player-drawer__section">
      <div class="player-drawer__section-title">Top up</div>
      <div class="player-drawer__hint">Buy or bridge USDC directly into your arena wallet to start playing.</div>
      <div class="player-drawer__actions">
        <button type="button" class="player-drawer__button player-drawer__button--primary" data-action="fund-primary">Top Up</button>
        <button type="button" class="player-drawer__button" data-action="copy-deposit">Copy deposit address</button>
      </div>
      <div class="player-drawer__address">${escapeHtml(walletView.depositAddress || 'Deposit address still syncing')}</div>
    </section>
    <section class="player-drawer__section">
      <div class="player-drawer__section-title">Autoplay</div>
      <label class="player-drawer__toggle">
        <input type="checkbox" data-field="autoplay-enabled"${autoplay.enabled ? ' checked' : ''}>
        <span>Enable autoplay</span>
      </label>
      <div class="player-drawer__field">
        <span>Games</span>
        <div class="player-drawer__choices">${gameToggles}</div>
      </div>
      <label class="player-drawer__field">
        <span>Betting style</span>
        <select data-field="autoplay-wager-mode">
          <option value="fixed"${autoplay.wagerMode === 'fixed' ? ' selected' : ''}>Fixed amount</option>
          <option value="percent_wallet"${autoplay.wagerMode === 'percent_wallet' ? ' selected' : ''}>Wallet %</option>
          <option value="martingale"${autoplay.wagerMode === 'martingale' ? ' selected' : ''}>Martingale</option>
        </select>
      </label>
      <div class="player-drawer__field-row">
        <label class="player-drawer__field">
          <span>Stake %</span>
          <input type="number" min="1" max="100" value="${escapeHtml(autoplay.walletPct)}" data-field="autoplay-wallet-pct">
        </label>
        <label class="player-drawer__field">
          <span>Cooldown (ms)</span>
          <input type="number" min="1000" step="100" value="${escapeHtml(autoplay.cooldownMs)}" data-field="autoplay-cooldown-ms">
        </label>
      </div>
      <div class="player-drawer__field-row">
        <label class="player-drawer__field">
          <span>Multiplier</span>
          <input type="number" min="1.1" step="0.1" value="${escapeHtml(autoplay.martingaleMult)}" data-field="autoplay-martingale-mult">
        </label>
      </div>
      <div class="player-drawer__actions">
        <button type="button" class="player-drawer__button" data-action="save-autoplay"${bot?.id ? '' : ' disabled'}>Save autoplay</button>
      </div>
    </section>
    <section class="player-drawer__section">
      <div class="player-drawer__section-title">Recent activity</div>
      <ul class="player-drawer__activity">${activityItems || '<li class="player-drawer__activity-empty">No recent activity yet.</li>'}</ul>
      <a class="player-drawer__link" href="/dashboard" target="_blank" rel="noopener noreferrer">Open Full Dashboard</a>
    </section>
  `;
}

export function createPlayerDrawerController({
  apiJson,
  state,
  syncWalletSummary,
  showToast,
  windowRef = window,
  drawer,
  drawerBackdrop,
  drawerClose,
  drawerBody,
  dom = {}
}) {
  let open = false;
  let lastLoadedAt = 0;
  let refreshInFlight = null;
  let data = mergePlayerShell(seedDrawerDataFromRuntime({ state, dom }), state?.playerShellData || {});

  function persistShell(nextData) {
    data = mergePlayerShell(data, nextData || {});
    if (state) {
      state.playerShellData = data;
      state.playerShellLoadedAt = Number(data.loadedAt || Date.now());
    }
    saveStoredPlayerShell(windowRef?.localStorage, data);
  }

  async function loadData() {
    let bot = data?.bot || state?.playerShellData?.bot || null;
    if (!bot?.id) {
      const bootstrap = await apiJson('/api/player/bootstrap').catch(() => null);
      const bootstrapShell = playerShellFromBootstrap(bootstrap, {
        playerShell: state?.playerShellData || data || {}
      });
      if (bootstrapShell?.bot?.id) {
        persistShell({
          player: bootstrapShell.player || undefined,
          bot: bootstrapShell.bot,
          loadedAt: Date.now()
        });
        bot = bootstrapShell.bot;
      }
    }
    const [summary, activityPayload, readiness] = await Promise.all([
      apiJson('/api/player/wallet/summary').catch(() => null),
      apiJson('/api/player/activity?limit=5').catch(() => ({ activity: [] })),
      bot?.id ? apiJson(`/api/player/bots/${encodeURIComponent(bot.id)}/wallet`).catch(() => null) : Promise.resolve(null)
    ]);
    persistShell({
      walletSummary: summary,
      bot,
      readiness: readiness?.readiness || readiness || null,
      activityPreview: Array.isArray(activityPayload?.activity) ? activityPayload.activity : [],
      funding: resolveFundingRoute({
        walletProvider: summary?.wallet?.walletProvider ?? state?.walletProvider,
        walletAddress: data?.player?.profile?.wallet?.address ?? data?.player?.walletAddress ?? summary?.onchain?.address ?? summary?.wallet?.address,
        externalAddress: summary?.wallet?.externalWalletAddress ?? state?.walletExternalAddress
      }),
      loadedAt: Date.now()
    });
  }

  function attachBodyHandlers() {
    if (!drawerBody) return;
    drawerBody.querySelector('[data-action="fund-primary"]')?.addEventListener('click', () => {
      const href = String(data?.funding?.href || '');
      if (!href) {
        showToast?.('Funding route unavailable', 'error');
        return;
      }
      windowRef.open(href, '_blank', 'noopener,noreferrer');
    });
    drawerBody.querySelector('[data-action="copy-deposit"]')?.addEventListener('click', async () => {
      const depositAddress = String(data?.funding?.depositAddress || '');
      if (!depositAddress) {
        showToast?.('Deposit address unavailable', 'error');
        return;
      }
      try {
        await windowRef.navigator.clipboard.writeText(depositAddress);
        showToast?.('Deposit address copied', 'success');
      } catch {
        showToast?.('Copy failed', 'error');
      }
    });
    drawerBody.querySelector('[data-action="save-autoplay"]')?.addEventListener('click', async () => {
      if (!data.bot?.id) return;
      const saveButton = drawerBody.querySelector('[data-action="save-autoplay"]');
      const autoplayEnabled = drawerBody.querySelector('[data-field="autoplay-enabled"]')?.checked || false;
      const selectedGames = [...drawerBody.querySelectorAll('[data-field="autoplay-game"]:checked')]
        .map((input) => input.value)
        .filter(Boolean);
      const autoplay = autoplayEnabled ? {
        enabled: true,
        games: selectedGames.length > 0 ? selectedGames : ['rps', 'coinflip'],
        wagerMode: String(drawerBody.querySelector('[data-field="autoplay-wager-mode"]')?.value || 'fixed'),
        walletPct: Math.max(1, Math.min(100, Number(drawerBody.querySelector('[data-field="autoplay-wallet-pct"]')?.value || 5))),
        martingaleMult: Math.max(1.1, Number(drawerBody.querySelector('[data-field="autoplay-martingale-mult"]')?.value || 2)),
        cooldownMs: Math.max(1000, Number(drawerBody.querySelector('[data-field="autoplay-cooldown-ms"]')?.value || 3000))
      } : null;
      const payload = buildAutoplayConfigPayload({ bot: data.bot, autoplay });
      const previousLabel = saveButton?.textContent || 'Save autoplay';
      if (saveButton) {
        saveButton.disabled = true;
        saveButton.textContent = 'Saving...';
      }
      try {
        await apiJson(`/api/player/bots/${encodeURIComponent(data.bot.id)}/config`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload)
        });
        persistShell({
          bot: {
            ...(data.bot || {}),
            behavior: payload
          },
          loadedAt: Date.now()
        });
        showToast?.('Autoplay saved', 'success');
        await syncWalletSummary?.({ keepLastOnFailure: true });
        await refresh();
      } catch (error) {
        showToast?.(`Autoplay save failed: ${String(error?.message || error)}`, 'error');
      } finally {
        if (saveButton) {
          saveButton.disabled = false;
          saveButton.textContent = previousLabel;
        }
      }
    });
  }

  function render() {
    if (!drawerBody) return;
    drawerBody.innerHTML = createDrawerMarkup(data);
    attachBodyHandlers();
  }

  async function refresh() {
    if (refreshInFlight) {
      return refreshInFlight;
    }
    refreshInFlight = (async () => {
      if (state) {
        state.playerShellRefreshInFlight = refreshInFlight;
      }
      try {
        await loadData();
        lastLoadedAt = Date.now();
        render();
      } catch (error) {
        showToast?.(`Player panel unavailable: ${String(error?.message || error)}`, 'error');
      } finally {
        refreshInFlight = null;
        if (state) {
          state.playerShellRefreshInFlight = null;
        }
      }
    })();
    try {
      await refreshInFlight;
    } catch {}
  }

  function setOpen(nextOpen) {
    open = Boolean(nextOpen);
    drawer?.classList.toggle('open', open);
    drawer?.setAttribute('aria-hidden', open ? 'false' : 'true');
    drawerBackdrop?.toggleAttribute('hidden', !open);
    drawerBackdrop?.classList.toggle('visible', open);
    if (open) {
      persistShell(playerShellFromBootstrap(
        { playerShell: state?.playerShellData },
        seedDrawerDataFromRuntime({ state, dom })
      ));
      render();
      if (shouldRefreshPlayerShell(state?.playerShellLoadedAt || lastLoadedAt)) {
        void refresh();
      }
    }
  }

  drawerBackdrop?.addEventListener('click', () => setOpen(false));
  drawerClose?.addEventListener('click', () => setOpen(false));
  windowRef.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && open) {
      setOpen(false);
    }
  });

  return {
    setOpen,
    open: () => setOpen(true),
    close: () => setOpen(false),
    toggle: () => setOpen(!open),
    refresh
  };
}
