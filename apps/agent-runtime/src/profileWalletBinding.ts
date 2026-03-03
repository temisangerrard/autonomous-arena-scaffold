import type { BotRecord, Profile, WalletRecord } from '@arena/shared';
import type { SubjectLinkRecord } from './RuntimeDatabase.js';

export function rebindProfileWallet(params: {
  profileId: string;
  walletId: string;
  profiles: Map<string, Profile>;
  wallets: Map<string, WalletRecord>;
  subjectLinks: Map<string, SubjectLinkRecord>;
  botRegistry: Map<string, BotRecord>;
  subjects?: string[];
}): { ok: true; profileId: string; walletId: string; swappedProfileId: string | null } | { ok: false; reason: string } {
  const profile = params.profiles.get(params.profileId);
  if (!profile) {
    return { ok: false, reason: 'profile_not_found' };
  }
  const nextWallet = params.wallets.get(params.walletId);
  if (!nextWallet) {
    return { ok: false, reason: 'wallet_not_found' };
  }

  const currentWalletId = String(profile.walletId || '').trim();
  const currentWallet = currentWalletId ? params.wallets.get(currentWalletId) ?? null : null;
  const previousOwnerProfileId = String(nextWallet.ownerProfileId || '').trim();
  const previousOwnerProfile = previousOwnerProfileId ? params.profiles.get(previousOwnerProfileId) ?? null : null;

  profile.walletId = nextWallet.id;
  nextWallet.ownerProfileId = profile.id;

  if (previousOwnerProfile && previousOwnerProfile.id !== profile.id && currentWallet) {
    previousOwnerProfile.walletId = currentWallet.id;
    currentWallet.ownerProfileId = previousOwnerProfile.id;
  }

  if (currentWallet && (!previousOwnerProfile || previousOwnerProfile.id === profile.id)) {
    currentWallet.ownerProfileId = profile.id;
  }

  for (const bot of params.botRegistry.values()) {
    if (bot.ownerProfileId === profile.id) {
      bot.walletId = nextWallet.id;
      continue;
    }
    if (previousOwnerProfile && bot.ownerProfileId === previousOwnerProfile.id && currentWallet) {
      bot.walletId = currentWallet.id;
    }
  }

  const targetSubjects = new Set((params.subjects ?? []).map((entry) => String(entry || '').trim()).filter(Boolean));
  for (const [subject, link] of params.subjectLinks.entries()) {
    if (link.profileId === profile.id || targetSubjects.has(subject)) {
      link.profileId = profile.id;
      link.walletId = nextWallet.id;
      link.updatedAt = Date.now();
      params.subjectLinks.set(subject, link);
      continue;
    }
    if (previousOwnerProfile && previousOwnerProfile.id !== profile.id && link.profileId === previousOwnerProfile.id && currentWallet) {
      link.walletId = currentWallet.id;
      link.updatedAt = Date.now();
      params.subjectLinks.set(subject, link);
    }
  }

  return { ok: true, profileId: profile.id, walletId: nextWallet.id, swappedProfileId: previousOwnerProfile?.id ?? null };
}
