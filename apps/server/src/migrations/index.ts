/**
 * Database Migrations System
 * 
 * Provides versioned schema migrations with:
 * - Up/down migrations
 * - Automatic version tracking
 * - Rollback capability
 * - Production-safe execution
 */

import { log as rootLog } from '../logger.js';

const log = rootLog.child({ module: 'migrations' });

export type Migration = {
  version: number;
  name: string;
  up: string;
  down: string;
};

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'initial_schema',
    up: `
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS players (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'human',
        wallet_id TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS challenges (
        id TEXT PRIMARY KEY,
        challenger_id TEXT NOT NULL,
        opponent_id TEXT NOT NULL,
        game_type TEXT NOT NULL,
        wager NUMERIC NOT NULL DEFAULT 0,
        status TEXT NOT NULL,
        winner_id TEXT,
        challenger_move TEXT,
        opponent_move TEXT,
        coinflip_result TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        resolved_at TIMESTAMPTZ,
        challenge_json JSONB
      );

      CREATE TABLE IF NOT EXISTS escrow_events (
        id SERIAL PRIMARY KEY,
        challenge_id TEXT NOT NULL,
        phase TEXT NOT NULL,
        ok BOOLEAN NOT NULL,
        reason TEXT,
        tx_hash TEXT,
        fee NUMERIC,
        payout NUMERIC,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_escrow_events_challenge_id ON escrow_events(challenge_id);
      CREATE INDEX IF NOT EXISTS idx_challenges_status ON challenges(status);
      CREATE INDEX IF NOT EXISTS idx_challenges_created_at ON challenges(created_at);
      CREATE INDEX IF NOT EXISTS idx_players_wallet_id ON players(wallet_id);
    `,
    down: `
      DROP INDEX IF EXISTS idx_players_wallet_id;
      DROP INDEX IF EXISTS idx_challenges_created_at;
      DROP INDEX IF EXISTS idx_challenges_status;
      DROP INDEX IF EXISTS idx_escrow_events_challenge_id;
      DROP TABLE IF EXISTS escrow_events;
      DROP TABLE IF EXISTS challenges;
      DROP TABLE IF EXISTS players;
      DROP TABLE IF EXISTS schema_migrations;
    `
  },
  {
    version: 2,
    name: 'add_player_stats',
    up: `
      ALTER TABLE players ADD COLUMN IF NOT EXISTS wins INTEGER DEFAULT 0;
      ALTER TABLE players ADD COLUMN IF NOT EXISTS losses INTEGER DEFAULT 0;
      ALTER TABLE players ADD COLUMN IF NOT EXISTS total_wagered NUMERIC DEFAULT 0;
      ALTER TABLE players ADD COLUMN IF NOT EXISTS total_won NUMERIC DEFAULT 0;
    `,
    down: `
      ALTER TABLE players DROP COLUMN IF EXISTS total_won;
      ALTER TABLE players DROP COLUMN IF EXISTS total_wagered;
      ALTER TABLE players DROP COLUMN IF EXISTS losses;
      ALTER TABLE players DROP COLUMN IF EXISTS wins;
    `
  },
  {
    version: 3,
    name: 'add_challenge_indexes',
    up: `
      CREATE INDEX IF NOT EXISTS idx_challenges_challenger_id ON challenges(challenger_id);
      CREATE INDEX IF NOT EXISTS idx_challenges_opponent_id ON challenges(opponent_id);
      CREATE INDEX IF NOT EXISTS idx_challenges_game_type ON challenges(game_type);
    `,
    down: `
      DROP INDEX IF EXISTS idx_challenges_game_type;
      DROP INDEX IF EXISTS idx_challenges_opponent_id;
      DROP INDEX IF EXISTS idx_challenges_challenger_id;
    `
  },
  {
    version: 4,
    name: 'add_rate_limit_tracking',
    up: `
      CREATE TABLE IF NOT EXISTS rate_limits (
        id SERIAL PRIMARY KEY,
        key TEXT NOT NULL UNIQUE,
        count INTEGER DEFAULT 1,
        window_start TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_rate_limits_key ON rate_limits(key);
      CREATE INDEX IF NOT EXISTS idx_rate_limits_window ON rate_limits(window_start);
    `,
    down: `
      DROP INDEX IF EXISTS idx_rate_limits_window;
      DROP INDEX IF EXISTS idx_rate_limits_key;
      DROP TABLE IF EXISTS rate_limits;
    `
  },
  {
    version: 5,
    name: 'add_audit_log',
    up: `
      CREATE TABLE IF NOT EXISTS audit_log (
        id SERIAL PRIMARY KEY,
        actor_id TEXT,
        actor_type TEXT,
        action TEXT NOT NULL,
        resource_type TEXT,
        resource_id TEXT,
        metadata JSONB,
        ip_address TEXT,
        user_agent TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON audit_log(actor_id);
      CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);
      CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at);
    `,
    down: `
      DROP INDEX IF EXISTS idx_audit_log_created;
      DROP INDEX IF EXISTS idx_audit_log_action;
      DROP INDEX IF EXISTS idx_audit_log_actor;
      DROP TABLE IF EXISTS audit_log;
    `
  },
  {
    version: 6,
    name: 'add_prediction_markets',
    up: `
      CREATE TABLE IF NOT EXISTS markets (
        id TEXT PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        question TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'general',
        close_at TIMESTAMPTZ NOT NULL,
        resolve_at TIMESTAMPTZ,
        status TEXT NOT NULL DEFAULT 'open',
        oracle_source TEXT NOT NULL DEFAULT 'polymarket_gamma',
        oracle_market_id TEXT NOT NULL,
        outcome TEXT,
        yes_price NUMERIC NOT NULL DEFAULT 0.50,
        no_price NUMERIC NOT NULL DEFAULT 0.50,
        raw_json JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS market_positions (
        id TEXT PRIMARY KEY,
        market_id TEXT NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
        player_id TEXT NOT NULL,
        wallet_id TEXT NOT NULL,
        side TEXT NOT NULL,
        stake NUMERIC NOT NULL,
        price NUMERIC NOT NULL,
        shares NUMERIC NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        escrow_bet_id TEXT NOT NULL UNIQUE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        settled_at TIMESTAMPTZ
      );

      CREATE TABLE IF NOT EXISTS market_admin_activation (
        market_id TEXT PRIMARY KEY REFERENCES markets(id) ON DELETE CASCADE,
        active BOOLEAN NOT NULL DEFAULT false,
        max_wager NUMERIC NOT NULL DEFAULT 100,
        house_spread_bps INTEGER NOT NULL DEFAULT 300,
        updated_by TEXT,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_markets_status_close ON markets(status, close_at);
      CREATE INDEX IF NOT EXISTS idx_market_positions_player_status ON market_positions(player_id, status);
      CREATE INDEX IF NOT EXISTS idx_market_positions_market_status ON market_positions(market_id, status);
    `,
    down: `
      DROP INDEX IF EXISTS idx_market_positions_market_status;
      DROP INDEX IF EXISTS idx_market_positions_player_status;
      DROP INDEX IF EXISTS idx_markets_status_close;
      DROP TABLE IF EXISTS market_admin_activation;
      DROP TABLE IF EXISTS market_positions;
      DROP TABLE IF EXISTS markets;
    `
  },
  {
    version: 7,
    name: 'prediction_liquidity_and_events',
    up: `
      ALTER TABLE market_positions ADD COLUMN IF NOT EXISTS estimated_payout_at_open NUMERIC;
      ALTER TABLE market_positions ADD COLUMN IF NOT EXISTS min_payout_at_open NUMERIC;
      ALTER TABLE market_positions ADD COLUMN IF NOT EXISTS payout NUMERIC;
      ALTER TABLE market_positions ADD COLUMN IF NOT EXISTS settlement_reason TEXT;

      CREATE TABLE IF NOT EXISTS market_interaction_events (
        id TEXT PRIMARY KEY,
        player_id TEXT NOT NULL,
        station_id TEXT NOT NULL,
        market_id TEXT,
        event_type TEXT NOT NULL,
        side TEXT,
        stake NUMERIC,
        opposite_liquidity_at_commit NUMERIC,
        close_at TIMESTAMPTZ,
        reason TEXT,
        reason_code TEXT,
        meta_json JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_market_interaction_events_player_created
        ON market_interaction_events(player_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_market_interaction_events_market_created
        ON market_interaction_events(market_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_market_interaction_events_event_created
        ON market_interaction_events(event_type, created_at DESC);
    `,
    down: `
      DROP INDEX IF EXISTS idx_market_interaction_events_event_created;
      DROP INDEX IF EXISTS idx_market_interaction_events_market_created;
      DROP INDEX IF EXISTS idx_market_interaction_events_player_created;
      DROP TABLE IF EXISTS market_interaction_events;
      ALTER TABLE market_positions DROP COLUMN IF EXISTS settlement_reason;
      ALTER TABLE market_positions DROP COLUMN IF EXISTS payout;
      ALTER TABLE market_positions DROP COLUMN IF EXISTS min_payout_at_open;
      ALTER TABLE market_positions DROP COLUMN IF EXISTS estimated_payout_at_open;
    `
  },
  {
    version: 8,
    name: 'market_positions_clob',
    up: `
      ALTER TABLE market_positions ADD COLUMN IF NOT EXISTS clob_order_id TEXT;
    `,
    down: `
      ALTER TABLE market_positions DROP COLUMN IF EXISTS clob_order_id;
    `
  }
];

