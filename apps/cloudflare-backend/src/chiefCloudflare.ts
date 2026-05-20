// Chief of Staff — Cloudflare Worker edition.
//
// Confirmation tokens are stored in D1 (STATE_DB) so they survive
// across isolate restarts and cross-isolate request routing.
// Plans are stored as serializable action specs — no closures in D1.

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

// ── Serializable action specs ────────────────────────────────────────────────
// All plan params are plain data — no closures — so they round-trip through D1.
type PlanAction =
  | { type: 'status.fetch' }
  | { type: 'wallet.gas';      walletId: string }
  | { type: 'wallet.fund';     walletId: string; amount: number }
  | { type: 'wallet.withdraw'; walletId: string; amount: number }
  | { type: 'wallet.transfer'; walletId: string; toWalletId: string; amount: number }
  | { type: 'bot.config';      botId: string; patch: Record<string, unknown> }
  | { type: 'bot.reconcile';   count: number }
  | { type: 'house.config';    npcFloor: number; topup: number; superFloor: number }
  | { type: 'delegation.apply' };

type SerializablePlan = {
  tool: string;
  sensitive: boolean;
  summary: string;
  action: PlanAction;
};

type StoredConfirmation = {
  token: string;
  ownerSub: string;
  mode: ChiefMode;
  intent: ChiefIntent;
  expiresAt: number;
  plans: SerializablePlan[];
};

type D1Like = {
  prepare: (sql: string) => {
    bind: (...values: unknown[]) => {
      run: () => Promise<unknown>;
      first: <T = Record<string, unknown>>() => Promise<T | null>;
      all: <T = Record<string, unknown>>() => Promise<{ results?: T[] }>;
    };
  };
};

type RuntimeFetch = <T>(path: string, init?: { method?: string; body?: unknown }) => Promise<T>;

const CONFIRM_TTL_MS = 120_000;
const QWEN_MODEL = 'qwen-plus';

// ── D1 helpers ───────────────────────────────────────────────────────────────

