import { readJsonBody, sendJson, type SimpleRouter } from '../lib/http.js';
import type { BotRecord, Profile, WalletRecord } from '@arena/shared';
import type { Personality } from '../PolicyEngine.js';
import type { AgentBehaviorConfig } from '../AgentBot.js';

export function registerProfileRoutes(router: SimpleRouter, deps: {
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
  schedulePersistState: () => void;
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
}

