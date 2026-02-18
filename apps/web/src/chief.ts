import { createHash, randomBytes } from 'node:crypto';
import type { Logger } from './logger.js';
import type { IdentityRecord, Role } from './sessionStore.js';
import { loadSkillCatalog } from './chief/skillCatalog.js';
import { routeSkills, type SkillTraceEntry } from './chief/skillRouter.js';
import { buildRunbookSelection, listRunbooks, type RunbookSafetyClass } from './chief/runbooks.js';
import type { ChiefDbGateway } from './chief/dbGateway.js';

export type ChiefMode = 'player' | 'admin';
export type ChiefIntent =
  | 'status_explain'
  | 'bot_tune'
  | 'wallet_action'
  | 'user_admin'
  | 'runtime_ops'
  | 'game_fix'
  | 'unknown';

export type ChiefActionResult = {
  tool: string;
  status: 'planned' | 'executed' | 'blocked';
  summary: string;
};

export type ChiefChatRequest = {
  message?: string;
  context?: {
    page?: string;
    profileId?: string;
  };
  confirmToken?: string;
};

export type ChiefChatResponse = {
  ok: boolean;
  mode: ChiefMode;
  reply: string;
  intent: ChiefIntent;
  actions: ChiefActionResult[];
  requiresConfirmation: boolean;
  confirmToken?: string;
  stateSnapshot?: Record<string, unknown>;
  errors?: Array<{ code: string; message: string }>;
  selectedSkills?: string[];
  runbook?: string;
  skillTrace?: SkillTraceEntry[];
  safetyClass?: RunbookSafetyClass;
  requiresInput?: Array<{ key: string; prompt: string; example?: string }>;
};

export type ChiefMetrics = {
  totalRequests: number;
  nonEmptyReplyCount: number;
  toolExecutions: number;
  confirmationRequests: number;
  confirmationCompletions: number;
  skillRouteAttempts: number;
  skillRouteHits: number;
  skillExecs: number;
  skillBlocks: number;
  skillFallbacks: number;
  llmRouteFallbacks: number;
  failures: Record<string, number>;
};

type PlayerProfile = {
  id: string;
  username: string;
  displayName: string;
  walletId: string;
  wallet?: {
    id: string;
    balance: number;
    address?: string;
  };
};

type RuntimeStatusPayload = {
  configuredBotCount?: number;
  connectedBotCount?: number;
  backgroundBotCount?: number;
  profileBotCount?: number;
  wsAuthMismatchLikely?: boolean;
  bots?: Array<{
    id: string;
    connected?: boolean;
    behavior?: {
      personality?: 'aggressive' | 'conservative' | 'social';
      mode?: 'active' | 'passive';
      targetPreference?: 'human_only' | 'human_first' | 'any';
      challengeCooldownMs?: number;
      challengeEnabled?: boolean;
      baseWager?: number;
      maxWager?: number;
    };
    meta?: {
      ownerProfileId?: string | null;
      displayName?: string;
      duty?: string;
      patrolSection?: number | null;
    };
  }>;
  wallets?: Array<{
    id: string;
    ownerProfileId?: string | null;
    address?: string;
    balance?: number;
  }>;
  superAgent?: {
    mode?: string;
    challengeEnabled?: boolean;
    workerTargetPreference?: string;
    defaultChallengeCooldownMs?: number;
    walletPolicy?: {
      enabled?: boolean;
    };
  };
  house?: {
    wallet?: { id?: string; balance?: number };
    npcWalletFloor?: number;
    npcWalletTopupAmount?: number;
    superAgentWalletFloor?: number;
  };
};

type ChiefDeps = {
  runtimeGet: <T>(pathname: string) => Promise<T>;
  runtimePost: <T>(pathname: string, body: unknown) => Promise<T>;
  serverGet: <T>(pathname: string) => Promise<T>;
  runtimeProfiles: () => Promise<PlayerProfile[]>;
  purgeSessionsForProfile: (profileId: string) => Promise<number>;
  log: Logger;
  dbGateway?: ChiefDbGateway;
  cooModeEnabled?: boolean;
  skillCatalogRoots?: string[];
};

type ChiefToolPlan = {
  tool: string;
  sensitive: boolean;
  summary: string;
  execute: () => Promise<{ summary: string; stateSnapshot?: Record<string, unknown> }>;
};

