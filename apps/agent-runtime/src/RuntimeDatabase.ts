import type { BotRecord, Profile, WalletRecord } from '@arena/shared';
import type { AgentBehaviorConfig } from './AgentBot.js';

type PgPool = {
  query: (text: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  end: () => Promise<void>;
};

export type SubjectLinkRecord = {
  subject: string;
  profileId: string;
  walletId: string;
  linkedAt: number;
  updatedAt: number;
  continuitySource: 'postgres' | 'runtime-file' | 'memory';
};

export type OwnerBotState = {
  record: BotRecord;
  behavior: AgentBehaviorConfig;
};

export type RuntimeDbState = {
  subjectLinks: SubjectLinkRecord[];
  profiles: Profile[];
  wallets: WalletRecord[];
  ownerBots: OwnerBotState[];
  counters: {
    profileCounter: number;
    walletCounter: number;
    backgroundCounter: number;
  };
};

const MIGRATIONS = `
CREATE TABLE IF NOT EXISTS auth_subject_links (
  subject TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  wallet_id TEXT NOT NULL,
  linked_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS runtime_profiles (
  profile_id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  display_name TEXT NOT NULL,
  wallet_id TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS runtime_wallets (
  wallet_id TEXT PRIMARY KEY,
  owner_profile_id TEXT NOT NULL,
  address TEXT NOT NULL,
  encrypted_private_key TEXT NOT NULL,
  balance DOUBLE PRECISION NOT NULL,
  daily_tx_count INTEGER NOT NULL,
  tx_day_stamp TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  last_tx_at BIGINT,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS runtime_owner_bots (
  bot_id TEXT PRIMARY KEY,
  owner_profile_id TEXT NOT NULL,
  config_json JSONB NOT NULL,
  meta_json JSONB NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS runtime_counters (
  singleton TEXT PRIMARY KEY,
  profile_counter INTEGER NOT NULL,
  wallet_counter INTEGER NOT NULL,
  background_counter INTEGER NOT NULL,
  updated_at BIGINT NOT NULL
);
`;

function asNum(value: unknown, fallback = 0): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function asStr(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function parseJson<T>(value: unknown): T | null {
  if (!value) {
    return null;
  }
  if (typeof value === 'object') {
    return value as T;
  }
  if (typeof value !== 'string') {
    return null;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export class RuntimeDatabase {
  private pool: PgPool | null = null;

  async connect(databaseUrl: string): Promise<void> {
    const url = databaseUrl.trim();
    if (!url) {
      return;
    }
    try {
      const pg = await import('pg');
      const Pool = pg.default?.Pool ?? (pg as unknown as { Pool: new (opts: object) => PgPool }).Pool;
      this.pool = new Pool({
        connectionString: url,
        max: 8,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 5_000
      }) as unknown as PgPool;
      await this.pool.query(MIGRATIONS);
      console.log('[agent-runtime] connected to postgres for canonical continuity state');
    } catch (error) {
      this.pool = null;
      console.warn('[agent-runtime] failed to connect postgres; falling back to file state', error);
    }
  }

  get connected(): boolean {
    return this.pool !== null;
  }

  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }

  async loadState(): Promise<RuntimeDbState | null> {
    if (!this.pool) {
      return null;
    }

    const [subjectRes, profileRes, walletRes, ownerBotRes, counterRes] = await Promise.all([
      this.pool.query('SELECT subject, profile_id, wallet_id, linked_at, updated_at FROM auth_subject_links'),
      this.pool.query('SELECT profile_id, username, display_name, wallet_id, created_at FROM runtime_profiles'),
      this.pool.query(`SELECT wallet_id, owner_profile_id, address, encrypted_private_key, balance,
          daily_tx_count, tx_day_stamp, created_at, last_tx_at
        FROM runtime_wallets`),
      this.pool.query('SELECT bot_id, config_json, meta_json FROM runtime_owner_bots'),
      this.pool.query('SELECT profile_counter, wallet_counter, background_counter FROM runtime_counters WHERE singleton = $1', ['runtime'])
    ]);

    const subjectLinks: SubjectLinkRecord[] = subjectRes.rows
      .map((row) => ({
        subject: asStr(row.subject),
        profileId: asStr(row.profile_id),
        walletId: asStr(row.wallet_id),
        linkedAt: asNum(row.linked_at),
        updatedAt: asNum(row.updated_at),
        continuitySource: 'postgres' as const
      }))
      .filter((entry) => entry.subject && entry.profileId && entry.walletId);

    const profiles: Profile[] = profileRes.rows
      .map((row) => ({
        id: asStr(row.profile_id),
        username: asStr(row.username),
        displayName: asStr(row.display_name),
        createdAt: asNum(row.created_at),
        walletId: asStr(row.wallet_id),
        ownedBotIds: [] as string[]
      }))
      .filter((entry) => entry.id && entry.walletId && entry.username);

    const wallets: WalletRecord[] = walletRes.rows
      .map((row) => ({
        id: asStr(row.wallet_id),
        ownerProfileId: asStr(row.owner_profile_id),
        address: asStr(row.address),
        encryptedPrivateKey: asStr(row.encrypted_private_key),
        balance: asNum(row.balance),
        dailyTxCount: asNum(row.daily_tx_count),
        txDayStamp: asStr(row.tx_day_stamp),
        createdAt: asNum(row.created_at),
        lastTxAt: row.last_tx_at == null ? null : asNum(row.last_tx_at)
      }))
      .filter((entry) => entry.id && entry.ownerProfileId && entry.address && entry.encryptedPrivateKey);

    const ownerBots: OwnerBotState[] = [];
    for (const row of ownerBotRes.rows) {
      const behavior = parseJson<AgentBehaviorConfig>(row.config_json);
      const record = parseJson<BotRecord>(row.meta_json);
      if (!behavior || !record?.id || !record.ownerProfileId) {
        continue;
      }
      ownerBots.push({ behavior, record });
      const profile = profiles.find((entry) => entry.id === record.ownerProfileId);
      if (profile && !profile.ownedBotIds.includes(record.id)) {
        profile.ownedBotIds.push(record.id);
      }
    }

    const countersRow = counterRes.rows[0] ?? {};
    const counters = {
      profileCounter: Math.max(1, asNum(countersRow.profile_counter, 1)),
      walletCounter: Math.max(1, asNum(countersRow.wallet_counter, 1)),
      backgroundCounter: Math.max(1, asNum(countersRow.background_counter, 1))
    };

    const hasRows = subjectLinks.length > 0 || profiles.length > 0 || wallets.length > 0 || ownerBots.length > 0;
    if (!hasRows) {
      return null;
    }

    return {
      subjectLinks,
      profiles,
      wallets,
      ownerBots,
      counters
    };
  }

  async saveState(state: RuntimeDbState): Promise<void> {
    if (!this.pool) {
      return;
    }
    const now = Date.now();
    await this.pool.query('BEGIN');
    try {
      await this.pool.query('DELETE FROM auth_subject_links');
      await this.pool.query('DELETE FROM runtime_profiles');
      await this.pool.query('DELETE FROM runtime_wallets');
      await this.pool.query('DELETE FROM runtime_owner_bots');

      for (const link of state.subjectLinks) {
        await this.pool.query(
          `INSERT INTO auth_subject_links (subject, profile_id, wallet_id, linked_at, updated_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [link.subject, link.profileId, link.walletId, link.linkedAt, link.updatedAt]
        );
      }

      for (const profile of state.profiles) {
        await this.pool.query(
          `INSERT INTO runtime_profiles (profile_id, username, display_name, wallet_id, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [profile.id, profile.username, profile.displayName, profile.walletId, profile.createdAt, now]
        );
      }

      for (const wallet of state.wallets) {
        await this.pool.query(
          `INSERT INTO runtime_wallets (
              wallet_id, owner_profile_id, address, encrypted_private_key, balance, daily_tx_count,
              tx_day_stamp, created_at, last_tx_at, updated_at
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            wallet.id,
            wallet.ownerProfileId,
            wallet.address,
            wallet.encryptedPrivateKey,
            wallet.balance,
            wallet.dailyTxCount,
            wallet.txDayStamp,
            wallet.createdAt,
            wallet.lastTxAt,
            now
          ]
        );
      }

      for (const ownerBot of state.ownerBots) {
        await this.pool.query(
          `INSERT INTO runtime_owner_bots (bot_id, owner_profile_id, config_json, meta_json, updated_at)
           VALUES ($1, $2, $3::jsonb, $4::jsonb, $5)`,
          [
            ownerBot.record.id,
            ownerBot.record.ownerProfileId,
            JSON.stringify(ownerBot.behavior),
            JSON.stringify(ownerBot.record),
            now
          ]
        );
      }

      await this.pool.query(
        `INSERT INTO runtime_counters (singleton, profile_counter, wallet_counter, background_counter, updated_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (singleton) DO UPDATE SET
           profile_counter = EXCLUDED.profile_counter,
           wallet_counter = EXCLUDED.wallet_counter,
           background_counter = EXCLUDED.background_counter,
           updated_at = EXCLUDED.updated_at`,
        ['runtime', state.counters.profileCounter, state.counters.walletCounter, state.counters.backgroundCounter, now]
      );
      await this.pool.query('COMMIT');
    } catch (error) {
      await this.pool.query('ROLLBACK');
      throw error;
    }
  }
}
