/**
 * Strategy compiler for bot autonomy policies.
 *
 * Accepts natural language spending rules or a named template and compiles
 * them to a BotStrategyPolicy that the agent runtime enforces at the
 * app layer (or on-chain via DelegationManager for smart accounts).
 *
 * Natural language examples:
 *   "Max $50/session, only coinflip, never more than $5 per game"
 *   "Conservative — $100/week, all games, supervised"
 *   "Degen mode: autonomous, $500 weekly, martingale, no limits per game"
 */

// randomUUID is available globally in Node 19+ and via crypto module
const randomUUID: () => string =
  typeof globalThis.crypto?.randomUUID === 'function'
    ? () => globalThis.crypto.randomUUID()
    : () => {
        // Fallback: simple RFC4122 v4 UUID
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
          const r = (Math.random() * 16) | 0;
          return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
        });
      };
import type {
  BotStrategyPolicy,
  AutonomyProfile,
  PolicyEnforcementMode,
  StrategyTemplateId,
  GameType,
} from '@arena/shared';

// ---------------------------------------------------------------------------
// Strategy templates
// ---------------------------------------------------------------------------

export type StrategyTemplate = Omit<BotStrategyPolicy, 'id' | 'compiledAt' | 'delegationHash'>;

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export const STRATEGY_TEMPLATES: Record<StrategyTemplateId, StrategyTemplate> = {
  /**
   * Conservative — supervised, low spend, coinflip only.
   * Suitable for NPCs or new player-owned bots.
   */
  conservative: {
    profile: 'supervised',
    enforcementMode: 'app_layer',
    sourceTemplate: 'conservative',
    sessionBudgetUsdc: 20,
    weeklyBudgetUsdc: 50,
    maxWagerPerGameUsdc: 2,
    allowedGames: ['coinflip'],
    mayInitiateChallenges: false,
    mayAcceptChallenges: true,
    expiresAt: null,
  },

  /**
   * Sparrer — semi-autonomous, moderate spend, all games.
   * Good all-round training partner bot.
   */
  sparrer: {
    profile: 'semi_autonomous',
    enforcementMode: 'app_layer',
    sourceTemplate: 'sparrer',
    sessionBudgetUsdc: 50,
    weeklyBudgetUsdc: 200,
    maxWagerPerGameUsdc: 10,
    allowedGames: ['rps', 'coinflip', 'dice_duel'],
    mayInitiateChallenges: true,
    mayAcceptChallenges: true,
    expiresAt: null,
  },

  /**
   * Degen — fully autonomous, high spend, all games, 30-day expiry.
   * Agent runs unsupervised within a weekly budget.
   */
  degen: {
    profile: 'autonomous',
    enforcementMode: 'app_layer',
    sourceTemplate: 'degen',
    sessionBudgetUsdc: 200,
    weeklyBudgetUsdc: 500,
    maxWagerPerGameUsdc: 50,
    allowedGames: ['rps', 'coinflip', 'dice_duel'],
    mayInitiateChallenges: true,
    mayAcceptChallenges: true,
    expiresAt: Date.now() + THIRTY_DAYS_MS,
  },

  /**
   * Sentinel — semi-autonomous, conservative, RPS patrol focus.
   * Defensive bot that holds a section of the arena.
   */
  sentinel: {
    profile: 'semi_autonomous',
    enforcementMode: 'app_layer',
    sourceTemplate: 'sentinel',
    sessionBudgetUsdc: 30,
    weeklyBudgetUsdc: 100,
    maxWagerPerGameUsdc: 5,
    allowedGames: ['rps'],
    mayInitiateChallenges: false,
    mayAcceptChallenges: true,
    expiresAt: null,
  },

  /**
   * Scout — supervised, minimal spend, explore-first.
   * Wanders the arena without challenging unless challenged.
   */
  scout: {
    profile: 'supervised',
    enforcementMode: 'app_layer',
    sourceTemplate: 'scout',
    sessionBudgetUsdc: 10,
    weeklyBudgetUsdc: 25,
    maxWagerPerGameUsdc: 1,
    allowedGames: ['coinflip', 'rps', 'dice_duel'],
    mayInitiateChallenges: false,
    mayAcceptChallenges: false,
    expiresAt: null,
  },
};

// ---------------------------------------------------------------------------
// Natural language compiler
// ---------------------------------------------------------------------------

