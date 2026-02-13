import { createServer } from 'node:http';
import {
  AgentBot,
  type AgentBehaviorConfig,
  type AgentBotStatus
} from './AgentBot.js';
import { createHealthStatus } from './health.js';
import {
  buildWorkerDirectives,
  createDefaultSuperAgentConfig,
  type LlmPolicy,
  type SuperAgentConfig,
  type WalletPolicy
} from './SuperAgent.js';
import type { Personality } from './PolicyEngine.js';

const port = Number(process.env.PORT ?? 4100);
const wsBaseUrl = process.env.GAME_WS_URL ?? 'ws://localhost:4000/ws';
const personalities: Personality[] = ['aggressive', 'conservative', 'social'];

const superAgentConfig: SuperAgentConfig = createDefaultSuperAgentConfig(
  process.env.GRAND_AGENT_ID ?? 'agent_1'
);

if (process.env.OPENROUTER_API_KEY) {
  superAgentConfig.llmPolicy.enabled = true;
}

if (process.env.WALLET_SKILLS_ENABLED === 'true') {
  superAgentConfig.walletPolicy.enabled = true;
}

const runtimeSecrets = {
  openRouterApiKey: process.env.OPENROUTER_API_KEY ?? ''
};

const bots = new Map<string, AgentBot>();

function makeBehaviorForIndex(index: number): AgentBehaviorConfig {
  return {
    personality: personalities[index % personalities.length] ?? 'social',
    challengeEnabled: superAgentConfig.challengeEnabled,
    challengeCooldownMs: superAgentConfig.defaultChallengeCooldownMs,
    targetPreference: superAgentConfig.workerTargetPreference
  };
}

function createBot(id: string, behavior: AgentBehaviorConfig): AgentBot {
  const bot = new AgentBot({
    id,
    wsBaseUrl,
    behavior
  });
  bot.start();
  return bot;
}

function ensureSuperAgentExists(): void {
  if (bots.has(superAgentConfig.id)) {
    return;
  }

  bots.set(
    superAgentConfig.id,
    createBot(superAgentConfig.id, {
      personality: 'aggressive',
      challengeEnabled: true,
      challengeCooldownMs: Math.max(1400, Math.floor(superAgentConfig.defaultChallengeCooldownMs * 0.5)),
      targetPreference: 'any'
    })
  );
}

function applySuperAgentDelegation(): void {
  const directives = buildWorkerDirectives(superAgentConfig, [...bots.keys()]);
  for (const directive of directives) {
    bots.get(directive.botId)?.updateBehavior(directive.patch);
  }

  bots.get(superAgentConfig.id)?.updateBehavior({
    personality: 'aggressive',
    challengeEnabled: true,
    challengeCooldownMs: Math.max(1400, Math.floor(superAgentConfig.defaultChallengeCooldownMs * 0.5)),
    targetPreference: 'any'
  });
}

function reconcileBots(targetCount: number): void {
  const bounded = Math.max(1, Math.min(60, targetCount));
  const ids = [...bots.keys()].sort();

  if (ids.length < bounded) {
    for (let i = ids.length; i < bounded; i += 1) {
      const id = `agent_${i + 1}`;
      const behavior = makeBehaviorForIndex(i);
      bots.set(id, createBot(id, behavior));
    }
  }

  if (ids.length > bounded) {
    for (let i = bounded; i < ids.length; i += 1) {
      const id = ids[i];
      if (!id) {
        continue;
      }
      if (id === superAgentConfig.id) {
        continue;
      }
      bots.get(id)?.stop();
      bots.delete(id);
    }
  }

  ensureSuperAgentExists();
  applySuperAgentDelegation();
}

function setCorsHeaders(res: import('node:http').ServerResponse): void {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type');
}

async function readJsonBody<T>(req: import('node:http').IncomingMessage): Promise<T | null> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }

  if (chunks.length === 0) {
    return null;
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T;
  } catch {
    return null;
  }
}

function sendJson(res: import('node:http').ServerResponse, payload: unknown, statusCode = 200): void {
  res.statusCode = statusCode;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(payload));
}

function botStatuses(): AgentBotStatus[] {
  return [...bots.values()].map((bot) => bot.getStatus());
}

function runtimeStatus() {
  const statuses = botStatuses();
  return {
    configuredBotCount: statuses.length,
    connectedBotCount: statuses.filter((bot) => bot.connected).length,
    wsBaseUrl,
    openRouterConfigured: Boolean(runtimeSecrets.openRouterApiKey),
    superAgent: {
      id: superAgentConfig.id,
      mode: superAgentConfig.mode,
      challengeEnabled: superAgentConfig.challengeEnabled,
      defaultChallengeCooldownMs: superAgentConfig.defaultChallengeCooldownMs,
      workerTargetPreference: superAgentConfig.workerTargetPreference,
      llmPolicy: superAgentConfig.llmPolicy,
      walletPolicy: superAgentConfig.walletPolicy
    },
    bots: statuses
  };
}

type SuperAgentPatch = Partial<{
  id: string;
  mode: SuperAgentConfig['mode'];
  challengeEnabled: boolean;
  defaultChallengeCooldownMs: number;
  workerTargetPreference: SuperAgentConfig['workerTargetPreference'];
  llmPolicy: Partial<LlmPolicy>;
  walletPolicy: Partial<WalletPolicy>;
}>;

reconcileBots(Number(process.env.BOT_COUNT ?? 8));

