import { createHash } from 'node:crypto';

type PgPool = {
  query: (text: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  end: () => Promise<void>;
};

type ChiefDbGatewayConfig = {
  serverDatabaseUrl?: string;
  runtimeDatabaseUrl?: string;
};

export type EconomySummary = {
  lookbackHours: number;
  challengeCount: number;
  resolvedCount: number;
  totalWagered: number;
  activePlayers: number;
  escrowEvents: number;
  escrowFailures: number;
  estimatedPayout: number;
};

export type RuntimeIntegrity = {
  runtimeConnected: boolean;
  profileCount: number;
  walletCount: number;
  subjectLinkCount: number;
  ownerBotCount: number;
  profilesMissingWallets: number;
  subjectLinksMissingProfiles: number;
};

function asNum(value: unknown): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function asStr(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export class ChiefDbGateway {
  private serverPool: PgPool | null = null;
  private runtimePool: PgPool | null = null;

  constructor(private readonly config: ChiefDbGatewayConfig) {}

  async connect(): Promise<void> {
    const pg = await import('pg').catch(() => null);
    const PoolCtor = pg?.default?.Pool ?? (pg as unknown as { Pool?: new (opts: object) => PgPool })?.Pool;
    if (!PoolCtor) {
      return;
    }

    const serverUrl = String(this.config.serverDatabaseUrl || '').trim();
    if (serverUrl) {
      try {
        this.serverPool = new PoolCtor({
          connectionString: serverUrl,
          max: 4,
          idleTimeoutMillis: 20_000,
          connectionTimeoutMillis: 4_000
        }) as unknown as PgPool;
        await this.serverPool.query('SELECT 1');
      } catch {
        this.serverPool = null;
      }
    }

    const runtimeUrl = String(this.config.runtimeDatabaseUrl || '').trim();
    if (runtimeUrl) {
      try {
        this.runtimePool = new PoolCtor({
          connectionString: runtimeUrl,
          max: 4,
          idleTimeoutMillis: 20_000,
          connectionTimeoutMillis: 4_000
        }) as unknown as PgPool;
        await this.runtimePool.query('SELECT 1');
      } catch {
        this.runtimePool = null;
      }
    }
  }

  async close(): Promise<void> {
    await Promise.all([
      this.serverPool?.end().catch(() => undefined),
      this.runtimePool?.end().catch(() => undefined)
    ]);
    this.serverPool = null;
    this.runtimePool = null;
  }

  health() {
    return {
      server: Boolean(this.serverPool),
      runtime: Boolean(this.runtimePool)
    };
  }

  async findPlayerByReference(ref: string): Promise<{
    id: string;
    displayName: string;
    walletId: string | null;
    wins: number;
    losses: number;
    totalWagered: number;
    totalWon: number;
  } | null> {
    if (!this.serverPool) {
      return null;
    }
    const normalized = String(ref || '').trim().toLowerCase();
    if (!normalized) {
      return null;
    }

    const result = await this.serverPool.query(
      `SELECT id, display_name, wallet_id,
              COALESCE(wins, 0) AS wins,
              COALESCE(losses, 0) AS losses,
              COALESCE(total_wagered, 0) AS total_wagered,
              COALESCE(total_won, 0) AS total_won
         FROM players
        WHERE LOWER(id) = $1 OR LOWER(display_name) = $1
        LIMIT 1`,
      [normalized]
    ).catch(() => ({ rows: [] }));

    const row = result.rows[0];
    if (!row) {
      return null;
    }

    return {
      id: asStr(row.id),
      displayName: asStr(row.display_name),
      walletId: asStr(row.wallet_id) || null,
      wins: asNum(row.wins),
      losses: asNum(row.losses),
      totalWagered: asNum(row.total_wagered),
      totalWon: asNum(row.total_won)
    };
  }

  async getChallengeOpsSummary(limit = 50): Promise<{
    total: number;
    open: number;
    resolved: number;
    staleOpen: number;
    latest: Array<{ id: string; status: string; gameType: string; wager: number; ageMinutes: number }>;
  }> {
    if (!this.serverPool) {
      return { total: 0, open: 0, resolved: 0, staleOpen: 0, latest: [] };
    }

    const safeLimit = Math.max(5, Math.min(200, Number(limit || 50)));
    const [stats, latest] = await Promise.all([
      this.serverPool.query(
        `SELECT
           COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE status NOT IN ('resolved','declined','expired'))::int AS open,
           COUNT(*) FILTER (WHERE status = 'resolved')::int AS resolved,
           COUNT(*) FILTER (WHERE status NOT IN ('resolved','declined','expired') AND created_at < NOW() - INTERVAL '15 minutes')::int AS stale_open
         FROM challenges`
      ).catch(() => ({ rows: [] })),
      this.serverPool.query(
        `SELECT id, status, game_type, wager,
                EXTRACT(EPOCH FROM (NOW() - created_at))/60.0 AS age_minutes
           FROM challenges
          ORDER BY created_at DESC
          LIMIT $1`,
        [safeLimit]
      ).catch(() => ({ rows: [] }))
    ]);

    const statRow = stats.rows[0] ?? {};
    return {
      total: asNum(statRow.total),
      open: asNum(statRow.open),
      resolved: asNum(statRow.resolved),
      staleOpen: asNum(statRow.stale_open),
      latest: latest.rows.map((row) => ({
        id: asStr(row.id),
        status: asStr(row.status),
        gameType: asStr(row.game_type),
        wager: asNum(row.wager),
        ageMinutes: Number(asNum(row.age_minutes).toFixed(1))
      }))
    };
  }

  async getEconomySummary(lookbackHours = 24): Promise<EconomySummary> {
    if (!this.serverPool) {
      return {
        lookbackHours,
        challengeCount: 0,
        resolvedCount: 0,
        totalWagered: 0,
        activePlayers: 0,
        escrowEvents: 0,
        escrowFailures: 0,
        estimatedPayout: 0
      };
    }

    const safeHours = Math.max(1, Math.min(168, Number(lookbackHours || 24)));
    const query = await this.serverPool.query(
      `WITH recent_challenges AS (
        SELECT * FROM challenges
         WHERE created_at >= NOW() - ($1::text || ' hours')::interval
      ),
      recent_escrow AS (
        SELECT * FROM escrow_events
         WHERE created_at >= NOW() - ($1::text || ' hours')::interval
      )
      SELECT
        (SELECT COUNT(*)::int FROM recent_challenges) AS challenge_count,
        (SELECT COUNT(*)::int FROM recent_challenges WHERE status = 'resolved') AS resolved_count,
        (SELECT COALESCE(SUM(wager), 0) FROM recent_challenges) AS total_wagered,
        (SELECT COUNT(DISTINCT player_id)::int FROM (
          SELECT challenger_id AS player_id FROM recent_challenges
          UNION ALL
          SELECT opponent_id AS player_id FROM recent_challenges
        ) q) AS active_players,
        (SELECT COUNT(*)::int FROM recent_escrow) AS escrow_events,
        (SELECT COUNT(*)::int FROM recent_escrow WHERE ok = false) AS escrow_failures,
        (SELECT COALESCE(SUM(payout), 0) FROM recent_escrow) AS estimated_payout`,
      [safeHours]
    ).catch(() => ({ rows: [] }));

    const row = query.rows[0] ?? {};
    return {
      lookbackHours: safeHours,
      challengeCount: asNum(row.challenge_count),
      resolvedCount: asNum(row.resolved_count),
      totalWagered: asNum(row.total_wagered),
      activePlayers: asNum(row.active_players),
      escrowEvents: asNum(row.escrow_events),
      escrowFailures: asNum(row.escrow_failures),
      estimatedPayout: asNum(row.estimated_payout)
    };
  }

  async getRuntimeIntegrity(): Promise<RuntimeIntegrity> {
    if (!this.runtimePool) {
      return {
        runtimeConnected: false,
        profileCount: 0,
        walletCount: 0,
        subjectLinkCount: 0,
        ownerBotCount: 0,
        profilesMissingWallets: 0,
        subjectLinksMissingProfiles: 0
      };
    }

    const [countsRes, missingWalletsRes, brokenLinksRes] = await Promise.all([
      this.runtimePool.query(
        `SELECT
           (SELECT COUNT(*)::int FROM runtime_profiles) AS profile_count,
           (SELECT COUNT(*)::int FROM runtime_wallets) AS wallet_count,
           (SELECT COUNT(*)::int FROM auth_subject_links) AS subject_link_count,
           (SELECT COUNT(*)::int FROM runtime_owner_bots) AS owner_bot_count`
      ).catch(() => ({ rows: [] })),
      this.runtimePool.query(
        `SELECT COUNT(*)::int AS missing
           FROM runtime_profiles p
      LEFT JOIN runtime_wallets w ON p.wallet_id = w.wallet_id
          WHERE w.wallet_id IS NULL`
      ).catch(() => ({ rows: [] })),
      this.runtimePool.query(
        `SELECT COUNT(*)::int AS missing
           FROM auth_subject_links l
      LEFT JOIN runtime_profiles p ON l.profile_id = p.profile_id
          WHERE p.profile_id IS NULL`
      ).catch(() => ({ rows: [] }))
    ]);

    const counts = countsRes.rows[0] ?? {};
    return {
      runtimeConnected: true,
      profileCount: asNum(counts.profile_count),
      walletCount: asNum(counts.wallet_count),
      subjectLinkCount: asNum(counts.subject_link_count),
      ownerBotCount: asNum(counts.owner_bot_count),
      profilesMissingWallets: asNum(missingWalletsRes.rows[0]?.missing),
      subjectLinksMissingProfiles: asNum(brokenLinksRes.rows[0]?.missing)
    };
  }

  async writeAudit(params: {
    actorId: string;
    actorType: 'admin' | 'system';
    action: string;
    resourceType?: string;
    resourceId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    if (!this.serverPool) {
      return;
    }
    const metadata = params.metadata ?? {};
    const metadataHash = createHash('sha256').update(JSON.stringify(metadata)).digest('hex').slice(0, 16);

    await this.serverPool.query(
      `INSERT INTO audit_log (actor_id, actor_type, action, resource_type, resource_id, metadata)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [
        params.actorId,
        params.actorType,
        params.action,
        params.resourceType ?? null,
        params.resourceId ?? null,
        JSON.stringify({ ...metadata, metadataHash })
      ]
    ).catch(() => undefined);
  }
}

export async function createChiefDbGateway(config: ChiefDbGatewayConfig): Promise<ChiefDbGateway> {
  const gateway = new ChiefDbGateway(config);
  await gateway.connect();
  return gateway;
}
