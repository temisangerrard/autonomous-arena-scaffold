import type { Chief2Deps, Chief2Identity, Chief2Intent } from '../contracts.js';

export type Chief2PlanResult = {
  summary: string;
  stateSnapshot?: Record<string, unknown>;
};

export type Chief2Plan = {
  tool: string;
  sensitive: boolean;
  summary: string;
  execute: () => Promise<Chief2PlanResult>;
};

export type Chief2PlanSelection = {
  intent: Chief2Intent;
  objective: string;
  plans: Chief2Plan[];
};

type RuntimeStatusPayload = {
  configuredBotCount?: number;
  connectedBotCount?: number;
  wsAuthMismatchLikely?: boolean;
  disconnectedBotIds?: string[];
  house?: {
    sponsorGas?: {
      status?: 'green' | 'yellow' | 'red' | 'unknown';
      balanceEth?: string | null;
      thresholdEth?: string;
      topupEth?: string;
    };
    wallet?: { balance?: number; id?: string };
  };
};

function detectIntent(message: string): Chief2Intent {
  const normalized = String(message || '').toLowerCase();
  if (/\b(status|health|summary|heartbeat|state)\b/.test(normalized)) {
    return 'status_explain';
  }
  if (/\b(bot|reconcile|delegation|runtime|gas|sponsor)\b/.test(normalized)) {
    return 'runtime_ops';
  }
  if (/\b(user|player|teleport|logout|credit|debit|wallet adjust)\b/.test(normalized)) {
    return 'user_admin';
  }
  if (/\b(market|oracle|activate|deactivate|sync)\b/.test(normalized)) {
    return 'market_ops';
  }
  return 'unknown';
}

function summarizeRuntime(status: RuntimeStatusPayload): string {
  const configured = Number(status.configuredBotCount || 0);
  const connected = Number(status.connectedBotCount || 0);
  const disconnected = Array.isArray(status.disconnectedBotIds) ? status.disconnectedBotIds.length : 0;
  const wsMismatch = Boolean(status.wsAuthMismatchLikely);
  const sponsor = status.house?.sponsorGas;
  const sponsorStatus = sponsor?.status || 'unknown';
  return [
    `bots configured=${configured} connected=${connected} disconnected=${disconnected}`,
    `ws_auth_mismatch=${wsMismatch ? 'likely' : 'no'}`,
    `sponsor_gas=${sponsorStatus} balanceEth=${String(sponsor?.balanceEth ?? '-')}`
  ].join('\n');
}

