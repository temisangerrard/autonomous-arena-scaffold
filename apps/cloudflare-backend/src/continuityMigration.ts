type Role = 'player' | 'admin';

export type LegacyIdentityRecord = {
  sub: string;
  email: string;
  name: string;
  picture: string;
  role: Role;
  profileId: string | null;
  walletId: string | null;
  username: string | null;
  displayName: string | null;
  createdAt: number;
  lastLoginAt: number;
};

export type LegacySessionRecord = {
  id: string;
  sub: string;
  expiresAt: number;
};

export type LegacyAuthState = {
  identities: LegacyIdentityRecord[];
  sessions: LegacySessionRecord[];
};

export type ExistingWebIdentity = LegacyIdentityRecord;

export type ExistingSubjectLink = {
  subject: string;
  profileId: string;
  walletId: string;
  linkedAt: number;
  updatedAt: number;
};

export type ExistingRuntimeProfile = {
  profileId: string;
  username: string;
  displayName: string;
  walletId: string;
  createdAt: number;
};

export type ExistingRuntimeWallet = {
  walletId: string;
  ownerProfileId: string;
  address: string;
  encryptedPrivateKey: string | null;
  walletProvider: 'internal' | 'coinbase_embedded';
  externalWalletAddress: string | null;
  externalWalletRef: string | null;
  externalWalletLinkedAt: number | null;
  balance: number;
  dailyTxCount: number;
  txDayStamp: string;
  createdAt: number;
  lastTxAt: number | null;
};

export type ExistingD1Snapshot = {
  webIdentities: ExistingWebIdentity[];
  subjectLinks: ExistingSubjectLink[];
  runtimeProfiles: ExistingRuntimeProfile[];
  runtimeWallets: ExistingRuntimeWallet[];
};

export type PlannedRuntimeProfile = ExistingRuntimeProfile & {
  updatedAt: number;
};

export type PlannedRuntimeWallet = ExistingRuntimeWallet & {
  updatedAt: number;
};

export type ContinuityImportPlan = {
  importedIdentities: LegacyIdentityRecord[];
  importedSessions: LegacySessionRecord[];
  runtimeProfiles: PlannedRuntimeProfile[];
  runtimeWallets: PlannedRuntimeWallet[];
  subjectLinks: ExistingSubjectLink[];
  summary: {
    sourceIdentityCount: number;
    sourceSessionCount: number;
    importedIdentityCount: number;
    importedSessionCount: number;
    importedSubjectLinkCount: number;
    runtimeProfilesCreated: number;
    runtimeWalletsCreated: number;
    emailGroupsRewritten: number;
    conflictingProfileCount: number;
    identitiesWithoutCanonicalMapping: number;
    placeholderWalletCount: number;
  };
  warnings: string[];
};

type CanonicalChoice = {
  profileId: string;
  walletId: string;
  username: string | null;
  displayName: string | null;
  source: 'source_identity' | 'existing_identity' | 'continuity';
};

type ParsedLegacyAuthState =
  | LegacyAuthState
  | { version?: number; identities?: LegacyIdentityRecord[]; sessions?: LegacySessionRecord[] }
  | LegacyIdentityRecord[];

const USER_SEED_BALANCE = 0;

