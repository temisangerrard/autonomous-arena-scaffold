import { describe, expect, it } from 'vitest';
import {
  ARENA_PUBLIC_STATION_LAYOUT,
  arenaPrimaryStationIds,
  getArenaStationById
} from './stationLayout.js';

describe('arena station layout', () => {
  it('defines a single primary venue for each core arena role', () => {
    const ids = arenaPrimaryStationIds();
    expect(ids).toEqual([
      'station_world_info_a',
      'station_cashier_bank',
      'station_dealer_coinflip_a',
      'station_dealer_rps_a',
      'station_dealer_dice_a',
      'station_dealer_prediction_a'
    ]);
  });

  it('clusters all venues as ring dealers within 55 units of the arena center', () => {
    const ringStations = ARENA_PUBLIC_STATION_LAYOUT.filter((station) => station.arenaZone === 'ring');
    expect(ringStations).toHaveLength(6);
    for (const station of ringStations) {
      const distanceFromCenter = Math.hypot(station.x, station.z);
      // All stations sit within a 55-unit horseshoe around the central
      // train, at least 18 units out so they clear the train obstacle itself.
      expect(distanceFromCenter).toBeGreaterThanOrEqual(18);
      expect(distanceFromCenter).toBeLessThanOrEqual(55);
    }

    const coinflipB = getArenaStationById('station_world_info_a');
    expect(coinflipB?.arenaZone).toBe('ring');
    expect(coinflipB?.uiRole).toBe('coinflip');
  });
});
