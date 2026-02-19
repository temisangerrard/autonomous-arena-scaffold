import { createHash, randomBytes } from 'node:crypto';
import type { Chief2CommandRequest, Chief2CommandResponse, Chief2Deps, Chief2Event, Chief2Identity, Chief2Incident, Chief2Telemetry } from './contracts.js';
import { createOpenRouterProvider } from './ai/provider.js';
import { runChief2Loop } from './core/agentLoop.js';
import { buildChief2Plans, type Chief2Plan } from './core/toolRegistry.js';
import { Chief2MemoryStore } from './runtime/memoryStore.js';
import { listChief2Runbooks } from './runtime/runbooks.js';
import { Chief2SessionStore } from './runtime/sessionStore.js';

type PendingConfirmation = {
  token: string;
  ownerSub: string;
  intent: Chief2CommandResponse['intent'];
  objective: string;
  expiresAt: number;
  plans: Chief2Plan[];
};

type RuntimeStatusRecord = Record<string, unknown> & {
  wsAuthMismatchLikely?: unknown;
  disconnectedBotIds?: unknown;
  house?: unknown;
};

const CONFIRM_TTL_MS = 120_000;

function newTraceId(): string {
  return `trace_${randomBytes(10).toString('hex')}`;
}

function hashIncident(parts: string[]): string {
  return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 16);
}

function defaultReply(): string {
  return 'Chief Ops is alive. Try: "status", "reconcile bots to 8", "check sponsor gas", or "sync markets".';
}

function nowIso(): string {
  return new Date().toISOString();
}

