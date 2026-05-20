// Chief of Staff — Cloudflare Worker edition.
// Ports the deterministic intent+plan engine from apps/web/src/chief.ts,
// swaps Node.js crypto for Web Crypto, and calls Qwen as the LLM fallback.
// No file-system or Node-only deps; safe to run in a CF Worker isolate.

type ChiefMode = 'player' | 'admin';
type ChiefIntent =
  | 'status_explain' | 'bot_tune' | 'wallet_action'
  | 'user_admin' | 'runtime_ops' | 'game_fix' | 'unknown';

export type CloudflareChiefRequest = {
  message?: string;
  confirmToken?: string;
};

export type CloudflareChiefResponse = {
  ok: boolean;
  mode: ChiefMode;
  intent: ChiefIntent;
  reply: string;
  actions: Array<{ tool: string; status: 'planned' | 'executed' | 'blocked'; summary: string }>;
  requiresConfirmation: boolean;
  confirmToken?: string;
  stateSnapshot?: Record<string, unknown>;
  errors?: Array<{ code: string; message: string }>;
};

type ToolPlan = {
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
  plans: ToolPlan[];
};

type IdentityLike = {
  sub: string;
  profileId: string | null;
  walletId: string | null;
  displayName: string | null;
  role: string;
};

type RuntimeFetch = <T>(path: string, init?: { method?: string; body?: unknown }) => Promise<T>;

const CONFIRM_TTL_MS = 120_000;
const QWEN_MODEL = 'qwen-plus';

// Module-level store — lives for the duration of the isolate (minutes).
const pendingConfirmations = new Map<string, PendingConfirmation>();

function prunePending(): void {
  const now = Date.now();
  for (const [token, pending] of pendingConfirmations.entries()) {
    if (pending.expiresAt <= now) pendingConfirmations.delete(token);
  }
}

