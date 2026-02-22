import { log as rootLog } from './logger.js';
import { runMigrations, getMigrationStatus, type PgPool } from './migrations/index.js';

const log = rootLog.child({ module: 'database' });

export type MarketRecord = {
  id: string;
  slug: string;
  question: string;
  category: string;
  closeAt: number;
  resolveAt: number | null;
  status: 'open' | 'closed' | 'resolved' | 'cancelled';
  oracleSource: string;
  oracleMarketId: string;
  outcome: 'yes' | 'no' | null;
  yesPrice: number;
  noPrice: number;
};

export type MarketActivationRecord = {
  marketId: string;
  active: boolean;
  maxWager: number;
  houseSpreadBps: number;
  updatedBy: string | null;
  updatedAt: number;
};

export type MarketPositionRecord = {
  id: string;
  marketId: string;
  playerId: string;
  walletId: string;
  side: 'yes' | 'no';
  stake: number;
  price: number;
  shares: number;
  status: 'open' | 'won' | 'lost' | 'voided';
  escrowBetId: string;
  estimatedPayoutAtOpen: number | null;
  minPayoutAtOpen: number | null;
  payout: number | null;
  settlementReason: string | null;
  clobOrderId: string | null;
  createdAt: number;
  settledAt: number | null;
};

export type MarketInteractionEventRecord = {
  id: string;
  playerId: string;
  stationId: string;
  marketId: string | null;
  eventType: string;
  side: 'yes' | 'no' | null;
  stake: number | null;
  oppositeLiquidityAtCommit: number | null;
  closeAt: number | null;
  reason: string | null;
  reasonCode: string | null;
  metaJson: Record<string, unknown> | null;
  createdAt: number;
};

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

      // Run versioned migrations
      const result = await runMigrations(this.pool);
      if (result.errors.length > 0) {
        log.error({ errors: result.errors }, 'migration errors occurred');
      }
      log.info({ 
        applied: result.applied, 
        versions: result.versions,
        hasErrors: result.errors.length > 0
      }, 'database connected and migrations completed');
    } catch (err) {
      log.error({ err }, 'failed to connect to postgres — running without persistent database');
      this.pool = null;
    }
  }

  get connected(): boolean {
    return this.pool !== null;
  }

  /**
   * Get the underlying pool for migrations and advanced queries
   */
  getPool(): PgPool | null {
    return this.pool;
  }

  /**
   * Get migration status for diagnostics endpoint
   */
  async getMigrationStatus(): Promise<{
    currentVersion: number;
    appliedMigrations: Array<{ version: number; name: string; appliedAt: string | null }>;
    pendingMigrations: Array<{ version: number; name: string }>;
  } | null> {
    if (!this.pool) return null;
    return getMigrationStatus(this.pool);
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

  async getPlayerById(id: string): Promise<{
    id: string;
    displayName: string;
    role: string;
    walletId: string | null;
    wins: number;
    losses: number;
    totalWagered: number;
    totalWon: number;
  } | null> {
    if (!this.pool) return null;
    try {
      const result = await this.pool.query(
        `SELECT id, display_name, role, wallet_id, 
           COALESCE(wins, 0) as wins, 
           COALESCE(losses, 0) as losses,
           COALESCE(total_wagered, 0) as total_wagered,
           COALESCE(total_won, 0) as total_won
         FROM players WHERE id = $1`,
        [id]
      );
      if (result.rows.length === 0) return null;
      const row = result.rows[0]!;
      return {
        id: String(row.id),
        displayName: String(row.display_name),
        role: String(row.role),
        walletId: row.wallet_id ? String(row.wallet_id) : null,
        wins: Number(row.wins ?? 0),
        losses: Number(row.losses ?? 0),
        totalWagered: Number(row.total_wagered ?? 0),
        totalWon: Number(row.total_won ?? 0)
      };
    } catch (err) {
      log.error({ err, playerId: id }, 'failed to get player');
      return null;
    }
  }

  async updatePlayerStats(params: {
    id: string;
    wins?: number;
    losses?: number;
    totalWagered?: number;
    totalWon?: number;
  }): Promise<void> {
    if (!this.pool) return;
    try {
      const sets: string[] = ['updated_at = NOW()'];
      const values: unknown[] = [params.id];
      let paramIdx = 2;

      if (params.wins !== undefined) {
        sets.push(`wins = COALESCE(wins, 0) + $${paramIdx}`);
        values.push(params.wins);
        paramIdx++;
      }
      if (params.losses !== undefined) {
        sets.push(`losses = COALESCE(losses, 0) + $${paramIdx}`);
        values.push(params.losses);
        paramIdx++;
      }
      if (params.totalWagered !== undefined) {
        sets.push(`total_wagered = COALESCE(total_wagered, 0) + $${paramIdx}`);
        values.push(params.totalWagered);
        paramIdx++;
      }
      if (params.totalWon !== undefined) {
        sets.push(`total_won = COALESCE(total_won, 0) + $${paramIdx}`);
        values.push(params.totalWon);
        paramIdx++;
      }

      if (sets.length === 1) return; // Only updated_at

      await this.pool.query(
        `UPDATE players SET ${sets.join(', ')} WHERE id = $1`,
        values
      );
    } catch (err) {
      log.error({ err, playerId: params.id }, 'failed to update player stats');
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

  async getChallengeById(id: string): Promise<{
    id: string;
    challengerId: string;
    opponentId: string;
    gameType: string;
    wager: number;
    status: string;
    winnerId: string | null;
    createdAt: number;
  } | null> {
    if (!this.pool) return null;
    try {
      const result = await this.pool.query(
        `SELECT id, challenger_id, opponent_id, game_type, wager, status, winner_id, created_at
         FROM challenges WHERE id = $1`,
        [id]
      );
      if (result.rows.length === 0) return null;
      const row = result.rows[0]!;
      return {
        id: String(row.id),
        challengerId: String(row.challenger_id),
        opponentId: String(row.opponent_id),
        gameType: String(row.game_type),
        wager: Number(row.wager),
        status: String(row.status),
        winnerId: row.winner_id ? String(row.winner_id) : null,
        createdAt: row.created_at ? new Date(String(row.created_at)).getTime() : Date.now()
      };
    } catch (err) {
      log.error({ err, challengeId: id }, 'failed to get challenge');
      return null;
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

  // ─── Prediction Markets ────────────────────────────────

  async upsertMarket(params: {
    id: string;
    slug: string;
    question: string;
    category: string;
    closeAt: number;
    resolveAt?: number | null;
    status: 'open' | 'closed' | 'resolved' | 'cancelled';
    oracleSource: string;
    oracleMarketId: string;
    outcome?: 'yes' | 'no' | null;
    yesPrice: number;
    noPrice: number;
    rawJson?: object;
  }): Promise<void> {
    if (!this.pool) return;
    try {
      await this.pool.query(
        `INSERT INTO markets (
           id, slug, question, category, close_at, resolve_at, status,
           oracle_source, oracle_market_id, outcome, yes_price, no_price, raw_json, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW(),NOW())
         ON CONFLICT (id) DO UPDATE SET
           slug = EXCLUDED.slug,
           question = EXCLUDED.question,
           category = EXCLUDED.category,
           close_at = EXCLUDED.close_at,
           resolve_at = EXCLUDED.resolve_at,
           status = EXCLUDED.status,
           oracle_source = EXCLUDED.oracle_source,
           oracle_market_id = EXCLUDED.oracle_market_id,
           outcome = EXCLUDED.outcome,
           yes_price = EXCLUDED.yes_price,
           no_price = EXCLUDED.no_price,
           raw_json = EXCLUDED.raw_json,
           updated_at = NOW()`,
        [
          params.id,
          params.slug,
          params.question,
          params.category,
          new Date(params.closeAt).toISOString(),
          params.resolveAt ? new Date(params.resolveAt).toISOString() : null,
          params.status,
          params.oracleSource,
          params.oracleMarketId,
          params.outcome ?? null,
          params.yesPrice,
          params.noPrice,
          params.rawJson ? JSON.stringify(params.rawJson) : null
        ]
      );
    } catch (err) {
      log.error({ err, marketId: params.id }, 'failed to upsert market');
    }
  }

  async listMarkets(limit = 200): Promise<MarketRecord[]> {
    if (!this.pool) return [];
    try {
      const safeLimit = Math.max(1, Math.min(1000, Number(limit || 200)));
      const result = await this.pool.query(
        `SELECT id, slug, question, category, close_at, resolve_at, status, oracle_source, oracle_market_id, outcome, yes_price, no_price
         FROM markets
         ORDER BY close_at ASC
         LIMIT $1`,
        [safeLimit]
      );
      return result.rows.map((row) => ({
        id: String(row.id),
        slug: String(row.slug),
        question: String(row.question),
        category: String(row.category || 'general'),
        closeAt: new Date(String(row.close_at)).getTime(),
        resolveAt: row.resolve_at ? new Date(String(row.resolve_at)).getTime() : null,
        status: String(row.status) as MarketRecord['status'],
        oracleSource: String(row.oracle_source || 'polymarket_gamma'),
        oracleMarketId: String(row.oracle_market_id || ''),
        outcome: row.outcome === 'yes' || row.outcome === 'no' ? row.outcome : null,
        yesPrice: Number(row.yes_price ?? 0.5),
        noPrice: Number(row.no_price ?? 0.5)
      }));
    } catch (err) {
      log.error({ err }, 'failed to list markets');
      return [];
    }
  }

  async getMarketById(marketId: string): Promise<MarketRecord | null> {
    if (!this.pool) return null;
    try {
      const result = await this.pool.query(
        `SELECT id, slug, question, category, close_at, resolve_at, status, oracle_source, oracle_market_id, outcome, yes_price, no_price
         FROM markets
         WHERE id = $1
         LIMIT 1`,
        [marketId]
      );
      const row = result.rows[0];
      if (!row) return null;
      return {
        id: String(row.id),
        slug: String(row.slug),
        question: String(row.question),
        category: String(row.category || 'general'),
        closeAt: new Date(String(row.close_at)).getTime(),
        resolveAt: row.resolve_at ? new Date(String(row.resolve_at)).getTime() : null,
        status: String(row.status) as MarketRecord['status'],
        oracleSource: String(row.oracle_source || 'polymarket_gamma'),
        oracleMarketId: String(row.oracle_market_id || ''),
        outcome: row.outcome === 'yes' || row.outcome === 'no' ? row.outcome : null,
        yesPrice: Number(row.yes_price ?? 0.5),
        noPrice: Number(row.no_price ?? 0.5)
      };
    } catch (err) {
      log.error({ err, marketId }, 'failed to get market by id');
      return null;
    }
  }

  async setMarketActivation(params: {
    marketId: string;
    active: boolean;
    maxWager: number;
    houseSpreadBps: number;
    updatedBy?: string | null;
  }): Promise<void> {
    if (!this.pool) return;
    try {
      await this.pool.query(
        `INSERT INTO market_admin_activation (market_id, active, max_wager, house_spread_bps, updated_by, updated_at)
         VALUES ($1,$2,$3,$4,$5,NOW())
         ON CONFLICT (market_id) DO UPDATE SET
           active = EXCLUDED.active,
           max_wager = EXCLUDED.max_wager,
           house_spread_bps = EXCLUDED.house_spread_bps,
           updated_by = EXCLUDED.updated_by,
           updated_at = NOW()`,
        [
          params.marketId,
          params.active,
          Math.max(1, Number(params.maxWager || 100)),
          Math.max(0, Math.min(10_000, Math.floor(Number(params.houseSpreadBps || 300)))),
          params.updatedBy ?? null
        ]
      );
    } catch (err) {
      log.error({ err, marketId: params.marketId }, 'failed to set market activation');
    }
  }

  async listMarketActivations(): Promise<MarketActivationRecord[]> {
    if (!this.pool) return [];
    try {
      const result = await this.pool.query(
        `SELECT market_id, active, max_wager, house_spread_bps, updated_by, updated_at
         FROM market_admin_activation
         ORDER BY updated_at DESC`
      );
      return result.rows.map((row) => ({
        marketId: String(row.market_id),
        active: Boolean(row.active),
        maxWager: Number(row.max_wager ?? 100),
        houseSpreadBps: Number(row.house_spread_bps ?? 300),
        updatedBy: row.updated_by ? String(row.updated_by) : null,
        updatedAt: row.updated_at ? new Date(String(row.updated_at)).getTime() : Date.now()
      }));
    } catch (err) {
      log.error({ err }, 'failed to list market activations');
      return [];
    }
  }

  async createMarketPosition(params: {
    id: string;
    marketId: string;
    playerId: string;
    walletId: string;
    side: 'yes' | 'no';
    stake: number;
    price: number;
    shares: number;
    escrowBetId: string;
    estimatedPayoutAtOpen?: number | null;
    minPayoutAtOpen?: number | null;
  }): Promise<void> {
    if (!this.pool) return;
    try {
      await this.pool.query(
        `INSERT INTO market_positions (
           id, market_id, player_id, wallet_id, side, stake, price, shares, status, escrow_bet_id,
           estimated_payout_at_open, min_payout_at_open, created_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'open',$9,$10,$11,NOW())`,
        [
          params.id,
          params.marketId,
          params.playerId,
          params.walletId,
          params.side,
          params.stake,
          params.price,
          params.shares,
          params.escrowBetId,
          params.estimatedPayoutAtOpen ?? null,
          params.minPayoutAtOpen ?? null
        ]
      );
    } catch (err) {
      log.error({ err, positionId: params.id }, 'failed to create market position');
      throw err;
    }
  }

  async listPlayerMarketPositions(playerId: string, limit = 100): Promise<MarketPositionRecord[]> {
    if (!this.pool) return [];
    try {
      const safeLimit = Math.max(1, Math.min(500, Number(limit || 100)));
      const result = await this.pool.query(
        `SELECT id, market_id, player_id, wallet_id, side, stake, price, shares, status, escrow_bet_id,
                estimated_payout_at_open, min_payout_at_open, payout, settlement_reason,
                clob_order_id, created_at, settled_at
         FROM market_positions
         WHERE player_id = $1
         ORDER BY created_at DESC
         LIMIT $2`,
        [playerId, safeLimit]
      );
      return result.rows.map((row) => ({
        id: String(row.id),
        marketId: String(row.market_id),
        playerId: String(row.player_id),
        walletId: String(row.wallet_id),
        side: String(row.side) === 'no' ? 'no' : 'yes',
        stake: Number(row.stake ?? 0),
        price: Number(row.price ?? 0.5),
        shares: Number(row.shares ?? 0),
        status: String(row.status) as MarketPositionRecord['status'],
        escrowBetId: String(row.escrow_bet_id || ''),
        estimatedPayoutAtOpen: row.estimated_payout_at_open != null ? Number(row.estimated_payout_at_open) : null,
        minPayoutAtOpen: row.min_payout_at_open != null ? Number(row.min_payout_at_open) : null,
        payout: row.payout != null ? Number(row.payout) : null,
        settlementReason: row.settlement_reason != null ? String(row.settlement_reason) : null,
        clobOrderId: row.clob_order_id != null ? String(row.clob_order_id) : null,
        createdAt: row.created_at ? new Date(String(row.created_at)).getTime() : Date.now(),
        settledAt: row.settled_at ? new Date(String(row.settled_at)).getTime() : null
      }));
    } catch (err) {
      log.error({ err, playerId }, 'failed to list player market positions');
      return [];
    }
  }

  async listOpenMarketPositions(limit = 500): Promise<MarketPositionRecord[]> {
    if (!this.pool) return [];
    try {
      const safeLimit = Math.max(1, Math.min(5000, Number(limit || 500)));
      const result = await this.pool.query(
        `SELECT id, market_id, player_id, wallet_id, side, stake, price, shares, status, escrow_bet_id,
                estimated_payout_at_open, min_payout_at_open, payout, settlement_reason,
                clob_order_id, created_at, settled_at
         FROM market_positions
         WHERE status = 'open'
         ORDER BY created_at ASC
         LIMIT $1`,
        [safeLimit]
      );
      return result.rows.map((row) => ({
        id: String(row.id),
        marketId: String(row.market_id),
        playerId: String(row.player_id),
        walletId: String(row.wallet_id),
        side: String(row.side) === 'no' ? 'no' : 'yes',
        stake: Number(row.stake ?? 0),
        price: Number(row.price ?? 0.5),
        shares: Number(row.shares ?? 0),
        status: String(row.status) as MarketPositionRecord['status'],
        escrowBetId: String(row.escrow_bet_id || ''),
        estimatedPayoutAtOpen: row.estimated_payout_at_open != null ? Number(row.estimated_payout_at_open) : null,
        minPayoutAtOpen: row.min_payout_at_open != null ? Number(row.min_payout_at_open) : null,
        payout: row.payout != null ? Number(row.payout) : null,
        settlementReason: row.settlement_reason != null ? String(row.settlement_reason) : null,
        clobOrderId: row.clob_order_id != null ? String(row.clob_order_id) : null,
        createdAt: row.created_at ? new Date(String(row.created_at)).getTime() : Date.now(),
        settledAt: row.settled_at ? new Date(String(row.settled_at)).getTime() : null
      }));
    } catch (err) {
      log.error({ err }, 'failed to list open market positions');
      return [];
    }
  }

  async settleMarketPosition(params: {
    positionId: string;
    status: 'won' | 'lost' | 'voided';
    payout?: number | null;
    settlementReason?: string | null;
  }): Promise<void> {
    if (!this.pool) return;
    try {
      await this.pool.query(
        `UPDATE market_positions
         SET status = $2, payout = $3, settlement_reason = $4, settled_at = NOW()
         WHERE id = $1`,
        [params.positionId, params.status, params.payout ?? null, params.settlementReason ?? null]
      );
    } catch (err) {
      log.error({ err, positionId: params.positionId }, 'failed to settle market position');
    }
  }

  async setPositionClobOrder(positionId: string, orderId: string): Promise<void> {
    if (!this.pool) return;
    try {
      await this.pool.query(
        'UPDATE market_positions SET clob_order_id = $2 WHERE id = $1',
        [positionId, orderId]
      );
    } catch (err) {
      log.error({ err, positionId, orderId }, 'failed to set clob_order_id on position');
    }
  }

  async insertMarketInteractionEvent(params: {
    id: string;
    playerId: string;
    stationId: string;
    marketId: string | null;
    eventType: string;
    side: 'yes' | 'no' | null;
    stake: number | null;
    oppositeLiquidityAtCommit: number | null;
    closeAt: number | null;
    reason: string | null;
    reasonCode: string | null;
    metaJson: Record<string, unknown> | null;
  }): Promise<void> {
    if (!this.pool) return;
    try {
      await this.pool.query(
        `INSERT INTO market_interaction_events (
           id, player_id, station_id, market_id, event_type, side, stake,
           opposite_liquidity_at_commit, close_at, reason, reason_code, meta_json, created_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
         ON CONFLICT (id) DO NOTHING`,
        [
          params.id,
          params.playerId,
          params.stationId,
          params.marketId,
          params.eventType,
          params.side,
          params.stake,
          params.oppositeLiquidityAtCommit,
          params.closeAt != null ? new Date(params.closeAt).toISOString() : null,
          params.reason,
          params.reasonCode,
          params.metaJson != null ? JSON.stringify(params.metaJson) : null
        ]
      );
    } catch (err) {
      log.error({ err, eventId: params.id }, 'failed to insert market interaction event');
    }
  }

  async listMarketInteractionCounts(limitHours = 24): Promise<Array<{ eventType: string; count: number }>> {
    if (!this.pool) return [];
    try {
      const result = await this.pool.query(
        `SELECT event_type, COUNT(*)::int AS count
         FROM market_interaction_events
         WHERE created_at >= NOW() - INTERVAL '${Math.max(1, Math.min(168, Number(limitHours || 24)))} hours'
         GROUP BY event_type
         ORDER BY count DESC
         LIMIT 50`
      );
      return result.rows.map((row) => ({
        eventType: String(row.event_type),
        count: Number(row.count)
      }));
    } catch (err) {
      log.error({ err }, 'failed to list market interaction counts');
      return [];
    }
  }

  // ─── Rate Limiting ──────────────────────────────────────

  async checkRateLimit(params: {
    key: string;
    limit: number;
    windowMs: number;
  }): Promise<{ allowed: boolean; count: number; resetAt: number }> {
    if (!this.pool) {
      return { allowed: true, count: 0, resetAt: Date.now() + params.windowMs };
    }

    const now = Date.now();
    const windowStart = new Date(now - (now % params.windowMs));

    try {
      // Clean up expired entries first
      await this.pool.query(
        `DELETE FROM rate_limits WHERE window_start < $1`,
        [windowStart.toISOString()]
      );

      // Get or create rate limit record
      const result = await this.pool.query(
        `INSERT INTO rate_limits (key, count, window_start, updated_at)
         VALUES ($1, 1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET
           count = CASE 
             WHEN rate_limits.window_start = $2 THEN rate_limits.count + 1
             ELSE 1
           END,
           window_start = CASE
             WHEN rate_limits.window_start = $2 THEN rate_limits.window_start
             ELSE $2
           END,
           updated_at = NOW()
         RETURNING count, window_start`,
        [params.key, windowStart.toISOString()]
      );

      const row = result.rows[0]!;
      const count = Number(row.count);
      const resetAt = new Date(String(row.window_start)).getTime() + params.windowMs;

      return {
        allowed: count <= params.limit,
        count,
        resetAt
      };
    } catch (err) {
      log.error({ err, key: params.key }, 'rate limit check failed');
      return { allowed: true, count: 0, resetAt: now + params.windowMs };
    }
  }

  // ─── Audit Logging ──────────────────────────────────────

  async insertAuditLog(params: {
    actorId?: string;
    actorType?: string;
    action: string;
    resourceType?: string;
    resourceId?: string;
    metadata?: object;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<void> {
    if (!this.pool) return;
    try {
      await this.pool.query(
        `INSERT INTO audit_log (actor_id, actor_type, action, resource_type, resource_id, metadata, ip_address, user_agent, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
        [
          params.actorId ?? null,
          params.actorType ?? null,
          params.action,
          params.resourceType ?? null,
          params.resourceId ?? null,
          params.metadata ? JSON.stringify(params.metadata) : null,
          params.ipAddress ?? null,
          params.userAgent ?? null
        ]
      );
    } catch (err) {
      log.error({ err, action: params.action }, 'failed to insert audit log');
    }
  }

  async getAuditLogs(params: {
    actorId?: string;
    action?: string;
    resourceType?: string;
    limit?: number;
    offset?: number;
  }): Promise<Array<{
    id: number;
    actorId: string | null;
    actorType: string | null;
    action: string;
    resourceType: string | null;
    resourceId: string | null;
    metadata: object | null;
    ipAddress: string | null;
    createdAt: number;
  }>> {
    if (!this.pool) return [];
    try {
      const conditions: string[] = [];
      const values: unknown[] = [];
      let paramIdx = 1;

      if (params.actorId) {
        conditions.push(`actor_id = $${paramIdx}`);
        values.push(params.actorId);
        paramIdx++;
      }
      if (params.action) {
        conditions.push(`action = $${paramIdx}`);
        values.push(params.action);
        paramIdx++;
      }
      if (params.resourceType) {
        conditions.push(`resource_type = $${paramIdx}`);
        values.push(params.resourceType);
        paramIdx++;
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const limit = Math.max(1, Math.min(1000, params.limit ?? 100));
      const offset = Math.max(0, params.offset ?? 0);

      values.push(limit, offset);
      const result = await this.pool.query(
        `SELECT id, actor_id, actor_type, action, resource_type, resource_id, metadata, ip_address, created_at
         FROM audit_log
         ${whereClause}
         ORDER BY created_at DESC
         LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
        values
      );

      return result.rows.map(row => ({
        id: Number(row.id),
        actorId: row.actor_id ? String(row.actor_id) : null,
        actorType: row.actor_type ? String(row.actor_type) : null,
        action: String(row.action),
        resourceType: row.resource_type ? String(row.resource_type) : null,
        resourceId: row.resource_id ? String(row.resource_id) : null,
        metadata: row.metadata ? (row.metadata as object) : null,
        ipAddress: row.ip_address ? String(row.ip_address) : null,
        createdAt: row.created_at ? new Date(String(row.created_at)).getTime() : Date.now()
      }));
    } catch (err) {
      log.error({ err }, 'failed to get audit logs');
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

  // ─── Leaderboard ────────────────────────────────────────

  async getLeaderboard(params: {
    limit?: number;
    sortBy?: 'wins' | 'totalWon';
  }): Promise<Array<{
    id: string;
    displayName: string;
    wins: number;
    losses: number;
    totalWagered: number;
    totalWon: number;
  }>> {
    if (!this.pool) return [];
    try {
      const limit = Math.max(1, Math.min(100, params.limit ?? 10));
      const sortBy = params.sortBy === 'totalWon' ? 'total_won' : 'wins';
      
      const result = await this.pool.query(
        `SELECT id, display_name, 
           COALESCE(wins, 0) as wins, 
           COALESCE(losses, 0) as losses,
           COALESCE(total_wagered, 0) as total_wagered,
           COALESCE(total_won, 0) as total_won
         FROM players
         WHERE role = 'human'
         ORDER BY ${sortBy} DESC, wins DESC
         LIMIT $1`,
        [limit]
      );

      return result.rows.map(row => ({
        id: String(row.id),
        displayName: String(row.display_name),
        wins: Number(row.wins),
        losses: Number(row.losses),
        totalWagered: Number(row.total_wagered),
        totalWon: Number(row.total_won)
      }));
    } catch (err) {
      log.error({ err }, 'failed to get leaderboard');
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