export async function buildChief2Plans(deps: Chief2Deps, identity: Chief2Identity, message: string): Promise<Chief2PlanSelection> {
  const intent = detectIntent(message);
  const normalized = String(message || '').toLowerCase().trim();
  const plans: Chief2Plan[] = [];

  if (intent === 'status_explain' || intent === 'unknown') {
    plans.push({
      tool: 'inspect.runtime.status',
      sensitive: false,
      summary: 'Collect runtime operational status.',
      execute: async () => {
        const status = await deps.runtimeGet<RuntimeStatusPayload>('/status').catch(() => ({} as RuntimeStatusPayload));
        return {
          summary: summarizeRuntime(status),
          stateSnapshot: {
            configuredBotCount: status.configuredBotCount || 0,
            connectedBotCount: status.connectedBotCount || 0,
            disconnectedBotIds: status.disconnectedBotIds || [],
            wsAuthMismatchLikely: Boolean(status.wsAuthMismatchLikely),
            sponsorGas: status.house?.sponsorGas || null
          }
        };
      }
    });
    return {
      intent: intent === 'unknown' ? 'status_explain' : intent,
      objective: 'inspect runtime state and explain current posture',
      plans
    };
  }

  if (intent === 'runtime_ops') {
    if (/\breconcile\b/.test(normalized)) {
      const countMatch = normalized.match(/\b(?:to|count)\s+(\d{1,2})\b/);
      const count = Math.max(0, Math.min(60, Number(countMatch?.[1] || 8)));
      plans.push({
        tool: 'runtime.bots.reconcile',
        sensitive: true,
        summary: `Reconcile runtime background bot count to ${count}.`,
        execute: async () => {
          await deps.runtimePost('/agents/reconcile', { count });
          return { summary: `Reconciled background bots to ${count}.` };
        }
      });
    }

    if (/\b(apply\s+delegation|delegation)\b/.test(normalized)) {
      plans.push({
        tool: 'runtime.delegation.apply',
        sensitive: true,
        summary: 'Apply runtime super-agent delegation policy.',
        execute: async () => {
          await deps.runtimePost('/super-agent/delegate/apply', {});
          return { summary: 'Applied runtime delegation policy.' };
        }
      });
    }

    if (/\b(gas|sponsor)\b/.test(normalized)) {
      plans.push({
        tool: 'runtime.gas.inspect',
        sensitive: false,
        summary: 'Inspect sponsor gas diagnostics.',
        execute: async () => {
          const status = await deps.runtimeGet<RuntimeStatusPayload>('/status').catch(() => ({} as RuntimeStatusPayload));
          const sponsor = status.house?.sponsorGas;
          return {
            summary: `Sponsor gas status=${String(sponsor?.status || 'unknown')} balanceEth=${String(sponsor?.balanceEth ?? '-')}`,
            stateSnapshot: { sponsorGas: sponsor || null }
          };
        }
      });

      const refillMatch = normalized.match(/\brefill\s+(\d+(?:\.\d+)?)\b/);
      if (refillMatch?.[1]) {
        const amount = Math.max(0, Number(refillMatch[1]));
        plans.push({
          tool: 'runtime.house.refill',
          sensitive: true,
          summary: `Refill house treasury by ${amount}.`,
          execute: async () => {
            await deps.runtimePost('/house/refill', { amount, reason: 'admin_chief2' });
            return { summary: `Submitted house refill for ${amount}.` };
          }
        });
      }
    }

    if (plans.length === 0) {
      plans.push({
        tool: 'inspect.runtime.status',
        sensitive: false,
        summary: 'No specific runtime command detected; returning status.',
        execute: async () => {
          const status = await deps.runtimeGet<RuntimeStatusPayload>('/status').catch(() => ({} as RuntimeStatusPayload));
          return { summary: summarizeRuntime(status), stateSnapshot: { status } };
        }
      });
    }

    return { intent, objective: 'execute runtime maintenance actions', plans };
  }

  if (intent === 'user_admin') {
    const profileId = (normalized.match(/\b(?:user|player)\s+([a-z0-9_.-]+)/)?.[1] || '').trim();
    if (!profileId) {
      return {
        intent,
        objective: 'collect user-admin action input',
        plans: [{
          tool: 'user.input.required',
          sensitive: false,
          summary: 'User reference missing (expected: user <profileId>).',
          execute: async () => ({ summary: 'User action requires profile id. Example: "teleport user profile_7 section 3".' })
        }]
      };
    }

    if (/\bteleport\b/.test(normalized)) {
      const sectionMatch = normalized.match(/\bsection\s+(\d{1,2})\b/);
      const section = sectionMatch ? Math.max(1, Math.min(8, Number(sectionMatch[1]))) : undefined;
      plans.push({
        tool: 'users.teleport',
        sensitive: true,
        summary: `Teleport ${profileId}${section ? ` to section ${section}` : ''}.`,
        execute: async () => {
          await deps.adminActions.userTeleport({ profileId, section });
          return { summary: `Teleported ${profileId}${section ? ` to section ${section}` : ''}.` };
        }
      });
    }

    const adjustMatch = normalized.match(/\b(credit|debit)\s+(\d+(?:\.\d+)?)\b/);
    if (adjustMatch?.[1] && adjustMatch?.[2]) {
      const direction = adjustMatch[1] as 'credit' | 'debit';
      const amount = Math.max(0, Number(adjustMatch[2]));
      plans.push({
        tool: 'users.wallet.adjust',
        sensitive: true,
        summary: `${direction} ${amount} for ${profileId}.`,
        execute: async () => {
          await deps.adminActions.userWalletAdjust({ profileId, direction, amount, reason: 'admin_chief2' });
          return { summary: `${direction} applied (${amount}) for ${profileId}.` };
        }
      });
    }

    if (/\blogout\b/.test(normalized)) {
      plans.push({
        tool: 'users.logout',
        sensitive: true,
        summary: `Force logout for ${profileId}.`,
        execute: async () => {
          await deps.adminActions.userLogout({ profileId });
          return { summary: `Forced logout for ${profileId}.` };
        }
      });
    }

    if (plans.length === 0) {
      plans.push({
        tool: 'user.input.required',
        sensitive: false,
        summary: 'No supported user action detected.',
        execute: async () => ({ summary: 'Supported user actions: teleport, credit/debit, logout.' })
      });
    }

    return { intent, objective: `execute user admin actions for ${profileId}`, plans };
  }

  if (intent === 'market_ops') {
    if (/\bsync\b/.test(normalized)) {
      plans.push({
        tool: 'markets.sync',
        sensitive: true,
        summary: 'Sync prediction markets from oracle.',
        execute: async () => {
          await deps.serverPost('/admin/markets/sync', {});
          return { summary: 'Synced prediction markets.' };
        }
      });
    }
    const activateMatch = normalized.match(/\bactivate\s+([a-z0-9_-]{3,})\b/);
    if (activateMatch?.[1]) {
      const marketId = activateMatch[1];
      plans.push({
        tool: 'markets.activate',
        sensitive: true,
        summary: `Activate market ${marketId}.`,
        execute: async () => {
          await deps.serverPost('/admin/markets/activate', { marketId });
          return { summary: `Activated market ${marketId}.` };
        }
      });
    }
    const deactivateMatch = normalized.match(/\bdeactivate\s+([a-z0-9_-]{3,})\b/);
    if (deactivateMatch?.[1]) {
      const marketId = deactivateMatch[1];
      plans.push({
        tool: 'markets.deactivate',
        sensitive: true,
        summary: `Deactivate market ${marketId}.`,
        execute: async () => {
          await deps.serverPost('/admin/markets/deactivate', { marketId });
          return { summary: `Deactivated market ${marketId}.` };
        }
      });
    }

    if (plans.length === 0) {
      plans.push({
        tool: 'markets.help',
        sensitive: false,
        summary: 'No market action detected.',
        execute: async () => ({ summary: 'Supported market actions: sync, activate <marketId>, deactivate <marketId>.' })
      });
    }

    return { intent, objective: 'execute market operations', plans };
  }

  return {
    intent: 'unknown',
    objective: 'return a safe operational summary',
    plans: [
      {
        tool: 'inspect.runtime.status',
        sensitive: false,
        summary: 'Fallback to runtime status.',
        execute: async () => {
          const status = await deps.runtimeGet<RuntimeStatusPayload>('/status').catch(() => ({} as RuntimeStatusPayload));
          return { summary: summarizeRuntime(status), stateSnapshot: { status, actor: identity.sub } };
        }
      }
    ]
  };
}
