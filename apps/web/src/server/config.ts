import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveEscrowApprovalPolicy } from '@arena/shared';
import { buildAllowedOrigins } from '../cors.js';
import { loadEnvFromFile } from '../lib/env.js';
import { log } from '../logger.js';
import type { ServerConfig } from './types.js';

function resolveInternalServiceToken(): string {
  const explicit = process.env.INTERNAL_SERVICE_TOKEN?.trim() || '';
  if (explicit) return explicit;
  return '';
}

export function loadServerConfig(): ServerConfig {
  loadEnvFromFile();

  const googleClientId = process.env.GOOGLE_CLIENT_ID?.trim() ?? '';
  const firebaseWebApiKey = process.env.FIREBASE_WEB_API_KEY?.trim() ?? '';
  const firebaseAuthDomain = process.env.FIREBASE_AUTH_DOMAIN?.trim() ?? '';
  const firebaseProjectId = process.env.FIREBASE_PROJECT_ID?.trim() ?? '';
  const escrowApprovalChainIdRaw = Number(
    process.env.ESCROW_APPROVAL_CHAIN_ID
    ?? process.env.CHAIN_ID
    ?? Number.NaN
  );
  const escrowApprovalChainId = Number.isFinite(escrowApprovalChainIdRaw) ? escrowApprovalChainIdRaw : null;
  const escrowApprovalChainHint = String(
    process.env.ESCROW_APPROVAL_CHAIN_HINT
    ?? process.env.CHAIN_RPC_URL
    ?? ''
  ).trim();
  const escrowApprovalModeSepolia = String(process.env.ESCROW_APPROVAL_MODE_SEPOLIA ?? 'auto').trim().toLowerCase() === 'auto'
    ? 'auto'
    : 'manual';
  const escrowApprovalModeMainnet = String(process.env.ESCROW_APPROVAL_MODE_MAINNET ?? 'manual').trim().toLowerCase() === 'auto'
    ? 'auto'
    : 'manual';
  const escrowApprovalDefaultMode = String(process.env.ESCROW_APPROVAL_MODE_DEFAULT ?? 'manual').trim().toLowerCase() === 'auto'
    ? 'auto'
    : 'manual';
  const escrowAutoApproveMaxWagerRaw = Number(process.env.ESCROW_AUTO_APPROVE_MAX_WAGER ?? Number.NaN);
  const escrowAutoApproveDailyCapRaw = Number(process.env.ESCROW_AUTO_APPROVE_DAILY_CAP ?? Number.NaN);

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const publicDirCandidates = [
    path.resolve(process.cwd(), 'apps/web/public'),
    path.resolve(__dirname, '../../public'),
    path.resolve(__dirname, '../../../../../../../apps/web/public')
  ];

  return {
    port: Number(process.env.PORT ?? 3000),
    googleClientId,
    googleAuthEnabled: googleClientId.length > 0,
    firebaseWebApiKey,
    firebaseAuthDomain,
    firebaseProjectId,
    cdpProjectId: process.env.CDP_PROJECT_ID?.trim() ?? '',
    firebaseGoogleAuthEnabled: (process.env.FIREBASE_GOOGLE_AUTH_ENABLED ?? 'true') === 'true'
      && firebaseWebApiKey.length > 0
      && firebaseAuthDomain.length > 0,
    firebaseClientAuthEnabled: firebaseWebApiKey.length > 0 && firebaseAuthDomain.length > 0,
    emailAuthEnabled: firebaseWebApiKey.length > 0,
    serverBase: process.env.WEB_API_BASE_URL ?? 'http://localhost:4000',
    runtimeBase: process.env.WEB_AGENT_RUNTIME_BASE_URL ?? 'http://localhost:4100',
    publicGameWsUrl: process.env.WEB_GAME_WS_URL ?? '',
    publicWorldAssetBaseUrl: process.env.PUBLIC_WORLD_ASSET_BASE_URL ?? '',
    defaultWorldAssetBaseUrl: 'https://pub-302820e514cd451baaf272a33bd70765.r2.dev',
    allowedAuthOrigins: buildAllowedOrigins(process.env.ALLOWED_AUTH_ORIGINS, [
      'https://autobett.xyz',
      'https://www.autobett.xyz',
      'https://autobett.netlify.app',
      'https://www.autobett.netlify.app',
      'http://localhost:3000'
    ]),
    wsAuthSecret: process.env.GAME_WS_AUTH_SECRET?.trim() || '',
    internalToken: resolveInternalServiceToken(),
    redisUrl: process.env.REDIS_URL?.trim() || '',
    adminEmails: new Set(
      (process.env.ADMIN_EMAILS ?? process.env.SUPER_ADMIN_EMAIL ?? '')
        .split(',')
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean)
    ),
    localAdminUsername: process.env.ADMIN_USERNAME ?? '',
    localAdminPassword: process.env.ADMIN_PASSWORD ?? '',
    localAuthEnabled: (process.env.LOCAL_AUTH_ENABLED ?? 'false') === 'true',
    isProduction: process.env.NODE_ENV === 'production',
    escrowApprovalChainId,
    escrowApprovalChainHint,
    escrowApprovalModeSepolia,
    escrowApprovalModeMainnet,
    escrowApprovalDefaultMode,
    escrowAutoApproveMaxWager: Number.isFinite(escrowAutoApproveMaxWagerRaw) && escrowAutoApproveMaxWagerRaw > 0
      ? escrowAutoApproveMaxWagerRaw
      : null,
    escrowAutoApproveDailyCap: Number.isFinite(escrowAutoApproveDailyCapRaw) && escrowAutoApproveDailyCapRaw > 0
      ? escrowAutoApproveDailyCapRaw
      : null,
    escrowApprovalResolved: resolveEscrowApprovalPolicy({
      chainId: escrowApprovalChainId,
      chainHint: escrowApprovalChainHint,
      modeSepolia: escrowApprovalModeSepolia,
      modeMainnet: escrowApprovalModeMainnet,
      defaultMode: escrowApprovalDefaultMode,
      autoApproveMaxWager: Number.isFinite(escrowAutoApproveMaxWagerRaw) && escrowAutoApproveMaxWagerRaw > 0
        ? escrowAutoApproveMaxWagerRaw
        : null,
      autoApproveDailyCap: Number.isFinite(escrowAutoApproveDailyCapRaw) && escrowAutoApproveDailyCapRaw > 0
        ? escrowAutoApproveDailyCapRaw
        : null
    }),
    chiefCooModeEnabled: process.env.CHIEF_COO_MODE_ENABLED === 'true',
    chiefDbGatewayEnabled: process.env.CHIEF_DB_GATEWAY_ENABLED === 'true',
    chiefSkillCatalogRoots: String(process.env.CHIEF_SKILL_ROOTS || '.agents/skills')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean),
    webStateFile: process.env.WEB_STATE_FILE
      ? path.resolve(process.cwd(), process.env.WEB_STATE_FILE)
      : path.resolve(process.cwd(), 'output', 'web-auth-state.json'),
    publicDir: publicDirCandidates.find((candidate) => existsSync(candidate)) ?? path.resolve(__dirname, '../../public'),
    sessionTtlMs: 1000 * 60 * 60 * 24 * 7,
    identityTtlMs: 1000 * 60 * 60 * 24 * 30,
    cookieName: 'arena_sid'
  };
}

