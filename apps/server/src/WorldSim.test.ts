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

    for (let i = 0; i < 120; i += 1) {
      sim.setInput('p1', { moveX: 0, moveZ: 1 });
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
});
