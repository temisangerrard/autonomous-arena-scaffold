import { describe, expect, it } from 'vitest';
import { createTargetingController } from '../public/js/play/runtime/targeting.js';

describe('targeting source priority', () => {
  it('prefers host stations over nearby baked/server stations', () => {
    const state = {
      nearbyIds: new Set(),
      nearbyStationIds: new Set(['station_server', 'station_baked', 'station_host']),
      nearbyDistances: new Map([
        ['station_server', 1.5],
        ['station_baked', 1.2],
        ['station_host', 2.5]
      ]),
      stations: new Map([
        ['station_server', { id: 'station_server', source: 'server' }],
        ['station_baked', { id: 'station_baked', source: 'baked' }],
        ['station_host', { id: 'station_host', source: 'host' }]
      ]),
      ui: { targetId: '', interactOpen: true, interactionMode: 'station' },
      players: new Map(),
      playerId: 'player_1'
    };

    const targeting = createTargetingController({
      state,
      isStation: (id) => String(id || '').startsWith('station_')
    });

    const nextTarget = targeting.getUiTargetId();
    expect(nextTarget).toBe('station_host');
  });
});