async function storeConfirmation(db: D1Like, c: StoredConfirmation): Promise<void> {
  await db.prepare(
    `INSERT OR REPLACE INTO chief_confirmations
       (token, owner_sub, mode, intent, expires_at, plans_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(c.token, c.ownerSub, c.mode, c.intent, c.expiresAt, JSON.stringify(c.plans), Date.now()).run();
}

async function loadConfirmation(db: D1Like, token: string): Promise<StoredConfirmation | null> {
  const row = await db.prepare(
    'SELECT token, owner_sub, mode, intent, expires_at, plans_json FROM chief_confirmations WHERE token = ?'
  ).bind(token).first<Record<string, unknown>>();
  if (!row) return null;
  return {
    token: String(row.token),
    ownerSub: String(row.owner_sub),
    mode: String(row.mode) as ChiefMode,
    intent: String(row.intent) as ChiefIntent,
    expiresAt: Number(row.expires_at),
    plans: JSON.parse(String(row.plans_json)) as SerializablePlan[],
  };
}

async function deleteConfirmation(db: D1Like, token: string): Promise<void> {
  await db.prepare('DELETE FROM chief_confirmations WHERE token = ?').bind(token).run();
}

async function pruneExpired(db: D1Like): Promise<void> {
  await db.prepare('DELETE FROM chief_confirmations WHERE expires_at <= ?').bind(Date.now()).run();
}

// ── Intent detection ─────────────────────────────────────────────────────────

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

// ── Plan building (returns serializable specs, no closures) ──────────────────

type IdentityLike = {
  sub: string;
  profileId: string | null;
  walletId: string | null;
  displayName: string | null;
  role: string;
};

async function buildPlans(
  mode: ChiefMode,
  intent: ChiefIntent,
  message: string,
  identity: IdentityLike,
  runtimeFetch: RuntimeFetch
): Promise<SerializablePlan[]> {
  const n = message.toLowerCase().trim();
  const plans: SerializablePlan[] = [];

  if (intent === 'status_explain') {
    plans.push({ tool: 'inspect.state', sensitive: false, summary: 'Fetch current arena state.', action: { type: 'status.fetch' } });
    return plans;
  }

  if (intent === 'wallet_action' && identity.walletId) {
    if (/\b(fix|top\s?up|prepare)\s+gas\b|\bgas\s+(low|topup|fix)\b|\bprepare escrow\b/.test(n)) {
      plans.push({ tool: 'wallet.gas.prepare', sensitive: false, summary: `Prepare gas for wallet ${identity.walletId}.`, action: { type: 'wallet.gas', walletId: identity.walletId } });
    }
    const fundMatch = n.match(/\bfund\s+(\d+(?:\.\d+)?)\b/);
    if (fundMatch?.[1]) {
      const amount = Math.max(0, Number(fundMatch[1]));
      plans.push({ tool: 'wallet.fund', sensitive: false, summary: `Fund wallet by ${amount}.`, action: { type: 'wallet.fund', walletId: identity.walletId, amount } });
    }
    const withdrawMatch = n.match(/\b(?:withdraw|cash out)\s+(\d+(?:\.\d+)?)\b/);
    if (withdrawMatch?.[1]) {
      const amount = Math.max(0, Number(withdrawMatch[1]));
      plans.push({ tool: 'wallet.withdraw', sensitive: true, summary: `Withdraw ${amount} from wallet.`, action: { type: 'wallet.withdraw', walletId: identity.walletId, amount } });
    }
    const transferMatch = n.match(/\b(?:transfer|send)\s+(\d+(?:\.\d+)?)\s+(?:to)\s+([a-z0-9_:-]+)\b/);
    if (transferMatch?.[1] && transferMatch?.[2]) {
      const amount = Math.max(0, Number(transferMatch[1]));
      const toWalletId = String(transferMatch[2]);
      plans.push({ tool: 'wallet.transfer', sensitive: true, summary: `Transfer ${amount} to ${toWalletId}.`, action: { type: 'wallet.transfer', walletId: identity.walletId, toWalletId, amount } });
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
      const sensitive = mode === 'admin';
      plans.push({ tool: sensitive ? 'fix.bot.behavior.patch' : 'bot.update', sensitive, summary: `Update ${ownerBot.id}: ${details.join(', ')}.`, action: { type: 'bot.config', botId: ownerBot.id, patch } });
    }
    return plans;
  }

  if (mode === 'admin' && (intent === 'runtime_ops' || intent === 'game_fix')) {
    const reconcileMatch = n.match(/\b(?:reconcile|bot count)\s*(?:to)?\s*(\d{1,3})\b/);
    if (reconcileMatch?.[1]) {
      const count = Math.max(0, Math.min(60, Number(reconcileMatch[1])));
      plans.push({ tool: 'fix.bot.reconcile', sensitive: true, summary: `Set background bots to ${count}.`, action: { type: 'bot.reconcile', count } });
    }
    if (/\b(?:apply|run)\s+(?:delegation|directives?)\b/.test(n)) {
      plans.push({ tool: 'fix.runtime.delegation.apply', sensitive: true, summary: 'Apply super-agent delegation.', action: { type: 'delegation.apply' } });
    }
  }

  return plans;
}

// ── Plan execution (reconstructs from action spec) ───────────────────────────

async function executeAction(
  action: PlanAction,
  runtimeFetch: RuntimeFetch
): Promise<{ summary: string; stateSnapshot?: Record<string, unknown> }> {
  switch (action.type) {
    case 'status.fetch': {
      const status = await runtimeFetch<Record<string, unknown>>('/status');
      return { summary: `bots configured=${Number(status?.configuredBotCount ?? 0)} connected=${Number(status?.connectedBotCount ?? 0)}`, stateSnapshot: status };
    }
    case 'wallet.gas': {
      const payload = await runtimeFetch<{ results?: Array<{ ok?: boolean; reason?: string }> }>(
        '/wallets/onchain/prepare-escrow', { method: 'POST', body: { walletIds: [action.walletId], amount: 1 } }
      );
      const st = payload.results?.[0];
      return { summary: st?.ok ? `Gas prepared for ${action.walletId}.` : `Gas prepare status=${st?.reason ?? 'unknown'}.` };
    }
    case 'wallet.fund':
      await runtimeFetch(`/wallets/${action.walletId}/fund`, { method: 'POST', body: { amount: action.amount } });
      return { summary: `Funded wallet by ${action.amount}.` };
    case 'wallet.withdraw':
      await runtimeFetch(`/wallets/${action.walletId}/withdraw`, { method: 'POST', body: { amount: action.amount } });
      return { summary: `Withdrew ${action.amount}.` };
    case 'wallet.transfer':
      await runtimeFetch(`/wallets/${action.walletId}/transfer`, { method: 'POST', body: { toWalletId: action.toWalletId, amount: action.amount } });
      return { summary: `Transferred ${action.amount} to ${action.toWalletId}.` };
    case 'bot.config':
      await runtimeFetch(`/agents/${action.botId}/config`, { method: 'POST', body: action.patch });
      return { summary: `Updated ${action.botId}.` };
    case 'bot.reconcile':
      await runtimeFetch('/agents/reconcile', { method: 'POST', body: { count: action.count } });
      return { summary: `Reconciled background bots to ${action.count}.` };
    case 'house.config':
      await runtimeFetch('/house/config', { method: 'POST', body: { npcWalletFloor: action.npcFloor, npcWalletTopupAmount: action.topup, superAgentWalletFloor: action.superFloor } });
      return { summary: 'Updated house config.' };
    case 'delegation.apply':
      await runtimeFetch('/super-agent/delegate/apply', { method: 'POST', body: {} });
      return { summary: 'Applied super-agent delegation.' };
    default:
      return { summary: 'Unknown action type.' };
  }
}

async function executePlans(
  plans: SerializablePlan[],
  runtimeFetch: RuntimeFetch
): Promise<{
  actions: CloudflareChiefResponse['actions'];
  replyParts: string[];
  stateSnapshot?: Record<string, unknown>;
}> {
  const actions: CloudflareChiefResponse['actions'] = [];
  const replyParts: string[] = [];
  let stateSnapshot: Record<string, unknown> | undefined;

  for (const plan of plans) {
    try {
      const result = await executeAction(plan.action, runtimeFetch);
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

// ── Qwen LLM fallback ─────────────────────────────────────────────────────────

async function callQwen(baseUrl: string, apiKey: string, systemPrompt: string, userMessage: string): Promise<string> {
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'authorization': `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: QWEN_MODEL, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userMessage }], max_tokens: 400, temperature: 0.4 }),
  }).catch(() => null);
  if (!res?.ok) return '';
  const data = await res.json().catch(() => null) as Record<string, unknown> | null;
  return String((data as any)?.choices?.[0]?.message?.content ?? '').trim();
}

