import type { IdentityRecord } from './sessionStore.js';

export function rewriteEmailIdentityBindings(params: {
  identities: IdentityRecord[];
  profileId: string;
  walletId: string;
  username?: string | null;
  displayName?: string | null;
}): {
  updated: IdentityRecord[];
  conflictingProfileIds: string[];
} {
  const conflicting = new Set<string>();
  const updated = params.identities.map((identity) => {
    if (identity.profileId && identity.profileId !== params.profileId) {
      conflicting.add(identity.profileId);
    }
    return {
      ...identity,
      profileId: params.profileId,
      walletId: params.walletId,
      username: params.username ?? identity.username,
      displayName: params.displayName ?? identity.displayName
    };
  });
  return {
    updated,
    conflictingProfileIds: [...conflicting]
  };
}