export type PgPool = {
  query: (text: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  end: () => Promise<void>;
};

/**
 * Get current schema version from database
 */
export async function getCurrentVersion(pool: PgPool): Promise<number> {
  try {
    const result = await pool.query(
      "SELECT MAX(version) as version FROM schema_migrations"
    );
    const version = result.rows[0]?.version;
    return typeof version === 'number' ? version : 0;
  } catch {
    // Table doesn't exist yet
    return 0;
  }
}

/**
 * Check if a specific migration has been applied
 */
export async function isMigrationApplied(pool: PgPool, version: number): Promise<boolean> {
  try {
    const result = await pool.query(
      "SELECT 1 FROM schema_migrations WHERE version = $1",
      [version]
    );
    return result.rows.length > 0;
  } catch {
    return false;
  }
}

/**
 * Record a migration as applied
 */
export async function recordMigration(pool: PgPool, migration: Migration): Promise<void> {
  await pool.query(
    "INSERT INTO schema_migrations (version, name, applied_at) VALUES ($1, $2, NOW())",
    [migration.version, migration.name]
  );
}

/**
 * Remove a migration record (for rollbacks)
 */
export async function removeMigrationRecord(pool: PgPool, version: number): Promise<void> {
  await pool.query(
    "DELETE FROM schema_migrations WHERE version = $1",
    [version]
  );
}

/**
 * Run all pending migrations
 */
export async function runMigrations(pool: PgPool): Promise<{
  applied: number;
  versions: number[];
  errors: Array<{ version: number; error: string }>;
}> {
  const currentVersion = await getCurrentVersion(pool);
  const pending = MIGRATIONS.filter(m => m.version > currentVersion).sort((a, b) => a.version - b.version);
  
  const result = {
    applied: 0,
    versions: [] as number[],
    errors: [] as Array<{ version: number; error: string }>
  };

  if (pending.length === 0) {
    log.info({ currentVersion }, 'no pending migrations');
    return result;
  }

  log.info({ 
    currentVersion, 
    pendingVersions: pending.map(m => m.version),
    pendingNames: pending.map(m => m.name)
  }, 'running pending migrations');

  for (const migration of pending) {
    try {
      log.info({ version: migration.version, name: migration.name }, 'applying migration');
      
      await pool.query(migration.up);
      await recordMigration(pool, migration);
      
      result.applied += 1;
      result.versions.push(migration.version);
      
      log.info({ version: migration.version, name: migration.name }, 'migration applied successfully');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error({ 
        version: migration.version, 
        name: migration.name, 
        error: errorMessage 
      }, 'migration failed');
      
      result.errors.push({
        version: migration.version,
        error: errorMessage
      });
      
      // Stop on first error to maintain consistency
      break;
    }
  }

  return result;
}

/**
 * Rollback the last N migrations
 */
export async function rollbackMigrations(pool: PgPool, steps: number = 1): Promise<{
  rolledBack: number;
  versions: number[];
  errors: Array<{ version: number; error: string }>;
}> {
  const currentVersion = await getCurrentVersion(pool);
  const toRollback = MIGRATIONS
    .filter(m => m.version <= currentVersion)
    .sort((a, b) => b.version - a.version)
    .slice(0, steps);

  const result = {
    rolledBack: 0,
    versions: [] as number[],
    errors: [] as Array<{ version: number; error: string }>
  };

  if (toRollback.length === 0) {
    log.info('no migrations to rollback');
    return result;
  }

  log.info({
    currentVersion,
    rollbackVersions: toRollback.map(m => m.version)
  }, 'rolling back migrations');

  for (const migration of toRollback) {
    try {
      log.info({ version: migration.version, name: migration.name }, 'rolling back migration');
      
      await pool.query(migration.down);
      await removeMigrationRecord(pool, migration.version);
      
      result.rolledBack += 1;
      result.versions.push(migration.version);
      
      log.info({ version: migration.version, name: migration.name }, 'migration rolled back successfully');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error({ 
        version: migration.version, 
        name: migration.name, 
        error: errorMessage 
      }, 'rollback failed');
      
      result.errors.push({
        version: migration.version,
        error: errorMessage
      });
      
      break;
    }
  }

  return result;
}

/**
 * Get migration status for diagnostics
 */
export async function getMigrationStatus(pool: PgPool): Promise<{
  currentVersion: number;
  appliedMigrations: Array<{ version: number; name: string; appliedAt: string | null }>;
  pendingMigrations: Array<{ version: number; name: string }>;
}> {
  const currentVersion = await getCurrentVersion(pool);
  
  let appliedMigrations: Array<{ version: number; name: string; appliedAt: string | null }> = [];
  
  try {
    const result = await pool.query(
      "SELECT version, name, applied_at FROM schema_migrations ORDER BY version"
    );
    appliedMigrations = result.rows.map(row => ({
      version: row.version as number,
      name: row.name as string,
      appliedAt: row.applied_at ? String(row.applied_at) : null
    }));
  } catch {
    // Table doesn't exist
  }

  const pendingMigrations = MIGRATIONS
    .filter(m => m.version > currentVersion)
    .map(m => ({ version: m.version, name: m.name }));

  return {
    currentVersion,
    appliedMigrations,
    pendingMigrations
  };
}