function detectIntent(message: string): ChiefIntent {
  const n = message.toLowerCase();
  if (/\b(status|health|state|what('?s| is) happening|summary)\b/.test(n)) return 'status_explain';
  if (/\b(personality|target|mode|cooldown|wager|bot)\b/.test(n)) return 'bot_tune';
  if (/\b(fund|withdraw|cash out|transfer|send|gas|escrow)\b/.test(n)) return 'wallet_action';
  if (/\b(user|player|logout|credit|debit|inspect)\b/.test(n)) return 'user_admin';
  if (/\b(reconcile|delegation|super[- ]?agent|runtime)\b/.test(n)) return 'runtime_ops';
  if (/\b(fix|broken|stuck|repair)\b/.test(n)) return 'game_fix';
  return 'unknown';
}

async function callQwen(
  qwenBaseUrl: string,
  qwenApiKey: string,
  systemPrompt: string,
  userMessage: string
): Promise<string> {
  const res = await fetch(`${qwenBaseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${qwenApiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: QWEN_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      max_tokens: 400,
      temperature: 0.4,
    }),
  }).catch(() => null);

  if (!res?.ok) return '';
  const data = await res.json().catch(() => null) as Record<string, unknown> | null;
  return String((data as any)?.choices?.[0]?.message?.content ?? '').trim();
}

function buildSystemPrompt(
  mode: ChiefMode,
  stateSnippet: string
): string {
  const base = `You are Chief, the AI operations controller for AutoBett Arena — an onchain agent wagering platform.
Respond concisely (≤3 sentences). Use arena terminology. Be direct and actionable.
Arena state:\n${stateSnippet}`;
  if (mode === 'admin') {
    return `${base}\nYou are in ADMIN mode. You can advise on reconciliation, house settings, and player management.`;
  }
  return `${base}\nYou are in PLAYER mode. Help the player manage their agent, wallet, and strategy.`;
}

async function buildStateSnippet(runtimeFetch: RuntimeFetch): Promise<string> {
  try {
    const status = await runtimeFetch<Record<string, unknown>>('/status');
    const bots = Number(status?.configuredBotCount ?? 0);
    const connected = Number(status?.connectedBotCount ?? 0);
    const profileBots = Number(status?.profileBotCount ?? 0);
    return `bots=${bots} connected=${connected} playerBots=${profileBots}`;
  } catch {
    return 'status=unavailable';
  }
}

async function buildPlans(
  mode: ChiefMode,
  intent: ChiefIntent,
  message: string,
  identity: IdentityLike,
  runtimeFetch: RuntimeFetch
): Promise<ToolPlan[]> {
  const n = message.toLowerCase().trim();
  const plans: ToolPlan[] = [];

  if (intent === 'status_explain') {
    plans.push({
      tool: 'inspect.state',
      sensitive: false,
      summary: 'Fetch and summarise current arena runtime state.',
      execute: async () => {
        const status = await runtimeFetch<Record<string, unknown>>('/status');
        const bots = Number(status?.configuredBotCount ?? 0);
        const connected = Number(status?.connectedBotCount ?? 0);
        return {
          summary: `bots configured=${bots} connected=${connected}`,
          stateSnapshot: status,
        };
      },
    });
    return plans;
  }

  if (intent === 'wallet_action' && identity.walletId) {
    if (/\b(fix|top\s?up|prepare)\s+gas\b|\bgas\s+(low|topup|fix)\b|\bprepare escrow\b/.test(n)) {
      plans.push({
        tool: 'wallet.gas.prepare',
        sensitive: false,
        summary: `Prepare gas + approvals for wallet ${identity.walletId}.`,
        execute: async () => {
          const payload = await runtimeFetch<{ results?: Array<{ ok?: boolean; reason?: string }> }>(
            '/wallets/onchain/prepare-escrow',
            { method: 'POST', body: { walletIds: [identity.walletId], amount: 1 } }
          );
          const st = payload.results?.[0];
          return { summary: st?.ok ? `Gas prepared for ${identity.walletId}.` : `Gas prepare status=${st?.reason ?? 'unknown'}.` };
        },
      });
    }

    const fundMatch = n.match(/\bfund\s+(\d+(?:\.\d+)?)\b/);
    if (fundMatch?.[1]) {
      const amount = Math.max(0, Number(fundMatch[1]));
      plans.push({
        tool: 'wallet.fund',
        sensitive: false,
        summary: `Fund wallet by ${amount}.`,
        execute: async () => {
          await runtimeFetch(`/wallets/${identity.walletId}/fund`, { method: 'POST', body: { amount } });
          return { summary: `Funded wallet by ${amount}.` };
        },
      });
    }

    const withdrawMatch = n.match(/\b(?:withdraw|cash out)\s+(\d+(?:\.\d+)?)\b/);
    if (withdrawMatch?.[1]) {
      const amount = Math.max(0, Number(withdrawMatch[1]));
      plans.push({
        tool: 'wallet.withdraw',
        sensitive: true,
        summary: `Withdraw ${amount} from wallet.`,
        execute: async () => {
          await runtimeFetch(`/wallets/${identity.walletId}/withdraw`, { method: 'POST', body: { amount } });
          return { summary: `Withdrew ${amount}.` };
        },
      });
    }

    return plans;
  }

  if (intent === 'bot_tune') {
    const status = await runtimeFetch<{ bots?: Array<{ id: string; meta?: { ownerProfileId?: string } }> }>('/status').catch(() => ({ bots: [] }));
    const ownerBot = (status.bots ?? []).find((b) => b.meta?.ownerProfileId === identity.profileId);
    if (!ownerBot?.id) return plans;

    const patch: Record<string, unknown> = {};
    const details: string[] = [];

    const personalityMatch = n.match(/\b(?:personality|persona)\s+(social|aggressive|conservative)\b/);
    if (personalityMatch?.[1]) { patch.personality = personalityMatch[1]; details.push(`personality=${personalityMatch[1]}`); }

    const targetMatch = n.match(/\btarget\s+(human_first|human_only|any)\b/);
    if (targetMatch?.[1]) { patch.targetPreference = targetMatch[1]; details.push(`target=${targetMatch[1]}`); }

    const modeMatch = n.match(/\bmode\s+(active|passive)\b/);
    if (modeMatch?.[1]) { patch.mode = modeMatch[1]; details.push(`mode=${modeMatch[1]}`); }

    const cooldownMatch = n.match(/\bcooldown\s+(\d{3,6})\b/);
    if (cooldownMatch?.[1]) { const ms = Math.max(1200, Number(cooldownMatch[1])); patch.challengeCooldownMs = ms; details.push(`cooldown=${ms}ms`); }

    const wagerMatch = n.match(/\bwager\s+base\s+(\d+)\s+max\s+(\d+)\b/);
    if (wagerMatch?.[1] && wagerMatch?.[2]) {
      const base = Math.max(1, Number(wagerMatch[1]));
      const max = Math.max(base, Number(wagerMatch[2]));
      patch.baseWager = base; patch.maxWager = max; details.push(`wager=${base}-${max}`);
    }

    if (details.length > 0) {
      plans.push({
        tool: mode === 'admin' ? 'fix.bot.behavior.patch' : 'bot.update',
        sensitive: mode === 'admin',
        summary: `Update ${ownerBot.id}: ${details.join(', ')}.`,
        execute: async () => {
          await runtimeFetch(`/agents/${ownerBot.id}/config`, { method: 'POST', body: patch });
          return { summary: `Updated ${ownerBot.id}.` };
        },
      });
    }
    return plans;
  }

  if (mode === 'admin' && (intent === 'runtime_ops' || intent === 'game_fix')) {
    const reconcileMatch = n.match(/\b(?:reconcile|bot count)\s*(?:to)?\s*(\d{1,3})\b/);
    if (reconcileMatch?.[1]) {
      const count = Math.max(0, Math.min(60, Number(reconcileMatch[1])));
      plans.push({
        tool: 'fix.bot.reconcile',
        sensitive: true,
        summary: `Set background bot count to ${count}.`,
        execute: async () => {
          await runtimeFetch('/agents/reconcile', { method: 'POST', body: { count } });
          return { summary: `Reconciled background bots to ${count}.` };
        },
      });
    }
  }

  return plans;
}

async function executePlans(plans: ToolPlan[]): Promise<{
  actions: CloudflareChiefResponse['actions'];
  replyParts: string[];
  stateSnapshot?: Record<string, unknown>;
}> {
  const actions: CloudflareChiefResponse['actions'] = [];
  const replyParts: string[] = [];
  let stateSnapshot: Record<string, unknown> | undefined;

  for (const plan of plans) {
    try {
      const result = await plan.execute();
      actions.push({ tool: plan.tool, status: 'executed', summary: result.summary });
      if (result.summary) replyParts.push(result.summary);
      if (result.stateSnapshot) stateSnapshot = result.stateSnapshot;
    } catch (err) {
      const msg = String((err as Error).message || 'execution_failed');
      actions.push({ tool: plan.tool, status: 'blocked', summary: msg });
      replyParts.push(`${plan.tool} failed: ${msg}`);
    }
  }
  return { actions, replyParts, stateSnapshot };
}

export function createCloudflareChief(
  qwenBaseUrl: string,
  qwenApiKey: string,
  runtimeFetch: RuntimeFetch
) {
  async function handleChat(
    identity: IdentityLike,
    request: CloudflareChiefRequest
  ): Promise<CloudflareChiefResponse> {
    prunePending();

    const mode: ChiefMode = identity.role === 'admin' ? 'admin' : 'player';
    const message = String(request.message ?? '').trim();

    if (!message && !request.confirmToken) {
      return { ok: false, mode, intent: 'unknown', reply: 'Message is required.', actions: [], requiresConfirmation: false, errors: [{ code: 'message_required', message: 'Provide a message.' }] };
    }

    // Handle confirmation flow
    if (request.confirmToken) {
      const pending = pendingConfirmations.get(request.confirmToken);
      if (!pending || pending.expiresAt <= Date.now()) {
        return { ok: false, mode, intent: 'unknown', reply: 'Confirmation token expired or invalid.', actions: [], requiresConfirmation: false, errors: [{ code: 'confirm_token_invalid', message: 'Invalid or expired token.' }] };
      }
      if (pending.ownerSub !== identity.sub) {
        return { ok: false, mode, intent: pending.intent, reply: 'Token does not belong to this account.', actions: [], requiresConfirmation: false, errors: [{ code: 'confirm_token_owner_mismatch', message: 'Token owner mismatch.' }] };
      }
      pendingConfirmations.delete(request.confirmToken);
      const executed = await executePlans(pending.plans);
      return {
        ok: true, mode: pending.mode, intent: pending.intent,
        reply: executed.replyParts.join('\n') || 'Confirmed and executed.',
        actions: executed.actions, requiresConfirmation: false, stateSnapshot: executed.stateSnapshot,
      };
    }

    const intent = detectIntent(message);
    const plans = await buildPlans(mode, intent, message, identity, runtimeFetch);
    const sensitivePlans = plans.filter((p) => p.sensitive);

    // Sensitive plans require confirmation
    if (plans.length > 0 && sensitivePlans.length > 0) {
      const token = `cst_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`;
      pendingConfirmations.set(token, { token, ownerSub: identity.sub, mode, intent, expiresAt: Date.now() + CONFIRM_TTL_MS, plans });
      return {
        ok: true, mode, intent,
        reply: ['I can do that — confirm to execute:', ...plans.map((p) => `- ${p.summary}`)].join('\n'),
        actions: plans.map((p) => ({ tool: p.tool, status: 'planned' as const, summary: p.summary })),
        requiresConfirmation: true, confirmToken: token,
      };
    }

    // Execute non-sensitive plans directly
    if (plans.length > 0) {
      const executed = await executePlans(plans);
      return {
        ok: true, mode, intent,
        reply: executed.replyParts.join('\n') || 'Done.',
        actions: executed.actions, requiresConfirmation: false, stateSnapshot: executed.stateSnapshot,
      };
    }

    // No deterministic plan matched — fall back to Qwen
    if (qwenApiKey) {
      const stateSnippet = await buildStateSnippet(runtimeFetch);
      const systemPrompt = buildSystemPrompt(mode, stateSnippet);
      const llmReply = await callQwen(qwenBaseUrl, qwenApiKey, systemPrompt, message);
      if (llmReply) {
        return { ok: true, mode, intent, reply: llmReply, actions: [], requiresConfirmation: false };
      }
    }

    return {
      ok: true, mode, intent,
      reply: 'No action matched. Try: "status", "set personality aggressive", "fund 5", or "reconcile bots to 10".',
      actions: [], requiresConfirmation: false,
    };
  }

  return { handleChat };
}
