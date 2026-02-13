export type InputState = {
  moveX: number;
  moveZ: number;
};

export type PlayerSnapshot = {
  id: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  speed: number;
};

export type WorldSnapshot = {
  tick: number;
  players: PlayerSnapshot[];
};

type PlayerState = {
  id: string;
  x: number;
  z: number;
  vx: number;
  vz: number;
  yaw: number;
};

const WORLD_BOUND = 120;
const ACCEL = 14;
const DRAG = 8;
const MAX_SPEED = 5;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export class WorldSim {
  private readonly players = new Map<string, PlayerState>();
  private readonly inputs = new Map<string, InputState>();
  private tickCount = 0;

  joinPlayer(id: string): void {
    const positionSeed = this.players.size * 2;
    this.players.set(id, {
      id,
      x: positionSeed,
      z: positionSeed,
      vx: 0,
      vz: 0,
      yaw: 0
    });
    this.inputs.set(id, { moveX: 0, moveZ: 0 });
  }

  removePlayer(id: string): void {
    this.players.delete(id);
    this.inputs.delete(id);
  }

  setInput(id: string, input: InputState): void {
    if (!this.players.has(id)) {
      return;
    }

    this.inputs.set(id, {
      moveX: clamp(input.moveX, -1, 1),
      moveZ: clamp(input.moveZ, -1, 1)
    });
  }

  step(dtSeconds: number): WorldSnapshot {
    this.tickCount += 1;

    for (const player of this.players.values()) {
      const input = this.inputs.get(player.id) ?? { moveX: 0, moveZ: 0 };
      const rawLength = Math.hypot(input.moveX, input.moveZ);
      const moving = rawLength > 0.001;

      if (moving) {
        const dirX = input.moveX / rawLength;
        const dirZ = input.moveZ / rawLength;

        player.vx += dirX * ACCEL * dtSeconds;
        player.vz += dirZ * ACCEL * dtSeconds;
      } else {
        player.vx -= player.vx * Math.min(1, DRAG * dtSeconds);
        player.vz -= player.vz * Math.min(1, DRAG * dtSeconds);
      }

      const speed = Math.hypot(player.vx, player.vz);
      if (speed > MAX_SPEED) {
        player.vx = (player.vx / speed) * MAX_SPEED;
        player.vz = (player.vz / speed) * MAX_SPEED;
      }

      player.x += player.vx * dtSeconds;
      player.z += player.vz * dtSeconds;

      player.x = clamp(player.x, -WORLD_BOUND, WORLD_BOUND);
      player.z = clamp(player.z, -WORLD_BOUND, WORLD_BOUND);

      if (Math.abs(player.x) === WORLD_BOUND) {
        player.vx = 0;
      }
      if (Math.abs(player.z) === WORLD_BOUND) {
        player.vz = 0;
      }

      const postSpeed = Math.hypot(player.vx, player.vz);
      if (postSpeed > 0.01) {
        player.yaw = Math.atan2(player.vx, player.vz);
      }
    }

    return {
      tick: this.tickCount,
      players: [...this.players.values()].map((player) => ({
        id: player.id,
        x: player.x,
        y: 1.2,
        z: player.z,
        yaw: player.yaw,
        speed: Math.hypot(player.vx, player.vz)
      }))
    };
  }
}
