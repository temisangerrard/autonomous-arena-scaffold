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
    expect(ringStations).toHaveLength(5);
    for (const station of ringStations) {
      const distanceFromCenter = Math.hypot(station.x, station.z);
      // All ring stations sit within a 55-unit horseshoe around the central
      // train, at least 20 units out so they clear the train obstacle itself.
      expect(distanceFromCenter).toBeGreaterThanOrEqual(20);
      expect(distanceFromCenter).toBeLessThanOrEqual(55);
    }

    const infoKiosk = getArenaStationById('station_world_info_a');
    expect(infoKiosk?.arenaZone).toBe('entry');
    expect(infoKiosk?.uiRole).toBe('guide');
  });
});
