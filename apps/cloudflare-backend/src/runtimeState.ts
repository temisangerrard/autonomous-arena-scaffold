type D1First<T = Record<string, unknown>> = Promise<T | null>;

type D1PreparedStatement = {
  bind: (...values: unknown[]) => D1PreparedStatement;
  first: <T = Record<string, unknown>>() => D1First<T>;
  run: () => Promise<unknown>;
  all: <T = Record<string, unknown>>() => Promise<{ results?: T[] }>;
};

type D1DatabaseLike = {
  exec: (query: string) => Promise<unknown>;
  prepare: (query: string) => D1PreparedStatement;
};

export type RuntimeEnv = {
  STATE_DB?: D1DatabaseLike;
  SERVER_UPSTREAM?: string;
  INTERNAL_SERVICE_TOKEN?: string;
  OPENROUTER_API_KEY?: string;
};

type RuntimeProfile = {
  id: string;
  username: string;
  displayName: string;
  createdAt: number;
  walletId: string;
  ownedBotIds: string[];
};

type RuntimeWallet = {
  id: string;
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

type RuntimeBotRecord = {
  id: string;
  ownerProfileId: string;
  displayName: string;
  createdAt: number;
  managedBySuperAgent: boolean;
  autoplayEnabled: boolean;
  duty: 'owner' | 'npc' | 'house' | 'super';
  patrolSection: number | null;
  walletId: string | null;
};

type AutoplayConfig = {
  enabled: boolean;
  allowedGames: Array<'rps' | 'coinflip' | 'dice_duel'>;
  wagerMode: 'fixed' | 'percent_wallet' | 'martingale';
  baseWager: number;
  maxWager: number;
  walletPercent?: number;
  martingaleMultiplier?: number;
  sessionLossLimit?: number;
  sessionWinTarget?: number;
  cooldownMs?: number;
};

type RuntimeBotBehavior = {
  personality: 'aggressive' | 'conservative' | 'social';
  mode: 'active' | 'passive';
  challengeEnabled: boolean;
  challengeCooldownMs: number;
  targetPreference: 'human_only' | 'human_first' | 'any';
  baseWager: number;
  maxWager: number;
  sessionLossLimit?: number;
  sessionWinTarget?: number;
  autoplay?: AutoplayConfig;
};

type AutoplaySessionState = {
  sessionNetPnl: number;
  currentWager: number;
  consecutiveLosses: number;
  pauseReason: 'cooling_down' | 'loss_limit' | 'win_target' | 'insufficient_funds' | null;
  pausedAt: number | null;
  lastGameAt: number | null;
};

type OwnerPresenceRecord = {
  profileId: string;
  until: number;
  leaseId: string | null;
  playerId: string | null;
  serverId: string | null;
  source: 'ws_session' | 'legacy_browser';
};

type PlayableStation = {
  id: string;
  gameType: 'rps' | 'coinflip' | 'dice_duel' | 'blackjack' | 'prediction';
  available?: boolean;
};

const USER_SEED_BALANCE = 20;
const HOUSE_SEED_BALANCE = 500;

const MIGRATIONS = [
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
  `CREATE TABLE IF NOT EXISTS runtime_profile_onboarding (
    profile_id TEXT PRIMARY KEY,
    onboarding_completed_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS runtime_owner_bots (
    bot_id TEXT PRIMARY KEY,
    owner_profile_id TEXT NOT NULL,
    record_json TEXT NOT NULL,
    behavior_json TEXT NOT NULL,
    autoplay_session_json TEXT,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS runtime_owner_presence (
    profile_id TEXT PRIMARY KEY,
    until_ms INTEGER NOT NULL,
    lease_id TEXT,
    player_id TEXT,
    server_id TEXT,
    source TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS runtime_counters (
    singleton TEXT PRIMARY KEY,
    profile_counter INTEGER NOT NULL,
    wallet_counter INTEGER NOT NULL,
    bot_counter INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS runtime_admin_settings (
    setting_key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `INSERT OR IGNORE INTO runtime_counters (singleton, profile_counter, wallet_counter, bot_counter, updated_at)
   VALUES ('runtime', 1, 1, 1, 0)`,
];

let schemaReady: Promise<void> | null = null;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

function normalizeOrigin(value: string | undefined): string {
  return String(value || '').trim().replace(/\/+$/, '');
}

function assertInternal(request: Request, env: RuntimeEnv): boolean {
  const expected = String(env.INTERNAL_SERVICE_TOKEN || '').trim();
  if (!expected) return false;
  return request.headers.get('x-internal-token') === expected;
}

function dayStamp(now = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function asNum(value: unknown, fallback = 0): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function asStr(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function safeJsonParse<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function walletSummary(wallet: RuntimeWallet | null) {
  if (!wallet) return null;
  return {
    id: wallet.id,
    ownerProfileId: wallet.ownerProfileId,
    address: wallet.address,
    walletProvider: wallet.walletProvider,
    externalWalletAddress: wallet.externalWalletAddress,
    externalWalletRef: wallet.externalWalletRef,
    externalWalletLinkedAt: wallet.externalWalletLinkedAt,
    escrowApproval: null,
    canExportKey: wallet.walletProvider === 'internal',
    balance: wallet.balance,
    dailyTxCount: wallet.dailyTxCount,
    txDayStamp: wallet.txDayStamp,
    lastTxAt: wallet.lastTxAt,
    createdAt: wallet.createdAt,
  };
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

async function ensureSchema(db: D1DatabaseLike | undefined): Promise<void> {
  if (!db) return;
  if (!schemaReady) {
    schemaReady = (async () => {
      for (const statement of MIGRATIONS) {
        await db.prepare(statement).run();
      }
    })();
  }
  await schemaReady;
}

async function all<T>(db: D1DatabaseLike, sql: string, values: unknown[] = []): Promise<T[]> {
  const result = await db.prepare(sql).bind(...values).all<T>();
  return Array.isArray(result.results) ? result.results : [];
}

async function first<T>(db: D1DatabaseLike, sql: string, values: unknown[] = []): Promise<T | null> {
  return db.prepare(sql).bind(...values).first<T>();
}

async function run(db: D1DatabaseLike, sql: string, values: unknown[] = []): Promise<void> {
  await db.prepare(sql).bind(...values).run();
}

async function readSetting<T>(db: D1DatabaseLike, key: string, fallback: T): Promise<T> {
  const row = await first<Record<string, unknown>>(db, 'SELECT value_json FROM runtime_admin_settings WHERE setting_key = ?', [key]);
  return safeJsonParse(row?.value_json, fallback);
}

async function writeSetting(db: D1DatabaseLike, key: string, value: unknown): Promise<void> {
  await run(db, 'INSERT OR REPLACE INTO runtime_admin_settings (setting_key, value_json, updated_at) VALUES (?, ?, ?)', [key, JSON.stringify(value), Date.now()]);
}

async function nextCounter(db: D1DatabaseLike, field: 'profile_counter' | 'wallet_counter' | 'bot_counter'): Promise<number> {
  const row = await first<Record<string, unknown>>(db, `SELECT ${field} FROM runtime_counters WHERE singleton = 'runtime'`);
  const current = Math.max(1, asNum(row?.[field], 1));
  await run(db, `UPDATE runtime_counters SET ${field} = ?, updated_at = ? WHERE singleton = 'runtime'`, [current + 1, Date.now()]);
  return current;
}

function normalizeUsernameSeed(input: string): string {
  const cleaned = String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned || 'player';
}

async function uniqueUsername(db: D1DatabaseLike, seed: string): Promise<string> {
  const base = normalizeUsernameSeed(seed).slice(0, 18) || 'player';
  let index = 0;
  while (index < 5000) {
    const candidate = index === 0 ? base : `${base}_${index}`;
    const existing = await first(db, 'SELECT profile_id FROM runtime_profiles WHERE lower(username) = lower(?)', [candidate]);
    if (!existing) return candidate;
    index += 1;
  }
  return `${base}_${Date.now().toString(36)}`;
}

function defaultBehavior(): RuntimeBotBehavior {
  return {
    personality: 'social',
    mode: 'passive',
    challengeEnabled: false,
    challengeCooldownMs: 2_000,
    targetPreference: 'human_only',
    baseWager: 1,
    maxWager: 2,
    autoplay: {
      enabled: false,
      allowedGames: ['rps', 'coinflip', 'dice_duel'],
      wagerMode: 'fixed',
      baseWager: 1,
      maxWager: 2,
      cooldownMs: 2_000,
    },
  };
}

function defaultAutoplaySession(behavior: RuntimeBotBehavior): AutoplaySessionState {
  const base = behavior.autoplay?.baseWager ?? behavior.baseWager ?? 1;
  return {
    sessionNetPnl: 0,
    currentWager: Math.max(1, base),
    consecutiveLosses: 0,
    pauseReason: null,
    pausedAt: null,
    lastGameAt: null,
  };
}

async function ensureHouseProfile(db: D1DatabaseLike): Promise<{ profile: RuntimeProfile; wallet: RuntimeWallet }> {
  const existing = await first<Record<string, unknown>>(db, 'SELECT profile_id, username, display_name, wallet_id, created_at FROM runtime_profiles WHERE profile_id = ?', ['system_house']);
  if (existing) {
    const wallet = await getWallet(db, asStr(existing.wallet_id));
    if (!wallet) throw new Error('house_wallet_missing');
    return {
      profile: {
        id: asStr(existing.profile_id),
        username: asStr(existing.username),
        displayName: asStr(existing.display_name),
        createdAt: asNum(existing.created_at),
        walletId: asStr(existing.wallet_id),
        ownedBotIds: [],
      },
      wallet,
    };
  }
  const createdAt = Date.now();
  const walletId = 'wallet_house';
  const wallet: RuntimeWallet = {
    id: walletId,
    ownerProfileId: 'system_house',
    address: await syntheticAddress(`house:${walletId}`),
    encryptedPrivateKey: await syntheticPrivateKey(`house:${walletId}`),
    walletProvider: 'internal',
    externalWalletAddress: null,
    externalWalletRef: null,
    externalWalletLinkedAt: null,
    balance: HOUSE_SEED_BALANCE,
    dailyTxCount: 0,
    txDayStamp: dayStamp(),
    createdAt,
    lastTxAt: null,
  };
  await run(
    db,
    `INSERT OR IGNORE INTO runtime_wallets (
      wallet_id, owner_profile_id, address, encrypted_private_key, wallet_provider,
      external_wallet_address, external_wallet_ref, external_wallet_linked_at, balance,
      daily_tx_count, tx_day_stamp, created_at, last_tx_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      wallet.id,
      wallet.ownerProfileId,
      wallet.address,
      wallet.encryptedPrivateKey,
      wallet.walletProvider,
      null,
      null,
      null,
      wallet.balance,
      wallet.dailyTxCount,
      wallet.txDayStamp,
      wallet.createdAt,
      wallet.lastTxAt,
      createdAt,
    ],
  );
  await run(
    db,
    'INSERT OR IGNORE INTO runtime_profiles (profile_id, username, display_name, wallet_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    ['system_house', 'system_house', 'House', walletId, createdAt, createdAt],
  );
  const profile = await getProfile(db, 'system_house');
  const storedWallet = await getWallet(db, profile?.walletId ?? walletId);
  if (!profile || !storedWallet) {
    throw new Error('house_profile_bootstrap_failed');
  }
  return { profile, wallet: storedWallet };
}