const VALID_GAMES: GameType[] = ['rps', 'coinflip', 'dice_duel'];

/**
 * Extract a USD dollar amount from tokens like "$50", "50 usdc", "50 dollars".
 * Returns null if no match.
 */
function extractAmount(text: string, ...keywords: string[]): number | null {
  for (const kw of keywords) {
    // e.g. "max $50 per game", "never more than $100 per tx"
    const patterns = [
      new RegExp(`\\$([\\d.]+)\\s*(?:per\\s+(?:${kw}))?`, 'i'),
      new RegExp(`([\\d.]+)\\s*(?:usdc|usd|\\$)?\\s*(?:per\\s+)?${kw}`, 'i'),
      new RegExp(`${kw}[^\\d$]*\\$?([\\d.]+)`, 'i'),
    ];
    for (const re of patterns) {
      const m = re.exec(text);
      if (m && m[1] != null) {
        const v = parseFloat(m[1]);
        if (!isNaN(v) && v > 0) return v;
      }
    }
  }
  return null;
}

/**
 * Detect autonomy profile from text.
 */
function detectProfile(text: string): AutonomyProfile {
  const lower = text.toLowerCase();
  if (/\bautonomous\b|\bfull.auto\b|\bno.approval\b|\bself.directed\b/.test(lower)) {
    return 'autonomous';
  }
  if (/\bsupervised\b|\bask.first\b|\bmanual.approve\b|\brequire.approval\b/.test(lower)) {
    return 'supervised';
  }
  return 'semi_autonomous';
}

/**
 * Detect enforcement mode from text.
 */
function detectEnforcementMode(text: string): PolicyEnforcementMode {
  const lower = text.toLowerCase();
  if (/\bonchain\b|\bon.chain\b|\bdelegation\b|\bdelegation.manager\b/.test(lower)) {
    return 'onchain';
  }
  return 'app_layer';
}

/**
 * Detect allowed games from text.
 * Defaults to all games if none are explicitly specified.
 */
function detectAllowedGames(text: string): GameType[] {
  const lower = text.toLowerCase();
  const found: GameType[] = [];

  if (/\bcoinflip\b|\bcoin.flip\b/.test(lower)) found.push('coinflip');
  if (/\brps\b|\brock.paper\b/.test(lower)) found.push('rps');
  if (/\bdice\b|\bdice.duel\b/.test(lower)) found.push('dice_duel');

  // "only X" means restrict; without "only" default to all
  if (found.length > 0 && /\bonly\b|\bexclusively\b/.test(lower)) {
    return found;
  }
  if (found.length > 0) {
    // Mentioned some; allow those plus default (all)
    return [...VALID_GAMES];
  }
  return [...VALID_GAMES];
}

/**
 * Detect expiry from text. Looks for patterns like "30 days", "7d", "1 week".
 * Returns unix ms or null.
 */
function detectExpiry(text: string): number | null {
  const lower = text.toLowerCase();
  const dayMatch = /(\d+)\s*(?:day|days|d)\b/.exec(lower);
  if (dayMatch?.[1] != null) {
    return Date.now() + parseInt(dayMatch[1], 10) * 24 * 60 * 60 * 1000;
  }
  const weekMatch = /(\d+)\s*(?:week|weeks|wk|wks)\b/.exec(lower);
  if (weekMatch?.[1] != null) {
    return Date.now() + parseInt(weekMatch[1], 10) * 7 * 24 * 60 * 60 * 1000;
  }
  const monthMatch = /(\d+)\s*(?:month|months|mo)\b/.exec(lower);
  if (monthMatch?.[1] != null) {
    return Date.now() + parseInt(monthMatch[1], 10) * 30 * 24 * 60 * 60 * 1000;
  }
  return null;
}

/**
 * Compile a natural language policy description into a BotStrategyPolicy.
 *
 * Example inputs:
 *   "Max $50/session, only coinflip, never more than $5 per game"
 *   "Autonomous degen: $500/week, all games, expires 30 days"
 *   "Supervised — accept challenges only, $10 session budget"
 */
