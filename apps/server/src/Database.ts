import { log as rootLog } from './logger.js';

const log = rootLog.child({ module: 'database' });

type PgPool = {
  query: (text: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  end: () => Promise<void>;
};

const MIGRATIONS = `
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
`;

export class Database {
  private pool: PgPool | null = null;

  async connect(databaseUrl: string | undefined): Promise<void> {
    if (!databaseUrl) {
      log.warn('DATABASE_URL not set — running without persistent database');
      return;
    }

    try {
      const pg = await import('pg');
      const Pool = pg.default?.Pool ?? (pg as unknown as { Pool: new (opts: object) => PgPool }).Pool;
      this.pool = new Pool({
        connectionString: databaseUrl,
        max: 10,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 5_000
      }) as unknown as PgPool;

      // Run auto-migrations
      await this.pool.query(MIGRATIONS);
      log.info('connected to postgres and ran migrations');
    } catch (err) {
      log.error({ err }, 'failed to connect to postgres — running without persistent database');
      this.pool = null;
    }
  }

  get connected(): boolean {
    return this.pool !== null;
  }

  // ─── Players ────────────────────────────────────────────

  async upsertPlayer(params: {
    id: string;
    displayName: string;
    role: string;
    walletId: string | null;
  }): Promise<void> {
    if (!this.pool) return;
    try {
      await this.pool.query(
        `INSERT INTO players (id, display_name, role, wallet_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, NOW(), NOW())
         ON CONFLICT (id) DO UPDATE SET
           display_name = EXCLUDED.display_name,
           role = EXCLUDED.role,
           wallet_id = EXCLUDED.wallet_id,
           updated_at = NOW()`,
        [params.id, params.displayName, params.role, params.walletId]
      );
    } catch (err) {
      log.error({ err, playerId: params.id }, 'failed to upsert player');
    }
  }

  // ─── Challenges ─────────────────────────────────────────

  async insertChallenge(params: {
    id: string;
    challengerId: string;
    opponentId: string;
    gameType: string;
    wager: number;
    status: string;
    challengeJson: object;
  }): Promise<void> {
    if (!this.pool) return;
    try {
      await this.pool.query(
        `INSERT INTO challenges (id, challenger_id, opponent_id, game_type, wager, status, challenge_json, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
         ON CONFLICT (id) DO UPDATE SET
           status = EXCLUDED.status,
           challenge_json = EXCLUDED.challenge_json`,
        [params.id, params.challengerId, params.opponentId, params.gameType, params.wager, params.status, JSON.stringify(params.challengeJson)]
      );
    } catch (err) {
      log.error({ err, challengeId: params.id }, 'failed to insert challenge');
    }
  }

  async updateChallengeStatus(params: {
    id: string;
    status: string;
    winnerId?: string | null;
    challengerMove?: string | null;
    opponentMove?: string | null;
    coinflipResult?: string | null;
    challengeJson?: object;
  }): Promise<void> {
    if (!this.pool) return;
    try {
      const resolvedAt = (params.status === 'resolved' || params.status === 'declined' || params.status === 'expired')
        ? 'NOW()'
        : 'resolved_at';

      await this.pool.query(
        `UPDATE challenges SET
           status = $2,
           winner_id = COALESCE($3, winner_id),
           challenger_move = COALESCE($4, challenger_move),
           opponent_move = COALESCE($5, opponent_move),
           coinflip_result = COALESCE($6, coinflip_result),
           challenge_json = COALESCE($7, challenge_json),
           resolved_at = ${resolvedAt}
         WHERE id = $1`,
        [
          params.id,
          params.status,
          params.winnerId ?? null,
          params.challengerMove ?? null,
          params.opponentMove ?? null,
          params.coinflipResult ?? null,
          params.challengeJson ? JSON.stringify(params.challengeJson) : null
        ]
      );
    } catch (err) {
      log.error({ err, challengeId: params.id }, 'failed to update challenge status');
    }
  }

  // ─── Escrow Events ──────────────────────────────────────

  async insertEscrowEvent(params: {
    challengeId: string;
    phase: string;
    ok: boolean;
    reason?: string;
    txHash?: string;
    fee?: number;
    payout?: number;
  }): Promise<void> {
    if (!this.pool) return;
    try {
      await this.pool.query(
        `INSERT INTO escrow_events (challenge_id, phase, ok, reason, tx_hash, fee, payout, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
        [params.challengeId, params.phase, params.ok, params.reason ?? null, params.txHash ?? null, params.fee ?? null, params.payout ?? null]
      );
    } catch (err) {
      log.error({ err, challengeId: params.challengeId }, 'failed to insert escrow event');
    }
  }

  async getEscrowEventsForPlayer(params: {
    playerId: string;
    limit: number;
  }): Promise<Array<{
    challengeId: string;
    phase: string;
    ok: boolean;
    reason: string | null;
    txHash: string | null;
    fee: number | null;
    payout: number | null;
    at: number;
    challengerId: string;
    opponentId: string;
    winnerId: string | null;
    gameType: string;
    wager: number;
  }>> {
    if (!this.pool) return [];
    try {
      const safeLimit = Math.max(1, Math.min(300, Number(params.limit || 60)));
      const result = await this.pool.query(
        `SELECT
           e.challenge_id,
           e.phase,
           e.ok,
           e.reason,
           e.tx_hash,
           e.fee,
           e.payout,
           e.created_at,
           c.challenger_id,
           c.opponent_id,
           c.winner_id,
           c.game_type,
           c.wager
         FROM escrow_events e
         JOIN challenges c ON c.id = e.challenge_id
         WHERE c.challenger_id = $1 OR c.opponent_id = $1
         ORDER BY e.created_at DESC
         LIMIT $2`,
        [params.playerId, safeLimit]
      );
      return result.rows.map((row) => ({
        challengeId: String(row.challenge_id || ''),
        phase: String(row.phase || 'unknown'),
        ok: Boolean(row.ok),
        reason: row.reason == null ? null : String(row.reason),
        txHash: row.tx_hash == null ? null : String(row.tx_hash),
        fee: row.fee == null ? null : Number(row.fee),
        payout: row.payout == null ? null : Number(row.payout),
        at: row.created_at ? new Date(String(row.created_at)).getTime() : Date.now(),
        challengerId: String(row.challenger_id || ''),
        opponentId: String(row.opponent_id || ''),
        winnerId: row.winner_id == null ? null : String(row.winner_id),
        gameType: String(row.game_type || 'unknown'),
        wager: Number(row.wager ?? 0)
      }));
    } catch (err) {
      log.error({ err, playerId: params.playerId }, 'failed to query escrow events for player');
      return [];
    }
  }

  // ─── Recovery Queries ───────────────────────────────────

  async findStuckChallenges(): Promise<Array<{
    id: string;
    challengerId: string;
    opponentId: string;
    status: string;
    challengeJson: object | null;
  }>> {
    if (!this.pool) return [];
    try {
      const result = await this.pool.query(
        `SELECT id, challenger_id, opponent_id, status, challenge_json
         FROM challenges
         WHERE status IN ('accepted', 'created')
           AND created_at < NOW() - INTERVAL '5 minutes'
         ORDER BY created_at ASC
         LIMIT 50`
      );
      return result.rows.map((row) => ({
        id: row.id as string,
        challengerId: row.challenger_id as string,
        opponentId: row.opponent_id as string,
        status: row.status as string,
        challengeJson: row.challenge_json as object | null
      }));
    } catch (err) {
      log.error({ err }, 'failed to query stuck challenges');
      return [];
    }
  }

  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }
}