async function getWallet(db: D1DatabaseLike, walletId: string): Promise<RuntimeWallet | null> {
  const row = await first<Record<string, unknown>>(
    db,
    `SELECT wallet_id, owner_profile_id, address, encrypted_private_key, wallet_provider,
      external_wallet_address, external_wallet_ref, external_wallet_linked_at, balance,
      daily_tx_count, tx_day_stamp, created_at, last_tx_at
     FROM runtime_wallets WHERE wallet_id = ?`,
    [walletId],
  );
  if (!row) return null;
  return {
    id: asStr(row.wallet_id),
    ownerProfileId: asStr(row.owner_profile_id),
    address: asStr(row.address),
    encryptedPrivateKey: asStr(row.encrypted_private_key) || null,
    walletProvider: asStr(row.wallet_provider) === 'coinbase_embedded' ? 'coinbase_embedded' : 'internal',
    externalWalletAddress: asStr(row.external_wallet_address) || null,
    externalWalletRef: asStr(row.external_wallet_ref) || null,
    externalWalletLinkedAt: row.external_wallet_linked_at == null ? null : asNum(row.external_wallet_linked_at),
    balance: asNum(row.balance),
    dailyTxCount: asNum(row.daily_tx_count),
    txDayStamp: asStr(row.tx_day_stamp),
    createdAt: asNum(row.created_at),
    lastTxAt: row.last_tx_at == null ? null : asNum(row.last_tx_at),
  };
}

async function getProfile(db: D1DatabaseLike, profileId: string): Promise<RuntimeProfile | null> {
  const row = await first<Record<string, unknown>>(db, 'SELECT profile_id, username, display_name, wallet_id, created_at FROM runtime_profiles WHERE profile_id = ?', [profileId]);
  if (!row) return null;
  const botRows = await all<Record<string, unknown>>(db, 'SELECT bot_id FROM runtime_owner_bots WHERE owner_profile_id = ? ORDER BY bot_id', [profileId]);
  return {
    id: asStr(row.profile_id),
    username: asStr(row.username),
    displayName: asStr(row.display_name),
    createdAt: asNum(row.created_at),
    walletId: asStr(row.wallet_id),
    ownedBotIds: botRows.map((entry) => asStr(entry.bot_id)).filter(Boolean),
  };
}

