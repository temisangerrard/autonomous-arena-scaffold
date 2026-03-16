export const PLAYER_SHELL_TTL_MS = 30_000;
export const PLAYER_SHELL_ACTIVITY_LIMIT = 5;

export function limitPlayerShellActivity(entries, limit = PLAYER_SHELL_ACTIVITY_LIMIT) {
  if (!Array.isArray(entries)) return [];
  return [...entries]
    .sort((left, right) => Number(right?.at ?? 0) - Number(left?.at ?? 0))
    .slice(0, Math.max(1, limit));
}

function pickObject(value, fallback = null) {
  return value && typeof value === 'object' ? value : fallback;
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
    bot: pickObject(source?.bot, pickObject(fallback?.bot, null)),
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
    merged.bot = pickObject(patch.bot, baseline.bot);
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
