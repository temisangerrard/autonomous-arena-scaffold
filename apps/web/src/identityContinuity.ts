export type ContinuityLink = {
  profileId: string;
  walletId: string;
  linkedAt: number;
  updatedAt: number;
  continuitySource: string;
};

export type EmailIdentityCandidate = {
  sub: string;
  profileId: string | null;
  walletId: string | null;
  username?: string | null;
  displayName?: string | null;
  lastLoginAt?: number | null;
};

export async function findMatchingContinuityLink(
  subjects: string[],
  lookup: (subject: string) => Promise<ContinuityLink | null>
): Promise<{
  link: ContinuityLink | null;
  matchedSubject: string | null;
  hadLookupFailure: boolean;
}> {
  const ordered = [...new Set(subjects.map((entry) => String(entry || '').trim()).filter(Boolean))];
  let hadLookupFailure = false;

  for (const subject of ordered) {
    try {
      const link = await lookup(subject);
      if (link?.profileId && link?.walletId) {
        return {
          link,
          matchedSubject: subject,
          hadLookupFailure
        };
      }
    } catch {
      hadLookupFailure = true;
    }
  }

  return {
    link: null,
    matchedSubject: null,
    hadLookupFailure
  };
}

export function preferEmailIdentityOverContinuity(input: {
  continuity: ContinuityLink | null;
  emailIdentities: EmailIdentityCandidate[];
}): {
  profileId: string;
  walletId: string;
  username?: string | null;
  displayName?: string | null;
  source: 'continuity' | 'email';
} | null {
  const reusable = [...input.emailIdentities]
    .filter((entry) => entry.profileId && entry.walletId)
    .sort((a, b) => Number(b.lastLoginAt || 0) - Number(a.lastLoginAt || 0))[0] || null;

  if (!input.continuity && !reusable) {
    return null;
  }
  if (!input.continuity && reusable?.profileId && reusable?.walletId) {
    return {
      profileId: reusable.profileId,
      walletId: reusable.walletId,
      username: reusable.username ?? null,
      displayName: reusable.displayName ?? null,
      source: 'email'
    };
  }
  if (!input.continuity) {
    return null;
  }
  if (!reusable?.profileId || !reusable?.walletId) {
    return {
      profileId: input.continuity.profileId,
      walletId: input.continuity.walletId,
      source: 'continuity'
    };
  }

  const sameAsContinuity =
    reusable.profileId === input.continuity.profileId && reusable.walletId === input.continuity.walletId;
  if (sameAsContinuity) {
    return {
      profileId: input.continuity.profileId,
      walletId: input.continuity.walletId,
      username: reusable.username ?? null,
      displayName: reusable.displayName ?? null,
      source: 'continuity'
    };
  }

  if (Number(reusable.lastLoginAt || 0) > Number(input.continuity.updatedAt || 0)) {
    return {
      profileId: reusable.profileId,
      walletId: reusable.walletId,
      username: reusable.username ?? null,
      displayName: reusable.displayName ?? null,
      source: 'email'
    };
  }

  return {
    profileId: input.continuity.profileId,
    walletId: input.continuity.walletId,
    source: 'continuity'
  };
}
