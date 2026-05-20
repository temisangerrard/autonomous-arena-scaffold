import type { IncomingMessage, ServerResponse } from 'node:http';
import type { createChiefService } from '../chief.js';
import type { createChief2Service } from '../chief2/index.js';
import type { createSessionStore, IdentityRecord, Role, SessionRecord } from '../sessionStore.js';

export type PlayerProfile = {
  id: string;
  username: string;
  displayName: string;
  walletId: string;
  ownedBotIds: string[];
  wallet?: {
    id: string;
    address?: string;
    balance: number;
  };
};

export type PlayerDirectoryEntry = {
  id: string;
  username: string;
  displayName: string;
  walletId: string;
  walletAddress?: string;
};

export type RuntimeStatusPayload = {
  connectedBotCount?: number;
  disconnectedBotIds?: string[];
  lastBotWsErrorAt?: number | null;
  lastBotWsCloseById?: Record<string, { code?: number; reason?: string; at: number }>;
  bots?: Array<{
    id: string;
    connected?: boolean;
    walletId?: string | null;
    walletAddress?: string | null;
    behavior: {
      personality: 'aggressive' | 'conservative' | 'social';
      mode?: 'active' | 'passive';
      targetPreference: 'human_only' | 'human_first' | 'any';
      challengeCooldownMs: number;
      challengeEnabled?: boolean;
      baseWager?: number;
      maxWager?: number;
    };
    meta?: {
      ownerProfileId?: string | null;
      displayName?: string;
      duty?: string;
      managedBySuperAgent?: boolean;
      patrolSection?: number | null;
      actorId?: string;
      botClass?: 'owner' | 'background' | 'house';
      controlState?: 'human_active' | 'bot_active' | 'idle_offline';
      visibilityHint?: string;
      ownerOnline?: boolean;
    };
  }>;
  wallets?: Array<{
    id: string;
    ownerProfileId?: string | null;
    address?: string;
    balance?: number;
  }>;
};

export type FirebaseAuthResult = {
  localId: string;
  email: string;
  displayName?: string;
};

export type FirebaseLookupResult = {
  localId: string;
  email: string;
  displayName?: string;
  picture?: string;
  emailVerified: boolean;
  providerIds: string[];
};

export type FirebaseGoogleExchangeResult = {
  localId: string;
  email: string;
  displayName?: string;
  picture?: string;
};

export type GoogleTokenInfo = {
  sub: string;
  email: string;
  name?: string;
  picture?: string;
  aud: string;
  exp: string;
  iss?: string;
  email_verified?: string | boolean;
};

export type ServerConfig = {
  port?: number;
  googleClientId?: string;
  googleAuthEnabled?: boolean;
  firebaseWebApiKey?: string;
  firebaseAuthDomain?: string;
  firebaseProjectId?: string;
  cdpProjectId?: string;
  firebaseGoogleAuthEnabled?: boolean;
  firebaseClientAuthEnabled?: boolean;
  emailAuthEnabled?: boolean;
  serverBase?: string;
  runtimeBase?: string;
  publicGameWsUrl?: string;
  realtimeEnabled?: boolean;
  publicWorldAssetBaseUrl?: string;
  defaultWorldAssetBaseUrl?: string;
  allowedAuthOrigins: Set<string>;
  wsAuthSecret?: string;
  internalToken?: string;
  redisUrl?: string;
  adminEmails?: Set<string>;
  localAdminUsername?: string;
  localAdminPassword?: string;
  localAuthEnabled?: boolean;
  isProduction?: boolean;
  escrowApprovalChainId?: number | null;
  escrowApprovalChainHint?: string;
  escrowApprovalModeSepolia?: 'auto' | 'manual';
  escrowApprovalModeMainnet?: 'auto' | 'manual';
  escrowApprovalDefaultMode?: 'auto' | 'manual';
  escrowAutoApproveMaxWager?: number | null;
  escrowAutoApproveDailyCap?: number | null;
  escrowApprovalResolved?: Record<string, unknown>;
  chiefCooModeEnabled?: boolean;
  chiefDbGatewayEnabled?: boolean;
  chiefSkillCatalogRoots?: string[];
  webStateFile?: string;
  publicDir?: string;
  sessionTtlMs?: number;
  identityTtlMs?: number;
  cookieName?: string;
};

