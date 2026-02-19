import type { SkillDefinition } from './skillCatalog.js';

export type SkillTraceEntry = {
  step: string;
  status: 'planned' | 'executed' | 'blocked';
  summary: string;
  whySelected?: string;
  whySkipped?: string;
  whyFallback?: string;
};

export type SkillRouteResult = {
  selectedSkills: string[];
  trace: SkillTraceEntry[];
};

const ROUTE_ALIASES: Record<string, string[]> = {
  'authenticate-wallet': ['sign in wallet', 'login wallet', 'connect wallet', 'not signed in', 'auth wallet'],
  fund: ['fund wallet', 'add funds', 'buy usdc', 'deposit usdc', 'top up wallet'],
  'send-usdc': ['send usdc', 'transfer usdc', 'pay ', 'tip '],
  trade: ['swap token', 'trade token', 'buy eth', 'sell eth', 'convert usdc'],
  'query-onchain-data': ['query onchain', 'onchain data', 'base events', 'base transactions'],
  'search-for-service': ['search bazaar', 'find service', 'discover api', 'browse bazaar'],
  'pay-for-service': ['x402 pay', 'paid api', 'call paid endpoint'],
  x402: ['x402', 'payment requirements', '402 endpoint'],
  'monetize-service': ['monetize api', 'paid endpoint', 'sell service', 'charge for api']
};

function norm(input: string): string {
  return input.toLowerCase().replace(/\s+/g, ' ').trim();
}

function matchSkill(message: string, skill: SkillDefinition): { hit: boolean; reason: string } {
  const m = norm(message);
  const skillName = norm(skill.name);
  if (m.includes(skillName)) {
    return { hit: true, reason: `Matched explicit skill name ${skill.name}.` };
  }
  const aliases = ROUTE_ALIASES[skill.name] ?? [];
  for (const alias of aliases) {
    if (m.includes(alias)) {
      return { hit: true, reason: `Matched phrase "${alias}" for ${skill.name}.` };
    }
  }

  const descTokens = norm(skill.description)
    .split(/[^a-z0-9]+/g)
    .filter((entry) => entry.length >= 5)
    .slice(0, 16);
  let tokenHits = 0;
  for (const token of descTokens) {
    if (m.includes(token)) {
      tokenHits += 1;
    }
  }
  if (tokenHits >= 2) {
    return { hit: true, reason: `Matched ${tokenHits} description tokens for ${skill.name}.` };
  }

  return { hit: false, reason: `No deterministic match for ${skill.name}.` };
}

export function routeSkills(message: string, skills: SkillDefinition[]): SkillRouteResult {
  const selected: string[] = [];
  const trace: SkillTraceEntry[] = [];

  for (const skill of skills) {
    const matched = matchSkill(message, skill);
    if (matched.hit) {
      selected.push(skill.name);
      trace.push({
        step: `skill.route.${skill.name}`,
        status: 'planned',
        summary: matched.reason,
        whySelected: matched.reason
      });
    }
  }

  if (selected.includes('trade') || selected.includes('send-usdc') || selected.includes('fund') || selected.includes('pay-for-service')) {
    if (!selected.includes('authenticate-wallet')) {
      selected.unshift('authenticate-wallet');
      trace.push({
        step: 'skill.route.authenticate-wallet',
        status: 'planned',
        summary: 'Injected authentication prerequisite for wallet-sensitive operation.',
        whySelected: 'Wallet-sensitive action matched and auth prerequisite was missing.'
      });
    }
  }

  return {
    selectedSkills: [...new Set(selected)],
    trace
  };
}