export function createChief2Service(deps: Chief2Deps) {
  const ai = createOpenRouterProvider();
  const memory = new Chief2MemoryStore();
  const sessions = new Chief2SessionStore();
  const pending = new Map<string, PendingConfirmation>();
  const telemetry: Chief2Telemetry = {
    totalCommands: 0,
    nonEmptyReplyCount: 0,
    toolExecutionCount: 0,
    confirmationRequestedCount: 0,
    confirmationCompletedCount: 0,
    failures: {}
  };

  function incFailure(code: string): void {
    telemetry.failures[code] = Number(telemetry.failures[code] || 0) + 1;
  }

  function prunePending(): void {
    const now = Date.now();
    for (const [token, item] of pending.entries()) {
      if (item.expiresAt <= now) {
        pending.delete(token);
      }
    }
  }

  function trackIncidentsFromStatus(status: Record<string, unknown>, traceId?: string): void {
    const wsMismatch = Boolean(status.wsAuthMismatchLikely);
    const disconnected = Array.isArray(status.disconnectedBotIds) ? status.disconnectedBotIds : [];
    const sponsor = ((status.house as { sponsorGas?: { status?: string; balanceEth?: string | null } } | undefined)?.sponsorGas) || undefined;

    if (wsMismatch) {
      memory.upsertIncident({
        id: `inc_${hashIncident(['ws_mismatch'])}`,
        at: Date.now(),
        severity: 'high',
        title: 'WebSocket auth mismatch likely',
        detail: 'Runtime indicates bot websocket auth mismatch. Verify shared secret and token format.',
        status: 'open',
        traceId
      });
    }

    if (disconnected.length > 0) {
      memory.upsertIncident({
        id: `inc_${hashIncident(['bots_disconnected'])}`,
        at: Date.now(),
        severity: disconnected.length > 5 ? 'high' : 'medium',
        title: 'Bots disconnected',
        detail: `${disconnected.length} bots currently disconnected.`,
        status: 'open',
        traceId
      });
    }

    if (String(sponsor?.status || '') === 'red') {
      memory.upsertIncident({
        id: `inc_${hashIncident(['sponsor_gas_red'])}`,
        at: Date.now(),
        severity: 'high',
        title: 'Sponsor gas depleted',
        detail: `Sponsor gas red. balanceEth=${String(sponsor?.balanceEth ?? '-')}.`,
        status: 'open',
        traceId
      });
    }
  }

  async function summarizeWithLlmIfNeeded(input: {
    message: string;
    objective: string;
    details: string;
  }): Promise<string | null> {
    const prompt = [
      `Operator message: ${input.message}`,
      `Objective: ${input.objective}`,
      `Execution details:`,
      input.details
    ].join('\n');
    return ai.complete({
      system: 'You are Chief Ops. Be concise, operational, and factual. Never invent actions.',
      prompt
    });
  }

  async function executePlans(params: {
    message: string;
    intent: Chief2CommandResponse['intent'];
    sessionId: string;
    traceId: string;
    objective: string;
    plans: Chief2Plan[];
    identity: Chief2Identity;
  }): Promise<Chief2CommandResponse> {
    const loop = await runChief2Loop({ objective: params.objective, plans: params.plans });
    telemetry.toolExecutionCount += loop.actions.filter((entry) => entry.status === 'executed').length;

    const details = loop.replyParts.join('\n').trim();
    let reply = details;
    if (!reply) {
      const llm = await summarizeWithLlmIfNeeded({
        message: params.message,
        objective: params.objective,
        details: 'No concrete output from deterministic tools.'
      });
      reply = String(llm || '').trim() || defaultReply();
      loop.events.push({ type: 'fallback', at: Date.now(), message: llm ? 'LLM fallback summary used.' : 'Deterministic fallback used.' });
    }

    if (reply.length > 0) {
      telemetry.nonEmptyReplyCount += 1;
    } else {
      incFailure('empty_reply');
      reply = defaultReply();
    }

    memory.recordTurn({
      at: Date.now(),
      traceId: params.traceId,
      sessionId: params.sessionId,
      ownerSub: params.identity.sub,
      message: params.message,
      intent: params.intent,
      actions: loop.actions,
      reply,
      executionGraph: loop.executionGraph
    });

    if (loop.stateSnapshot) {
      trackIncidentsFromStatus(loop.stateSnapshot, params.traceId);
    }

    return {
      ok: true,
      reply,
      intent: params.intent,
      actions: loop.actions,
      executionGraph: loop.executionGraph,
      requiresConfirmation: false,
      traceId: params.traceId,
      sessionId: params.sessionId,
      stateSnapshot: loop.stateSnapshot,
      events: loop.events
    };
  }

  async function command(identity: Chief2Identity, request: Chief2CommandRequest): Promise<Chief2CommandResponse> {
    telemetry.totalCommands += 1;
    prunePending();
    const session = sessions.getOrCreate(identity.sub);
    const traceId = newTraceId();

    if (request.confirmToken) {
      const item = pending.get(String(request.confirmToken));
      if (!item) {
        incFailure('confirm_not_found');
        return {
          ok: false,
          reply: 'Confirmation token not found or expired.',
          intent: 'runtime_ops',
          actions: [],
          executionGraph: {
            objective: 'confirm pending action',
            steps: [{ tool: 'confirm.token', status: 'blocked', summary: 'Token not found or expired.' }],
            stopReason: 'blocked'
          },
          requiresConfirmation: false,
          traceId,
          sessionId: session.id,
          events: [{ type: 'blocked', at: Date.now(), tool: 'confirm.token', message: 'Token not found or expired.' }]
        };
      }
      if (item.ownerSub !== identity.sub) {
        incFailure('confirm_forbidden');
        return {
          ok: false,
          reply: 'Confirmation token belongs to another operator session.',
          intent: item.intent,
          actions: [],
          executionGraph: {
            objective: item.objective,
            steps: [{ tool: 'confirm.token', status: 'blocked', summary: 'Token owner mismatch.' }],
            stopReason: 'blocked'
          },
          requiresConfirmation: false,
          traceId,
          sessionId: session.id,
          events: [{ type: 'blocked', at: Date.now(), tool: 'confirm.token', message: 'Token owner mismatch.' }]
        };
      }
      pending.delete(item.token);
      telemetry.confirmationCompletedCount += 1;
      return executePlans({
        message: 'confirmed execution',
        intent: item.intent,
        sessionId: session.id,
        traceId,
        objective: item.objective,
        plans: item.plans,
        identity
      });
    }

    const message = String(request.message || '').trim();
    if (!message) {
      return {
        ok: false,
        reply: 'Message required. Try: status, reconcile bots to 8, check sponsor gas, sync markets.',
        intent: 'unknown',
        actions: [],
        executionGraph: {
          objective: 'collect operator command input',
          steps: [{ tool: 'input.required', status: 'blocked', summary: 'message is required' }],
          stopReason: 'blocked'
        },
        requiresConfirmation: false,
        traceId,
        sessionId: session.id,
        events: [{ type: 'blocked', at: Date.now(), tool: 'input.required', message: 'message is required' }]
      };
    }

    const selected = await buildChief2Plans(deps, identity, message);
    const sensitive = selected.plans.some((plan) => plan.sensitive);

    if (sensitive) {
      const token = createHash('sha256')
        .update(`${identity.sub}:${message}:${Date.now()}:${randomBytes(6).toString('hex')}`)
        .digest('hex')
        .slice(0, 18);
      pending.set(token, {
        token,
        ownerSub: identity.sub,
        intent: selected.intent,
        objective: selected.objective,
        expiresAt: Date.now() + CONFIRM_TTL_MS,
        plans: selected.plans
      });
      telemetry.confirmationRequestedCount += 1;
      const events: Chief2Event[] = selected.plans.map((plan) => ({
        type: 'plan',
        at: Date.now(),
        tool: plan.tool,
        message: plan.summary
      }));
      const actions = selected.plans.map((plan) => ({ tool: plan.tool, status: 'planned' as const, summary: plan.summary }));
      const reply = `Planned ${actions.length} action${actions.length === 1 ? '' : 's'}. Confirmation required. Token expires in ${Math.floor(CONFIRM_TTL_MS / 1000)}s.`;
      telemetry.nonEmptyReplyCount += 1;
      return {
        ok: true,
        reply,
        intent: selected.intent,
        actions,
        executionGraph: {
          objective: selected.objective,
          steps: actions.map((entry) => ({ tool: entry.tool, status: 'planned', summary: entry.summary })),
          stopReason: 'fallback'
        },
        requiresConfirmation: true,
        confirmToken: token,
        traceId,
        sessionId: session.id,
        events
      };
    }

    return executePlans({
      message,
      intent: selected.intent,
      sessionId: session.id,
      traceId,
      objective: selected.objective,
      plans: selected.plans,
      identity
    });
  }

  async function bootstrap() {
    const [runtimeStatusRaw, serverHealth, runtimeHealth] = await Promise.all([
      deps.runtimeGet<Record<string, unknown>>('/status').catch(() => ({})),
      deps.serverGet<Record<string, unknown>>('/health').catch(() => ({ ok: false })),
      deps.runtimeGet<Record<string, unknown>>('/health').catch(() => ({ ok: false }))
    ]);
    const runtimeStatus = runtimeStatusRaw as RuntimeStatusRecord;

    trackIncidentsFromStatus(runtimeStatus);

    const degradedReasons: string[] = [];
    const disconnectedBotIds = Array.isArray(runtimeStatus.disconnectedBotIds) ? runtimeStatus.disconnectedBotIds : [];
    if (Boolean(runtimeStatus.wsAuthMismatchLikely)) degradedReasons.push('ws_auth_mismatch_likely');
    if (disconnectedBotIds.length > 0) degradedReasons.push('bots_disconnected');
    const sponsorStatus = ((runtimeStatus.house as { sponsorGas?: { status?: string } } | undefined)?.sponsorGas?.status || 'unknown');
    if (sponsorStatus === 'red') degradedReasons.push('sponsor_gas_red');

    return {
      ok: true,
      mission: {
        id: 'chief_ops_pi_parallel',
        name: 'Chief Ops Agent',
        charterVersion: 'v1',
        summary: 'Stabilize runtime health, protect player experience, and execute safe operations with confirmation for sensitive actions.',
        generatedAt: nowIso()
      },
      liveState: {
        runtime: runtimeStatus,
        serverHealth,
        runtimeHealth,
        degradedReasons
      },
      incidents: memory.listIncidents(40),
      runbooks: listChief2Runbooks(),
      telemetry: { ...telemetry, failures: { ...telemetry.failures } }
    };
  }

  function listIncidents(limit = 80): Chief2Incident[] {
    return memory.listIncidents(limit);
  }

  function listRunbooks() {
    return listChief2Runbooks();
  }

  function metrics() {
    return { ...telemetry, failures: { ...telemetry.failures } };
  }

  return {
    command,
    bootstrap,
    listIncidents,
    listRunbooks,
    metrics
  };
}
