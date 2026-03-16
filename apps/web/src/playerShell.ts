export const PLAYER_SHELL_ACTIVITY_PREVIEW_LIMIT = 5;

export type PlayerShellInput = {
  user?: {
    profileId?: string;
    walletId?: string;
  } | null;
  profile?: {
    id?: string;
    displayName?: string;
    username?: string;
    walletId?: string;
    wallet?: {
      id?: string;
      address?: string;
    } | null;
  } | null;
  walletSummary?: Record<string, any> | null;
  funding?: Record<string, any> | null;
  bot?: Record<string, any> | null;
  readiness?: Record<string, any> | null;
  activity?: Array<Record<string, any>> | null;
  loadedAt?: number;
};

function limitActivity(entries: Array<Record<string, any>> | null | undefined, limit = PLAYER_SHELL_ACTIVITY_PREVIEW_LIMIT) {
  if (!Array.isArray(entries)) return [];
  return [...entries]
    .sort((left, right) => Number(right?.at ?? 0) - Number(left?.at ?? 0))
    .slice(0, Math.max(1, limit));
}

export function buildPlayerShell(input: PlayerShellInput) {
  const user = input?.user && typeof input.user === 'object' ? input.user : {};
  const profile = input?.profile && typeof input.profile === 'object' ? input.profile : {};
  const wallet = profile?.wallet && typeof profile.wallet === 'object' ? profile.wallet : {};
  const walletSummary = input?.walletSummary && typeof input.walletSummary === 'object' ? input.walletSummary : null;
  const funding = input?.funding && typeof input.funding === 'object' ? input.funding : null;
  return {
    player: {
      id: String(profile?.id || user?.profileId || ''),
      displayName: String(profile?.displayName || 'Player'),
      username: String(profile?.username || ''),
      walletId: String(wallet?.id || profile?.walletId || user?.walletId || ''),
      walletAddress: String(wallet?.address || walletSummary?.onchain?.address || walletSummary?.wallet?.address || '')
    },
    walletSummary,
    funding,
    bot: input?.bot && typeof input.bot === 'object' ? input.bot : null,
    readiness: input?.readiness && typeof input.readiness === 'object' ? input.readiness : null,
    activityPreview: limitActivity(input?.activity, PLAYER_SHELL_ACTIVITY_PREVIEW_LIMIT),
    loadedAt: Number.isFinite(Number(input?.loadedAt)) ? Number(input.loadedAt) : Date.now()
  };
}