export function compileNaturalLanguagePolicy(
  text: string,
  overrides?: Partial<Pick<BotStrategyPolicy, 'enforcementMode' | 'expiresAt'>>
): BotStrategyPolicy {
  // Session budget: "max $50/session", "$50 session limit", "50 per session"
  const sessionBudget =
    extractAmount(text, 'session', 'session limit', 'session budget') ??
    extractAmount(text, 'stop.?loss') ??
    50; // conservative default

  // Weekly budget: "$500/week", "500 per week"
  const weeklyBudget = extractAmount(text, 'week', 'weekly', 'per week') ?? undefined;

  // Per-game max: "$5 per game", "never more than $10 per tx", "$10/game"
  const maxWagerPerGame =
    extractAmount(text, 'game', 'tx', 'transaction', 'wager', 'bet', 'per game') ??
    Math.min(10, sessionBudget / 5);

  const profile = detectProfile(text);
  const enforcementMode = overrides?.enforcementMode ?? detectEnforcementMode(text);
  const allowedGames = detectAllowedGames(text);
  const expiresAt = overrides?.expiresAt !== undefined
    ? overrides.expiresAt
    : detectExpiry(text);

  const lower = text.toLowerCase();
  const mayInitiate = !/\bno.initiat\b|\baccept.only\b|\bpassive\b|\bnot.initiat\b/.test(lower);
  const mayAccept = !/\bno.accept\b|\binitiat.only\b/.test(lower);

  return {
    id: randomUUID(),
    profile,
    enforcementMode,
    naturalLanguageDescription: text.trim(),
    sessionBudgetUsdc: Math.max(1, Math.round(sessionBudget)),
    weeklyBudgetUsdc: weeklyBudget ? Math.max(1, Math.round(weeklyBudget)) : undefined,
    maxWagerPerGameUsdc: Math.max(1, Math.round(maxWagerPerGame)),
    allowedGames,
    mayInitiateChallenges: mayInitiate,
    mayAcceptChallenges: mayAccept,
    expiresAt,
    compiledAt: Date.now(),
  };
}

/**
 * Instantiate a named strategy template as a BotStrategyPolicy.
 */
export function instantiateTemplate(templateId: StrategyTemplateId): BotStrategyPolicy {
  const template = STRATEGY_TEMPLATES[templateId];
  // Refresh degen expiry on each instantiation
  const expiresAt = templateId === 'degen' ? Date.now() + THIRTY_DAYS_MS : template.expiresAt;
  return {
    ...template,
    id: randomUUID(),
    compiledAt: Date.now(),
    expiresAt,
  };
}

// ---------------------------------------------------------------------------
// Policy → AgentBehaviorConfig projection
// ---------------------------------------------------------------------------

/**
 * Derive AgentBehaviorConfig patch from a BotStrategyPolicy.
 * Callers should merge this into the existing behavior via updateBehavior().
 */
export function policyToBehaviorPatch(
  policy: BotStrategyPolicy
): import('./AgentBot.js').AgentBehaviorConfig {
  const { profile, allowedGames, maxWagerPerGameUsdc, sessionBudgetUsdc, mayInitiateChallenges, mayAcceptChallenges } = policy;

  const personality =
    profile === 'autonomous' ? 'aggressive'
    : profile === 'semi_autonomous' ? 'social'
    : 'conservative';

  const mode = profile === 'supervised' ? 'passive' : 'active';
  const baseWager = Math.max(1, Math.min(50, Math.floor(maxWagerPerGameUsdc)));
  const maxWager = Math.max(baseWager, Math.min(100, Math.floor(maxWagerPerGameUsdc)));

  return {
    personality,
    mode,
    challengeEnabled: mayInitiateChallenges,
    challengeCooldownMs: profile === 'autonomous' ? 2000 : profile === 'semi_autonomous' ? 5000 : 10000,
    targetPreference: profile === 'supervised' ? 'human_only' : 'any',
    baseWager,
    maxWager,
    sessionLossLimit: sessionBudgetUsdc,
    autoplay: {
      enabled: profile !== 'supervised',
      allowedGames: allowedGames.filter((g): g is 'rps' | 'coinflip' | 'dice_duel' =>
        ['rps', 'coinflip', 'dice_duel'].includes(g)
      ),
      wagerMode: profile === 'autonomous' ? 'percent_wallet' : 'fixed',
      baseWager,
      maxWager,
      walletPercent: profile === 'autonomous' ? 5 : undefined,
      sessionLossLimit: sessionBudgetUsdc,
      cooldownMs: profile === 'autonomous' ? 1500 : 3000,
    },
    strategyPolicy: policy,
  } as import('./AgentBot.js').AgentBehaviorConfig;
}
