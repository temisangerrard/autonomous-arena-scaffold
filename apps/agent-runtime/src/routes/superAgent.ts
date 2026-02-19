import { readJsonBody, sendJson, type SimpleRouter } from '../lib/http.js';
import {
  buildWorkerDirectives,
  type LlmPolicy,
  type SuperAgentConfig,
  type WalletPolicy
} from '../SuperAgent.js';

export function registerSuperAgentRoutes(router: SimpleRouter, deps: {
  bots: Map<string, unknown>;
  superAgentConfig: SuperAgentConfig;
  getOpenRouterApiKey: () => string;
  setOpenRouterApiKey: (apiKey: string) => void;
  runtimeStatus: () => { superAgent: unknown };
  ETHSKILLS_SOURCES: string[];
  superAgentEthSkills: unknown[];
  syncEthSkillsKnowledge: (force: boolean) => Promise<{ ok: boolean; refreshed: number; reason?: string }>;
  ensureSuperAgentExists: () => void;
  applySuperAgentDelegation: () => void;
  schedulePersistState: () => void;
  rememberSuperAgent: (type: 'command' | 'decision' | 'system', message: string) => void;
  parseSuperAgentActions: (message: string) => Array<{ kind: string; value?: unknown }>;
  applySuperAgentAction: (action: { kind: string; value?: unknown }) => string;
  askOpenRouterSuperAgent: (message: string) => Promise<string | null>;
}) {
  router.get('/super-agent/status', (_req, res) => {
    sendJson(res, deps.runtimeStatus().superAgent);
  });

  router.get('/super-agent/ethskills', (_req, res) => {
    sendJson(res, { ok: true, sources: deps.ETHSKILLS_SOURCES, entries: deps.superAgentEthSkills });
  });

  router.post('/super-agent/ethskills/sync', async (_req, res) => {
    const result = await deps.syncEthSkillsKnowledge(true);
    sendJson(res, {
      ok: result.ok,
      refreshed: result.refreshed,
      reason: result.reason,
      entries: deps.superAgentEthSkills
    }, result.ok ? 200 : 503);
  });

  router.post('/super-agent/config', async (req, res) => {
    type Patch = Partial<{
      id: string;
      mode: SuperAgentConfig['mode'];
      challengeEnabled: boolean;
      defaultChallengeCooldownMs: number;
      workerTargetPreference: SuperAgentConfig['workerTargetPreference'];
      llmPolicy: Partial<LlmPolicy>;
      walletPolicy: Partial<WalletPolicy>;
    }>;

    const body = await readJsonBody<Patch>(req);
    if (!body) {
      sendJson(res, { ok: false, reason: 'invalid_json' }, 400);
      return;
    }

    if (typeof body.id === 'string' && body.id.trim().length > 0) {
      deps.superAgentConfig.id = body.id.trim();
    }
    if (body.mode) {
      deps.superAgentConfig.mode = body.mode;
    }
    if (typeof body.challengeEnabled === 'boolean') {
      deps.superAgentConfig.challengeEnabled = body.challengeEnabled;
    }
    if (typeof body.defaultChallengeCooldownMs === 'number') {
      deps.superAgentConfig.defaultChallengeCooldownMs = Math.max(1200, Math.min(120000, body.defaultChallengeCooldownMs));
    }
    if (body.workerTargetPreference) {
      deps.superAgentConfig.workerTargetPreference = body.workerTargetPreference;
    }
    if (body.llmPolicy) {
      deps.superAgentConfig.llmPolicy = { ...deps.superAgentConfig.llmPolicy, ...body.llmPolicy };
    }
    if (body.walletPolicy) {
      deps.superAgentConfig.walletPolicy = { ...deps.superAgentConfig.walletPolicy, ...body.walletPolicy };
    }

    deps.ensureSuperAgentExists();
    deps.applySuperAgentDelegation();
    deps.schedulePersistState();
    sendJson(res, { ok: true, superAgent: deps.runtimeStatus().superAgent });
  });

  router.post('/super-agent/delegate/apply', async (_req, res) => {
    deps.ensureSuperAgentExists();
    deps.applySuperAgentDelegation();
    deps.schedulePersistState();
    sendJson(res, {
      ok: true,
      directivesApplied: buildWorkerDirectives(deps.superAgentConfig, [...deps.bots.keys()]).length,
      superAgent: deps.runtimeStatus().superAgent
    });
  });

  router.get('/super-agent/delegate/preview', (_req, res) => {
    sendJson(res, {
      superAgentId: deps.superAgentConfig.id,
      directives: buildWorkerDirectives(deps.superAgentConfig, [...deps.bots.keys()])
    });
  });

  router.post('/super-agent/chat', async (req, res) => {
    const body = await readJsonBody<{ message?: string; includeStatus?: boolean }>(req);
    const message = body?.message?.trim() ?? '';
    if (!message) {
      sendJson(res, { ok: false, reason: 'message_required' }, 400);
      return;
    }

    deps.rememberSuperAgent('command', message);
    const actions = deps.parseSuperAgentActions(message);
    const actionReplies: string[] = [];

    for (const action of actions) {
      actionReplies.push(deps.applySuperAgentAction(action));
    }

    if (actions.some((entry) => entry.kind === 'sync_ethskills')) {
      const synced = await deps.syncEthSkillsKnowledge(true);
      actionReplies.push(
        synced.ok
          ? `ETHSkills synced (${synced.refreshed} pages).`
          : `ETHSkills sync failed (${synced.reason ?? 'unknown_error'}).`
      );
    }

    if (actions.some((entry) => entry.kind !== 'status' && entry.kind !== 'help')) {
      deps.ensureSuperAgentExists();
      deps.applySuperAgentDelegation();
    }

    const advisory = (await deps.askOpenRouterSuperAgent(message)) ?? '';

    const replyParts: string[] = [];
    if (actionReplies.length > 0) {
      replyParts.push(`Executed:\n${actionReplies.join('\n')}`);
    }
    if (advisory) {
      replyParts.push(advisory);
      deps.rememberSuperAgent('decision', 'provided llm advisory');
    }
    if (replyParts.length === 0) {
      replyParts.push('No direct command detected. Ask for "status" or "help", or use commands like "mode hunter", "bot count 16", "enable wallet policy".');
    }

    sendJson(res, {
      ok: true,
      reply: replyParts.join('\n\n'),
      actionsApplied: actions.map((entry) => entry.kind),
      status: body?.includeStatus ? deps.runtimeStatus() : undefined
    });
    deps.schedulePersistState();
  });

  router.post('/secrets/openrouter', async (req, res) => {
    const body = await readJsonBody<{ apiKey?: string }>(req);
    const apiKey = body?.apiKey?.trim() ?? '';
    deps.setOpenRouterApiKey(apiKey);
    deps.superAgentConfig.llmPolicy.enabled = true;
    deps.schedulePersistState();
    const storedKey = deps.getOpenRouterApiKey();
    sendJson(res, {
      ok: true,
      openRouterConfigured: Boolean(storedKey),
      masked: storedKey ? `${storedKey.slice(0, 7)}...${storedKey.slice(-4)}` : null
    });
  });

  router.post('/capabilities/wallet', async (req, res) => {
    const body = await readJsonBody<{
      enabled?: boolean;
      grandAgentId?: string;
      skills?: string[];
      maxBetPercentOfBankroll?: number;
      maxDailyTxCount?: number;
      requireEscrowForChallenges?: boolean;
    }>(req);

    if (typeof body?.enabled === 'boolean') {
      deps.superAgentConfig.walletPolicy.enabled = body.enabled;
    }
    if (body?.grandAgentId) {
      deps.superAgentConfig.id = body.grandAgentId;
    }
    if (Array.isArray(body?.skills)) {
      deps.superAgentConfig.walletPolicy.allowedSkills = body.skills.filter((item) => typeof item === 'string' && item.trim().length > 0);
    }
    if (typeof body?.maxBetPercentOfBankroll === 'number') {
      deps.superAgentConfig.walletPolicy.maxBetPercentOfBankroll = Math.max(0.1, Math.min(100, body.maxBetPercentOfBankroll));
    }
    if (typeof body?.maxDailyTxCount === 'number') {
      deps.superAgentConfig.walletPolicy.maxDailyTxCount = Math.max(1, Math.min(10000, body.maxDailyTxCount));
    }
    if (typeof body?.requireEscrowForChallenges === 'boolean') {
      deps.superAgentConfig.walletPolicy.requireEscrowForChallenges = body.requireEscrowForChallenges;
    }

    deps.ensureSuperAgentExists();
    deps.applySuperAgentDelegation();
    deps.schedulePersistState();

    sendJson(res, {
      ok: true,
      superAgentId: deps.superAgentConfig.id,
      walletPolicy: deps.superAgentConfig.walletPolicy
    });
  });
}
