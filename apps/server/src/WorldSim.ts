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

type AabbObstacle = {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
};

const WORLD_BOUND = 120;
const ACCEL = 14;
const DRAG = 8;
const MAX_SPEED = 5;
const PLAYER_RADIUS = 1.05;
const AVOIDANCE_RADIUS = 3.3;
const AVOIDANCE_ACCEL = 12;
const OBSTACLE_BUFFER = 2.6;
const SECTION_SPAWNS: Array<{ x: number; z: number }> = [
  { x: -90, z: -70 },
  { x: -30, z: -70 },
  { x: 30, z: -70 },
  { x: 90, z: -70 },
  { x: -90, z: 70 },
  { x: -30, z: 70 },
  { x: 30, z: 70 },
  { x: 90, z: 70 }
];
const HUMAN_SPAWNS: Array<{ x: number; z: number }> = [
  { x: -24, z: -24 },
  { x: 0, z: -24 },
  { x: 24, z: -24 },
  { x: -24, z: 24 },
  { x: 0, z: 24 },
  { x: 24, z: 24 },
  { x: 48, z: 0 },
  { x: -8, z: 48 }
];
const STATIC_OBSTACLES: AabbObstacle[] = [
  // Rail corridor and train body near center.
  { minX: -38, maxX: 38, minZ: -18, maxZ: 16 },
  // Left passenger carriage.
  { minX: -94, maxX: -44, minZ: -20, maxZ: 20 },
  // Castle/building block in north-west area.
  { minX: -38, maxX: 32, minZ: -74, maxZ: -28 },
  // Giant tree / props cluster in north-east.
  { minX: 60, maxX: 112, minZ: -62, maxZ: -12 },
  // North-west stump/props pocket.
  { minX: -112, maxX: -72, minZ: -72, maxZ: -40 },
  // South-east logs/props pocket.
  { minX: 72, maxX: 112, minZ: 40, maxZ: 84 }
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function hashId(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function collidesWithObstacle(x: number, z: number, radius: number): boolean {
  for (const obstacle of STATIC_OBSTACLES) {
    const nearX = clamp(x, obstacle.minX, obstacle.maxX);
    const nearZ = clamp(z, obstacle.minZ, obstacle.maxZ);
    const dx = x - nearX;
    const dz = z - nearZ;
    if (dx * dx + dz * dz < radius * radius) {
      return true;
    }
  }
  return false;
}

function findSafeSpawn(x: number, z: number): { x: number; z: number } {
  if (!collidesWithObstacle(x, z, PLAYER_RADIUS)) {
    return { x, z };
  }

  for (let i = 1; i <= 24; i += 1) {
    const ring = Math.floor((i - 1) / 8) + 1;
    const angle = (i % 8) * (Math.PI / 4);
    const nx = x + Math.cos(angle) * ring * 3.5;
    const nz = z + Math.sin(angle) * ring * 3.5;
    if (!collidesWithObstacle(nx, nz, PLAYER_RADIUS)) {
      return { x: clamp(nx, -WORLD_BOUND + PLAYER_RADIUS, WORLD_BOUND - PLAYER_RADIUS), z: clamp(nz, -WORLD_BOUND + PLAYER_RADIUS, WORLD_BOUND - PLAYER_RADIUS) };
    }
  }

  return { x: 0, z: 30 };
}

export class WorldSim {
  private readonly players = new Map<string, PlayerState>();
  private readonly inputs = new Map<string, InputState>();
  private tickCount = 0;

  private collidesWithPlayer(x: number, z: number, excludeId?: string): boolean {
    const minDist = PLAYER_RADIUS * 2;
    const minDistSq = minDist * minDist;
    for (const other of this.players.values()) {
      if (excludeId && other.id === excludeId) {
        continue;
      }
      const dx = x - other.x;
      const dz = z - other.z;
      if (dx * dx + dz * dz < minDistSq) {
        return true;
      }
    }
    return false;
  }

  private canOccupy(x: number, z: number, excludeId?: string): boolean {
    return !collidesWithObstacle(x, z, PLAYER_RADIUS) && !this.collidesWithPlayer(x, z, excludeId);
  }

  private findSafeSpawnFor(id: string, desiredX: number, desiredZ: number): { x: number; z: number } {
    const clampedX = clamp(desiredX, -WORLD_BOUND + PLAYER_RADIUS, WORLD_BOUND - PLAYER_RADIUS);
    const clampedZ = clamp(desiredZ, -WORLD_BOUND + PLAYER_RADIUS, WORLD_BOUND - PLAYER_RADIUS);
    if (this.canOccupy(clampedX, clampedZ, id)) {
      return { x: clampedX, z: clampedZ };
    }

    const fallback = findSafeSpawn(clampedX, clampedZ);
    if (this.canOccupy(fallback.x, fallback.z, id)) {
      return fallback;
    }

    for (let ring = 1; ring <= 28; ring += 1) {
      const samples = 12 + ring * 2;
      for (let i = 0; i < samples; i += 1) {
        const angle = (i / samples) * Math.PI * 2;
        const radius = ring * 3.3;
        const x = clamp(clampedX + Math.cos(angle) * radius, -WORLD_BOUND + PLAYER_RADIUS, WORLD_BOUND - PLAYER_RADIUS);
        const z = clamp(clampedZ + Math.sin(angle) * radius, -WORLD_BOUND + PLAYER_RADIUS, WORLD_BOUND - PLAYER_RADIUS);
        if (this.canOccupy(x, z, id)) {
          return { x, z };
        }
      }
    }

    const guaranteedOpen: Array<{ x: number; z: number }> = [...HUMAN_SPAWNS, ...SECTION_SPAWNS];
    for (const candidate of guaranteedOpen) {
      if (this.canOccupy(candidate.x, candidate.z, id)) {
        return candidate;
      }
    }

    return { x: 0, z: 30 };
  }

  joinPlayer(id: string): void {
    const hash = hashId(id);
    const isAgent = id.startsWith('agent');
    const section = SECTION_SPAWNS[hash % SECTION_SPAWNS.length] ?? { x: 0, z: 0 };
    const jitterX = ((hash >> 8) % 20) - 10;
    const jitterZ = ((hash >> 16) % 20) - 10;

    const humanSpawn = HUMAN_SPAWNS[hash % HUMAN_SPAWNS.length] ?? { x: 0, z: 30 };
    const desiredX = isAgent ? section.x + jitterX : humanSpawn.x;
    const desiredZ = isAgent ? section.z + jitterZ : humanSpawn.z;
    const safe = this.findSafeSpawnFor(id, desiredX, desiredZ);

    this.players.set(id, {
      id,
      x: safe.x,
      z: safe.z,
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

  setPlayerPositionForTest(id: string, x: number, z: number): void {
    const player = this.players.get(id);
    if (!player) {
      return;
    }
    player.x = clamp(x, -WORLD_BOUND + PLAYER_RADIUS, WORLD_BOUND - PLAYER_RADIUS);
    player.z = clamp(z, -WORLD_BOUND + PLAYER_RADIUS, WORLD_BOUND - PLAYER_RADIUS);
    player.vx = 0;
    player.vz = 0;
  }

  step(dtSeconds: number): WorldSnapshot {
    this.tickCount += 1;
    const allPlayers = [...this.players.values()];

    for (const player of allPlayers) {
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

      // Predictive avoidance keeps movement smoother than pure post-collision correction.
      let avoidX = 0;
      let avoidZ = 0;
      for (const other of allPlayers) {
        if (other.id === player.id) {
          continue;
        }
        const dx = player.x - other.x;
        const dz = player.z - other.z;
        const distSq = dx * dx + dz * dz;
        if (distSq < 0.0001 || distSq > AVOIDANCE_RADIUS * AVOIDANCE_RADIUS) {
          continue;
        }
        const dist = Math.sqrt(distSq);
        const weight = (AVOIDANCE_RADIUS - dist) / AVOIDANCE_RADIUS;
        avoidX += (dx / dist) * weight;
        avoidZ += (dz / dist) * weight;
      }
      for (const obstacle of STATIC_OBSTACLES) {
        const nearX = clamp(player.x, obstacle.minX, obstacle.maxX);
        const nearZ = clamp(player.z, obstacle.minZ, obstacle.maxZ);
        const dx = player.x - nearX;
        const dz = player.z - nearZ;
        const distSq = dx * dx + dz * dz;
        const range = PLAYER_RADIUS + OBSTACLE_BUFFER;
        if (distSq < 0.0001 || distSq > range * range) {
          continue;
        }
        const dist = Math.sqrt(distSq);
        const weight = (range - dist) / range;
        avoidX += (dx / dist) * weight * 1.35;
        avoidZ += (dz / dist) * weight * 1.35;
      }
      const avoidMag = Math.hypot(avoidX, avoidZ);
      if (avoidMag > 0.0001) {
        player.vx += (avoidX / avoidMag) * AVOIDANCE_ACCEL * dtSeconds;
        player.vz += (avoidZ / avoidMag) * AVOIDANCE_ACCEL * dtSeconds;
      }

      const speed = Math.hypot(player.vx, player.vz);
      if (speed > MAX_SPEED) {
        player.vx = (player.vx / speed) * MAX_SPEED;
        player.vz = (player.vz / speed) * MAX_SPEED;
      }

      const nextX = clamp(player.x + player.vx * dtSeconds, -WORLD_BOUND + PLAYER_RADIUS, WORLD_BOUND - PLAYER_RADIUS);
      if (!collidesWithObstacle(nextX, player.z, PLAYER_RADIUS)) {
        player.x = nextX;
      } else {
        player.vx *= -0.08;
      }

      const nextZ = clamp(player.z + player.vz * dtSeconds, -WORLD_BOUND + PLAYER_RADIUS, WORLD_BOUND - PLAYER_RADIUS);
      if (!collidesWithObstacle(player.x, nextZ, PLAYER_RADIUS)) {
        player.z = nextZ;
      } else {
        player.vz *= -0.08;
      }

      const postSpeed = Math.hypot(player.vx, player.vz);
      if (postSpeed > 0.01) {
        player.yaw = Math.atan2(player.vx, player.vz);
      }
    }

    for (let i = 0; i < allPlayers.length; i += 1) {
      for (let j = i + 1; j < allPlayers.length; j += 1) {
        const a = allPlayers[i];
        const b = allPlayers[j];
        if (!a || !b) {
          continue;
        }

        let dx = b.x - a.x;
        let dz = b.z - a.z;
        let dist = Math.hypot(dx, dz);
        const minDist = PLAYER_RADIUS * 2;

        if (dist >= minDist) {
          continue;
        }

        if (dist < 0.0001) {
          const angle = ((hashId(a.id) + hashId(b.id)) % 360) * (Math.PI / 180);
          dx = Math.cos(angle);
          dz = Math.sin(angle);
          dist = 1;
        }

        const overlap = minDist - dist;
        const nx = dx / dist;
        const nz = dz / dist;
        const push = overlap * 0.5;

        const nextAX = clamp(a.x - nx * push, -WORLD_BOUND + PLAYER_RADIUS, WORLD_BOUND - PLAYER_RADIUS);
        const nextAZ = clamp(a.z - nz * push, -WORLD_BOUND + PLAYER_RADIUS, WORLD_BOUND - PLAYER_RADIUS);
        if (!collidesWithObstacle(nextAX, nextAZ, PLAYER_RADIUS)) {
          a.x = nextAX;
          a.z = nextAZ;
        }

        const nextBX = clamp(b.x + nx * push, -WORLD_BOUND + PLAYER_RADIUS, WORLD_BOUND - PLAYER_RADIUS);
        const nextBZ = clamp(b.z + nz * push, -WORLD_BOUND + PLAYER_RADIUS, WORLD_BOUND - PLAYER_RADIUS);
        if (!collidesWithObstacle(nextBX, nextBZ, PLAYER_RADIUS)) {
          b.x = nextBX;
          b.z = nextBZ;
        }

        a.vx *= 0.9;
        a.vz *= 0.9;
        b.vx *= 0.9;
        b.vz *= 0.9;
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
