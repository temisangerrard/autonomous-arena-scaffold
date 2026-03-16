export const PLAYER_SHELL_TTL_MS = 30_000;
export const PLAYER_SHELL_ACTIVITY_LIMIT = 5;

function formatUsd(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 'US$0.00';
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(amount);
}

function titleCaseWords(value) {
  return String(value || '')
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function describeOpponentClass(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'owner_bot' || normalized === 'player_bot') return 'Player Bot';
  if (normalized === 'background_bot' || normalized === 'house_bot') return 'House Bot';
  if (normalized === 'house' || normalized === 'house_dealer') return 'House Dealer';
  if (normalized === 'human' || normalized === 'player') return 'Player';
  return 'Arena';
}

function describeMatchOutcome(entry) {
  const outcome = String(entry?.outcome || entry?.status || entry?.phase || '').trim().toLowerCase();
  if (!outcome) return 'Updated';
  if (outcome === 'resolved' && entry?.winnerId) return 'Resolved';
  return titleCaseWords(outcome);
}

function normalizeActivityEntry(entry) {
  const kind = String(entry?.kind || '').trim().toLowerCase();
  if (kind === 'escrow') {
    const gameLabel = titleCaseWords(String(entry?.gameType || 'match'));
    const opponentLabel = String(entry?.opponentLabel || 'House');
    const wager = Number(entry?.wager ?? entry?.amount ?? 0);
    const payout = Number(entry?.payout ?? 0);
    return {
      ...entry,
      kind: 'match',
      activityType: 'match',
      title: `${gameLabel} vs ${opponentLabel}`,
      detail: [
        describeOpponentClass(entry?.opponentClass),
        opponentLabel,
        wager > 0 ? `Wager ${formatUsd(wager)}` : '',
        payout > 0 ? `Payout ${formatUsd(payout)}` : describeMatchOutcome(entry)
      ].filter(Boolean).join(' · ')
    };
  }
  if (kind === 'market_position') {
    return {
      ...entry,
      activityType: 'market_position',
      title: String(entry?.marketQuestion || 'Market'),
      detail: `Position ${titleCaseWords(String(entry?.status || 'open'))}`
    };
  }
  if (kind === 'onchain_transfer') {
    const direction = titleCaseWords(String(entry?.direction || 'transfer'));
    const tokenSymbol = String(entry?.tokenSymbol || 'TOKEN');
    return {
      ...entry,
      activityType: 'onchain_transfer',
      title: direction,
      detail: `${String(entry?.amount || '0')} ${tokenSymbol}`
    };
  }
  return {
    ...entry,
    activityType: String(entry?.activityType || kind || 'activity'),
    title: String(entry?.title || titleCaseWords(kind || 'activity')),
    detail: String(entry?.detail || '')
  };
}

export function limitPlayerShellActivity(entries, limit = PLAYER_SHELL_ACTIVITY_LIMIT) {
  if (!Array.isArray(entries)) return [];
  return [...entries]
    .sort((left, right) => Number(right?.at ?? 0) - Number(left?.at ?? 0))
    .map((entry) => normalizeActivityEntry(entry))
    .slice(0, Math.max(1, limit));
}

function pickObject(value, fallback = null) {
  return value && typeof value === 'object' ? value : fallback;
}

function normalizeBot(bot, fallback = null) {
  const source = pickObject(bot, fallback);
  if (!source) return null;
  return {
    ...source,
    controlMode: String(source?.controlMode || source?.meta?.controlState || ''),
    actorClass: String(source?.actorClass || source?.meta?.botClass || ''),
    visibilityHint: String(source?.visibilityHint || source?.meta?.visibilityHint || '')
  };
}

function fallbackPlayerFromBootstrap(bootstrap) {
  const user = pickObject(bootstrap?.user, {});
  const profile = pickObject(bootstrap?.profile, {});
  const wallet = pickObject(profile?.wallet, {});
  return {
    id: String(profile?.id || user?.profileId || ''),
    displayName: String(profile?.displayName || user?.displayName || user?.name || 'Player'),
    username: String(profile?.username || user?.username || ''),
    walletId: String(wallet?.id || profile?.walletId || user?.walletId || ''),
    walletAddress: String(wallet?.address || user?.walletAddress || '')
  };
}

export function normalizePlayerShell(shell, fallback = {}) {
  const source = pickObject(shell, {});
  const activitySource = Array.isArray(source?.activityPreview)
    ? source.activityPreview
    : Array.isArray(source?.activity)
      ? source.activity
      : fallback?.activityPreview;
  return {
    player: pickObject(source?.player, pickObject(fallback?.player, null)),
    walletSummary: pickObject(source?.walletSummary, pickObject(fallback?.walletSummary, null)),
    funding: pickObject(source?.funding, pickObject(fallback?.funding, null)),
    bot: normalizeBot(source?.bot, pickObject(fallback?.bot, null)),
    readiness: pickObject(source?.readiness, pickObject(fallback?.readiness, null)),
    activityPreview: limitPlayerShellActivity(activitySource, PLAYER_SHELL_ACTIVITY_LIMIT),
    loadedAt: Number.isFinite(Number(source?.loadedAt))
      ? Number(source.loadedAt)
      : Number.isFinite(Number(fallback?.loadedAt))
        ? Number(fallback.loadedAt)
        : Date.now()
  };
}

export function playerShellFromBootstrap(bootstrap, fallback = {}) {
  const shell = normalizePlayerShell(bootstrap?.playerShell, fallback);
  if (!shell.player) {
    shell.player = fallbackPlayerFromBootstrap(bootstrap);
  }
  return shell;
}

export function mergePlayerShell(base, patch = {}) {
  const baseline = normalizePlayerShell(base, {});
  const merged = {
    ...baseline,
    loadedAt: Number.isFinite(Number(patch?.loadedAt)) ? Number(patch.loadedAt) : baseline.loadedAt
  };
  if (Object.prototype.hasOwnProperty.call(patch, 'player')) {
    merged.player = pickObject(patch.player, baseline.player);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'walletSummary')) {
    merged.walletSummary = pickObject(patch.walletSummary, baseline.walletSummary);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'funding')) {
    merged.funding = pickObject(patch.funding, baseline.funding);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'bot')) {
    merged.bot = normalizeBot(patch.bot, baseline.bot);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'readiness')) {
    merged.readiness = pickObject(patch.readiness, baseline.readiness);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'activityPreview') || Object.prototype.hasOwnProperty.call(patch, 'activity')) {
    merged.activityPreview = limitPlayerShellActivity(
      Array.isArray(patch?.activityPreview) ? patch.activityPreview : patch?.activity,
      PLAYER_SHELL_ACTIVITY_LIMIT
    );
  }
  return merged;
}

export function shouldRefreshPlayerShell(lastLoadedAt, now = Date.now(), ttlMs = PLAYER_SHELL_TTL_MS) {
  const loadedAt = Number(lastLoadedAt);
  if (!Number.isFinite(loadedAt) || loadedAt <= 0) {
    return true;
  }
  return (Number(now) - loadedAt) >= ttlMs;
}
