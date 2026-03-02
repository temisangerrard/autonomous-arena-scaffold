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

  it('clusters ring venues around the arena center while keeping guide at entry', () => {
    const ringStations = ARENA_PUBLIC_STATION_LAYOUT.filter((station) => station.arenaZone === 'ring');
    expect(ringStations).toHaveLength(5);
    for (const station of ringStations) {
      const distanceFromCenter = Math.hypot(station.x, station.z);
      expect(distanceFromCenter).toBeGreaterThanOrEqual(8);
      expect(distanceFromCenter).toBeLessThanOrEqual(18);
    }

    const guide = getArenaStationById('station_world_info_a');
    expect(guide?.arenaZone).toBe('entry');
    expect(guide?.uiRole).toBe('guide');
  });
});
