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
});