export function validateServerConfig(config: ServerConfig): void {
  if (config.localAuthEnabled && !config.localAdminPassword) {
    if (config.isProduction) {
      log.fatal('ADMIN_PASSWORD must be set when LOCAL_AUTH_ENABLED=true in production. Refusing to start.');
      process.exit(1);
    }
    log.warn('ADMIN_PASSWORD is not set. Local admin auth will reject all login attempts. Set ADMIN_PASSWORD in .env.');
  }

  if (config.isProduction && config.localAuthEnabled && config.localAdminPassword && config.localAdminPassword.length < 8) {
    log.fatal('ADMIN_PASSWORD is too short for production (min 8 characters). Refusing to start.');
    process.exit(1);
  }
  if (config.isProduction && !config.wsAuthSecret) {
    log.fatal('GAME_WS_AUTH_SECRET must be set in production to prevent unauthenticated /ws access. Refusing to start.');
    process.exit(1);
  }
  if (config.isProduction && !config.internalToken) {
    log.fatal('INTERNAL_SERVICE_TOKEN must be set in production for runtime admin proxy + presence APIs. Refusing to start.');
    process.exit(1);
  }
  if (config.isProduction && !config.redisUrl) {
    log.fatal('REDIS_URL must be set in production for auth session persistence. Refusing to start.');
    process.exit(1);
  }
  if (config.isProduction && (config.adminEmails?.size ?? 0) === 0) {
    log.fatal('ADMIN_EMAILS must be set in production. Refusing to start.');
    process.exit(1);
  }
  if (!config.isProduction && (config.adminEmails?.size ?? 0) === 0) {
    log.warn('ADMIN_EMAILS is empty. No configured admin email can access /admin or /users.');
  }
}

