import { describe, expect, it } from 'vitest';
import { ChiefDbGateway } from './chief/dbGateway.js';

describe('chief db gateway', () => {
  it('returns safe defaults when db pools are unavailable', async () => {
    const gateway = new ChiefDbGateway({
      serverDatabaseUrl: '',
      runtimeDatabaseUrl: ''
    });

    const [economy, challenges, integrity, player] = await Promise.all([
      gateway.getEconomySummary(24),
      gateway.getChallengeOpsSummary(20),
      gateway.getRuntimeIntegrity(),
      gateway.findPlayerByReference('alice')
    ]);

    expect(economy.challengeCount).toBe(0);
    expect(challenges.total).toBe(0);
    expect(integrity.runtimeConnected).toBe(false);
    expect(player).toBeNull();
    expect(gateway.health()).toEqual({ server: false, runtime: false });
  });
});
