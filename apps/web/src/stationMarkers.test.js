import { describe, expect, it } from 'vitest';
import { createStationSystem } from '../public/js/play/stations.js';

function makeThree() {
  class Group {
    constructor() { this.children = []; this.position = { set() {} }; this.rotation = { y: 0 }; }
    add(...items) { this.children.push(...items); }
  }
  class Mesh {
    constructor() { this.position = { y: 0, set() {} }; this.rotation = { x: 0, y: 0 }; this.castShadow = false; this.receiveShadow = false; }
  }
  class Sprite {
    constructor() { this.scale = { set() {} }; this.position = { set() {} }; }
  }
  class CanvasTexture { constructor() { this.needsUpdate = false; this.colorSpace = ''; } }
  class SpriteMaterial { constructor() {} }
  class MeshStandardMaterial { constructor() {} }
  class CylinderGeometry { constructor() {} }
  class TorusGeometry { constructor() {} }
  class OctahedronGeometry { constructor() {} }
  return {
    Group,
    Mesh,
    Sprite,
    CanvasTexture,
    SpriteMaterial,
    MeshStandardMaterial,
    CylinderGeometry,
    TorusGeometry,
    OctahedronGeometry,
    SRGBColorSpace: 'srgb'
  };
}

function installDomCanvasStub() {
  global.document = {
    createElement(tag) {
      if (tag !== 'canvas') throw new Error(`unexpected tag ${tag}`);
      return {
        width: 0,
        height: 0,
        getContext() {
          return {
            clearRect() {},
            beginPath() {},
            roundRect() {},
            fill() {},
            stroke() {},
            fillText() {},
            set fillStyle(_) {},
            set strokeStyle(_) {},
            set lineWidth(_) {},
            set font(_) {},
            set textAlign(_) {},
            set textBaseline(_) {}
          };
        }
      };
    }
  };
}

describe('station markers', () => {
  it('does not render host or overlapping server station markers when a host npc already represents the venue', () => {
    installDomCanvasStub();
    const THREE = makeThree();
    const scene = { addCalls: [], remove() {}, add(node) { this.addCalls.push(node); } };
    const system = createStationSystem({ THREE, scene });
    const state = {
      hostStations: new Map([
        ['station_npc_host_5', {
          id: 'station_npc_host_5',
          source: 'host',
          kind: 'dealer_rps',
          displayName: 'Super Agent',
          x: 25,
          z: -24,
          yaw: 0,
          proxyStationId: 'station_dealer_rps_a'
        }]
      ]),
      stations: new Map([
        ['station_npc_host_5', {
          id: 'station_npc_host_5',
          source: 'host',
          kind: 'dealer_rps',
          displayName: 'Super Agent',
          x: 25,
          z: -24,
          yaw: 0,
          proxyStationId: 'station_dealer_rps_a'
        }],
        ['station_dealer_rps_a', {
          id: 'station_dealer_rps_a',
          source: 'server',
          kind: 'dealer_rps',
          displayName: 'RPS Dealer A',
          x: 25,
          z: -24,
          yaw: 0
        }]
      ])
    };

    system.syncStations(state);

    expect(system.markers.has('station_npc_host_5')).toBe(false);
    expect(system.markers.has('station_dealer_rps_a')).toBe(false);
  });
});
