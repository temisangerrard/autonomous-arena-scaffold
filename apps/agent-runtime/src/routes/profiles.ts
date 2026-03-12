import { readJsonBody, sendJson, type SimpleRouter } from '../lib/http.js';
import type { BotRecord, Profile, WalletRecord } from '@arena/shared';
import type { Personality } from '../PolicyEngine.js';
import type { AgentBehaviorConfig } from '../AgentBot.js';
import { rebindProfileWallet } from '../profileWalletBinding.js';

export function registerProfileRoutes(router: SimpleRouter, deps: {
  isInternalAuthorized: (req: import('node:http').IncomingMessage) => boolean;
  profiles: Map<string, Profile>;
  wallets: Map<string, WalletRecord>;
  bots: Map<string, unknown>;
  botRegistry: Map<string, BotRecord>;
  walletSummary: (wallet: WalletRecord | null) => unknown;
  publicProfiles: () => unknown;
  createProfileWithBot: (params: {
    username: string;
    displayName?: string;
    personality?: Personality;
    targetPreference?: AgentBehaviorConfig['targetPreference'];
  }) => { ok: true; profile: Profile; wallet: unknown; botId: string } | { ok: false; reason: string };
  provisionProfileForSubject: (params: {
    externalSubject: string;
    email?: string;
    displayName?: string;
    personality?: Personality;
    targetPreference?: AgentBehaviorConfig['targetPreference'];
  }) => { ok: true; created: boolean; profile: Profile; wallet: unknown; botId: string | null } | { ok: false; reason: string };
  createOwnerBotForProfile: (profile: Profile, body: {
    displayName?: string;
    personality?: Personality;
    targetPreference?: AgentBehaviorConfig['targetPreference'];
    mode?: AgentBehaviorConfig['mode'];
    baseWager?: number;
    maxWager?: number;
    managedBySuperAgent?: boolean;
  }) => { ok: true; botId: string } | { ok: false; reason: string; botId?: string; profileId?: string };
  getProfileOnboardingState: (profileId: string) => { completed: boolean; completedAt: number | null };
  markProfileOnboardingCompleted: (profileId: string, completedAt?: number) => { completed: boolean; completedAt: number | null };
  getSubjectLinkBySubject: (subject: string) => {
    subject: string;
    profileId: string;
    walletId: string;
    linkedAt: number;
    updatedAt: number;
    continuitySource: 'postgres' | 'runtime-file' | 'memory';
  } | null;
  upsertSubjectLinkBySubject: (params: {
    subject: string;
    profileId: string;
    walletId?: string;
  }) => {
    subject: string;
    profileId: string;
    walletId: string;
    linkedAt: number;
    updatedAt: number;
    continuitySource: 'postgres' | 'runtime-file' | 'memory';
  } | null;
  schedulePersistState: () => void;
  subjectLinks: Map<string, {
    subject: string;
    profileId: string;
    walletId: string;
    linkedAt: number;
    updatedAt: number;
    continuitySource: 'postgres' | 'runtime-file' | 'memory';
  }>;
}) {
  router.get('/profiles', (_req, res) => {
    // keep existing response shape from index.ts
    sendJson(res, { profiles: deps.publicProfiles() });
  });

  router.post('/profiles/create', async (req, res) => {
    const body = await readJsonBody<{
      username?: string;
      displayName?: string;
      personality?: Personality;
      targetPreference?: AgentBehaviorConfig['targetPreference'];
    }>(req);

    if (!body?.username || typeof body.username !== 'string') {
      sendJson(res, { ok: false, reason: 'username_required' }, 400);
      return;
    }

    const created = deps.createProfileWithBot({
      username: body.username,
      displayName: body.displayName,
      personality: body.personality,
      targetPreference: body.targetPreference
    });

    if (!created.ok) {
      sendJson(res, created, 400);
      return;
    }

    sendJson(res, created);
    deps.schedulePersistState();
  });

  router.post('/profiles/provision', async (req, res) => {
    const body = await readJsonBody<{
      externalSubject?: string;
      email?: string;
      displayName?: string;
      personality?: Personality;
      targetPreference?: AgentBehaviorConfig['targetPreference'];
    }>(req);

    if (!body?.externalSubject || typeof body.externalSubject !== 'string') {
      sendJson(res, { ok: false, reason: 'external_subject_required' }, 400);
      return;
    }

    const provisioned = deps.provisionProfileForSubject({
      externalSubject: body.externalSubject,
      email: body.email,
      displayName: body.displayName,
      personality: body.personality,
      targetPreference: body.targetPreference
    });

    if (!provisioned.ok) {
      sendJson(res, provisioned, 400);
      return;
    }

    sendJson(res, provisioned);
    deps.schedulePersistState();
  });

  router.get('/profiles/link', (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const subject = String(url.searchParams.get('subject') ?? '').trim();
    if (!subject) {
      sendJson(res, { ok: false, reason: 'subject_required' }, 400);
      return;
    }
    const link = deps.getSubjectLinkBySubject(subject);
    if (!link) {
      sendJson(res, { ok: false, reason: 'subject_link_not_found' }, 404);
      return;
    }
    sendJson(res, { ok: true, link });
  });

  router.post('/profiles/link', async (req, res) => {
    if (!deps.isInternalAuthorized(req)) {
      sendJson(res, { ok: false, reason: 'unauthorized_internal' }, 401);
      return;
    }
    const body = await readJsonBody<{ subject?: string; profileId?: string; walletId?: string }>(req);
    const subject = String(body?.subject ?? '').trim();
    const profileId = String(body?.profileId ?? '').trim();
    const walletId = String(body?.walletId ?? '').trim();
    if (!subject || !profileId) {
      sendJson(res, { ok: false, reason: 'subject_and_profile_required' }, 400);
      return;
    }
    const link = deps.upsertSubjectLinkBySubject({
      subject,
      profileId,
      walletId: walletId || undefined
    });
    if (!link) {
      sendJson(res, { ok: false, reason: 'profile_or_wallet_not_found' }, 404);
      return;
    }
    sendJson(res, { ok: true, link });
    deps.schedulePersistState();
  });

  router.post('/profiles/:profileId/update', async (req, res, params) => {
    const profileId = String(params?.profileId ?? '').trim();
    const profile = profileId ? deps.profiles.get(profileId) : null;
    if (!profile) {
      sendJson(res, { ok: false, reason: 'profile_not_found' }, 404);
      return;
    }

    const body = await readJsonBody<{ displayName?: string; username?: string }>(req);
    if (!body) {
      sendJson(res, { ok: false, reason: 'invalid_json' }, 400);
      return;
    }

    if (typeof body.displayName === 'string' && body.displayName.trim().length > 0) {
      profile.displayName = body.displayName.trim();
    }

    if (typeof body.username === 'string' && body.username.trim().length > 1) {
      const normalized = body.username.toLowerCase();
      const taken = [...deps.profiles.values()].some(
        (item) => item.id !== profile.id && item.username.toLowerCase() === normalized
      );

      if (taken) {
        sendJson(res, { ok: false, reason: 'username_taken' }, 400);
        return;
      }

      profile.username = body.username.trim();
    }

    sendJson(res, { ok: true, profile: { ...profile, wallet: deps.walletSummary(deps.wallets.get(profile.walletId) ?? null) } });
    deps.schedulePersistState();
  });

  router.post('/profiles/:profileId/wallet/rebind', async (req, res, params) => {
    if (!deps.isInternalAuthorized(req)) {
      sendJson(res, { ok: false, reason: 'unauthorized_internal' }, 401);
      return;
    }

    const profileId = String(params?.profileId ?? '').trim();
    const profile = profileId ? deps.profiles.get(profileId) : null;
    if (!profile) {
      sendJson(res, { ok: false, reason: 'profile_not_found' }, 404);
      return;
    }

    const body = await readJsonBody<{ walletId?: string; walletAddress?: string; subjects?: string[] }>(req);
    const walletId = String(body?.walletId ?? '').trim();
    const walletAddress = String(body?.walletAddress ?? '').trim().toLowerCase();
    const targetWallet = walletId
      ? deps.wallets.get(walletId) ?? null
      : [...deps.wallets.values()].find((entry) => entry.address.toLowerCase() === walletAddress) ?? null;
    if (!targetWallet) {
      sendJson(res, { ok: false, reason: 'wallet_not_found' }, 404);
      return;
    }

    const result = rebindProfileWallet({
      profileId: profile.id,
      walletId: targetWallet.id,
      profiles: deps.profiles,
      wallets: deps.wallets,
      subjectLinks: deps.subjectLinks,
      botRegistry: deps.botRegistry,
      subjects: Array.isArray(body?.subjects) ? body.subjects : []
    });
    if (!result.ok) {
      sendJson(res, result, result.reason === 'profile_not_found' || result.reason === 'wallet_not_found' ? 404 : 400);
      return;
    }

    sendJson(res, {
      ok: true,
      profile: {
        ...profile,
        wallet: deps.walletSummary(deps.wallets.get(profile.walletId) ?? null)
      },
      swappedProfileId: result.swappedProfileId
    });
    deps.schedulePersistState();
  });

  router.post('/profiles/:profileId/wallet/provider-link', async (req, res, params) => {
    if (!deps.isInternalAuthorized(req)) {
      sendJson(res, { ok: false, reason: 'unauthorized_internal' }, 401);
      return;
    }
    const profileId = String(params?.profileId ?? '').trim();
    const profile = profileId ? deps.profiles.get(profileId) : null;
    if (!profile) {
      sendJson(res, { ok: false, reason: 'profile_not_found' }, 404);
      return;
    }
    const wallet = deps.wallets.get(profile.walletId) ?? null;
    if (!wallet) {
      sendJson(res, { ok: false, reason: 'wallet_not_found' }, 404);
      return;
    }

    const body = await readJsonBody<{
      provider?: 'internal' | 'coinbase_embedded';
      externalWalletAddress?: string;
      externalWalletRef?: string;
      linkedAt?: number;
    }>(req);
    const provider = body?.provider === 'coinbase_embedded' ? 'coinbase_embedded' : 'internal';
    const externalWalletAddress = String(body?.externalWalletAddress ?? '').trim();
    const externalWalletRef = String(body?.externalWalletRef ?? '').trim();
    const linkedAt = Number(body?.linkedAt || Date.now()) || Date.now();

    wallet.walletProvider = provider;
    wallet.externalWalletAddress = provider === 'coinbase_embedded'
      ? (externalWalletAddress || wallet.externalWalletAddress || wallet.address)
      : null;
    wallet.externalWalletRef = provider === 'coinbase_embedded' ? (externalWalletRef || null) : null;
    wallet.externalWalletLinkedAt = provider === 'coinbase_embedded' ? linkedAt : null;
    if (provider === 'coinbase_embedded') {
      wallet.encryptedPrivateKey = null;
      if (wallet.externalWalletAddress) {
        wallet.address = wallet.externalWalletAddress;
      }
    }

    sendJson(res, {
      ok: true,
      profile: {
        ...profile,
        wallet: deps.walletSummary(wallet)
      }
    });
    deps.schedulePersistState();
  });

  router.post('/profiles/:profileId/bots/create', async (req, res, params) => {
    const profileId = String(params?.profileId ?? '').trim();
    const profile = profileId ? deps.profiles.get(profileId) : null;
    if (!profile) {
      sendJson(res, { ok: false, reason: 'profile_not_found' }, 404);
      return;
    }

    if (profile.ownedBotIds.length >= 1) {
      sendJson(res, { ok: false, reason: 'bot_already_exists', botId: profile.ownedBotIds[0], profileId: profile.id }, 409);
      return;
    }

    const body = await readJsonBody<{
      displayName?: string;
      personality?: Personality;
      targetPreference?: AgentBehaviorConfig['targetPreference'];
      mode?: AgentBehaviorConfig['mode'];
      baseWager?: number;
      maxWager?: number;
      managedBySuperAgent?: boolean;
    }>(req);

    const result = deps.createOwnerBotForProfile(profile, body ?? {});
    if (!result.ok) {
      sendJson(res, result, result.reason === 'profile_not_found' ? 404 : 400);
      return;
    }

    sendJson(res, { ok: true, botId: result.botId, profileId: profile.id });
    deps.schedulePersistState();
  });

  router.get('/profiles/:profileId/onboarding', (req, res, params) => {
    const profileId = String(params?.profileId ?? '').trim();
    const profile = profileId ? deps.profiles.get(profileId) : null;
    if (!profile) {
      sendJson(res, { ok: false, reason: 'profile_not_found' }, 404);
      return;
    }
    const state = deps.getProfileOnboardingState(profile.id);
    sendJson(res, { ok: true, profileId: profile.id, ...state });
  });

  router.post('/profiles/:profileId/onboarding/complete', async (req, res, params) => {
    const profileId = String(params?.profileId ?? '').trim();
    const profile = profileId ? deps.profiles.get(profileId) : null;
    if (!profile) {
      sendJson(res, { ok: false, reason: 'profile_not_found' }, 404);
      return;
    }
    const body = await readJsonBody<{ completedAt?: number }>(req);
    const completedAt = Number(body?.completedAt || 0) || Date.now();
    const state = deps.markProfileOnboardingCompleted(profile.id, completedAt);
    sendJson(res, { ok: true, profileId: profile.id, ...state });
  });
}
