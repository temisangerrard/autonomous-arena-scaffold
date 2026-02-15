import { readJsonBody, sendJson, type SimpleRouter } from '../lib/http.js';
import type { BotRecord } from '@arena/shared';
import type { AgentBot, AgentBehaviorConfig } from '../AgentBot.js';

export function registerBotRoutes(router: SimpleRouter, deps: {
  bots: Map<string, AgentBot>;
  botRegistry: Map<string, BotRecord>;
  backgroundBotIds: Set<string>;
  usedDisplayNames: Set<string>;
  wallets: Map<string, import('@arena/shared').WalletRecord>;
  walletSummary: (wallet: import('@arena/shared').WalletRecord | null) => unknown;
  reconcileBots: (count: number) => void;
  schedulePersistState: () => void;
}) {
  router.post('/agents/reconcile', async (req, res) => {
    const body = await readJsonBody<{ count?: number }>(req);
    const count = Math.max(0, Math.min(60, Number(body?.count ?? deps.backgroundBotIds.size)));
    deps.reconcileBots(count);
    deps.schedulePersistState();
    sendJson(res, { ok: true, configuredBackgroundBotCount: deps.backgroundBotIds.size, configuredBotCount: deps.bots.size });
  });

  router.post('/agents/:botId/config', async (req, res, params) => {
    const id = String(params?.botId ?? '').trim();
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
        deps.usedDisplayNames.add(record.displayName);
        bot.updateDisplayName(record.displayName);
      }
      if (typeof body.managedBySuperAgent === 'boolean') {
        record.managedBySuperAgent = body.managedBySuperAgent;
      }
    }

    sendJson(res, { ok: true, bot: bot.getStatus(), meta: record });
    deps.schedulePersistState();
  });

  router.get('/bots/:botId/wallet', (_req, res, params) => {
    const botId = String(params?.botId ?? '').trim();
    const record = botId ? deps.botRegistry.get(botId) : null;
    if (!record || !record.walletId) {
      sendJson(res, { ok: false, reason: 'bot_wallet_not_found' }, 404);
      return;
    }
    const wallet = deps.wallets.get(record.walletId) ?? null;
    sendJson(res, { ok: true, botId, wallet: deps.walletSummary(wallet) });
  });
}
