import { describe, expect, it, vi } from 'vitest';
import { createWorldStationsController } from '../public/js/play/runtime/world-stations.js';

function makeState() {
  return {
    hostStations: new Map(),
    bakedStations: new Map(),
    stations: new Map()
  };
}

describe('world stations controller', () => {
  it('drops baked stations that overlap a live host station', () => {
    const state = makeState();
    const mergeStations = vi.fn();
    const remapLocalStationProxies = vi.fn();
    const scene = { add() {}, remove() {} };
    const controller = createWorldStationsController({
      THREE: {},
      scene,
      state,
      createWorldNpcHosts: () => ({
        hostStations: new Map([
          ['station_npc_host_8', {
            id: 'station_npc_host_8',
            source: 'host',
            kind: 'dealer_prediction',
            displayName: 'Super Agent',
            x: -70,
            z: 43,
            localInteraction: { title: 'Super Agent' }
          }]
        ]),
        updateHosts() {},
        dispose() {}
      }),
      extractBakedNpcStations: () => new Map([
        ['station_baked_prediction_s5', {
          id: 'station_baked_prediction_s5',
          source: 'baked',
          kind: 'dealer_prediction',
          displayName: 'Prediction Dealer B',
          x: -69,
          z: 43,
          proxyStationId: 'station_dealer_prediction_a'
        }]
      ]),
      remapLocalStationProxies,
      mergeStations
    });

    controller.setWorldRoot({});
    controller.setupWorldNpcStations();

    expect(state.hostStations.size).toBe(1);
    expect(state.bakedStations.size).toBe(0);
    expect(remapLocalStationProxies).toHaveBeenCalled();
    expect(mergeStations).toHaveBeenCalled();
  });

  it('degrades orphaned baked dealers into guide NPCs that route to live hosts', () => {
    const state = makeState();
    const mergeStations = vi.fn();
    const remapLocalStationProxies = vi.fn();
    const scene = { add() {}, remove() {} };
    const controller = createWorldStationsController({
      THREE: {},
      scene,
      state,
      createWorldNpcHosts: () => ({
        hostStations: new Map([
          ['station_npc_host_3', {
            id: 'station_npc_host_3',
            source: 'host',
            hostRole: 'coinflip',
            kind: 'dealer_coinflip',
            displayName: 'Jade',
            x: -20,
            z: -20,
            localInteraction: { title: 'Jade' }
          }]
        ]),
        updateHosts() {},
        dispose() {}
      }),
      extractBakedNpcStations: () => new Map([
        ['station_baked_coinflip_s1', {
          id: 'station_baked_coinflip_s1',
          source: 'baked',
          hostRole: 'coinflip',
          kind: 'dealer_coinflip',
          displayName: 'S1 Coinflip Dealer 1',
          x: -80,
          z: -45,
          proxyStationId: ''
        }]
      ]),
      remapLocalStationProxies,
      mergeStations
    });

    controller.setWorldRoot({});
    controller.setupWorldNpcStations();

    const baked = state.bakedStations.get('station_baked_coinflip_s1');
    expect(baked.kind).toBe('world_interactable');
    expect(baked.degradedToLocal).toBe(true);
    expect(baked.displayName).toBe('Coinflip Runner');
    expect(baked.localInteraction).toMatchObject({
      title: 'Coinflip Runner',
      useLabel: 'Open coinflip',
      routeStationId: 'station_npc_host_3'
    });
  });
});