const WEB_MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS web_identities (
    sub TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    name TEXT NOT NULL,
    picture TEXT NOT NULL,
    role TEXT NOT NULL,
    profile_id TEXT,
    wallet_id TEXT,
    username TEXT,
    display_name TEXT,
    created_at INTEGER NOT NULL,
    last_login_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS web_sessions (
    session_id TEXT PRIMARY KEY,
    sub TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_web_sessions_sub ON web_sessions(sub)`,
  `CREATE INDEX IF NOT EXISTS idx_web_identities_email ON web_identities(email)`,
];

const RUNTIME_MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS runtime_profiles (
    profile_id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    display_name TEXT NOT NULL,
    wallet_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS runtime_wallets (
    wallet_id TEXT PRIMARY KEY,
    owner_profile_id TEXT NOT NULL,
    address TEXT NOT NULL,
    encrypted_private_key TEXT,
    wallet_provider TEXT NOT NULL DEFAULT 'internal',
    external_wallet_address TEXT,
    external_wallet_ref TEXT,
    external_wallet_linked_at INTEGER,
    balance REAL NOT NULL,
    daily_tx_count INTEGER NOT NULL,
    tx_day_stamp TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_tx_at INTEGER,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS auth_subject_links (
    subject TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL,
    wallet_id TEXT NOT NULL,
    linked_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
];

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asNumber(value: unknown, fallback = 0): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function normalizeOptional(value: unknown): string | null {
  const normalized = asString(value).trim();
  return normalized || null;
}

function normalizeEmail(value: unknown): string {
  return asString(value).trim().toLowerCase();
}

function normalizeRole(value: unknown): Role {
  return asString(value) === 'admin' ? 'admin' : 'player';
}

function dayStamp(timestamp: number): string {
  const now = new Date(timestamp);
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

async function shaHex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function syntheticAddress(seed: string): Promise<string> {
  return `0x${(await shaHex(seed)).slice(0, 40)}`;
}

async function syntheticPrivateKey(seed: string): Promise<string> {
  return `0x${(await shaHex(`pk:${seed}`)).padEnd(64, '0').slice(0, 64)}`;
}

function normalizeIdentity(value: unknown): LegacyIdentityRecord | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const sub = asString(record.sub).trim();
  const email = normalizeEmail(record.email);
  if (!sub || !email) return null;
  return {
    sub,
    email,
    name: asString(record.name).trim() || email.split('@')[0] || 'Player',
    picture: asString(record.picture).trim(),
    role: normalizeRole(record.role),
    profileId: normalizeOptional(record.profileId),
    walletId: normalizeOptional(record.walletId),
    username: normalizeOptional(record.username),
    displayName: normalizeOptional(record.displayName),
    createdAt: asNumber(record.createdAt, Date.now()),
    lastLoginAt: asNumber(record.lastLoginAt, asNumber(record.createdAt, Date.now())),
  };
}

function normalizeSession(value: unknown): LegacySessionRecord | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const id = asString(record.id).trim();
  const sub = asString(record.sub).trim();
  const expiresAt = asNumber(record.expiresAt);
  if (!id || !sub || !Number.isFinite(expiresAt)) return null;
  return { id, sub, expiresAt };
}

export function parseLegacyAuthStateDocument(input: unknown): LegacyAuthState {
  const raw = input as ParsedLegacyAuthState;
  const identitiesRaw = Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.identities)
      ? raw.identities
      : [];
  const sessionsRaw = Array.isArray(raw) ? [] : Array.isArray(raw?.sessions) ? raw.sessions : [];
  return {
    identities: identitiesRaw.map(normalizeIdentity).filter((entry): entry is LegacyIdentityRecord => Boolean(entry)),
    sessions: sessionsRaw.map(normalizeSession).filter((entry): entry is LegacySessionRecord => Boolean(entry)),
  };
}

function mergeIdentity(base: LegacyIdentityRecord, existing: ExistingWebIdentity | null): LegacyIdentityRecord {
  if (!existing) return base;
  return {
    ...existing,
    ...base,
    profileId: base.profileId ?? existing.profileId,
    walletId: base.walletId ?? existing.walletId,
    username: base.username ?? existing.username,
    displayName: base.displayName ?? existing.displayName,
    createdAt: Math.min(base.createdAt, existing.createdAt),
    lastLoginAt: Math.max(base.lastLoginAt, existing.lastLoginAt),
  };
}

function buildSubjectLinkMap(snapshot: ExistingD1Snapshot): Map<string, ExistingSubjectLink> {
  return new Map(snapshot.subjectLinks.map((entry) => [entry.subject, entry]));
}

function buildIdentityMap(snapshot: ExistingD1Snapshot): Map<string, ExistingWebIdentity> {
  return new Map(snapshot.webIdentities.map((entry) => [entry.sub, entry]));
}

function chooseCanonicalIdentity(
  group: LegacyIdentityRecord[],
  subjectLinkMap: Map<string, ExistingSubjectLink>,
  sourceSubs: Set<string>,
): CanonicalChoice | null {
  const sourceMappedIdentities = [...group]
    .filter((entry) => sourceSubs.has(entry.sub))
    .filter((entry) => entry.profileId && entry.walletId)
    .sort((a, b) => Number(b.lastLoginAt || 0) - Number(a.lastLoginAt || 0));
  if (sourceMappedIdentities[0]?.profileId && sourceMappedIdentities[0]?.walletId) {
    return {
      profileId: sourceMappedIdentities[0].profileId,
      walletId: sourceMappedIdentities[0].walletId,
      username: sourceMappedIdentities[0].username,
      displayName: sourceMappedIdentities[0].displayName,
      source: 'source_identity',
    };
  }

  const mappedIdentities = [...group]
    .filter((entry) => entry.profileId && entry.walletId)
    .sort((a, b) => Number(b.lastLoginAt || 0) - Number(a.lastLoginAt || 0));
  if (mappedIdentities[0]?.profileId && mappedIdentities[0]?.walletId) {
    return {
      profileId: mappedIdentities[0].profileId,
      walletId: mappedIdentities[0].walletId,
      username: mappedIdentities[0].username,
      displayName: mappedIdentities[0].displayName,
      source: 'existing_identity',
    };
  }
  const linked = [...group]
    .map((entry) => subjectLinkMap.get(entry.sub) || null)
    .filter((entry): entry is ExistingSubjectLink => Boolean(entry?.profileId && entry?.walletId))
    .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))[0] || null;
  if (!linked) return null;
  const latestIdentity = [...group].sort((a, b) => Number(b.lastLoginAt || 0) - Number(a.lastLoginAt || 0))[0] || null;
  return {
    profileId: linked.profileId,
    walletId: linked.walletId,
    username: latestIdentity?.username ?? null,
    displayName: latestIdentity?.displayName ?? null,
    source: 'continuity',
  };
}

function rewriteIdentity(identity: LegacyIdentityRecord, canonical: CanonicalChoice): LegacyIdentityRecord {
  return {
    ...identity,
    profileId: canonical.profileId,
    walletId: canonical.walletId,
    username: canonical.username ?? identity.username,
    displayName: canonical.displayName ?? identity.displayName,
  };
}

function sqlValue(value: unknown): string {
  if (value == null) return 'NULL';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
  if (typeof value === 'boolean') return value ? '1' : '0';
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function buildPlaceholderWallet(walletId: string, ownerProfileId: string, now: number): Promise<PlannedRuntimeWallet> {
  return {
    walletId,
    ownerProfileId,
    address: await syntheticAddress(`${ownerProfileId}:${walletId}`),
    encryptedPrivateKey: await syntheticPrivateKey(`${ownerProfileId}:${walletId}`),
    walletProvider: 'internal',
    externalWalletAddress: null,
    externalWalletRef: null,
    externalWalletLinkedAt: null,
    balance: USER_SEED_BALANCE,
    dailyTxCount: 0,
    txDayStamp: dayStamp(now),
    createdAt: now,
    lastTxAt: null,
    updatedAt: now,
  };
}

export async function buildContinuityImportPlan(params: {
  source: LegacyAuthState;
  existing: ExistingD1Snapshot;
  includeSessions?: boolean;
  now?: number;
}): Promise<ContinuityImportPlan> {
  const now = Number(params.now || Date.now());
  const sourceIdentityCount = params.source.identities.length;
  const sourceSessionCount = params.source.sessions.length;
  const existingIdentityMap = buildIdentityMap(params.existing);
  const subjectLinkMap = buildSubjectLinkMap(params.existing);
  const sourceSubs = new Set(params.source.identities.map((entry) => entry.sub));
  const sourceEmails = new Set(params.source.identities.map((entry) => normalizeEmail(entry.email)).filter(Boolean));
  const mergedBySub = new Map<string, LegacyIdentityRecord>();

  for (const identity of params.existing.webIdentities) {
    if (!sourceEmails.has(normalizeEmail(identity.email))) continue;
    mergedBySub.set(identity.sub, identity);
  }

  for (const identity of params.source.identities) {
    mergedBySub.set(identity.sub, mergeIdentity(identity, existingIdentityMap.get(identity.sub) || null));
  }

  const byEmail = new Map<string, LegacyIdentityRecord[]>();
  for (const identity of mergedBySub.values()) {
    const email = normalizeEmail(identity.email);
    if (!email) continue;
    const group = byEmail.get(email) ?? [];
    group.push(identity);
    byEmail.set(email, group);
  }

  const importedIdentities: LegacyIdentityRecord[] = [];
  const warnings: string[] = [];
  let emailGroupsRewritten = 0;
  let conflictingProfileCount = 0;
  let identitiesWithoutCanonicalMapping = 0;

  for (const group of byEmail.values()) {
    const canonical = chooseCanonicalIdentity(group, subjectLinkMap, sourceSubs);
    if (!canonical) {
      identitiesWithoutCanonicalMapping += group.length;
      warnings.push(`No canonical mapping found for ${group[0]?.email || 'unknown email'}; ${group.length} identities skipped.`);
      continue;
    }
    const conflictingProfiles = new Set(group.map((entry) => entry.profileId).filter((entry): entry is string => Boolean(entry && entry !== canonical.profileId)));
    if (conflictingProfiles.size > 0) {
      emailGroupsRewritten += 1;
      conflictingProfileCount += conflictingProfiles.size;
    }
    for (const identity of group) {
      importedIdentities.push(rewriteIdentity(identity, canonical));
    }
  }

  importedIdentities.sort((a, b) => a.email.localeCompare(b.email) || a.sub.localeCompare(b.sub));

  const includedSubs = new Set(importedIdentities.map((entry) => entry.sub));
  const importedSessions = params.includeSessions
    ? params.source.sessions
      .filter((entry) => includedSubs.has(entry.sub))
      .filter((entry) => entry.expiresAt > now)
    : [];

  const runtimeProfiles = new Map<string, PlannedRuntimeProfile>(
    params.existing.runtimeProfiles.map((entry) => [entry.profileId, { ...entry, updatedAt: now }]),
  );
  const runtimeWallets = new Map<string, PlannedRuntimeWallet>(
    params.existing.runtimeWallets.map((entry) => [entry.walletId, { ...entry, updatedAt: now }]),
  );
  const subjectLinks = new Map<string, ExistingSubjectLink>(
    params.existing.subjectLinks.map((entry) => [entry.subject, entry]),
  );

  let runtimeProfilesCreated = 0;
  let runtimeWalletsCreated = 0;
  let placeholderWalletCount = 0;

  for (const identity of importedIdentities) {
    if (!identity.profileId || !identity.walletId) continue;
    const nextProfile: PlannedRuntimeProfile = {
      ...(runtimeProfiles.get(identity.profileId) ?? {
        profileId: identity.profileId,
        username: identity.username || identity.email.split('@')[0] || identity.profileId,
        displayName: identity.displayName || identity.name || identity.username || identity.profileId,
        walletId: identity.walletId,
        createdAt: identity.createdAt || now,
      }),
      username: identity.username || runtimeProfiles.get(identity.profileId)?.username || identity.email.split('@')[0] || identity.profileId,
      displayName: identity.displayName || identity.name || runtimeProfiles.get(identity.profileId)?.displayName || identity.profileId,
      walletId: identity.walletId,
      updatedAt: now,
    };
    if (!runtimeProfiles.has(identity.profileId)) {
      runtimeProfilesCreated += 1;
    }
    runtimeProfiles.set(identity.profileId, nextProfile);
    if (!runtimeWallets.has(identity.walletId)) {
      runtimeWallets.set(identity.walletId, await buildPlaceholderWallet(identity.walletId, identity.profileId, now));
      runtimeWalletsCreated += 1;
      placeholderWalletCount += 1;
    }
    const currentLink = subjectLinks.get(identity.sub);
    subjectLinks.set(identity.sub, {
      subject: identity.sub,
      profileId: identity.profileId,
      walletId: identity.walletId,
      linkedAt: currentLink?.linkedAt ?? identity.createdAt ?? now,
      updatedAt: now,
    });
  }

  return {
    importedIdentities,
    importedSessions,
    runtimeProfiles: [...runtimeProfiles.values()].sort((a, b) => a.profileId.localeCompare(b.profileId)),
    runtimeWallets: [...runtimeWallets.values()].sort((a, b) => a.walletId.localeCompare(b.walletId)),
    subjectLinks: [...subjectLinks.values()].sort((a, b) => a.subject.localeCompare(b.subject)),
    summary: {
      sourceIdentityCount,
      sourceSessionCount,
      importedIdentityCount: importedIdentities.length,
      importedSessionCount: importedSessions.length,
      importedSubjectLinkCount: importedIdentities.length,
      runtimeProfilesCreated,
      runtimeWalletsCreated,
      emailGroupsRewritten,
      conflictingProfileCount,
      identitiesWithoutCanonicalMapping,
      placeholderWalletCount,
    },
    warnings,
  };
}

export function buildContinuityImportSql(plan: ContinuityImportPlan): string {
  const statements: string[] = [
    ...WEB_MIGRATIONS.map((statement) => `${statement};`),
    ...RUNTIME_MIGRATIONS.map((statement) => `${statement};`),
  ];

  for (const profile of plan.runtimeProfiles) {
    statements.push(
      `INSERT OR REPLACE INTO runtime_profiles (profile_id, username, display_name, wallet_id, created_at, updated_at) VALUES (${sqlValue(profile.profileId)}, ${sqlValue(profile.username)}, ${sqlValue(profile.displayName)}, ${sqlValue(profile.walletId)}, ${sqlValue(profile.createdAt)}, ${sqlValue(profile.updatedAt)});`,
    );
  }

  for (const wallet of plan.runtimeWallets) {
    statements.push(
      `INSERT OR REPLACE INTO runtime_wallets (wallet_id, owner_profile_id, address, encrypted_private_key, wallet_provider, external_wallet_address, external_wallet_ref, external_wallet_linked_at, balance, daily_tx_count, tx_day_stamp, created_at, last_tx_at, updated_at) VALUES (${sqlValue(wallet.walletId)}, ${sqlValue(wallet.ownerProfileId)}, ${sqlValue(wallet.address)}, ${sqlValue(wallet.encryptedPrivateKey)}, ${sqlValue(wallet.walletProvider)}, ${sqlValue(wallet.externalWalletAddress)}, ${sqlValue(wallet.externalWalletRef)}, ${sqlValue(wallet.externalWalletLinkedAt)}, ${sqlValue(wallet.balance)}, ${sqlValue(wallet.dailyTxCount)}, ${sqlValue(wallet.txDayStamp)}, ${sqlValue(wallet.createdAt)}, ${sqlValue(wallet.lastTxAt)}, ${sqlValue(wallet.updatedAt)});`,
    );
  }

  for (const link of plan.subjectLinks) {
    statements.push(
      `INSERT OR REPLACE INTO auth_subject_links (subject, profile_id, wallet_id, linked_at, updated_at) VALUES (${sqlValue(link.subject)}, ${sqlValue(link.profileId)}, ${sqlValue(link.walletId)}, ${sqlValue(link.linkedAt)}, ${sqlValue(link.updatedAt)});`,
    );
  }

  for (const identity of plan.importedIdentities) {
    statements.push(
      `INSERT OR REPLACE INTO web_identities (sub, email, name, picture, role, profile_id, wallet_id, username, display_name, created_at, last_login_at) VALUES (${sqlValue(identity.sub)}, ${sqlValue(identity.email)}, ${sqlValue(identity.name)}, ${sqlValue(identity.picture)}, ${sqlValue(identity.role)}, ${sqlValue(identity.profileId)}, ${sqlValue(identity.walletId)}, ${sqlValue(identity.username)}, ${sqlValue(identity.displayName)}, ${sqlValue(identity.createdAt)}, ${sqlValue(identity.lastLoginAt)});`,
    );
  }

  for (const session of plan.importedSessions) {
    statements.push(
      `INSERT OR REPLACE INTO web_sessions (session_id, sub, expires_at) VALUES (${sqlValue(session.id)}, ${sqlValue(session.sub)}, ${sqlValue(session.expiresAt)});`,
    );
  }

  return statements.join('\n');
}
