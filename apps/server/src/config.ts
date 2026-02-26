/**
 * Centralized server configuration
 * All environment variables are loaded here for consistent access
 */

import { createHash } from 'node:crypto';
import { loadEnvFromFile } from './lib/env.js';
import { resolveEscrowApprovalPolicy } from '@arena/shared';

loadEnvFromFile();

const escrowApprovalChainIdRaw = Number(
  process.env.ESCROW_APPROVAL_CHAIN_ID
  ?? process.env.CHAIN_ID
  ?? Number.NaN
);
const escrowApprovalChainId = Number.isFinite(escrowApprovalChainIdRaw)
  ? escrowApprovalChainIdRaw
  : null;
const escrowApprovalChainHint = String(
  process.env.ESCROW_APPROVAL_CHAIN_HINT
  ?? process.env.CHAIN_RPC_URL
  ?? ''
).trim();
const escrowApprovalModeSepolia = String(process.env.ESCROW_APPROVAL_MODE_SEPOLIA ?? 'auto').trim().toLowerCase();
const escrowApprovalModeMainnet = String(process.env.ESCROW_APPROVAL_MODE_MAINNET ?? 'manual').trim().toLowerCase();
const escrowApprovalDefaultMode = String(process.env.ESCROW_APPROVAL_MODE_DEFAULT ?? 'manual').trim().toLowerCase();
const escrowAutoApproveMaxWagerRaw = Number(process.env.ESCROW_AUTO_APPROVE_MAX_WAGER ?? Number.NaN);
const escrowAutoApproveDailyCapRaw = Number(process.env.ESCROW_AUTO_APPROVE_DAILY_CAP ?? Number.NaN);
const escrowAutoApproveMaxWager = Number.isFinite(escrowAutoApproveMaxWagerRaw) && escrowAutoApproveMaxWagerRaw > 0
  ? escrowAutoApproveMaxWagerRaw
  : null;
const escrowAutoApproveDailyCap = Number.isFinite(escrowAutoApproveDailyCapRaw) && escrowAutoApproveDailyCapRaw > 0
  ? escrowAutoApproveDailyCapRaw
  : null;
const escrowApprovalResolved = resolveEscrowApprovalPolicy({
  chainId: escrowApprovalChainId,
  chainHint: escrowApprovalChainHint,
  modeSepolia: escrowApprovalModeSepolia,
  modeMainnet: escrowApprovalModeMainnet,
  defaultMode: escrowApprovalDefaultMode,
  autoApproveMaxWager: escrowAutoApproveMaxWager,
  autoApproveDailyCap: escrowAutoApproveDailyCap
});

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
  chainRpcUrl: process.env.CHAIN_RPC_URL,
  escrowResolverPrivateKey: process.env.ESCROW_RESOLVER_PRIVATE_KEY,
  escrowContractAddress: process.env.ESCROW_CONTRACT_ADDRESS,
  escrowTokenDecimals: Number(process.env.ESCROW_TOKEN_DECIMALS ?? 6),
  deployerPrivateKey: process.env.DEPLOYER_PRIVATE_KEY,
  
  // Polymarket CLOB hedge (Polygon mainnet)
  polymarketHedgeEnabled:    (process.env.POLYMARKET_HEDGE_ENABLED ?? 'false') === 'true',
  polymarketHedgePrivateKey: process.env.POLYMARKET_HEDGE_PRIVATE_KEY?.trim() || '',
  polymarketClobUrl:         process.env.POLYMARKET_CLOB_URL?.trim() || 'https://clob.polymarket.com',
  polymarketHedgeFraction:   Math.max(0, Math.min(1, Number(process.env.POLYMARKET_HEDGE_FRACTION ?? 1))),

  // Auth
  wsAuthSecret: process.env.GAME_WS_AUTH_SECRET?.trim() || '',
  webAuthUrl: process.env.WEB_AUTH_URL?.trim() || '',
  internalServiceToken: process.env.INTERNAL_SERVICE_TOKEN?.trim() || '',
  stationPluginRouterEnabled: (process.env.STATION_PLUGIN_ROUTER_ENABLED ?? 'true') === 'true',
  diceDuelEnabled: (process.env.DICE_DUEL_ENABLED ?? 'true') === 'true',
  escrowApproval: {
    chainId: escrowApprovalChainId,
    chainHint: escrowApprovalChainHint,
    modeSepolia: escrowApprovalModeSepolia === 'auto' ? 'auto' : 'manual',
    modeMainnet: escrowApprovalModeMainnet === 'auto' ? 'auto' : 'manual',
    defaultMode: escrowApprovalDefaultMode === 'auto' ? 'auto' : 'manual',
    autoApproveMaxWager: escrowAutoApproveMaxWager,
    autoApproveDailyCap: escrowAutoApproveDailyCap,
    resolved: escrowApprovalResolved
  }
} as const;

/**
 * Resolve internal service token from config
 * SECURITY: Never derive tokens from private keys (predictable if key is compromised)
 */
export function resolveInternalServiceToken(): string {
  if (config.internalServiceToken) {
    return config.internalServiceToken;
  }

  // Removed insecure derivation from private keys
  // Always explicitly set INTERNAL_SERVICE_TOKEN in production
  return '';
}
