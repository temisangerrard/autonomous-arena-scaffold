import { describe, expect, it } from 'vitest';
import { buildStations } from './catalog.js';

describe('buildStations', () => {
  it('builds a single public venue per arena role with metadata', () => {
    const stations = buildStations({ diceDuelEnabled: true });
    const ids = new Set(stations.map((s) => s.id));

    expect([...ids]).toEqual([
      'station_world_info_a',
      'station_cashier_bank',
      'station_dealer_coinflip_a',
      'station_dealer_rps_a',
      'station_dealer_dice_a',
      'station_dealer_prediction_a'
    ]);

    const cashier = stations.find((s) => s.id === 'station_cashier_bank');
    const market = stations.find((s) => s.id === 'station_dealer_prediction_a');

    expect(cashier).toMatchObject({
      uiRole: 'cashier',
      publicFacing: true,
      primaryVenue: true,
      walletSurface: 'cashier',
      interactionMode: 'cashier',
      arenaZone: 'ring'
    });
    expect(market).toMatchObject({
      uiRole: 'market',
      publicFacing: true,
      primaryVenue: true,
      walletSurface: 'summary',
      interactionMode: 'market',
      arenaZone: 'ring'
    });
  });

  it('omits dice dealers when disabled', () => {
    const stations = buildStations({ diceDuelEnabled: false });
    const ids = new Set(stations.map((s) => s.id));
    expect(ids.has('station_dealer_prediction_a')).toBe(true);
    expect(ids.has('station_dealer_dice_a')).toBe(false);
  });
});
