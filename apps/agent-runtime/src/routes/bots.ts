/**
 * Bot route handlers
 * Extracted from index.ts for better modularity
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { readJsonBody, sendJson } from '../lib/http.js';
import type { BotRecord } from '@arena/shared';
import type { AgentBot, AgentBehaviorConfig } from '../AgentBot.js';

interface BotManagerDeps {
  bots: Map<string, AgentBot>;
  botRegistry: Map<string, BotRecord>;
  reconcileBots: (count: number) => void;
}

export function createBotsRouter(deps: BotManagerDeps) {
  const router = {
    /**
     * GET /agents/reconcile - Reconcile bot count
     */
    async handleReconcile(req: IncomingMessage, res: ServerResponse) {
      const body = await readJsonBody<{ count?: number }>(req);
      const count = Math.max(0, Math.min(60, Number(body?.count ?? deps.botRegistry.size)));
      
      deps.reconcileBots(count);
      
      sendJson(res, { 
        ok: true, 
        configuredBackgroundBotCount: [...deps.botRegistry.values()].filter(r => r.managedBySuperAgent && !r.ownerProfileId).length,
        configuredBotCount: deps.bots.size 
      });
    },

    /**
     * POST /agents/:id/config - Update bot configuration
     */
    async handleConfig(req: IncomingMessage, res: ServerResponse, params: Record<string, string>) {
      const id = params.id;
      
      if (!id) {
        sendJson(res, { ok: false, reason: 'bot_not_found' }, 404);
        return;
      }
      
      const bot = deps.bots.get(id);
      if (!bot) {
        sendJson(res, { ok: false, reason: 'bot_not_found' }, 404);
        return;
      }

      const body = await readJsonBody<Partial<AgentBehaviorConfig> & { displayName?: string; managedBySuperAgent?: boolean }>(req);
      if (!body) {
        sendJson(res, { ok: false, reason: 'invalid_json' }, 400);
        return;
      }

      const patch: Partial<AgentBehaviorConfig> = {};
      
      if (body.personality === 'aggressive' || body.personality === 'social' || body.personality === 'conservative') {
        patch.personality = body.personality;
      }
      if (body.mode === 'active' || body.mode === 'passive') {
        patch.mode = body.mode;
      }
      if (typeof body.challengeEnabled === 'boolean') {
        patch.challengeEnabled = body.challengeEnabled;
      }
      if (body.targetPreference === 'any' || body.targetPreference === 'human_only' || body.targetPreference === 'human_first') {
        patch.targetPreference = body.targetPreference;
      }
      if (typeof body.challengeCooldownMs === 'number') {
        patch.challengeCooldownMs = Math.max(1200, Math.min(120000, body.challengeCooldownMs));
      }
      if (typeof body.baseWager === 'number') {
        patch.baseWager = Math.max(1, Math.min(50, Math.floor(body.baseWager)));
      }
      if (typeof body.maxWager === 'number') {
        patch.maxWager = Math.max(1, Math.min(100, Math.floor(body.maxWager)));
      }
      if (typeof patch.baseWager === 'number' && typeof patch.maxWager === 'number' && patch.maxWager < patch.baseWager) {
        patch.maxWager = patch.baseWager;
      } else if (typeof patch.baseWager === 'number' && typeof patch.maxWager !== 'number') {
        const currentMax = bot.getStatus().behavior.maxWager;
        if (currentMax < patch.baseWager) {
          patch.maxWager = patch.baseWager;
        }
      }

      bot.updateBehavior(patch);

      const record = deps.botRegistry.get(id);
      if (record) {
        if (typeof body.displayName === 'string' && body.displayName.trim().length > 0) {
          record.displayName = body.displayName.trim();
          bot.updateDisplayName(record.displayName);
        }
        if (typeof body.managedBySuperAgent === 'boolean') {
          record.managedBySuperAgent = body.managedBySuperAgent;
        }
      }

      sendJson(res, { ok: true, bot: bot.getStatus(), meta: record });
    },

    /**
     * GET /bots/:id/wallet - Get bot's wallet
     */
    handleBotWallet(req: IncomingMessage, res: ServerResponse, params: Record<string, string>) {
      const botId = params.id;
      const record = botId ? deps.botRegistry.get(botId) : null;
      
      if (!record || !record.walletId) {
        sendJson(res, { ok: false, reason: 'bot_wallet_not_found' }, 404);
        return;
      }

      // Wallet data is accessed through index.ts - return placeholder
      sendJson(res, {
        ok: true,
        botId,
        walletId: record.walletId
      });
    }
  };

  return router;
}