async function buildStateSnippet(runtimeFetch: RuntimeFetch): Promise<string> {
  try {
    const s = await runtimeFetch<Record<string, unknown>>('/status');
    return `bots=${Number(s?.configuredBotCount ?? 0)} connected=${Number(s?.connectedBotCount ?? 0)} playerBots=${Number(s?.profileBotCount ?? 0)}`;
  } catch { return 'status=unavailable'; }
}

function buildSystemPrompt(mode: ChiefMode, stateSnippet: string): string {
  const base = `You are Chief, the AI operations controller for AutoBett Arena — an onchain agent wagering platform.
Respond in ≤3 sentences. Be direct and actionable. Use arena terminology.
Arena state: ${stateSnippet}`;
  return mode === 'admin'
    ? `${base}\nAdmin mode: advise on reconciliation, house settings, and player management.`
    : `${base}\nPlayer mode: help manage agent, wallet, and strategy.`;
}

// ── Public factory ────────────────────────────────────────────────────────────

export function createCloudflareChief(
  db: D1Like,
  qwenBaseUrl: string,
  qwenApiKey: string,
  runtimeFetch: RuntimeFetch
) {
  async function handleChat(
    identity: IdentityLike,
    request: CloudflareChiefRequest
  ): Promise<CloudflareChiefResponse> {
    // Best-effort prune; don't block the request if it fails
    pruneExpired(db).catch(() => undefined);

    const mode: ChiefMode = identity.role === 'admin' ? 'admin' : 'player';
    const message = String(request.message ?? '').trim();

    if (!message && !request.confirmToken) {
      return { ok: false, mode, intent: 'unknown', reply: 'Message is required.', actions: [], requiresConfirmation: false, errors: [{ code: 'message_required', message: 'Provide a message.' }] };
    }

    // ── Confirmation flow ──────────────────────────────────────────────────
    if (request.confirmToken) {
      const stored = await loadConfirmation(db, request.confirmToken);
      if (!stored || stored.expiresAt <= Date.now()) {
        return { ok: false, mode, intent: 'unknown', reply: 'Confirmation token expired or not found.', actions: [], requiresConfirmation: false, errors: [{ code: 'confirm_token_invalid', message: 'Invalid or expired token.' }] };
      }
      if (stored.ownerSub !== identity.sub) {
        return { ok: false, mode, intent: stored.intent, reply: 'Token does not belong to this account.', actions: [], requiresConfirmation: false, errors: [{ code: 'confirm_token_owner_mismatch', message: 'Token owner mismatch.' }] };
      }
      await deleteConfirmation(db, request.confirmToken);
      const executed = await executePlans(stored.plans, runtimeFetch);
      return { ok: true, mode: stored.mode, intent: stored.intent, reply: executed.replyParts.join('\n') || 'Confirmed and executed.', actions: executed.actions, requiresConfirmation: false, stateSnapshot: executed.stateSnapshot };
    }

    // ── Build and evaluate plans ───────────────────────────────────────────
    const intent = detectIntent(message);
    const plans = await buildPlans(mode, intent, message, identity, runtimeFetch);
    const sensitivePlans = plans.filter((p) => p.sensitive);

    if (plans.length > 0 && sensitivePlans.length > 0) {
      const token = `cst_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`;
      await storeConfirmation(db, { token, ownerSub: identity.sub, mode, intent, expiresAt: Date.now() + CONFIRM_TTL_MS, plans });
      return {
        ok: true, mode, intent,
        reply: ['I can do that — confirm to execute:', ...plans.map((p) => `- ${p.summary}`)].join('\n'),
        actions: plans.map((p) => ({ tool: p.tool, status: 'planned' as const, summary: p.summary })),
        requiresConfirmation: true, confirmToken: token,
      };
    }

    if (plans.length > 0) {
      const executed = await executePlans(plans, runtimeFetch);
      return { ok: true, mode, intent, reply: executed.replyParts.join('\n') || 'Done.', actions: executed.actions, requiresConfirmation: false, stateSnapshot: executed.stateSnapshot };
    }

    // ── LLM fallback ───────────────────────────────────────────────────────
    if (qwenApiKey) {
      const snippet = await buildStateSnippet(runtimeFetch);
      const llmReply = await callQwen(qwenBaseUrl, qwenApiKey, buildSystemPrompt(mode, snippet), message);
      if (llmReply) return { ok: true, mode, intent, reply: llmReply, actions: [], requiresConfirmation: false };
    }

    return { ok: true, mode, intent, reply: 'No action matched. Try: "status", "set personality aggressive", "fund 5", or "reconcile bots to 10".', actions: [], requiresConfirmation: false };
  }

  return { handleChat };
}