export type SessionStore = Awaited<ReturnType<typeof createSessionStore>>;
export type ChiefService = ReturnType<typeof createChiefService>;
export type Chief2Service = ReturnType<typeof createChief2Service>;

export type ServerContext = {
  config: ServerConfig;
  sessionStore: SessionStore;
  chiefService: ChiefService;
  chief2Service: Chief2Service;
  extractSession: (req: IncomingMessage) => Promise<SessionRecord | null>;
  getIdentityFromReq: (req: IncomingMessage) => Promise<IdentityRecord | null>;
  reconcileIdentityLink: (identity: IdentityRecord) => Promise<void>;
  requireRole: (
    req: IncomingMessage,
    roles: Role[]
  ) => Promise<{ ok: true; identity: IdentityRecord } | { ok: false }>;
  isSecureRequest: (req: IncomingMessage) => boolean;
  runtimeGet: <T = unknown>(pathname: string) => Promise<T>;
  runtimePost: <T = unknown>(pathname: string, body: unknown) => Promise<T>;
  runtimeProfiles: () => Promise<PlayerProfile[]>;
  runtimeStatusOk: () => Promise<boolean>;
  serverGet: <T = unknown>(pathname: string) => Promise<T>;
  serverPost: <T = unknown>(pathname: string, body: unknown) => Promise<T>;
  serverHealthOk: () => Promise<boolean>;
  upstreamErrorJson: (error: unknown, fallbackReason: string, fallbackStatus?: number) => {
    status: number;
    body: Record<string, unknown>;
  };
  externalSubjectFromIdentity: (identity: IdentityRecord) => string;
  externalSubjectFromSub: (sub: string) => string;
  subjectHashForAdmin: (subject: string) => string;
  runtimeSubjectLink: (subject: string) => Promise<{
    profileId: string;
    walletId: string;
    linkedAt: number;
    updatedAt: number;
    continuitySource: string;
  } | null>;
  candidatePlayerIds: (profileId: string) => string[];
  loadPlayerWalletSummary: (identity: IdentityRecord) => Promise<any>;
  loadPlayerRuntimeBotContext: (identity: IdentityRecord, profile: PlayerProfile) => Promise<any>;
  loadPlayerActivity: (identity: IdentityRecord, limit?: number) => Promise<any>;
  ensurePlayerProvisioned: (identity: IdentityRecord, subjectAliases?: string[]) => Promise<void>;
  firebaseIdentityAuth: (
    mode: 'signup' | 'login',
    email: string,
    password: string
  ) => Promise<{ ok: true; result: FirebaseAuthResult } | { ok: false; reason: string; status: number }>;
  firebaseLookupIdToken: (
    idToken: string
  ) => Promise<{ ok: true; result: FirebaseLookupResult } | { ok: false; reason: string; status: number }>;
  firebaseExchangeGoogleCredential: (
    googleIdToken: string
  ) => Promise<{ ok: true; result: FirebaseGoogleExchangeResult } | { ok: false; reason: string; status: number }>;
  upsertIdentitySubjectAliases: (identity: IdentityRecord, subjects: string[]) => Promise<void>;
  googleTokenInfo: (idToken: string) => Promise<GoogleTokenInfo>;
  isSameOriginRequest: (req: IncomingMessage) => boolean;
  sanitizeUser: (identity: IdentityRecord) => Record<string, unknown>;
  wsAuthForIdentity: (identity: IdentityRecord) => string | null;
  htmlRouteToFile: (pathname: string, identity: IdentityRecord | null, res: ServerResponse) => string | null;
};

export type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  requestUrl: URL,
  context: ServerContext
) => Promise<boolean>;
