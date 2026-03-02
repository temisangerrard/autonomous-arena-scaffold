import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readPredictionHostSpawn() {
  const source = readFileSync(new URL('../public/js/play/runtime/world-npc-hosts.js', import.meta.url), 'utf8');
  const match = source.match(/\{ x: (-?\d+), z: (-?\d+) \} \/\/ prediction -> station_dealer_prediction_a/);
  if (!match) {
    throw new Error('prediction host spawn not found');
  }
  return { x: Number(match[1]), z: Number(match[2]) };
}

describe('world npc host prediction spawn', () => {
  it('matches the live prediction dealer station coordinates', () => {
    expect(readPredictionHostSpawn()).toEqual({ x: -70, z: 43 });
  });
});
