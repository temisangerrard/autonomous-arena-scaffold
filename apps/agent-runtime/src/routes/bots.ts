import { readJsonBody, sendJson, type SimpleRouter } from '../lib/http.js';
import type { BotRecord, AutoplayStrategyConfig, GameType } from '@arena/shared';
import type { AgentBot, AgentBehaviorConfig } from '../AgentBot.js';
import { computeWalletReadiness } from '../walletReadiness.js';

const VALID_GAME_TYPES: GameType[] = ['rps', 'coinflip', 'dice_duel'];

function parseAutoplayConfig(raw: unknown): AutoplayStrategyConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const ap = raw as Record<string, unknown>;

  const enabled = typeof ap.enabled === 'boolean' ? ap.enabled : true;
  const allowedGames: GameType[] = Array.isArray(ap.allowedGames)
    ? (ap.allowedGames as unknown[]).filter((g): g is GameType => VALID_GAME_TYPES.includes(g as GameType))
    : [...VALID_GAME_TYPES];
  if (allowedGames.length === 0) allowedGames.push('rps');

  const wagerMode = ap.wagerMode === 'percent_wallet' || ap.wagerMode === 'martingale' ? ap.wagerMode : 'fixed';
  const baseWager = Math.max(1, Math.min(50, Math.floor(Number(ap.baseWager ?? 1))));
  const maxWager = Math.max(baseWager, Math.min(100, Math.floor(Number(ap.maxWager ?? baseWager))));
  const walletPercent = typeof ap.walletPercent === 'number'
    ? Math.max(1, Math.min(100, ap.walletPercent))
    : undefined;
  const martingaleMultiplier = typeof ap.martingaleMultiplier === 'number'
    ? Math.max(1.1, Math.min(10, ap.martingaleMultiplier))
    : undefined;
  const sessionLossLimit = typeof ap.sessionLossLimit === 'number'
    ? Math.max(0, Math.min(1000000, ap.sessionLossLimit))
    : undefined;
  const sessionWinTarget = typeof ap.sessionWinTarget === 'number'
    ? Math.max(0, Math.min(1000000, ap.sessionWinTarget))
    : undefined;
  const cooldownMs = Math.max(0, Math.min(600000, Math.floor(Number(ap.cooldownMs ?? 2000))));

  return { enabled, allowedGames, wagerMode, baseWager, maxWager, walletPercent, martingaleMultiplier, sessionLossLimit, sessionWinTarget, cooldownMs };
}

export function registerBotRoutes(router: SimpleRouter, deps: {
  bots: Map<string, AgentBot>;
  botRegistry: Map<string, BotRecord>;
  backgroundBotIds: Set<string>;
  usedDisplayNames: Set<string>;
  wallets: Map<string, import('@arena/shared').WalletRecord>;
  walletSummary: (wallet: import('@arena/shared').WalletRecord | null) => unknown;
  reconcileBots: (count: number) => void;
  schedulePersistState: () => void;
  coinbasePaymasterEnabled?: boolean;
  coinbaseEscrowApprovalCapUsdc?: number;
  chainId?: number | null;
  chainHint?: string | null;
  mainnetGasSponsorEnabled?: boolean;
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

    const body = await readJsonBody<Partial<AgentBehaviorConfig> & { displayName?: string; managedBySuperAgent?: boolean; autoplayEnabled?: boolean; autoplay?: unknown; resetAutoplaySession?: boolean }>(req);
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
    if (typeof body.sessionLossLimit === 'number') {
      patch.sessionLossLimit = Math.max(0, Math.min(1000000, body.sessionLossLimit));
    }
    if (typeof body.sessionWinTarget === 'number') {
      patch.sessionWinTarget = Math.max(0, Math.min(1000000, body.sessionWinTarget));
    }
    if (typeof patch.baseWager === 'number' && typeof patch.maxWager === 'number' && patch.maxWager < patch.baseWager) {
      patch.maxWager = patch.baseWager;
    } else if (typeof patch.baseWager === 'number' && typeof patch.maxWager !== 'number') {
      const currentMax = bot.getStatus().behavior.maxWager;
      if (currentMax < patch.baseWager) {
        patch.maxWager = patch.baseWager;
      }
    }

    // Parse and attach autoplay strategy config if provided
    if ('autoplay' in body) {
      const parsedAutoplay = body.autoplay !== null ? parseAutoplayConfig(body.autoplay) : null;
      patch.autoplay = parsedAutoplay ?? undefined;
    }

    bot.updateBehavior(patch);

    // Reset autoplay session if explicitly requested
    if (body.resetAutoplaySession === true) {
      bot.resetAutoplaySession();
    }

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
      if (typeof body.autoplayEnabled === 'boolean') {
        record.autoplayEnabled = body.autoplayEnabled;
        if (!record.autoplayEnabled) {
          bot.updateBehavior({
            mode: 'passive',
            challengeEnabled: false,
            targetPreference: 'human_only'
          });
        }
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
    const bot = deps.bots.get(botId);
    const behavior = bot?.getStatus().behavior;
    const minWager = behavior?.autoplay?.baseWager ?? behavior?.baseWager ?? 1;
    const readiness = computeWalletReadiness({
      wallet,
      minWager,
      coinbasePaymasterEnabled: deps.coinbasePaymasterEnabled,
      coinbaseEscrowApprovalCapUsdc: deps.coinbaseEscrowApprovalCapUsdc,
      chainId: deps.chainId,
      chainHint: deps.chainHint,
      mainnetGasSponsorEnabled: deps.mainnetGasSponsorEnabled
    });
    sendJson(res, { ok: true, botId, wallet: deps.walletSummary(wallet), readiness });
  });
}
