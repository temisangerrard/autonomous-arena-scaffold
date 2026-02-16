/**
 * Centralized server configuration
 * All environment variables are loaded here for consistent access
 */

import { createHash } from 'node:crypto';
import { loadEnvFromFile } from './lib/env.js';

loadEnvFromFile();

export const config = {
  // Server
  port: Number(process.env.SERVER_PORT ?? process.env.PORT ?? 4000),
  serverInstanceId: process.env.SERVER_INSTANCE_ID?.trim() || `srv_${Math.random().toString(36).slice(2, 9)}`,
  
  // Database
  databaseUrl: process.env.DATABASE_URL,
  redisUrl: process.env.REDIS_URL,
  
  // Presence
  presenceTtlSeconds: Math.max(10, Number(process.env.PRESENCE_TTL_SECONDS ?? 40)),
  
  // Game
  // Back-compat: env uses PROXIMITY_RADIUS (historical). Accept PROXIMITY_THRESHOLD too.
  proximityThreshold: Number(process.env.PROXIMITY_RADIUS ?? process.env.PROXIMITY_THRESHOLD ?? 12),
  worldBound: 120,
  
  // Challenges
  challengePendingTimeoutMs: Math.max(5_000, Number(process.env.CHALLENGE_PENDING_TIMEOUT_MS ?? 15_000)),
  challengeOrphanGraceMs: Math.max(30_000, Number(process.env.CHALLENGE_ORPHAN_GRACE_MS ?? 30_000)),
  agentToHumanChallengeCooldownMs: Math.max(0, Number(process.env.AGENT_TO_HUMAN_CHALLENGE_COOLDOWN_MS ?? 20000)),
  
  // Escrow
  agentRuntimeUrl: process.env.AGENT_RUNTIME_URL ?? process.env.WEB_AGENT_RUNTIME_BASE_URL ?? 'http://localhost:4100',
  escrowFeeBps: Math.max(0, Math.min(10_000, Number(process.env.ESCROW_FEE_BPS ?? 0))),
  escrowExecutionMode: (process.env.ESCROW_EXECUTION_MODE === 'onchain' ? 'onchain' : 'runtime') as 'onchain' | 'runtime',
  chainRpcUrl: process.env.CHAIN_RPC_URL,
  escrowResolverPrivateKey: process.env.ESCROW_RESOLVER_PRIVATE_KEY,
  escrowContractAddress: process.env.ESCROW_CONTRACT_ADDRESS,
  escrowTokenDecimals: Number(process.env.ESCROW_TOKEN_DECIMALS ?? 6),
  deployerPrivateKey: process.env.DEPLOYER_PRIVATE_KEY,
  
  // Auth
  wsAuthSecret: process.env.GAME_WS_AUTH_SECRET?.trim() || '',
  webAuthUrl: process.env.WEB_AUTH_URL?.trim() || '',
  internalServiceToken: process.env.INTERNAL_SERVICE_TOKEN?.trim() || '',
} as const;

/**
 * Resolve internal service token from config or derive from private key
 */
export function resolveInternalServiceToken(): string {
  if (config.internalServiceToken) {
    return config.internalServiceToken;
  }
  
  const superAgentKey = (config.escrowResolverPrivateKey || config.deployerPrivateKey || '').trim();
  if (!superAgentKey) {
    return '';
  }
  
  return `sa_${createHash('sha256').update(superAgentKey).digest('hex')}`;
}
