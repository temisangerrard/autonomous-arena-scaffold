import { describe, expect, it } from 'vitest';
import { WorldSim } from './WorldSim.js';

describe('WorldSim', () => {
  it('respects max speed cap', () => {
    const sim = new WorldSim();
    sim.joinPlayer('p1');

    for (let i = 0; i < 120; i += 1) {
      sim.setInput('p1', { moveX: 1, moveZ: 1 });
      sim.step(1 / 60);
    }

    const snapshot = sim.step(1 / 60);
    const player = snapshot.players.find((entry) => entry.id === 'p1');
    expect(player).toBeDefined();
    expect(player!.speed).toBeLessThanOrEqual(5.001);
  });

  it('keeps players inside world bounds', () => {
    const sim = new WorldSim();
    sim.joinPlayer('p1');

    for (let i = 0; i < 6000; i += 1) {
      sim.setInput('p1', { moveX: 1, moveZ: 0 });
      sim.step(1 / 60);
    }

    const snapshot = sim.step(1 / 60);
    const player = snapshot.players.find((entry) => entry.id === 'p1');
    expect(player).toBeDefined();
    expect(Math.abs(player!.x)).toBeLessThanOrEqual(120);
  });

  it('slows down when input stops', () => {
    const sim = new WorldSim();
    sim.joinPlayer('p1');
    sim.setPlayerPositionForTest('p1', 0, 60);

    for (let i = 0; i < 120; i += 1) {
      sim.setInput('p1', { moveX: 1, moveZ: 0 });
      sim.step(1 / 60);
    }

    const moving = sim.step(1 / 60).players[0]?.speed ?? 0;

    sim.setInput('p1', { moveX: 0, moveZ: 0 });
    for (let i = 0; i < 60; i += 1) {
      sim.step(1 / 60);
    }

    const slowed = sim.step(1 / 60).players[0]?.speed ?? 0;
    expect(slowed).toBeLessThan(moving);
  });

  it('spawns human players outside blocked structures', () => {
    const sim = new WorldSim();
    sim.joinPlayer('human_1');

    const snapshot = sim.step(1 / 60);
    const player = snapshot.players.find((entry) => entry.id === 'human_1');
    expect(player).toBeDefined();
    expect(Math.abs(player?.x ?? 0)).toBeLessThan(100);
    expect(Math.abs(player?.z ?? 0)).toBeLessThan(100);
    const insideTrainBlock = (player?.x ?? 0) > -38 && (player?.x ?? 0) < 38 && (player?.z ?? 0) > -18 && (player?.z ?? 0) < 16;
    expect(insideTrainBlock).toBe(false);
  });

  it('prevents players from overlapping each other', () => {
    const sim = new WorldSim();
    sim.joinPlayer('p1');
    sim.joinPlayer('p2');

    sim.setPlayerPositionForTest('p1', 0, 60);
    sim.setPlayerPositionForTest('p2', 0.1, 60.1);

    for (let i = 0; i < 3; i += 1) {
      sim.step(1 / 60);
    }

    const snapshot = sim.step(1 / 60);
    const p1 = snapshot.players.find((entry) => entry.id === 'p1');
    const p2 = snapshot.players.find((entry) => entry.id === 'p2');
    expect(p1).toBeDefined();
    expect(p2).toBeDefined();
    const distance = Math.hypot((p2?.x ?? 0) - (p1?.x ?? 0), (p2?.z ?? 0) - (p1?.z ?? 0));
    expect(distance).toBeGreaterThan(1.9);
  });

  it('blocks movement into static obstacle zones', () => {
    const sim = new WorldSim();
    sim.joinPlayer('p1');

    // Approach train body obstacle (minX -38) from the west.
    sim.setPlayerPositionForTest('p1', -52, 0);
    for (let i = 0; i < 220; i += 1) {
      sim.setInput('p1', { moveX: 1, moveZ: 0 });
      sim.step(1 / 60);
    }

    const snapshot = sim.step(1 / 60);
    const player = snapshot.players.find((entry) => entry.id === 'p1');
    expect(player).toBeDefined();
    // Collision radius keeps x just outside obstacle wall.
    expect((player?.x ?? 0)).toBeLessThan(-38.8);
  });
});