type PendingConfirmation = {
  token: string;
  ownerSub: string;
  mode: ChiefMode;
  intent: ChiefIntent;
  expiresAt: number;
  plans: ChiefToolPlan[];
  meta?: {
    selectedSkills?: string[];
    runbook?: string;
    skillTrace?: SkillTraceEntry[];
    safetyClass?: RunbookSafetyClass;
  };
};

const CONFIRM_TTL_MS = 120_000;

function redact(input: string): string {
  return String(input || '')
    .replace(/sk-[A-Za-z0-9_-]{10,}/g, '[redacted_key]')
    .replace(/0x[a-fA-F0-9]{64}/g, '[redacted_hex_secret]')
    .replace(/(internal[_-]?token|private[_-]?key)\s*[:=]\s*[^\s]+/gi, '$1=[redacted]');
}

function detectIntent(message: string): ChiefIntent {
  const normalized = message.toLowerCase();
  if (/\b(status|health|heartbeat|state|what('?s| is) happening|summary)\b/.test(normalized)) {
    return 'status_explain';
  }
  if (/\b(personality|target|mode|cooldown|wager|bot)\b/.test(normalized)) {
    return 'bot_tune';
  }
  if (/\b(fund|withdraw|cash out|transfer|send|gas|escrow)\b/.test(normalized)) {
    return 'wallet_action';
  }
  if (/\b(user|player|logout|teleport|credit|debit|inspect)\b/.test(normalized)) {
    return 'user_admin';
  }
  if (/\b(reconcile|delegation|ethskills|super[- ]?agent|runtime)\b/.test(normalized)) {
    return 'runtime_ops';
  }
  if (/\b(fix|broken|stuck|repair)\b/.test(normalized)) {
    return 'game_fix';
  }
  return 'unknown';
}

function roleToMode(role: Role): ChiefMode {
  return role === 'admin' ? 'admin' : 'player';
}

function incFailure(metrics: ChiefMetrics, code: string): void {
  metrics.failures[code] = Number(metrics.failures[code] ?? 0) + 1;
}

function summarizeStatus(snapshot: Record<string, unknown>): string {
  const configured = Number(snapshot.configuredBotCount ?? 0);
  const connected = Number(snapshot.connectedBotCount ?? 0);
  const wsMismatch = Boolean(snapshot.wsAuthMismatchLikely);
  const wallets = Number(snapshot.walletCount ?? 0);
  const challenges = Number(snapshot.challengeEvents ?? 0);
  return [
    `bots configured=${configured} connected=${connected}`,
    `wallets=${wallets} recentChallenges=${challenges}`,
    wsMismatch ? 'warning=ws_auth_mismatch_likely' : 'warning=none'
  ].join('\n');
}

function normalizeRef(value: string): string {
  return value.trim().toLowerCase();
}

function resolveProfileReference(profiles: PlayerProfile[], ref: string): PlayerProfile | null {
  const target = normalizeRef(ref);
  if (!target) {
    return null;
  }
  return profiles.find((profile) => (
    normalizeRef(profile.id) === target
    || normalizeRef(profile.username) === target
    || normalizeRef(profile.displayName) === target
  )) ?? null;
}

export function createChiefService(deps: ChiefDeps) {
  const cooModeEnabled = typeof deps.cooModeEnabled === 'boolean'
    ? deps.cooModeEnabled
    : process.env.CHIEF_COO_MODE_ENABLED === 'true';
  const skillCatalogRoots = deps.skillCatalogRoots?.length
    ? deps.skillCatalogRoots
    : [process.env.CHIEF_SKILL_ROOT || '.agents/skills'];
  const skillCatalogPromise = loadSkillCatalog(skillCatalogRoots).catch(() => []);
  const pendingConfirmations = new Map<string, PendingConfirmation>();
  const metrics: ChiefMetrics = {
    totalRequests: 0,
    nonEmptyReplyCount: 0,
    toolExecutions: 0,
    confirmationRequests: 0,
    confirmationCompletions: 0,
    skillRouteAttempts: 0,
    skillRouteHits: 0,
    skillExecs: 0,
    skillBlocks: 0,
    skillFallbacks: 0,
    llmRouteFallbacks: 0,
    failures: {}
  };

  function prunePending(): void {
    const now = Date.now();
    for (const [token, pending] of pendingConfirmations.entries()) {
      if (pending.expiresAt <= now) {
        pendingConfirmations.delete(token);
      }
    }
  }

  async function buildStateSnapshot(identity: IdentityRecord): Promise<Record<string, unknown>> {
    const [runtimeStatus, challengeRecent] = await Promise.all([
      deps.runtimeGet<RuntimeStatusPayload>('/status').catch(() => null),
      deps.serverGet<{ recent?: unknown[] }>('/challenges/recent?limit=12').catch(() => null)
    ]);
    const ownerBot = (runtimeStatus?.bots ?? []).find((bot) => bot.meta?.ownerProfileId === identity.profileId) ?? null;
    const ownerWallet = (runtimeStatus?.wallets ?? []).find((wallet) => wallet.id === identity.walletId) ?? null;
    return {
      configuredBotCount: runtimeStatus?.configuredBotCount ?? 0,
      connectedBotCount: runtimeStatus?.connectedBotCount ?? 0,
      backgroundBotCount: runtimeStatus?.backgroundBotCount ?? 0,
      profileBotCount: runtimeStatus?.profileBotCount ?? 0,
      wsAuthMismatchLikely: runtimeStatus?.wsAuthMismatchLikely ?? false,
      ownerBot: ownerBot ? {
        id: ownerBot.id,
        connected: ownerBot.connected ?? false,
        displayName: ownerBot.meta?.displayName ?? ownerBot.id,
        behavior: {
          personality: ownerBot.behavior?.personality ?? 'social',
          mode: ownerBot.behavior?.mode ?? 'active',
          targetPreference: ownerBot.behavior?.targetPreference ?? 'human_first',
          challengeCooldownMs: ownerBot.behavior?.challengeCooldownMs ?? 0
        }
      } : null,
      ownerWallet: ownerWallet ? {
        id: ownerWallet.id,
        balance: Number(ownerWallet.balance ?? 0),
        address: ownerWallet.address ?? null
      } : null,
      walletCount: (runtimeStatus?.wallets ?? []).length,
      challengeEvents: (challengeRecent?.recent ?? []).length,
      superAgent: runtimeStatus?.superAgent ?? null,
      house: runtimeStatus?.house ?? null
    };
  }

  async function fallbackReply(
    mode: ChiefMode,
    message: string,
    identity: IdentityRecord
  ): Promise<string> {
    if (mode === 'admin') {
      const payload = await deps.runtimePost<{ reply?: string }>('/super-agent/chat', {
        message,
        includeStatus: false
      }).catch(() => null);
      const reply = String(payload?.reply ?? '').trim();
      if (reply) {
        return reply;
      }
      return 'No direct action matched. Try: "status", "reconcile bots to 12", "apply delegation", or "inspect player <id>".';
    }

    const payload = await deps.runtimePost<{ reply?: string }>('/house/chat', {
      message,
      player: {
        profileId: identity.profileId,
        displayName: identity.displayName,
        walletId: identity.walletId
      }
    }).catch(() => null);
    const reply = String(payload?.reply ?? '').trim();
    if (reply) {
      return reply;
    }
    return 'I can always answer status and execute bot/wallet commands. Try: "status", "fix gas", or "set personality aggressive".';
  }

  async function buildPlans(
    mode: ChiefMode,
    intent: ChiefIntent,
    message: string,
    identity: IdentityRecord
  ): Promise<ChiefToolPlan[]> {
    const normalized = message.toLowerCase().trim();
    const plans: ChiefToolPlan[] = [];

    if (intent === 'status_explain') {
      plans.push({
        tool: 'inspect.state',
        sensitive: false,
        summary: 'Explain current runtime/game state.',
        execute: async () => {
          const snapshot = await buildStateSnapshot(identity);
          return {
            summary: summarizeStatus(snapshot),
            stateSnapshot: snapshot
          };
        }
      });
      return plans;
    }

    if (intent === 'wallet_action') {
      if (/\b(fix|top\s?up|prepare)\s+gas\b|\bgas\s+(low|topup|fix)\b|\bprepare escrow\b/.test(normalized) && identity.walletId) {
        plans.push({
          tool: 'wallet.gas.prepare',
          sensitive: false,
          summary: `Prepare gas + approvals for wallet ${identity.walletId}.`,
          execute: async () => {
            const payload = await deps.runtimePost<{
              ok?: boolean;
              results?: Array<{ walletId?: string; ok?: boolean; reason?: string }>;
            }>('/wallets/onchain/prepare-escrow', { walletIds: [identity.walletId], amount: 1 });
            const status = payload.results?.[0];
            if (status?.ok) {
              return { summary: `Wallet gas/approval prepared for ${identity.walletId}.` };
            }
            return { summary: `Gas prepare attempted for ${identity.walletId}; status=${status?.reason ?? 'unknown'}.` };
          }
        });
      }

      const fundMatch = normalized.match(/\bfund\s+(\d+(?:\.\d+)?)\b/);
      if (fundMatch?.[1] && identity.walletId) {
        const amount = Math.max(0, Number(fundMatch[1]));
        plans.push({
          tool: 'wallet.fund',
          sensitive: false,
          summary: `Fund wallet by ${amount}.`,
          execute: async () => {
            await deps.runtimePost(`/wallets/${identity.walletId}/fund`, { amount });
            return { summary: `Funded wallet by ${amount}.` };
          }
        });
      }

      const withdrawMatch = normalized.match(/\b(withdraw|cash out)\s+(\d+(?:\.\d+)?)\b/);
      if (withdrawMatch?.[2] && identity.walletId) {
        const amount = Math.max(0, Number(withdrawMatch[2]));
        plans.push({
          tool: 'wallet.withdraw',
          sensitive: true,
          summary: `Withdraw ${amount} from wallet.`,
          execute: async () => {
            await deps.runtimePost(`/wallets/${identity.walletId}/withdraw`, { amount });
            return { summary: `Withdrew ${amount} from wallet.` };
          }
        });
      }

      const transferMatch = normalized.match(/\b(transfer|send)\s+(\d+(?:\.\d+)?)\s+(?:to)\s+([a-z0-9_:-]+)\b/);
      if (transferMatch?.[2] && transferMatch?.[3] && identity.walletId) {
        const amount = Math.max(0, Number(transferMatch[2]));
        const toWalletId = String(transferMatch[3]).trim();
        plans.push({
          tool: 'wallet.transfer',
          sensitive: true,
          summary: `Transfer ${amount} to ${toWalletId}.`,
          execute: async () => {
            await deps.runtimePost(`/wallets/${identity.walletId}/transfer`, { toWalletId, amount });
            return { summary: `Transferred ${amount} to ${toWalletId}.` };
          }
        });
      }

      return plans;
    }

    if (intent === 'bot_tune') {
      const runtimeStatus = await deps.runtimeGet<RuntimeStatusPayload>('/status').catch(() => null);
      const ownerBot = (runtimeStatus?.bots ?? []).find((entry) => entry.meta?.ownerProfileId === identity.profileId);
      if (!ownerBot?.id) {
        return plans;
      }
      const patch: Record<string, unknown> = {};
      const details: string[] = [];

      const personalityMatch = normalized.match(/\b(personality|persona)\s+(social|aggressive|conservative)\b/);
      if (personalityMatch?.[2]) {
        patch.personality = personalityMatch[2];
        details.push(`personality=${personalityMatch[2]}`);
      }
      const targetMatch = normalized.match(/\btarget\s+(human_first|human_only|any)\b/);
      if (targetMatch?.[1]) {
        patch.targetPreference = targetMatch[1];
        details.push(`target=${targetMatch[1]}`);
      }
      const modeMatch = normalized.match(/\bmode\s+(active|passive)\b/);
      if (modeMatch?.[1]) {
        patch.mode = modeMatch[1];
        details.push(`mode=${modeMatch[1]}`);
      }
      const cooldownMatch = normalized.match(/\bcooldown\s+(\d{3,6})\b/);
      if (cooldownMatch?.[1]) {
        patch.challengeCooldownMs = Math.max(1200, Number(cooldownMatch[1]));
        details.push(`cooldown=${patch.challengeCooldownMs}ms`);
      }
      const wagerMatch = normalized.match(/\bwager\s+base\s+(\d+)\s+max\s+(\d+)\b/);
      if (wagerMatch?.[1] && wagerMatch?.[2]) {
        const base = Math.max(1, Number(wagerMatch[1]));
        const max = Math.max(base, Number(wagerMatch[2]));
        patch.baseWager = base;
        patch.maxWager = max;
        details.push(`wager=${base}-${max}`);
      }

      if (details.length > 0) {
        plans.push({
          tool: mode === 'admin' ? 'fix.bot.behavior.patch' : 'bot.update',
          sensitive: mode === 'admin',
          summary: `Update ${ownerBot.id}: ${details.join(', ')}.`,
          execute: async () => {
            await deps.runtimePost(`/agents/${ownerBot.id}/config`, patch);
            return { summary: `Updated ${ownerBot.id}.` };
          }
        });
      }
      return plans;
    }

    if (mode === 'admin' && (intent === 'runtime_ops' || intent === 'game_fix')) {
      const reconcileMatch = normalized.match(/\b(reconcile|bot count)\s*(?:to)?\s*(\d{1,3})\b/);
      if (reconcileMatch?.[2]) {
        const count = Math.max(0, Math.min(60, Number(reconcileMatch[2])));
        plans.push({
          tool: 'fix.bot.reconcile',
          sensitive: true,
          summary: `Set background bot count to ${count}.`,
          execute: async () => {
            await deps.runtimePost('/agents/reconcile', { count });
            return { summary: `Reconciled background bot count to ${count}.` };
          }
        });
      }

      if (/\b(apply|run)\s+(delegation|directives?)\b/.test(normalized)) {
        plans.push({
          tool: 'fix.runtime.delegation.apply',
          sensitive: true,
          summary: 'Apply super-agent delegation.',
          execute: async () => {
            await deps.runtimePost('/super-agent/delegate/apply', {});
            return { summary: 'Applied super-agent delegation.' };
          }
        });
      }

      if (/\b(sync|refresh)\s+(ethskills|skills)\b/.test(normalized)) {
        plans.push({
          tool: 'runtime.sync.ethskills',
          sensitive: false,
          summary: 'Sync ETHSkills knowledge.',
          execute: async () => {
            const synced = await deps.runtimePost<{ refreshed?: number }>('/super-agent/ethskills/sync', {});
            const refreshed = Number(synced?.refreshed ?? 0);
            return { summary: `Synced ETHSkills (${refreshed} pages).` };
          }
        });
      }

      const houseCfgMatch = normalized.match(/\bhouse\b.*\bnpc floor\s+(\d+)\b.*\btopup\s+(\d+)\b.*\bsuper floor\s+(\d+)\b/);
      if (houseCfgMatch?.[1] && houseCfgMatch?.[2] && houseCfgMatch?.[3]) {
        const npcWalletFloor = Number(houseCfgMatch[1]);
        const npcWalletTopupAmount = Number(houseCfgMatch[2]);
        const superAgentWalletFloor = Number(houseCfgMatch[3]);
        plans.push({
          tool: 'fix.house.config',
          sensitive: true,
          summary: `Set house config npcFloor=${npcWalletFloor}, topup=${npcWalletTopupAmount}, superFloor=${superAgentWalletFloor}.`,
          execute: async () => {
            await deps.runtimePost('/house/config', { npcWalletFloor, npcWalletTopupAmount, superAgentWalletFloor });
            return { summary: 'Updated house config.' };
          }
        });
      }
    }

    if (mode === 'admin' && intent === 'user_admin') {
      const profiles = await deps.runtimeProfiles().catch(() => []);
      const inspectMatch = normalized.match(/\b(inspect|show)\s+(?:player|user)\s+([a-z0-9_.-]+)\b/);
      if (inspectMatch?.[2]) {
        const profile = resolveProfileReference(profiles, inspectMatch[2]);
        plans.push({
          tool: 'inspect.player.state',
          sensitive: false,
          summary: profile ? `Inspect player ${profile.displayName}.` : `Inspect player ${inspectMatch[2]}.`,
          execute: async () => {
            if (!profile) {
              return { summary: `Player "${inspectMatch[2]}" not found.` };
            }
            const runtimeStatus = await deps.runtimeGet<RuntimeStatusPayload>('/status').catch(() => null);
            const bot = (runtimeStatus?.bots ?? []).find((entry) => entry.meta?.ownerProfileId === profile.id);
            const walletId = profile.wallet?.id ?? profile.walletId;
            const wallet = (runtimeStatus?.wallets ?? []).find((entry) => entry.id === walletId);
            return {
              summary: [
                `player=${profile.displayName} (@${profile.username}) id=${profile.id}`,
                `wallet=${walletId} balance=${Number(wallet?.balance ?? profile.wallet?.balance ?? 0).toFixed(2)}`,
                bot ? `bot=${bot.id} connected=${Boolean(bot.connected)} mode=${bot.behavior?.mode ?? '-'}` : 'bot=missing'
              ].join('\n')
            };
          }
        });
      }

      const logoutMatch = normalized.match(/\blogout\s+(?:player|user)\s+([a-z0-9_.-]+)\b/);
      if (logoutMatch?.[1]) {
        const profile = resolveProfileReference(profiles, logoutMatch[1]);
        if (profile) {
          plans.push({
            tool: 'user.logout',
            sensitive: true,
            summary: `Force logout for ${profile.displayName}.`,
            execute: async () => {
              const deleted = await deps.purgeSessionsForProfile(profile.id);
              return { summary: `Logged out ${profile.displayName}. Sessions terminated: ${deleted}.` };
            }
          });
        }
      }

      const adjustMatch = normalized.match(/\b(credit|debit)\s+(\d+(?:\.\d+)?)\s+(?:to|from)\s+([a-z0-9_.-]+)\b/);
      if (adjustMatch?.[1] && adjustMatch?.[2] && adjustMatch?.[3]) {
        const direction = adjustMatch[1] === 'debit' ? 'debit' : 'credit';
        const amount = Math.max(0, Number(adjustMatch[2]));
        const profile = resolveProfileReference(profiles, adjustMatch[3]);
        if (profile) {
          const walletId = profile.wallet?.id ?? profile.walletId;
          plans.push({
            tool: 'user.wallet.adjust',
            sensitive: true,
            summary: `${direction} ${amount} ${direction === 'credit' ? 'to' : 'from'} ${profile.displayName}.`,
            execute: async () => {
              if (direction === 'credit') {
                await deps.runtimePost('/house/transfer', { toWalletId: walletId, amount, reason: 'chief_admin_credit' });
                return { summary: `Credited ${amount} to ${profile.displayName}.` };
              }
              const house = await deps.runtimeGet<{ house?: { wallet?: { id?: string } } }>('/house/status');
              const houseWalletId = String(house.house?.wallet?.id ?? '').trim();
              if (!houseWalletId) {
                return { summary: 'Could not debit: house wallet unavailable.' };
              }
              await deps.runtimePost(`/wallets/${walletId}/transfer`, { toWalletId: houseWalletId, amount });
              return { summary: `Debited ${amount} from ${profile.displayName}.` };
            }
          });
        }
      }
    }

    return plans;
  }

  async function executePlans(
    identity: IdentityRecord,
    plans: ChiefToolPlan[],
    context?: { intent?: ChiefIntent; runbook?: string }
  ): Promise<{ actions: ChiefActionResult[]; replyParts: string[]; stateSnapshot?: Record<string, unknown> }> {
    const actions: ChiefActionResult[] = [];
    const replyParts: string[] = [];
    let stateSnapshot: Record<string, unknown> | undefined;

    for (const plan of plans) {
      try {
        const result = await plan.execute();
        metrics.toolExecutions += 1;
        actions.push({ tool: plan.tool, status: 'executed', summary: result.summary });
        if (result.summary) {
          replyParts.push(result.summary);
        }
        if (result.stateSnapshot) {
          stateSnapshot = result.stateSnapshot;
        }
        await deps.dbGateway?.writeAudit({
          actorId: identity.sub,
          actorType: identity.role === 'admin' ? 'admin' : 'system',
          action: `chief.${plan.tool}.executed`,
          resourceType: context?.runbook ? 'runbook' : 'tool',
          resourceId: context?.runbook ?? plan.tool,
          metadata: { summary: plan.summary, intent: context?.intent ?? 'unknown' }
        });
      } catch (error) {
        const message = String((error as Error).message || 'tool_execution_failed');
        incFailure(metrics, `tool_${plan.tool}`);
        actions.push({ tool: plan.tool, status: 'blocked', summary: message });
        replyParts.push(`${plan.tool} failed: ${message}`);
        await deps.dbGateway?.writeAudit({
          actorId: identity.sub,
          actorType: identity.role === 'admin' ? 'admin' : 'system',
          action: `chief.${plan.tool}.blocked`,
          resourceType: context?.runbook ? 'runbook' : 'tool',
          resourceId: context?.runbook ?? plan.tool,
          metadata: { error: message, intent: context?.intent ?? 'unknown' }
        });
      }
    }

    return { actions, replyParts, stateSnapshot };
  }

  function mintConfirmToken(
    identity: IdentityRecord,
    mode: ChiefMode,
    intent: ChiefIntent,
    plans: ChiefToolPlan[],
    meta?: PendingConfirmation['meta']
  ): string {
    const nonce = randomBytes(12).toString('hex');
    const digest = createHash('sha256')
      .update(identity.sub)
      .update(intent)
      .update(plans.map((plan) => `${plan.tool}:${plan.summary}`).join('|'))
      .update(nonce)
      .digest('hex')
      .slice(0, 24);
    const token = `cst_${digest}`;
    pendingConfirmations.set(token, {
      token,
      ownerSub: identity.sub,
      mode,
      intent,
      expiresAt: Date.now() + CONFIRM_TTL_MS,
      plans,
      meta
    });
    return token;
  }

  async function executePendingConfirmation(identity: IdentityRecord, confirmToken: string): Promise<ChiefChatResponse> {
    prunePending();
    const pending = pendingConfirmations.get(confirmToken);
    if (!pending) {
      return {
        ok: false,
        mode: roleToMode(identity.role),
        reply: 'Confirmation token is missing, expired, or already used.',
        intent: 'unknown',
        actions: [],
        requiresConfirmation: false,
        errors: [{ code: 'confirm_token_invalid', message: 'Invalid or expired confirmation token.' }]
      };
    }
    if (pending.ownerSub !== identity.sub) {
      return {
        ok: false,
        mode: roleToMode(identity.role),
        reply: 'Confirmation token does not belong to this account.',
        intent: pending.intent,
        actions: [],
        requiresConfirmation: false,
        errors: [{ code: 'confirm_token_owner_mismatch', message: 'Token owner mismatch.' }]
      };
    }
    pendingConfirmations.delete(confirmToken);
    const executed = await executePlans(identity, pending.plans, { intent: pending.intent, runbook: pending.meta?.runbook });
    metrics.confirmationCompletions += 1;
    return {
      ok: true,
      mode: pending.mode,
      reply: executed.replyParts.join('\n') || 'Confirmed.',
      intent: pending.intent,
      actions: executed.actions,
      requiresConfirmation: false,
      stateSnapshot: executed.stateSnapshot,
      selectedSkills: pending.meta?.selectedSkills,
      runbook: pending.meta?.runbook,
      skillTrace: pending.meta?.skillTrace,
      safetyClass: pending.meta?.safetyClass
    };
  }

  async function handleChat(input: {
    identity: IdentityRecord;
    request: ChiefChatRequest;
    forcedMode?: ChiefMode;
  }): Promise<ChiefChatResponse> {
    const requestId = randomBytes(6).toString('hex');
    metrics.totalRequests += 1;
    prunePending();

    const identity = input.identity;
    const mode = input.forcedMode ?? roleToMode(identity.role);
    const message = String(input.request.message ?? '').trim();
    if (!message && !input.request.confirmToken) {
      return {
        ok: false,
        mode,
        reply: 'Message is required.',
        intent: 'unknown',
        actions: [],
        requiresConfirmation: false,
        errors: [{ code: 'message_required', message: 'Provide a message.' }]
      };
    }

    deps.log.info({
      requestId,
      mode,
      role: identity.role,
      profileId: identity.profileId,
      hasConfirmToken: Boolean(input.request.confirmToken),
      message: redact(message).slice(0, 240)
    }, 'chief request');

    if (input.request.confirmToken) {
      const confirmed = await executePendingConfirmation(identity, String(input.request.confirmToken));
      if (confirmed.reply.trim().length > 0) {
        metrics.nonEmptyReplyCount += 1;
      }
      return confirmed;
    }

    const intent = detectIntent(message);
    metrics.skillRouteAttempts += 1;
    const catalog = await skillCatalogPromise;
    const routed = routeSkills(message, catalog);
    let selectedSkills = [...routed.selectedSkills];
    let skillTrace: SkillTraceEntry[] = [...routed.trace];
    if (selectedSkills.length > 0) {
      metrics.skillRouteHits += 1;
    }

    const runbookSelection = cooModeEnabled
      ? await buildRunbookSelection({
          mode,
          message,
          identity,
          runtimeGet: deps.runtimeGet,
          runtimePost: deps.runtimePost,
          runtimeProfiles: deps.runtimeProfiles,
          purgeSessionsForProfile: deps.purgeSessionsForProfile,
          buildStateSnapshot,
          dbGateway: deps.dbGateway
        })
      : { matched: false, selectedSkills: [], skillTrace: [], safetyClass: 'read_only' as RunbookSafetyClass, plans: [] };

    selectedSkills = [...new Set([...selectedSkills, ...runbookSelection.selectedSkills])];
    skillTrace = [...skillTrace, ...runbookSelection.skillTrace];

    if (runbookSelection.matched && runbookSelection.requiresInput?.length) {
      return {
        ok: true,
        mode,
        reply: 'Additional input required before this runbook can execute.',
        intent,
        actions: [],
        requiresConfirmation: false,
        selectedSkills,
        runbook: runbookSelection.runbook,
        skillTrace,
        safetyClass: runbookSelection.safetyClass,
        requiresInput: runbookSelection.requiresInput
      };
    }

    const plans = runbookSelection.matched ? runbookSelection.plans : await buildPlans(mode, intent, message, identity);
    const sensitivePlans = plans.filter((plan) => plan.sensitive);
    const safetyClass = runbookSelection.matched
      ? runbookSelection.safetyClass
      : (sensitivePlans.length > 0 ? 'mutating' : 'read_only');

    if (plans.length > 0 && sensitivePlans.length > 0) {
      metrics.confirmationRequests += 1;
      const confirmToken = mintConfirmToken(identity, mode, intent, plans, {
        selectedSkills,
        runbook: runbookSelection.runbook,
        skillTrace,
        safetyClass
      });
      const actions = plans.map((plan) => ({ tool: plan.tool, status: 'planned' as const, summary: plan.summary }));
      const reply = [
        'Confirmation required before executing sensitive actions.',
        ...plans.map((plan) => `- ${plan.summary}`)
      ].join('\n');
      metrics.nonEmptyReplyCount += 1;
      return {
        ok: true,
        mode,
        reply,
        intent,
        actions,
        requiresConfirmation: true,
        confirmToken,
        selectedSkills,
        runbook: runbookSelection.runbook,
        skillTrace,
        safetyClass
      };
    }

    if (plans.length > 0) {
      if (runbookSelection.matched) {
        metrics.skillExecs += 1;
      }
      const executed = await executePlans(identity, plans, { intent, runbook: runbookSelection.runbook });
      const reply = executed.replyParts.join('\n').trim() || 'Done.';
      if (reply.length > 0) {
        metrics.nonEmptyReplyCount += 1;
      } else {
        incFailure(metrics, 'empty_reply');
      }
      return {
        ok: true,
        mode,
        reply,
        intent,
        actions: executed.actions,
        requiresConfirmation: false,
        stateSnapshot: executed.stateSnapshot,
        selectedSkills,
        runbook: runbookSelection.runbook,
        skillTrace,
        safetyClass
      };
    }

    const fallback = await fallbackReply(mode, message, identity);
    if (selectedSkills.length > 0) {
      metrics.skillFallbacks += 1;
    }
    const safeFallback = String(fallback || '').trim() || 'No route matched, but chief is alive. Try "status".';
    if (safeFallback.length > 0) {
      metrics.nonEmptyReplyCount += 1;
    } else {
      incFailure(metrics, 'empty_reply');
    }
    return {
      ok: true,
      mode,
      reply: safeFallback,
      intent,
      actions: [],
      requiresConfirmation: false,
      selectedSkills,
      skillTrace
    };
  }

  async function heartbeat(): Promise<{
    ok: boolean;
    chief: {
      ready: boolean;
      pendingConfirmations: number;
      metrics: ChiefMetrics;
      confirmTtlMs: number;
    };
    deps: {
      runtime: boolean;
      server: boolean;
    };
  }> {
    prunePending();
    const [runtimeOk, serverOk] = await Promise.all([
      deps.runtimeGet('/status').then(() => true).catch(() => false),
      deps.serverGet('/health').then(() => true).catch(() => false)
    ]);
    return {
      ok: runtimeOk && serverOk,
      chief: {
        ready: true,
        pendingConfirmations: pendingConfirmations.size,
        metrics: { ...metrics, failures: { ...metrics.failures } },
        confirmTtlMs: CONFIRM_TTL_MS
      },
      deps: {
        runtime: runtimeOk,
        server: serverOk
      }
    };
  }

  return {
    handleChat,
    heartbeat,
    metrics: () => ({ ...metrics, failures: { ...metrics.failures } }),
    listSkills: async () => skillCatalogPromise,
    listRunbooks: () => listRunbooks(),
    getOpsState: async (identity: IdentityRecord) => {
      const [snapshot, economy, challengeSummary, runtimeIntegrity] = await Promise.all([
        buildStateSnapshot(identity),
        deps.dbGateway?.getEconomySummary(24),
        deps.dbGateway?.getChallengeOpsSummary(30),
        deps.dbGateway?.getRuntimeIntegrity()
      ]);
      return {
        ...snapshot,
        economy: economy ?? null,
        challengeSummary: challengeSummary ?? null,
        runtimeIntegrity: runtimeIntegrity ?? null,
        dbHealth: deps.dbGateway?.health() ?? { server: false, runtime: false }
      };
    }
  };
}
