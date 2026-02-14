import type { AgentBehaviorConfig } from './AgentBot.js';
import type { Personality } from './PolicyEngine.js';

export type SuperAgentMode = 'balanced' | 'hunter' | 'defensive';

export type WalletPolicy = {
  enabled: boolean;
  allowedSkills: string[];
  maxBetPercentOfBankroll: number;
  maxDailyTxCount: number;
  requireEscrowForChallenges: boolean;
};

export type LlmPolicy = {
  enabled: boolean;
  provider: 'openrouter';
  model: string;
  maxRequestsPerHourPerAgent: number;
  maxTokensPerDayPerAgent: number;
};

export type SuperAgentConfig = {
  id: string;
  mode: SuperAgentMode;
  challengeEnabled: boolean;
  defaultChallengeCooldownMs: number;
  workerTargetPreference: 'human_only' | 'human_first' | 'any';
  llmPolicy: LlmPolicy;
  walletPolicy: WalletPolicy;
};

export type WorkerDirective = {
  botId: string;
  patch: Partial<AgentBehaviorConfig>;
};

export function createDefaultSuperAgentConfig(id: string): SuperAgentConfig {
  return {
    id,
    mode: 'balanced',
    challengeEnabled: true,
    defaultChallengeCooldownMs: 5000,
    workerTargetPreference: 'any',
    llmPolicy: {
      enabled: true,
      provider: 'openrouter',
      model: 'openrouter/auto',
      maxRequestsPerHourPerAgent: 500,
      maxTokensPerDayPerAgent: 2000000
    },
    walletPolicy: {
      enabled: false,
      allowedSkills: [
        'authenticate-wallet',
        'fund',
        'send-usdc',
        'trade',
        'query-onchain-data',
        'solidity-contract-design',
        'solidity-security-review',
        'evm-gas-optimization'
      ],
      maxBetPercentOfBankroll: 5,
      maxDailyTxCount: 24,
      requireEscrowForChallenges: true
    }
  };
}

function personalityFor(mode: SuperAgentMode, index: number): Personality {
  if (mode === 'hunter') {
    return index % 2 === 0 ? 'aggressive' : 'social';
  }

  if (mode === 'defensive') {
    return index % 2 === 0 ? 'conservative' : 'social';
  }

  const personalities: Personality[] = ['aggressive', 'social', 'conservative'];
  return personalities[index % personalities.length] ?? 'social';
}

export function buildWorkerDirectives(
  config: SuperAgentConfig,
  allBotIds: string[]
): WorkerDirective[] {
  const workers = allBotIds.filter((id) => id !== config.id).sort();

  return workers.map((botId, index) => ({
    botId,
    patch: {
      personality: personalityFor(config.mode, index),
      mode: config.challengeEnabled ? 'active' : 'passive',
      challengeEnabled: config.challengeEnabled,
      challengeCooldownMs: Math.max(1200, config.defaultChallengeCooldownMs + index * 250),
      targetPreference: config.workerTargetPreference
    }
  }));
}
