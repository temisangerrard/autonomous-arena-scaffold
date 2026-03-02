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
});
