/**
 * Profile route handlers
 * Extracted from index.ts for better modularity
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { readJsonBody, sendJson } from '../lib/http.js';
import type { Profile, WalletRecord } from '@arena/shared';
import type { Personality } from '../PolicyEngine.js';
import type { AgentBehaviorConfig } from '../AgentBot.js';

interface ProfileManager {
  profiles: Map<string, Profile>;
  wallets: Map<string, WalletRecord>;
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
}

export function createProfilesRouter(profileManager: ProfileManager) {
  const router = {
    /**
     * GET /profiles - List all profiles
     */
    async handleList(req: IncomingMessage, res: ServerResponse) {
      const profiles = [...profileManager.profiles.values()].map((profile) => ({
        ...profile,
        wallet: profileManager.wallets.get(profile.walletId)
      }));
      sendJson(res, { profiles });
    },

    /**
     * POST /profiles/create - Create a new profile with bot
     */
    async handleCreate(req: IncomingMessage, res: ServerResponse) {
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

      const created = profileManager.createProfileWithBot({
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
    },

    /**
     * POST /profiles/provision - Provision profile from external subject
     */
    async handleProvision(req: IncomingMessage, res: ServerResponse) {
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

      const provisioned = profileManager.provisionProfileForSubject({
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
    },

    /**
     * POST /profiles/:id/update - Update profile
     */
    async handleUpdate(req: IncomingMessage, res: ServerResponse, params: Record<string, string>) {
      const profileId = params.id;
      const profile = profileId ? profileManager.profiles.get(profileId) : null;
      
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
        const taken = [...profileManager.profiles.values()].some(
          (item) => item.id !== profile.id && item.username.toLowerCase() === normalized
        );

        if (taken) {
          sendJson(res, { ok: false, reason: 'username_taken' }, 400);
          return;
        }

        profile.username = body.username.trim();
      }

      sendJson(res, { 
        ok: true, 
        profile: { 
          ...profile, 
          wallet: profileManager.wallets.get(profile.walletId) 
        } 
      });
    },

    /**
     * POST /profiles/:id/bots/create - Create bot for profile
     */
    async handleCreateBot(req: IncomingMessage, res: ServerResponse, params: Record<string, string>) {
      const profileId = params.id;
      const profile = profileId ? profileManager.profiles.get(profileId) : null;
      
      if (!profile) {
        sendJson(res, { ok: false, reason: 'profile_not_found' }, 404);
        return;
      }

      // Bot creation is handled in index.ts - this is a stub for the router pattern
      sendJson(res, { ok: false, reason: 'not_implemented' }, 501);
    }
  };

  return router;
}