async function getBot(db: D1DatabaseLike, botId: string): Promise<{ record: RuntimeBotRecord; behavior: RuntimeBotBehavior; autoplaySession: AutoplaySessionState } | null> {
  const row = await first<Record<string, unknown>>(
    db,
    'SELECT record_json, behavior_json, autoplay_session_json FROM runtime_owner_bots WHERE bot_id = ?',
    [botId],
  );
  if (!row) return null;
  const record = safeJsonParse<RuntimeBotRecord>(row.record_json, {} as RuntimeBotRecord);
  const behavior = safeJsonParse<RuntimeBotBehavior>(row.behavior_json, defaultBehavior());
  const autoplaySession = safeJsonParse<AutoplaySessionState>(row.autoplay_session_json, defaultAutoplaySession(behavior));
  if (!record?.id) return null;
  return { record, behavior, autoplaySession };
}

async function persistBot(db: D1DatabaseLike, record: RuntimeBotRecord, behavior: RuntimeBotBehavior, autoplaySession: AutoplaySessionState): Promise<void> {
  await run(
    db,
    `INSERT OR REPLACE INTO runtime_owner_bots (
      bot_id, owner_profile_id, record_json, behavior_json, autoplay_session_json, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?)`,
    [record.id, record.ownerProfileId, JSON.stringify(record), JSON.stringify(behavior), JSON.stringify(autoplaySession), Date.now()],
  );
}

