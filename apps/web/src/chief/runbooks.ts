import type { IdentityRecord } from '../sessionStore.js';
import type { SkillTraceEntry } from './skillRouter.js';
import type { ChiefDbGateway } from './dbGateway.js';

export type RunbookSafetyClass = 'read_only' | 'mutating' | 'financial';

export type RunbookPlan = {
  tool: string;
  sensitive: boolean;
  summary: string;
  execute: () => Promise<{ summary: string; stateSnapshot?: Record<string, unknown> }>;
};

export type RunbookSelection = {
  matched: boolean;
  runbook?: string;
  selectedSkills: string[];
  skillTrace: SkillTraceEntry[];
  safetyClass: RunbookSafetyClass;
  requiresInput?: Array<{ key: string; prompt: string; example?: string }>;
  plans: RunbookPlan[];
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

type RunbookDeps = {
  mode: 'player' | 'admin';
  message: string;
  identity: IdentityRecord;
  runtimeGet: <T>(pathname: string) => Promise<T>;
  runtimePost: <T>(pathname: string, body: unknown) => Promise<T>;
  runtimeProfiles: () => Promise<PlayerProfile[]>;
  purgeSessionsForProfile: (profileId: string) => Promise<number>;
  buildStateSnapshot: (identity: IdentityRecord) => Promise<Record<string, unknown>>;
  dbGateway?: ChiefDbGateway;
};

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

export async function buildRunbookSelection(deps: RunbookDeps): Promise<RunbookSelection> {
  const normalized = deps.message.toLowerCase().trim();
  if (deps.mode !== 'admin') {
    return {
      matched: false,
      selectedSkills: [],
      skillTrace: [],
      safetyClass: 'read_only',
      plans: []
    };
  }

  if (/\b(ops state|coo state|ops snapshot|operations snapshot)\b/.test(normalized)) {
    return {
      matched: true,
      runbook: 'ops.state.snapshot',
      selectedSkills: ['inspect.state'],
      skillTrace: [{ step: 'runbook.select.ops.state.snapshot', status: 'planned', summary: 'Selected ops snapshot runbook.' }],
      safetyClass: 'read_only',
      plans: [{
        tool: 'runbook.ops.state.snapshot',
        sensitive: false,
        summary: 'Collect unified operations state snapshot.',
        execute: async () => {
          const [snapshot, economy, integrity] = await Promise.all([
            deps.buildStateSnapshot(deps.identity),
            deps.dbGateway?.getEconomySummary(24),
            deps.dbGateway?.getRuntimeIntegrity()
          ]);
          return {
            summary: [
              'Collected COO snapshot.',
              economy ? `economy: challenges=${economy.challengeCount} wagered=${economy.totalWagered.toFixed(2)} activePlayers=${economy.activePlayers}` : 'economy: db unavailable',
              integrity ? `runtime: profiles=${integrity.profileCount} wallets=${integrity.walletCount} missingWalletLinks=${integrity.profilesMissingWallets}` : 'runtime: db unavailable'
            ].join('\n'),
            stateSnapshot: {
              ...snapshot,
              economy,
              runtimeIntegrity: integrity,
              dbHealth: deps.dbGateway?.health() ?? { server: false, runtime: false }
            }
          };
        }
      }],
      requiresInput: undefined
    };
  }

  if (/\b(economy|payout|wager|liquidity|risk alerts?)\b/.test(normalized)) {
    return {
      matched: true,
      runbook: 'economy.daily.summary',
      selectedSkills: ['economy.analytics'],
      skillTrace: [{ step: 'runbook.select.economy.daily.summary', status: 'planned', summary: 'Selected economy analytics runbook.' }],
      safetyClass: 'read_only',
      plans: [{
        tool: 'runbook.economy.daily.summary',
        sensitive: false,
        summary: 'Summarize economy health and risk indicators.',
        execute: async () => {
          const economy = await deps.dbGateway?.getEconomySummary(24);
          if (!economy) {
            return { summary: 'Economy summary unavailable (database not configured).' };
          }
          const failRate = economy.escrowEvents > 0 ? (economy.escrowFailures / economy.escrowEvents) * 100 : 0;
          const riskFlags: string[] = [];
          if (failRate >= 10) riskFlags.push(`high_escrow_failure_rate=${failRate.toFixed(1)}%`);
          if (economy.challengeCount > 0 && economy.resolvedCount / economy.challengeCount < 0.6) riskFlags.push('low_resolution_ratio');
          if (economy.totalWagered > 0 && economy.estimatedPayout > economy.totalWagered * 1.5) riskFlags.push('payout_outlier');

          return {
            summary: [
              `24h challenges=${economy.challengeCount} resolved=${economy.resolvedCount} activePlayers=${economy.activePlayers}`,
              `24h wagered=${economy.totalWagered.toFixed(2)} estimatedPayout=${economy.estimatedPayout.toFixed(2)}`,
              `escrow events=${economy.escrowEvents} failures=${economy.escrowFailures}`,
              riskFlags.length > 0 ? `risk alerts: ${riskFlags.join(', ')}` : 'risk alerts: none'
            ].join('\n'),
            stateSnapshot: { economy, riskFlags }
          };
        }
      }],
      requiresInput: undefined
    };
  }

  if (/\b(stuck challenges?|orphan challenges?|challenge ops|challenge summary)\b/.test(normalized)) {
    const includesFix = /\b(fix|repair|resolve|reconcile)\b/.test(normalized);
    const plans: RunbookPlan[] = [{
      tool: 'runbook.challenge.summary',
      sensitive: false,
      summary: 'Inspect challenge pipeline for stale/open issues.',
      execute: async () => {
        const summary = await deps.dbGateway?.getChallengeOpsSummary(40);
        if (!summary) {
          return { summary: 'Challenge summary unavailable (database not configured).' };
        }
        return {
          summary: [
            `challenges total=${summary.total} open=${summary.open} resolved=${summary.resolved} staleOpen=${summary.staleOpen}`,
            summary.staleOpen > 0 ? 'recommendation: run delegation + bot reconcile.' : 'recommendation: no intervention needed.'
          ].join('\n'),
          stateSnapshot: { challengeSummary: summary }
        };
      }
    }];

    if (includesFix) {
      plans.push({
        tool: 'runbook.challenge.reconcile',
        sensitive: true,
        summary: 'Apply safe runtime reconciliation for challenge flow.',
        execute: async () => {
          await deps.runtimePost('/super-agent/delegate/apply', {});
          await deps.runtimePost('/agents/reconcile', { count: 8 });
          return { summary: 'Applied delegation and reconciled background bots to 8.' };
        }
      });
    }

    return {
      matched: true,
      runbook: 'challenge.ops',
      selectedSkills: ['challenge.ops'],
      skillTrace: [{ step: 'runbook.select.challenge.ops', status: 'planned', summary: 'Selected challenge operations runbook.' }],
      safetyClass: includesFix ? 'mutating' : 'read_only',
      plans,
      requiresInput: undefined
    };
  }

  const inspectPlayerMatch = normalized.match(/\b(inspect|show|health)\s+(?:player|user)\s+([a-z0-9_.-]+)\b/);
  if (inspectPlayerMatch?.[2]) {
    const ref = inspectPlayerMatch[2];
    return {
      matched: true,
      runbook: 'player.inspect',
      selectedSkills: ['player.ops.inspect'],
      skillTrace: [{ step: 'runbook.select.player.inspect', status: 'planned', summary: 'Selected player inspection runbook.' }],
      safetyClass: 'read_only',
      plans: [{
        tool: 'runbook.player.inspect',
        sensitive: false,
        summary: `Inspect player ${ref}.`,
        execute: async () => {
          const profiles = await deps.runtimeProfiles().catch(() => [] as PlayerProfile[]);
          const profile = resolveProfileReference(profiles, ref);
          const dbPlayer = await deps.dbGateway?.findPlayerByReference(ref);
          if (!profile && !dbPlayer) {
            return { summary: `Player "${ref}" not found in runtime or db.` };
          }

          return {
            summary: [
              profile ? `runtime: id=${profile.id} username=${profile.username} wallet=${profile.walletId}` : 'runtime: not found',
              dbPlayer ? `db: id=${dbPlayer.id} wins=${dbPlayer.wins} losses=${dbPlayer.losses} wagered=${dbPlayer.totalWagered.toFixed(2)}` : 'db: not found'
            ].join('\n'),
            stateSnapshot: { profile: profile ?? null, dbPlayer: dbPlayer ?? null }
          };
        }
      }],
      requiresInput: undefined
    };
  }

  const logoutMatch = normalized.match(/\blogout\s+(?:player|user)\s+([a-z0-9_.-]+)\b/);
  if (logoutMatch?.[1]) {
    const ref = logoutMatch[1];
    return {
      matched: true,
      runbook: 'player.logout',
      selectedSkills: ['player.ops.logout'],
      skillTrace: [{ step: 'runbook.select.player.logout', status: 'planned', summary: 'Selected player logout runbook.' }],
      safetyClass: 'mutating',
      plans: [{
        tool: 'runbook.player.logout',
        sensitive: true,
        summary: `Force logout for ${ref}.`,
        execute: async () => {
          const profiles = await deps.runtimeProfiles().catch(() => [] as PlayerProfile[]);
          const profile = resolveProfileReference(profiles, ref);
          if (!profile) {
            return { summary: `Player "${ref}" not found.` };
          }
          const deleted = await deps.purgeSessionsForProfile(profile.id);
          return { summary: `Logged out ${profile.displayName}. Sessions terminated: ${deleted}.` };
        }
      }],
      requiresInput: undefined
    };
  }

  const adjustMatch = normalized.match(/\b(credit|debit)\s+(\d+(?:\.\d+)?)\s+(?:to|from)\s+([a-z0-9_.-]+)\b/);
  if (adjustMatch?.[1] && adjustMatch?.[2] && adjustMatch?.[3]) {
    const direction = adjustMatch[1] === 'debit' ? 'debit' : 'credit';
    const amount = Math.max(0, Number(adjustMatch[2]));
    const ref = adjustMatch[3];
    return {
      matched: true,
      runbook: 'wallet.adjust',
      selectedSkills: ['wallet.ops.adjust'],
      skillTrace: [{ step: 'runbook.select.wallet.adjust', status: 'planned', summary: 'Selected wallet adjustment runbook.' }],
      safetyClass: 'financial',
      plans: [{
        tool: 'runbook.wallet.adjust',
        sensitive: true,
        summary: `${direction} ${amount} ${direction === 'credit' ? 'to' : 'from'} ${ref}.`,
        execute: async () => {
          const profiles = await deps.runtimeProfiles().catch(() => [] as PlayerProfile[]);
          const profile = resolveProfileReference(profiles, ref);
          if (!profile) {
            return { summary: `Player "${ref}" not found.` };
          }
          const walletId = profile.wallet?.id ?? profile.walletId;
          if (direction === 'credit') {
            await deps.runtimePost('/house/transfer', { toWalletId: walletId, amount, reason: 'chief_admin_credit' });
            return { summary: `Credited ${amount} to ${profile.displayName}.` };
          }
          const house = await deps.runtimeGet<{ house?: { wallet?: { id?: string } } }>('/house/status').catch(() => null);
          const houseWalletId = String(house?.house?.wallet?.id ?? '').trim();
          if (!houseWalletId) {
            return { summary: 'Could not debit: house wallet unavailable.' };
          }
          await deps.runtimePost(`/wallets/${walletId}/transfer`, { toWalletId: houseWalletId, amount });
          return { summary: `Debited ${amount} from ${profile.displayName}.` };
        }
      }],
      requiresInput: undefined
    };
  }

  if (/\b(runtime integrity|continuity integrity|broken links?|wallet links?)\b/.test(normalized)) {
    const wantsRepair = /\b(repair|fix)\b/.test(normalized);
    return {
      matched: true,
      runbook: 'runtime.integrity',
      selectedSkills: ['runtime.integrity'],
      skillTrace: [{ step: 'runbook.select.runtime.integrity', status: 'planned', summary: 'Selected runtime continuity integrity runbook.' }],
      safetyClass: wantsRepair ? 'mutating' : 'read_only',
      plans: [{
        tool: 'runbook.runtime.integrity',
        sensitive: false,
        summary: 'Validate runtime continuity database integrity.',
        execute: async () => {
          const integrity = await deps.dbGateway?.getRuntimeIntegrity();
          if (!integrity) {
            return { summary: 'Runtime integrity unavailable (database not configured).' };
          }
          return {
            summary: [
              `runtime connected=${integrity.runtimeConnected}`,
              `profiles=${integrity.profileCount} wallets=${integrity.walletCount} ownerBots=${integrity.ownerBotCount}`,
              `missing wallet links=${integrity.profilesMissingWallets} broken subject links=${integrity.subjectLinksMissingProfiles}`
            ].join('\n'),
            stateSnapshot: { runtimeIntegrity: integrity }
          };
        }
      }],
      requiresInput: wantsRepair
        ? [{
            key: 'external_subject',
            prompt: 'Provide external subject/email for continuity repair provisioning.',
            example: 'google:1234567890'
          }]
        : undefined
    };
  }

  return {
    matched: false,
    selectedSkills: [],
    skillTrace: [],
    safetyClass: 'read_only',
    plans: []
  };
}

export function listRunbooks(): Array<{ id: string; summary: string; safetyClass: RunbookSafetyClass }> {
  return [
    { id: 'ops.state.snapshot', summary: 'Unified operations snapshot across runtime/server/db.', safetyClass: 'read_only' },
    { id: 'economy.daily.summary', summary: 'Daily economy summary with risk alerts and payout anomalies.', safetyClass: 'read_only' },
    { id: 'challenge.ops', summary: 'Inspect challenge pipeline and optionally run safe reconciliation.', safetyClass: 'mutating' },
    { id: 'player.inspect', summary: 'Inspect player health across runtime and database.', safetyClass: 'read_only' },
    { id: 'player.logout', summary: 'Force logout sessions for a player.', safetyClass: 'mutating' },
    { id: 'wallet.adjust', summary: 'Credit/debit player wallet via house transfer pathways.', safetyClass: 'financial' },
    { id: 'runtime.integrity', summary: 'Validate runtime continuity links and detect missing records.', safetyClass: 'read_only' }
  ];
}
