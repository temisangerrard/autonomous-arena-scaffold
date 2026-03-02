import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildStations } from '../../server/src/game/stations/catalog.ts';

function readWorldNpcHostsSource() {
  return readFileSync(new URL('../public/js/play/runtime/world-npc-hosts.js', import.meta.url), 'utf8');
}

function readPredictionHostSpawn(source) {
  const match = source.match(/\{ x: (-?\d+), z: (-?\d+) \} \/\/ prediction -> station_dealer_prediction_a/);
  if (!match) {
    throw new Error('prediction host spawn not found');
  }
  return { x: Number(match[1]), z: Number(match[2]) };
}

function readWorldSectionSpawns(source) {
  const start = source.indexOf('const WORLD_SECTION_SPAWNS = [');
  const end = source.indexOf('];', start);
  if (start < 0 || end < 0) {
    throw new Error('WORLD_SECTION_SPAWNS block not found');
  }
  const block = source.slice(start, end);
  const matches = [...block.matchAll(/\{ x: (-?\d+), z: (-?\d+) \}/g)];
  return matches.map((match) => ({ x: Number(match[1]), z: Number(match[2]) }));
}

function readProxyMap(source) {
  const start = source.indexOf('export const HOST_STATION_PROXY_MAP = {');
  const end = source.indexOf('};', start);
  if (start < 0 || end < 0) {
    throw new Error('HOST_STATION_PROXY_MAP block not found');
  }
  const block = source.slice(start, end);
  return Object.fromEntries(
    [...block.matchAll(/(station_npc_host_\d+): '([^']+)'/g)].map((match) => [match[1], match[2]])
  );
}

describe('world npc host prediction spawn', () => {
  it('only spawns one live host per surviving public dealer role', () => {
    const source = readWorldNpcHostsSource();
    const hostIds = [...source.matchAll(/hostId: '([^']+)'/g)].map((match) => match[1]);
    expect(hostIds).toEqual([
      'npc_host_guide',
      'npc_host_cashier',
      'npc_host_coinflip_a',
      'npc_host_rps_a',
      'npc_host_dice',
      'npc_host_info'
    ]);
  });

  it('matches the live prediction dealer station coordinates', () => {
    const source = readWorldNpcHostsSource();
    expect(readPredictionHostSpawn(source)).toEqual({ x: -70, z: 43 });
  });

  it('keeps proxied dealer hosts within the routed station radius', () => {
    const source = readWorldNpcHostsSource();
    const spawns = readWorldSectionSpawns(source);
    const proxyMap = readProxyMap(source);
    const stations = new Map(buildStations({ diceDuelEnabled: true }).map((station) => [station.id, station]));

    for (const [hostId, stationId] of Object.entries(proxyMap)) {
      const hostIndex = Number(hostId.replace('station_npc_host_', '')) - 1;
      const spawn = spawns[hostIndex];
      const station = stations.get(stationId);
      expect(spawn, `${hostId} spawn missing`).toBeTruthy();
      expect(station, `${stationId} missing`).toBeTruthy();
      const dist = Math.hypot(spawn.x - station.x, spawn.z - station.z);
      expect(dist, `${hostId} -> ${stationId} drifted too far`).toBeLessThanOrEqual(Number(station.radius ?? 8));
    }
  });
});
