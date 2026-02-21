import { describe, expect, it } from 'vitest';
import { createStationRouting } from '../public/js/play/runtime/station-routing.js';

function makeState() {
  return {
    serverStations: new Map(),
    hostStations: new Map(),
    bakedStations: new Map(),
    stations: new Map(),
    players: new Map(),
    playerId: 'player_1',
    ui: {}
  };
}

describe('station routing proxy resolution', () => {
  it('uses nearest compatible server station for baked stations when cached proxy is too far', () => {
    const state = makeState();
    state.serverStations.set('station_dealer_coinflip_a', {
      id: 'station_dealer_coinflip_a',
      kind: 'dealer_coinflip',
      x: -25,
      z: -24,
      radius: 8
    });
    state.serverStations.set('station_dealer_coinflip_b', {
      id: 'station_dealer_coinflip_b',
      kind: 'dealer_coinflip',
      x: 25,
      z: 26,
      radius: 8
    });
    state.bakedStations.set('station_baked_coinflip_s7', {
      id: 'station_baked_coinflip_s7',
      source: 'baked',
      kind: 'dealer_coinflip',
      x: -22,
      z: -25,
      proxyStationId: 'station_dealer_coinflip_a'
    });
    state.players.set('player_1', { x: 25, z: 26 });

    const routing = createStationRouting({ state, hostStationProxyMap: {} });
    routing.remapLocalStationProxies();
    routing.mergeStations();

    const resolved = routing.resolveStationIdForSend('station_baked_coinflip_s7');
    expect(resolved).toBe('station_dealer_coinflip_b');
  });

  it('keeps explicit proxy mapping for host stations', () => {
    const state = makeState();
    state.serverStations.set('station_dealer_coinflip_a', {
      id: 'station_dealer_coinflip_a',
      kind: 'dealer_coinflip',
      x: -25,
      z: -24,
      radius: 8
    });
    state.serverStations.set('station_dealer_coinflip_b', {
      id: 'station_dealer_coinflip_b',
      kind: 'dealer_coinflip',
      x: 25,
      z: 26,
      radius: 8
    });
    state.hostStations.set('station_npc_host_3', {
      id: 'station_npc_host_3',
      source: 'host',
      kind: 'dealer_coinflip',
      x: -25,
      z: -24,
      proxyStationId: ''
    });
    state.players.set('player_1', { x: 25, z: 26 });

    const routing = createStationRouting({
      state,
      hostStationProxyMap: { station_npc_host_3: 'station_dealer_coinflip_a' }
    });
    routing.remapLocalStationProxies();
    routing.mergeStations();

    const resolved = routing.resolveStationIdForSend('station_npc_host_3');
    expect(resolved).toBe('station_dealer_coinflip_a');
  });
});