async function createProfileProvision(db: D1DatabaseLike, params: {
  externalSubject: string;
  email?: string;
  displayName?: string;
  personality?: RuntimeBotBehavior['personality'];
  targetPreference?: RuntimeBotBehavior['targetPreference'];
}) {
  const existingLink = await first<Record<string, unknown>>(db, 'SELECT subject, profile_id, wallet_id, linked_at, updated_at FROM auth_subject_links WHERE subject = ?', [params.externalSubject]);
  if (existingLink) {
    const profile = await getProfile(db, asStr(existingLink.profile_id));
    const wallet = await getWallet(db, asStr(existingLink.wallet_id));
    if (profile && wallet) {
      return {
        ok: true,
        created: false,
        profile: { ...profile, wallet: walletSummary(wallet) },
        wallet: walletSummary(wallet),
        botId: profile.ownedBotIds[0] ?? null,
        continuity: {
          source: 'd1',
          linkedAt: asNum(existingLink.linked_at),
          lastVerifiedAt: asNum(existingLink.updated_at),
        },
      };
    }
  }

  const now = Date.now();
  const profileId = `profile_${await nextCounter(db, 'profile_counter')}`;
  const walletId = `wallet_${await nextCounter(db, 'wallet_counter')}`;
  const botId = `agent_${profileId}`;
  const username = await uniqueUsername(db, params.email?.split('@')[0] || params.displayName || params.externalSubject.slice(0, 12));
  const displayName = String(params.displayName || username).trim() || username;
  const wallet: RuntimeWallet = {
    id: walletId,
    ownerProfileId: profileId,
    address: await syntheticAddress(`${profileId}:${walletId}`),
    encryptedPrivateKey: await syntheticPrivateKey(`${profileId}:${walletId}`),
    walletProvider: 'internal',
    externalWalletAddress: null,
    externalWalletRef: null,
    externalWalletLinkedAt: null,
    balance: USER_SEED_BALANCE,
    dailyTxCount: 0,
    txDayStamp: dayStamp(),
    createdAt: now,
    lastTxAt: null,
  };
  await run(
    db,
    `INSERT INTO runtime_wallets (
      wallet_id, owner_profile_id, address, encrypted_private_key, wallet_provider,
      external_wallet_address, external_wallet_ref, external_wallet_linked_at, balance,
      daily_tx_count, tx_day_stamp, created_at, last_tx_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      wallet.id,
      wallet.ownerProfileId,
      wallet.address,
      wallet.encryptedPrivateKey,
      wallet.walletProvider,
      null,
      null,
      null,
      wallet.balance,
      wallet.dailyTxCount,
      wallet.txDayStamp,
      wallet.createdAt,
      wallet.lastTxAt,
      now,
    ],
  );
  await run(
    db,
    'INSERT INTO runtime_profiles (profile_id, username, display_name, wallet_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    [profileId, username, displayName, wallet.id, now, now],
  );
  await run(
    db,
    'INSERT OR REPLACE INTO auth_subject_links (subject, profile_id, wallet_id, linked_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    [params.externalSubject, profileId, wallet.id, now, now],
  );
  const behavior = defaultBehavior();
  behavior.personality = params.personality ?? 'social';
  behavior.targetPreference = params.targetPreference ?? 'human_first';
  const record: RuntimeBotRecord = {
    id: botId,
    ownerProfileId: profileId,
    displayName: `${displayName} Bot`,
    createdAt: now,
    managedBySuperAgent: true,
    autoplayEnabled: false,
    duty: 'owner',
    patrolSection: Math.abs(hashString(profileId)) % 8,
    walletId: wallet.id,
  };
  await persistBot(db, record, behavior, defaultAutoplaySession(behavior));
  const profile: RuntimeProfile = {
    id: profileId,
    username,
    displayName,
    createdAt: now,
    walletId: wallet.id,
    ownedBotIds: [botId],
  };
  return {
    ok: true,
    created: true,
    profile: { ...profile, wallet: walletSummary(wallet) },
    wallet: walletSummary(wallet),
    botId,
    continuity: {
      source: 'd1',
      linkedAt: now,
      lastVerifiedAt: now,
    },
  };
}

function hashString(input: string): number {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = ((hash << 5) - hash) + input.charCodeAt(index);
    hash |= 0;
  }
  return hash;
}

function chooseScheduledMove(botId: string, gameType: 'rps' | 'coinflip' | 'dice_duel'): string {
  const bucket = Math.floor(Date.now() / 1000);
  const seed = Math.abs(hashString(`${botId}:${bucket}`));
  if (gameType === 'coinflip') return seed % 2 === 0 ? 'heads' : 'tails';
  if (gameType === 'dice_duel') return `d${(seed % 6) + 1}`;
  return ['rock', 'paper', 'scissors'][seed % 3] ?? 'rock';
}

function computeReadiness(wallet: RuntimeWallet | null, behavior: RuntimeBotBehavior) {
  const minWager = Math.max(1, behavior.autoplay?.baseWager ?? behavior.baseWager ?? 1);
  if (!wallet) return { ready: false, status: 'wallet_missing', reason: 'wallet_missing' };
  if (wallet.balance < minWager) {
    return { ready: false, status: 'insufficient_usdc', reason: 'insufficient_balance', minWager, balance: wallet.balance };
  }
  return { ready: true, status: 'ready', minWager, balance: wallet.balance };
}

function shouldRunBot(behavior: RuntimeBotBehavior, session: AutoplaySessionState, wallet: RuntimeWallet | null): { ok: boolean; wager: number; gameType: 'rps' | 'coinflip' | 'dice_duel' | null } {
  if (behavior.mode === 'passive') return { ok: false, wager: 0, gameType: null };
  const autoplay = behavior.autoplay;
  if (!autoplay || autoplay.enabled === false) return { ok: false, wager: 0, gameType: null };
  const readiness = computeReadiness(wallet, behavior);
  if (!readiness.ready) return { ok: false, wager: 0, gameType: null };
  const cooldownMs = autoplay.cooldownMs ?? behavior.challengeCooldownMs ?? 2_000;
  if (session.pauseReason === 'cooling_down' && session.lastGameAt && Date.now() - session.lastGameAt < cooldownMs) {
    return { ok: false, wager: 0, gameType: null };
  }
  const allowed = autoplay.allowedGames.filter((entry): entry is 'rps' | 'coinflip' | 'dice_duel' => ['rps', 'coinflip', 'dice_duel'].includes(entry));
  const gameType: 'rps' | 'coinflip' | 'dice_duel' = allowed.length > 0
    ? (allowed[(Math.floor(Date.now() / 30_000) + Math.abs(hashString(String(wallet?.id || '0')))) % allowed.length] ?? 'rps')
    : 'rps';
  let wager = autoplay.baseWager;
  if (autoplay.wagerMode === 'percent_wallet' && wallet) {
    const pct = Math.max(1, Math.min(100, autoplay.walletPercent ?? 5)) / 100;
    wager = Math.max(1, Math.floor(wallet.balance * pct));
  } else if (autoplay.wagerMode === 'martingale') {
    wager = Math.max(1, session.currentWager || autoplay.baseWager);
  }
  wager = Math.max(1, Math.min(autoplay.maxWager, wager));
  if (wallet && wallet.balance < wager) return { ok: false, wager: 0, gameType: null };
  return { ok: true, wager, gameType };
}

function updateAutoplaySession(session: AutoplaySessionState, behavior: RuntimeBotBehavior, outcome: 'won' | 'lost' | 'push', wager: number): AutoplaySessionState {
  const autoplay = behavior.autoplay;
  const next: AutoplaySessionState = {
    ...session,
    lastGameAt: Date.now(),
    pauseReason: autoplay?.cooldownMs ? 'cooling_down' : null,
    pausedAt: autoplay?.cooldownMs ? Date.now() : null,
  };
  if (outcome === 'won') {
    next.sessionNetPnl += wager;
    next.consecutiveLosses = 0;
    next.currentWager = autoplay?.baseWager ?? behavior.baseWager ?? 1;
  } else if (outcome === 'lost') {
    next.sessionNetPnl -= wager;
    next.consecutiveLosses += 1;
    if (autoplay?.wagerMode === 'martingale') {
      const mult = Math.max(1.1, Math.min(10, autoplay.martingaleMultiplier ?? 2));
      next.currentWager = Math.min(autoplay.maxWager, Math.max(autoplay.baseWager, Math.round((next.currentWager || autoplay.baseWager) * mult)));
    }
  }
  if (autoplay?.sessionLossLimit != null && Math.abs(Math.min(0, next.sessionNetPnl)) >= autoplay.sessionLossLimit) {
    next.pauseReason = 'loss_limit';
    next.pausedAt = Date.now();
  }
  if (autoplay?.sessionWinTarget != null && next.sessionNetPnl >= autoplay.sessionWinTarget) {
    next.pauseReason = 'win_target';
    next.pausedAt = Date.now();
  }
  return next;
}

function resolveScheduledOutcome(message: Record<string, unknown> | undefined, actorId: string): 'won' | 'lost' | 'push' | null {
  const view = message?.view;
  if (!view || typeof view !== 'object') return null;
  const typed = view as Record<string, unknown>;
  const winnerId = String(typed.winnerId || '').trim();
  const payoutDelta = Number(typed.payoutDelta || 0);
  if (payoutDelta > 0 || winnerId === actorId) return 'won';
  if (payoutDelta < 0 || (winnerId && winnerId !== actorId)) return 'lost';
  if (Number.isFinite(payoutDelta)) return 'push';
  return null;
}

async function fetchPlayableStations(env: RuntimeEnv): Promise<PlayableStation[]> {
  const origin = normalizeOrigin(env.SERVER_UPSTREAM);
  if (!origin) return [];
  const response = await fetch(`${origin}/stations/playable`);
  if (!response.ok) return [];
  const payload = await response.json().catch(() => null) as { ok?: boolean; stations?: PlayableStation[] } | null;
  return payload?.ok && Array.isArray(payload.stations) ? payload.stations.filter((entry) => entry && entry.available !== false) : [];
}

async function postScheduledStationInteract(env: RuntimeEnv, body: { playerId: string; walletId: string | null; displayName: string; payload: Record<string, unknown> }) {
  const origin = normalizeOrigin(env.SERVER_UPSTREAM);
  if (!origin || !env.INTERNAL_SERVICE_TOKEN) return { ok: false, message: null as Record<string, unknown> | null };
  const response = await fetch(`${origin}/stations/interact`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-internal-token': env.INTERNAL_SERVICE_TOKEN,
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null) as { ok?: boolean; message?: Record<string, unknown> } | null;
  return { ok: Boolean(response.ok && payload?.ok), message: payload?.message ?? null };
}

async function runScheduledBots(env: RuntimeEnv): Promise<void> {
  const db = env.STATE_DB;
  if (!db) return;
  await ensureSchema(db);
  const stations = await fetchPlayableStations(env);
  if (stations.length === 0) return;
  const stationByGameType = new Map(stations.map((entry) => [entry.gameType, entry] as const));
  const startActionByGame = {
    coinflip: 'coinflip_house_start',
    rps: 'rps_house_start',
    dice_duel: 'dice_duel_start',
  } as const;
  const pickActionByGame = {
    coinflip: 'coinflip_house_pick',
    rps: 'rps_house_pick',
    dice_duel: 'dice_duel_pick',
  } as const;
  const rows = await all<Record<string, unknown>>(db, 'SELECT bot_id FROM runtime_owner_bots ORDER BY bot_id');
  for (const row of rows) {
    const bot = await getBot(db, asStr(row.bot_id));
    if (!bot?.record?.ownerProfileId) continue;
    const presence = await first<Record<string, unknown>>(db, 'SELECT until_ms FROM runtime_owner_presence WHERE profile_id = ?', [bot.record.ownerProfileId]);
    if (presence && asNum(presence.until_ms) > Date.now()) continue;
    const wallet = bot.record.walletId ? await getWallet(db, bot.record.walletId) : null;
    const plan = shouldRunBot(bot.behavior, bot.autoplaySession, wallet);
    if (!plan.ok || !plan.gameType) continue;
    const station = stationByGameType.get(plan.gameType);
    if (!station?.id) continue;
    const actorId = `u_${bot.record.ownerProfileId}`;
    const started = await postScheduledStationInteract(env, {
      playerId: actorId,
      walletId: bot.record.walletId,
      displayName: bot.record.displayName || bot.record.id,
      payload: {
        stationId: station.id,
        action: startActionByGame[plan.gameType],
        wager: plan.wager,
      },
    });
    if (!started.ok) continue;
    const resolved = await postScheduledStationInteract(env, {
      playerId: actorId,
      walletId: bot.record.walletId,
      displayName: bot.record.displayName || bot.record.id,
      payload: {
        stationId: station.id,
        action: pickActionByGame[plan.gameType],
        pick: chooseScheduledMove(bot.record.id, plan.gameType),
        playerSeed: crypto.randomUUID().replace(/-/g, '').slice(0, 16),
      },
    });
    if (!resolved.ok) continue;
    const outcome = resolveScheduledOutcome(resolved.message ?? undefined, actorId);
    if (outcome) {
      const nextSession = updateAutoplaySession(bot.autoplaySession, bot.behavior, outcome, plan.wager);
      await persistBot(db, bot.record, bot.behavior, nextSession);
    }
  }
}

export async function handleRuntimeRequest(request: Request, env: RuntimeEnv, pathname: string): Promise<Response | null> {
  const db = env.STATE_DB;
  if (!db) {
    return json({ ok: false, reason: 'state_db_unconfigured' }, 503);
  }
  await ensureSchema(db);
  await ensureHouseProfile(db);

  if (pathname === '/runtime/health') {
    return json({ ok: true, backend: 'cloudflare-runtime', storage: 'd1' });
  }

  const routePath = pathname.replace(/^\/runtime/, '') || '/';

  if (routePath === '/status') {
    const profileRows = await all<Record<string, unknown>>(db, 'SELECT profile_id, wallet_id FROM runtime_profiles ORDER BY profile_id');
    const profiles = [];
    for (const row of profileRows) {
      const profile = await getProfile(db, asStr(row.profile_id));
      if (!profile) continue;
      const wallet = await getWallet(db, profile.walletId);
      profiles.push({ ...profile, wallet: walletSummary(wallet) });
    }
    const botRows = await all<Record<string, unknown>>(db, 'SELECT bot_id FROM runtime_owner_bots ORDER BY bot_id');
    const bots = [];
    for (const row of botRows) {
      const bot = await getBot(db, asStr(row.bot_id));
      if (!bot) continue;
      const wallet = bot.record.walletId ? await getWallet(db, bot.record.walletId) : null;
      bots.push({
        id: bot.record.id,
        connected: false,
        walletId: bot.record.walletId,
        walletAddress: wallet?.address ?? null,
        behavior: bot.behavior,
        autoplaySession: bot.autoplaySession,
        meta: {
          ownerProfileId: bot.record.ownerProfileId,
          displayName: bot.record.displayName,
          duty: bot.record.duty,
          managedBySuperAgent: bot.record.managedBySuperAgent,
          patrolSection: bot.record.patrolSection,
          botClass: 'owner',
          controlState: bot.behavior.mode === 'active' ? 'bot_active' : 'idle_offline',
          ownerOnline: false,
        },
      });
    }
    const house = await ensureHouseProfile(db);
    const superAgent = await readSetting(db, 'super_agent', {
      id: 'agent_1',
      mode: 'balanced',
      challengeEnabled: false,
      defaultChallengeCooldownMs: 9000,
      workerTargetPreference: 'human_first',
    });
    const walletPolicy = await readSetting(db, 'wallet_policy', {
      enabled: true,
      allowedSkills: ['fund', 'withdraw', 'transfer'],
    });
    return json({
      ok: true,
      configuredBotCount: bots.length,
      connectedBotCount: 0,
      backgroundBotCount: bots.filter((entry) => entry.meta.ownerProfileId === 'system_house').length,
      profileBotCount: bots.filter((entry) => entry.meta.ownerProfileId !== 'system_house').length,
      disconnectedBotIds: bots.map((entry) => entry.id),
      profiles,
      house: { wallet: walletSummary(house.wallet) },
      bots,
      wallets: profiles.map((entry) => ({
        id: entry.walletId,
        ownerProfileId: entry.id,
      })),
      openRouterConfigured: Boolean(String(env.OPENROUTER_API_KEY || '').trim()),
      superAgent: {
        ...superAgent,
        walletPolicy,
      },
    });
  }

  if (routePath === '/profiles') {
    const rows = await all<Record<string, unknown>>(db, 'SELECT profile_id FROM runtime_profiles ORDER BY created_at ASC');
    const profiles = [];
    for (const row of rows) {
      const profile = await getProfile(db, asStr(row.profile_id));
      if (!profile) continue;
      const wallet = await getWallet(db, profile.walletId);
      profiles.push({ ...profile, wallet: walletSummary(wallet) });
    }
    return json({ profiles });
  }

  if (routePath === '/profiles/provision' && request.method === 'POST') {
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const subject = String(body?.externalSubject || '').trim();
    if (!subject) return json({ ok: false, reason: 'external_subject_required' }, 400);
    return json(await createProfileProvision(db, {
      externalSubject: subject,
      email: typeof body?.email === 'string' ? body.email : undefined,
      displayName: typeof body?.displayName === 'string' ? body.displayName : undefined,
      personality: body?.personality === 'aggressive' || body?.personality === 'conservative' || body?.personality === 'social' ? body.personality : undefined,
      targetPreference: body?.targetPreference === 'human_only' || body?.targetPreference === 'human_first' || body?.targetPreference === 'any' ? body.targetPreference : undefined,
    }));
  }

  if (routePath === '/profiles/create' && request.method === 'POST') {
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const username = String(body?.username || '').trim();
    const displayName = String(body?.displayName || username || 'Arena Player').trim();
    return json(await createProfileProvision(db, {
      externalSubject: `admin:${username || displayName}:${Date.now()}`,
      displayName,
      personality: body?.personality === 'aggressive' || body?.personality === 'conservative' || body?.personality === 'social' ? body.personality : undefined,
      targetPreference: body?.targetPreference === 'human_only' || body?.targetPreference === 'human_first' || body?.targetPreference === 'any' ? body.targetPreference : undefined,
    }));
  }

  if (routePath === '/profiles/link' && request.method === 'GET') {
    const url = new URL(request.url);
    const subject = String(url.searchParams.get('subject') || '').trim();
    if (!subject) return json({ ok: false, reason: 'subject_required' }, 400);
    const link = await first<Record<string, unknown>>(db, 'SELECT subject, profile_id, wallet_id, linked_at, updated_at FROM auth_subject_links WHERE subject = ?', [subject]);
    if (!link) return json({ ok: false, reason: 'subject_link_not_found' }, 404);
    return json({
      ok: true,
      link: {
        subject: asStr(link.subject),
        profileId: asStr(link.profile_id),
        walletId: asStr(link.wallet_id),
        linkedAt: asNum(link.linked_at),
        updatedAt: asNum(link.updated_at),
        continuitySource: 'd1',
      },
    });
  }

  if (routePath === '/profiles/link' && request.method === 'POST') {
    if (!assertInternal(request, env)) return json({ ok: false, reason: 'unauthorized_internal' }, 401);
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const subject = String(body?.subject || '').trim();
    const profileId = String(body?.profileId || '').trim();
    const walletId = String(body?.walletId || '').trim();
    if (!subject || !profileId) return json({ ok: false, reason: 'subject_and_profile_required' }, 400);
    const profile = await getProfile(db, profileId);
    if (!profile) return json({ ok: false, reason: 'profile_or_wallet_not_found' }, 404);
    const finalWalletId = walletId || profile.walletId;
    const now = Date.now();
    await run(db, 'INSERT OR REPLACE INTO auth_subject_links (subject, profile_id, wallet_id, linked_at, updated_at) VALUES (?, ?, ?, COALESCE((SELECT linked_at FROM auth_subject_links WHERE subject = ?), ?), ?)', [subject, profileId, finalWalletId, subject, now, now]);
    return json({ ok: true, link: { subject, profileId, walletId: finalWalletId, linkedAt: now, updatedAt: now, continuitySource: 'd1' } });
  }

  const profileUpdateMatch = routePath.match(/^\/profiles\/([^/]+)\/update$/);
  if (profileUpdateMatch && request.method === 'POST') {
    const profileId = profileUpdateMatch[1] || '';
    const profile = await getProfile(db, profileId);
    if (!profile) return json({ ok: false, reason: 'profile_not_found' }, 404);
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) return json({ ok: false, reason: 'invalid_json' }, 400);
    const displayName = typeof body.displayName === 'string' && body.displayName.trim() ? body.displayName.trim() : profile.displayName;
    let username = profile.username;
    if (typeof body.username === 'string' && body.username.trim().length > 1) {
      const candidate = body.username.trim().toLowerCase();
      const taken = await first(db, 'SELECT profile_id FROM runtime_profiles WHERE lower(username) = lower(?) AND profile_id <> ?', [candidate, profileId]);
      if (taken) return json({ ok: false, reason: 'username_taken' }, 400);
      username = body.username.trim();
    }
    await run(db, 'UPDATE runtime_profiles SET username = ?, display_name = ?, updated_at = ? WHERE profile_id = ?', [username, displayName, Date.now(), profileId]);
    const wallet = await getWallet(db, profile.walletId);
    return json({ ok: true, profile: { ...profile, username, displayName, wallet: walletSummary(wallet) } });
  }

  const onboardingGetMatch = routePath.match(/^\/profiles\/([^/]+)\/onboarding$/);
  if (onboardingGetMatch && request.method === 'GET') {
    const profile = await getProfile(db, onboardingGetMatch[1] || '');
    if (!profile) return json({ ok: false, reason: 'profile_not_found' }, 404);
    const row = await first<Record<string, unknown>>(db, 'SELECT onboarding_completed_at FROM runtime_profile_onboarding WHERE profile_id = ?', [profile.id]);
    const completedAt = row ? asNum(row.onboarding_completed_at) : null;
    return json({ ok: true, profileId: profile.id, completed: Boolean(completedAt), completedAt });
  }

  const onboardingPostMatch = routePath.match(/^\/profiles\/([^/]+)\/onboarding\/complete$/);
  if (onboardingPostMatch && request.method === 'POST') {
    const profile = await getProfile(db, onboardingPostMatch[1] || '');
    if (!profile) return json({ ok: false, reason: 'profile_not_found' }, 404);
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const completedAt = Math.max(1, asNum(body?.completedAt, Date.now()));
    await run(db, 'INSERT OR REPLACE INTO runtime_profile_onboarding (profile_id, onboarding_completed_at, updated_at) VALUES (?, ?, ?)', [profile.id, completedAt, Date.now()]);
    return json({ ok: true, profileId: profile.id, completed: true, completedAt });
  }

  const walletSummaryMatch = routePath.match(/^\/wallets\/([^/]+)\/summary$/);
  if (walletSummaryMatch && request.method === 'GET') {
    const wallet = await getWallet(db, walletSummaryMatch[1] || '');
    if (!wallet) return json({ ok: false, reason: 'wallet_not_found' }, 404);
    return json({
      ok: true,
      wallet: walletSummary(wallet),
      onchain: {
        mode: 'runtime',
        chainId: null,
        tokenAddress: null,
        tokenSymbol: 'USDC',
        tokenDecimals: 6,
        address: wallet.address,
        nativeBalanceEth: null,
        tokenBalance: wallet.balance.toFixed(2),
        synced: false,
        gasSponsored: false,
        gasPolicyReason: 'cloudflare_runtime_wallet',
      },
    });
  }

  const walletActivityMatch = routePath.match(/^\/wallets\/([^/]+)\/activity$/);
  if (walletActivityMatch && request.method === 'GET') {
    const wallet = await getWallet(db, walletActivityMatch[1] || '');
    if (!wallet) return json({ ok: false, reason: 'wallet_not_found' }, 404);
    return json({
      ok: true,
      walletId: wallet.id,
      address: wallet.address,
      chainId: null,
      tokenAddress: null,
      tokenSymbol: 'USDC',
      tokenDecimals: 6,
      lookbackBlocks: 0,
      recent: [],
    });
  }

  const walletActionMatch = routePath.match(/^\/wallets\/([^/]+)\/(fund|withdraw|transfer|export-key)$/);
  if (walletActionMatch && request.method === 'POST') {
    const wallet = await getWallet(db, walletActionMatch[1] || '');
    if (!wallet) return json({ ok: false, reason: 'wallet_not_found' }, 404);
    const action = walletActionMatch[2];
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (action === 'export-key') {
      return json({
        ok: true,
        walletId: wallet.id,
        address: wallet.address,
        privateKey: wallet.encryptedPrivateKey,
        exportedAt: Date.now(),
      });
    }
    const amount = Math.max(0, asNum(body?.amount));
    if (amount <= 0) return json({ ok: false, reason: 'invalid_amount' }, 400);
    if (action === 'fund') {
      wallet.balance += amount;
    } else if (action === 'withdraw') {
      if (wallet.balance < amount) return json({ ok: false, reason: 'insufficient_balance' }, 400);
      wallet.balance -= amount;
    } else if (action === 'transfer') {
      const targetWallet = await getWallet(db, String(body?.toWalletId || '').trim());
      if (!targetWallet) return json({ ok: false, reason: 'target_wallet_not_found' }, 404);
      if (targetWallet.id === wallet.id) return json({ ok: false, reason: 'same_wallet' }, 400);
      if (wallet.balance < amount) return json({ ok: false, reason: 'insufficient_balance' }, 400);
      wallet.balance -= amount;
      targetWallet.balance += amount;
      wallet.dailyTxCount += 1;
      targetWallet.dailyTxCount += 1;
      wallet.lastTxAt = Date.now();
      targetWallet.lastTxAt = Date.now();
      await run(db, 'UPDATE runtime_wallets SET balance = ?, daily_tx_count = ?, last_tx_at = ?, updated_at = ? WHERE wallet_id = ?', [wallet.balance, wallet.dailyTxCount, wallet.lastTxAt, Date.now(), wallet.id]);
      await run(db, 'UPDATE runtime_wallets SET balance = ?, daily_tx_count = ?, last_tx_at = ?, updated_at = ? WHERE wallet_id = ?', [targetWallet.balance, targetWallet.dailyTxCount, targetWallet.lastTxAt, Date.now(), targetWallet.id]);
      return json({ ok: true, mode: 'runtime', source: walletSummary(wallet), target: walletSummary(targetWallet) });
    }
    wallet.dailyTxCount += 1;
    wallet.lastTxAt = Date.now();
    await run(db, 'UPDATE runtime_wallets SET balance = ?, daily_tx_count = ?, last_tx_at = ?, updated_at = ? WHERE wallet_id = ?', [wallet.balance, wallet.dailyTxCount, wallet.lastTxAt, Date.now(), wallet.id]);
    return json({ ok: true, mode: 'runtime', wallet: walletSummary(wallet) });
  }

  if (routePath === '/wallets/onchain/prepare-escrow' && request.method === 'POST') {
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const walletIds = Array.isArray(body?.walletIds) ? body?.walletIds.map((entry) => String(entry || '').trim()).filter(Boolean) : [];
    return json({
      ok: true,
      configured: false,
      tokenDecimals: 6,
      results: walletIds.map((walletId) => ({ walletId, ok: true, source: 'cloudflare_runtime', status: 'ready' })),
    });
  }

  if (routePath === '/house/status') {
    const house = await ensureHouseProfile(db);
    return json({
      ok: true,
      house: {
        wallet: walletSummary(house.wallet),
      },
    });
  }

  if (routePath === '/house/config' && request.method === 'POST') {
    const house = await ensureHouseProfile(db);
    return json({ ok: true, house: { wallet: walletSummary(house.wallet) }, saved: false, mode: 'cloudflare_runtime' });
  }

  if (routePath === '/house/refill' && request.method === 'POST') {
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const amount = Math.max(0, asNum(body?.amount));
    if (amount <= 0) return json({ ok: false, reason: 'invalid_amount' }, 400);
    const house = await ensureHouseProfile(db);
    house.wallet.balance += amount;
    house.wallet.dailyTxCount += 1;
    house.wallet.lastTxAt = Date.now();
    await run(db, 'UPDATE runtime_wallets SET balance = ?, daily_tx_count = ?, last_tx_at = ?, updated_at = ? WHERE wallet_id = ?', [house.wallet.balance, house.wallet.dailyTxCount, house.wallet.lastTxAt, Date.now(), house.wallet.id]);
    return json({ ok: true, mode: 'runtime', house: { wallet: walletSummary(house.wallet) } });
  }

  if (routePath === '/house/transfer' && request.method === 'POST') {
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const toWalletId = String(body?.toWalletId || '').trim();
    const amount = Math.max(0, asNum(body?.amount));
    if (!toWalletId || amount <= 0) return json({ ok: false, reason: 'target_and_amount_required' }, 400);
    const house = await ensureHouseProfile(db);
    const targetWallet = await getWallet(db, toWalletId);
    if (!targetWallet) return json({ ok: false, reason: 'target_wallet_not_found' }, 404);
    if (house.wallet.balance < amount) return json({ ok: false, reason: 'insufficient_balance' }, 400);
    house.wallet.balance -= amount;
    targetWallet.balance += amount;
    house.wallet.dailyTxCount += 1;
    targetWallet.dailyTxCount += 1;
    house.wallet.lastTxAt = Date.now();
    targetWallet.lastTxAt = Date.now();
    await run(db, 'UPDATE runtime_wallets SET balance = ?, daily_tx_count = ?, last_tx_at = ?, updated_at = ? WHERE wallet_id = ?', [house.wallet.balance, house.wallet.dailyTxCount, house.wallet.lastTxAt, Date.now(), house.wallet.id]);
    await run(db, 'UPDATE runtime_wallets SET balance = ?, daily_tx_count = ?, last_tx_at = ?, updated_at = ? WHERE wallet_id = ?', [targetWallet.balance, targetWallet.dailyTxCount, targetWallet.lastTxAt, Date.now(), targetWallet.id]);
    return json({ ok: true, mode: 'runtime', source: walletSummary(house.wallet), target: walletSummary(targetWallet) });
  }

  if (routePath === '/agents/reconcile' && request.method === 'POST') {
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const count = Math.max(0, Math.min(120, Math.floor(asNum(body?.count))));
    const house = await ensureHouseProfile(db);
    const existingRows = await all<Record<string, unknown>>(db, 'SELECT bot_id FROM runtime_owner_bots WHERE owner_profile_id = ? ORDER BY bot_id', ['system_house']);
    for (let index = existingRows.length; index < count; index += 1) {
      const behavior = defaultBehavior();
      behavior.mode = 'active';
      behavior.challengeEnabled = true;
      behavior.targetPreference = 'human_first';
      const record: RuntimeBotRecord = {
        id: `agent_bg_${index + 1}`,
        ownerProfileId: 'system_house',
        displayName: `Arena Agent ${index + 1}`,
        createdAt: Date.now(),
        managedBySuperAgent: true,
        autoplayEnabled: true,
        duty: 'house',
        patrolSection: index % 8,
        walletId: house.wallet.id,
      };
      await persistBot(db, record, behavior, defaultAutoplaySession(behavior));
    }
    if (existingRows.length > count) {
      const remove = existingRows.slice(count).map((entry) => asStr(entry.bot_id)).filter(Boolean);
      for (const botId of remove) {
        await run(db, 'DELETE FROM runtime_owner_bots WHERE bot_id = ?', [botId]);
      }
    }
    return json({ ok: true, count });
  }

  if (routePath === '/super-agent/config' && request.method === 'POST') {
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const config = {
      id: String(body?.id || 'agent_1').trim() || 'agent_1',
      mode: ['balanced', 'aggressive', 'conservative'].includes(String(body?.mode || '')) ? String(body?.mode) : 'balanced',
      challengeEnabled: Boolean(body?.challengeEnabled),
      defaultChallengeCooldownMs: Math.max(1200, Math.min(120000, Math.floor(asNum(body?.defaultChallengeCooldownMs, 9000)))),
      workerTargetPreference: body?.workerTargetPreference === 'human_only' || body?.workerTargetPreference === 'human_first' || body?.workerTargetPreference === 'any'
        ? body.workerTargetPreference
        : 'human_first',
    };
    await writeSetting(db, 'super_agent', config);
    return json({ ok: true, saved: true, superAgent: config });
  }

  if (routePath === '/capabilities/wallet' && request.method === 'POST') {
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const skills = Array.isArray(body?.skills)
      ? body.skills.map((value) => String(value || '').trim()).filter(Boolean)
      : [];
    const policy = {
      enabled: Boolean(body?.enabled),
      allowedSkills: skills.length > 0 ? skills : ['fund', 'withdraw', 'transfer'],
    };
    await writeSetting(db, 'wallet_policy', policy);
    return json({ ok: true, saved: true, walletPolicy: policy });
  }

  if (routePath === '/secrets/openrouter' && request.method === 'POST') {
    return json({ ok: true, saved: false, reason: 'model_keys_are_managed_in_cloudflare_secrets' });
  }

  if (routePath === '/super-agent/ethskills/sync' && request.method === 'POST') {
    return json({ ok: true, refreshed: 0, skills: [] });
  }

  if (routePath === '/super-agent/delegate/apply' && request.method === 'POST') {
    return json({ ok: true, applied: false, mode: 'cloudflare_runtime_stub' });
  }

  const agentConfigMatch = routePath.match(/^\/agents\/([^/]+)\/config$/);
  if (agentConfigMatch && request.method === 'POST') {
    const bot = await getBot(db, agentConfigMatch[1] || '');
    if (!bot) return json({ ok: false, reason: 'bot_not_found' }, 404);
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) return json({ ok: false, reason: 'invalid_json' }, 400);
    if (body.personality === 'aggressive' || body.personality === 'conservative' || body.personality === 'social') bot.behavior.personality = body.personality;
    if (body.mode === 'active' || body.mode === 'passive') bot.behavior.mode = body.mode;
    if (typeof body.challengeEnabled === 'boolean') bot.behavior.challengeEnabled = body.challengeEnabled;
    if (body.targetPreference === 'human_only' || body.targetPreference === 'human_first' || body.targetPreference === 'any') bot.behavior.targetPreference = body.targetPreference;
    if (typeof body.baseWager === 'number') bot.behavior.baseWager = Math.max(1, Math.floor(body.baseWager));
    if (typeof body.maxWager === 'number') bot.behavior.maxWager = Math.max(bot.behavior.baseWager, Math.floor(body.maxWager));
    if (typeof body.displayName === 'string' && body.displayName.trim()) bot.record.displayName = body.displayName.trim();
    if (typeof body.managedBySuperAgent === 'boolean') bot.record.managedBySuperAgent = body.managedBySuperAgent;
    if (typeof body.autoplayEnabled === 'boolean') {
      bot.record.autoplayEnabled = body.autoplayEnabled;
      bot.behavior.mode = body.autoplayEnabled ? 'active' : 'passive';
      if (bot.behavior.autoplay) bot.behavior.autoplay.enabled = body.autoplayEnabled;
    }
    if (body.autoplay && typeof body.autoplay === 'object') {
      const autoplay = body.autoplay as Record<string, unknown>;
      const next = bot.behavior.autoplay ?? defaultBehavior().autoplay!;
      next.enabled = typeof autoplay.enabled === 'boolean' ? autoplay.enabled : next.enabled;
      if (Array.isArray(autoplay.allowedGames)) {
        next.allowedGames = autoplay.allowedGames
          .map((entry) => String(entry))
          .filter((entry): entry is 'rps' | 'coinflip' | 'dice_duel' => ['rps', 'coinflip', 'dice_duel'].includes(entry));
      }
      if (typeof autoplay.baseWager === 'number') next.baseWager = Math.max(1, Math.floor(autoplay.baseWager));
      if (typeof autoplay.maxWager === 'number') next.maxWager = Math.max(next.baseWager, Math.floor(autoplay.maxWager));
      if (autoplay.wagerMode === 'fixed' || autoplay.wagerMode === 'percent_wallet' || autoplay.wagerMode === 'martingale') next.wagerMode = autoplay.wagerMode;
      if (typeof autoplay.cooldownMs === 'number') next.cooldownMs = Math.max(0, Math.floor(autoplay.cooldownMs));
      if (typeof autoplay.walletPercent === 'number') next.walletPercent = autoplay.walletPercent;
      if (typeof autoplay.martingaleMultiplier === 'number') next.martingaleMultiplier = autoplay.martingaleMultiplier;
      if (typeof autoplay.sessionLossLimit === 'number') next.sessionLossLimit = autoplay.sessionLossLimit;
      if (typeof autoplay.sessionWinTarget === 'number') next.sessionWinTarget = autoplay.sessionWinTarget;
      bot.behavior.autoplay = next;
    }
    if (body.resetAutoplaySession === true) {
      bot.autoplaySession = defaultAutoplaySession(bot.behavior);
    }
    await persistBot(db, bot.record, bot.behavior, bot.autoplaySession);
    return json({ ok: true, bot: { id: bot.record.id, connected: false, behavior: bot.behavior, autoplaySession: bot.autoplaySession }, meta: bot.record });
  }

  const botWalletMatch = routePath.match(/^\/bots\/([^/]+)\/wallet$/);
  if (botWalletMatch && request.method === 'GET') {
    const bot = await getBot(db, botWalletMatch[1] || '');
    if (!bot || !bot.record.walletId) return json({ ok: false, reason: 'bot_wallet_not_found' }, 404);
    const wallet = await getWallet(db, bot.record.walletId);
    return json({ ok: true, botId: bot.record.id, wallet: walletSummary(wallet), readiness: computeReadiness(wallet, bot.behavior) });
  }

  const ownerPresenceMatch = routePath.match(/^\/owners\/([^/]+)\/presence$/);
  if (ownerPresenceMatch && request.method === 'POST') {
    if (!assertInternal(request, env)) return json({ ok: false, reason: 'unauthorized_internal' }, 401);
    const profileId = ownerPresenceMatch[1] || '';
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const state = body?.state === 'offline' ? 'offline' : 'online';
    if (state === 'offline') {
      await run(db, 'DELETE FROM runtime_owner_presence WHERE profile_id = ?', [profileId]);
      return json({ ok: true, state: 'offline' });
    }
    const until = Date.now() + Math.max(10_000, Math.min(300_000, asNum(body?.ttlMs, 90_000)));
    const source = body?.source === 'ws_session' ? 'ws_session' : 'legacy_browser';
    await run(
      db,
      `INSERT OR REPLACE INTO runtime_owner_presence (profile_id, until_ms, lease_id, player_id, server_id, source, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [profileId, until, String(body?.leaseId || '') || null, String(body?.playerId || '') || null, String(body?.serverId || '') || null, source, Date.now()],
    );
    return json({ ok: true, state: 'online', until, leaseId: String(body?.leaseId || '') || null, playerId: String(body?.playerId || '') || null, serverId: String(body?.serverId || '') || null, source });
  }

  return null;
}

export async function handleRuntimeScheduled(env: RuntimeEnv): Promise<void> {
  await runScheduledBots(env);
}