const server = createServer(async (req, res) => {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  const url = new URL(req.url ?? '/', 'http://localhost');

  if (url.pathname === '/health') {
    sendJson(res, createHealthStatus());
    return;
  }

  if (url.pathname === '/status') {
    sendJson(res, runtimeStatus());
    return;
  }

  if (url.pathname === '/super-agent/status') {
    sendJson(res, runtimeStatus().superAgent);
    return;
  }

  if (url.pathname === '/super-agent/config' && req.method === 'POST') {
    const body = await readJsonBody<SuperAgentPatch>(req);
    if (!body) {
      sendJson(res, { ok: false, reason: 'invalid_json' }, 400);
      return;
    }

    if (typeof body.id === 'string' && body.id.trim().length > 0) {
      superAgentConfig.id = body.id.trim();
    }
    if (body.mode) {
      superAgentConfig.mode = body.mode;
    }
    if (typeof body.challengeEnabled === 'boolean') {
      superAgentConfig.challengeEnabled = body.challengeEnabled;
    }
    if (typeof body.defaultChallengeCooldownMs === 'number') {
      superAgentConfig.defaultChallengeCooldownMs = Math.max(1200, Math.min(120000, body.defaultChallengeCooldownMs));
    }
    if (body.workerTargetPreference) {
      superAgentConfig.workerTargetPreference = body.workerTargetPreference;
    }
    if (body.llmPolicy) {
      superAgentConfig.llmPolicy = { ...superAgentConfig.llmPolicy, ...body.llmPolicy };
    }
    if (body.walletPolicy) {
      superAgentConfig.walletPolicy = { ...superAgentConfig.walletPolicy, ...body.walletPolicy };
    }

    ensureSuperAgentExists();
    applySuperAgentDelegation();
    sendJson(res, { ok: true, superAgent: runtimeStatus().superAgent });
    return;
  }

  if (url.pathname === '/super-agent/delegate/apply' && req.method === 'POST') {
    ensureSuperAgentExists();
    applySuperAgentDelegation();
    sendJson(res, {
      ok: true,
      directivesApplied: buildWorkerDirectives(superAgentConfig, [...bots.keys()]).length,
      superAgent: runtimeStatus().superAgent
    });
    return;
  }

  if (url.pathname === '/super-agent/delegate/preview') {
    sendJson(res, {
      superAgentId: superAgentConfig.id,
      directives: buildWorkerDirectives(superAgentConfig, [...bots.keys()])
    });
    return;
  }

  if (url.pathname === '/agents/reconcile' && req.method === 'POST') {
    const body = await readJsonBody<{ count?: number }>(req);
    const count = Math.max(1, Math.min(60, Number(body?.count ?? bots.size)));
    reconcileBots(count);
    sendJson(res, { ok: true, configuredBotCount: bots.size });
    return;
  }

  if (url.pathname.startsWith('/agents/') && url.pathname.endsWith('/config') && req.method === 'POST') {
    const id = url.pathname.split('/')[2];
    const bot = id ? bots.get(id) : undefined;
    if (!bot) {
      sendJson(res, { ok: false, reason: 'bot_not_found' }, 404);
      return;
    }

    const body = await readJsonBody<Partial<AgentBehaviorConfig>>(req);
    if (!body) {
      sendJson(res, { ok: false, reason: 'invalid_json' }, 400);
      return;
    }

    bot.updateBehavior(body);
    sendJson(res, { ok: true, bot: bot.getStatus() });
    return;
  }

  if (url.pathname === '/secrets/openrouter' && req.method === 'POST') {
    const body = await readJsonBody<{ apiKey?: string }>(req);
    runtimeSecrets.openRouterApiKey = body?.apiKey?.trim() ?? '';
    superAgentConfig.llmPolicy.enabled = Boolean(runtimeSecrets.openRouterApiKey);
    sendJson(res, {
      ok: true,
      openRouterConfigured: Boolean(runtimeSecrets.openRouterApiKey),
      masked: runtimeSecrets.openRouterApiKey
        ? `${runtimeSecrets.openRouterApiKey.slice(0, 7)}...${runtimeSecrets.openRouterApiKey.slice(-4)}`
        : null
    });
    return;
  }

  if (url.pathname === '/capabilities/wallet' && req.method === 'POST') {
    const body = await readJsonBody<{
      enabled?: boolean;
      grandAgentId?: string;
      skills?: string[];
      maxBetPercentOfBankroll?: number;
      maxDailyTxCount?: number;
      requireEscrowForChallenges?: boolean;
    }>(req);

    if (typeof body?.enabled === 'boolean') {
      superAgentConfig.walletPolicy.enabled = body.enabled;
    }
    if (body?.grandAgentId) {
      superAgentConfig.id = body.grandAgentId;
    }
    if (Array.isArray(body?.skills)) {
      superAgentConfig.walletPolicy.allowedSkills = body.skills.filter((item) => typeof item === 'string' && item.trim().length > 0);
    }
    if (typeof body?.maxBetPercentOfBankroll === 'number') {
      superAgentConfig.walletPolicy.maxBetPercentOfBankroll = Math.max(0.1, Math.min(100, body.maxBetPercentOfBankroll));
    }
    if (typeof body?.maxDailyTxCount === 'number') {
      superAgentConfig.walletPolicy.maxDailyTxCount = Math.max(1, Math.min(10000, body.maxDailyTxCount));
    }
    if (typeof body?.requireEscrowForChallenges === 'boolean') {
      superAgentConfig.walletPolicy.requireEscrowForChallenges = body.requireEscrowForChallenges;
    }

    ensureSuperAgentExists();
    applySuperAgentDelegation();

    sendJson(res, {
      ok: true,
      superAgentId: superAgentConfig.id,
      walletPolicy: superAgentConfig.walletPolicy
    });
    return;
  }

  sendJson(res, { error: 'not_found' }, 404);
});

server.listen(port, () => {
  console.log(`agent-runtime listening on :${port}`);
});
