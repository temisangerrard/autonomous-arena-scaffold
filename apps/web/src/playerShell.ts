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

function formatUsd(value: unknown): string {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 'US$0.00';
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(amount);
}

function titleCaseWords(value: string): string {
  return value
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function describeOpponentClass(value: unknown): string {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'owner_bot' || normalized === 'player_bot') return 'Player Bot';
  if (normalized === 'background_bot' || normalized === 'house_bot') return 'House Bot';
  if (normalized === 'house' || normalized === 'house_dealer') return 'House Dealer';
  if (normalized === 'human' || normalized === 'player') return 'Player';
  return 'Arena';
}

function describeMatchOutcome(entry: Record<string, any>): string {
  const outcome = String(entry?.outcome || entry?.status || entry?.phase || '').trim().toLowerCase();
  if (!outcome) return 'Updated';
  if (outcome === 'resolved' && entry?.winnerId) {
    return 'Resolved';
  }
  return titleCaseWords(outcome);
}

function normalizeActivityEntry(entry: Record<string, any>): Record<string, any> {
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
    const question = String(entry?.marketQuestion || 'Market');
    return {
      ...entry,
      activityType: 'market_position',
      title: question,
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

function limitActivity(
  entries: Array<Record<string, any>> | null | undefined,
  limit = PLAYER_SHELL_ACTIVITY_PREVIEW_LIMIT
): Array<Record<string, any>> {
  if (!Array.isArray(entries)) return [];
  return [...entries]
    .sort((left, right) => Number(right?.at ?? 0) - Number(left?.at ?? 0))
    .map((entry) => normalizeActivityEntry(entry))
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
    bot: input?.bot && typeof input.bot === 'object'
      ? {
          ...input.bot,
          controlMode: String(input.bot?.controlMode || input.bot?.meta?.controlState || ''),
          actorClass: String(input.bot?.actorClass || input.bot?.meta?.botClass || ''),
          visibilityHint: String(input.bot?.visibilityHint || input.bot?.meta?.visibilityHint || '')
        }
      : null,
    readiness: input?.readiness && typeof input.readiness === 'object' ? input.readiness : null,
    activityPreview: limitActivity(input?.activity, PLAYER_SHELL_ACTIVITY_PREVIEW_LIMIT),
    loadedAt: Number.isFinite(Number(input?.loadedAt)) ? Number(input.loadedAt) : Date.now()
  };
}
