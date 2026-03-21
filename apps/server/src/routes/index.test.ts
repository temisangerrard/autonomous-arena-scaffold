import { createServer } from 'node:http';
import { describe, expect, it } from 'vitest';
import { createRouter, type RouteContext } from './index.js';

function makeRouteContext(internalToken: string): RouteContext {
  return {
    serverInstanceId: 'srv_test',
    presenceStore: {
      get: async () => null,
      list: async () => []
    } as unknown as RouteContext['presenceStore'],
    distributedChallengeStore: {
      recentHistory: async () => []
    } as unknown as RouteContext['distributedChallengeStore'],
    challengeService: {
      getRecent: () => []
    } as unknown as RouteContext['challengeService'],
    database: {
      getMigrationStatus: async () => ({
        currentVersion: 1,
        pendingMigrations: 0,
        appliedCount: 1
      })
    } as unknown as RouteContext['database'],
    internalToken,
    publishAdminCommand: async () => undefined,
    teleportLocal: () => false,
    marketService: null
  };
}

async function withServer<T>(ctx: RouteContext, run: (baseUrl: string) => Promise<T>): Promise<T> {
  const server = createServer(createRouter(ctx));
  await new Promise<void>((resolve) => server.listen(0, resolve));
  try {
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('failed to bind test server');
    }
    return await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

describe('internal route authorization', () => {
  it('rejects /migrations/status when internal token is missing', async () => {
    await withServer(makeRouteContext(''), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/migrations/status`);
      expect(response.status).toBe(401);
      const payload = await response.json();
      expect(payload.ok).toBe(false);
      expect(payload.reason).toBe('unauthorized_internal');
    });
  });

  it('allows /migrations/status with matching internal token header', async () => {
    await withServer(makeRouteContext('test_internal_token'), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/migrations/status`, {
        headers: {
          'x-internal-token': 'test_internal_token'
        }
      });
      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload.ok).toBe(true);
    });
  });

  it('returns market positions by walletId when playerId is unavailable', async () => {
    const internalToken = 'test_internal_token';
    const ctx = makeRouteContext(internalToken);
    (ctx.database as unknown as {
      listWalletMarketPositions: (walletId: string, limit: number) => Promise<Array<Record<string, unknown>>>;
    }).listWalletMarketPositions = async () => ([
      {
        id: 'mp_test_1',
        marketId: 'cl_btc_5m_1772706600',
        playerId: 'u_profile_3',
        walletId: 'wallet_37',
        side: 'yes',
        stake: 1,
        price: 0.5,
        shares: 2,
        status: 'open',
        escrowBetId: 'mkt_1',
        estimatedPayoutAtOpen: 2,
        minPayoutAtOpen: 1,
        payout: null,
        settlementReason: null,
        clobOrderId: null,
        createdAt: Date.now(),
        settledAt: null
      }
    ]);
    ctx.marketService = {
      getAdminState: async () => ({
        markets: [
          {
            id: 'cl_btc_5m_1772706600',
            question: 'Will BTC/USD be higher in 5 minutes?',
            slug: 'btc-5m',
            oracleSource: 'chainlink_btc_usd',
            roundType: 'current',
            currentSpotPrice: 73271,
            lockPrice: 73250,
            finalPrice: null
          }
        ]
      })
    } as unknown as RouteContext['marketService'];

    await withServer(ctx, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/markets/player/positions?walletId=wallet_37&limit=10`, {
        headers: {
          'x-internal-token': internalToken
        }
      });
      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload.ok).toBe(true);
      expect(Array.isArray(payload.recent)).toBe(true);
      expect(payload.recent.length).toBe(1);
      expect(payload.recent[0]?.walletId).toBe('wallet_37');
      expect(payload.recent[0]?.marketQuestion).toContain('BTC/USD');
    });
  });

  it('returns escrow events by walletId via derived player ids', async () => {
    const internalToken = 'test_internal_token';
    const ctx = makeRouteContext(internalToken);
    let eventAt = 1_770_000_000_000;
    ctx.presenceStore = {
      get: async () => null,
      list: async () => ([
        {
          playerId: 'u_profile_3',
          role: 'human',
          displayName: 'Temisan',
          walletId: 'wallet_37',
          x: 0, y: 0, z: 0, yaw: 0, speed: 0, updatedAt: Date.now()
        }
      ])
    } as unknown as RouteContext['presenceStore'];
    (ctx.database as unknown as {
      listWalletMarketPositions: (walletId: string, limit?: number) => Promise<Array<{ playerId: string }>>;
      getEscrowEventsForPlayer: (params: { playerId: string; limit: number }) => Promise<Array<Record<string, unknown>>>;
    }).listWalletMarketPositions = async () => ([{ playerId: 'u_profile_3' }]);
    (ctx.database as unknown as {
      getEscrowEventsForPlayer: (params: { playerId: string; limit: number }) => Promise<Array<Record<string, unknown>>>;
    }).getEscrowEventsForPlayer = async ({ playerId }) => ([
      {
        challengeId: 'c_test_1',
        phase: 'resolve',
        ok: true,
        reason: null,
        txHash: '0xabc',
        fee: null,
        payout: null,
        at: eventAt++,
        challengerId: playerId,
        opponentId: 'system_house',
        winnerId: playerId,
        gameType: 'rps',
        wager: 1,
        activitySource: 'house_station'
      }
    ]);

    await withServer(ctx, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/escrow/events/recent?walletId=wallet_37&limit=10`, {
        headers: {
          'x-internal-token': internalToken
        }
      });
      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload.ok).toBe(true);
      expect(Array.isArray(payload.recent)).toBe(true);
      expect(payload.recent.length).toBe(1);
      expect(payload.recent[0]?.gameType).toBe('rps');
      expect(payload.recent[0]?.challengerId).toBe('u_profile_3');
    });
  });

  it('resolves escrow events when caller passes profile id without u_ prefix', async () => {
    const internalToken = 'test_internal_token';
    const ctx = makeRouteContext(internalToken);
    const calls: string[] = [];
    (ctx.database as unknown as {
      getEscrowEventsForPlayer: (params: { playerId: string; limit: number }) => Promise<Array<Record<string, unknown>>>;
    }).getEscrowEventsForPlayer = async ({ playerId }) => {
      calls.push(playerId);
      if (playerId !== 'u_profile_3') {
        return [];
      }
      return [
        {
          challengeId: 'c_test_2',
          phase: 'resolve',
          ok: true,
          reason: null,
          txHash: '0xdef',
          fee: null,
          payout: 2,
          at: Date.now(),
          challengerId: 'u_profile_3',
          opponentId: 'system_house',
          winnerId: 'u_profile_3',
          gameType: 'rps',
          wager: 1,
          activitySource: 'house_station'
        }
      ];
    };

    await withServer(ctx, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/escrow/events/recent?playerId=profile_3&limit=10`, {
        headers: {
          'x-internal-token': internalToken
        }
      });
      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload.ok).toBe(true);
      expect(Array.isArray(payload.recent)).toBe(true);
      expect(payload.recent.length).toBe(1);
      expect(payload.recent[0]?.challengerId).toBe('u_profile_3');
      expect(calls).toContain('profile_3');
      expect(calls).toContain('u_profile_3');
    });
  });
});
