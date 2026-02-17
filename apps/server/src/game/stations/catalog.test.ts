import { describe, expect, it } from 'vitest';
import { buildStations } from './catalog.js';

describe('buildStations', () => {
  it('builds expanded station list with dice dealers enabled', () => {
    const stations = buildStations({ diceDuelEnabled: true });
    const ids = new Set(stations.map((s) => s.id));
    expect(ids.has('station_dealer_coinflip_a')).toBe(true);
    expect(ids.has('station_dealer_coinflip_b')).toBe(true);
    expect(ids.has('station_dealer_rps_a')).toBe(true);
    expect(ids.has('station_dealer_rps_b')).toBe(true);
    expect(ids.has('station_dealer_dice_a')).toBe(true);
    expect(ids.has('station_dealer_dice_b')).toBe(true);
    expect(ids.has('station_cashier_bank')).toBe(true);
  });

  it('omits dice dealers when disabled', () => {
    const stations = buildStations({ diceDuelEnabled: false });
    const ids = new Set(stations.map((s) => s.id));
    expect(ids.has('station_dealer_dice_a')).toBe(false);
    expect(ids.has('station_dealer_dice_b')).toBe(false);
  });
});
