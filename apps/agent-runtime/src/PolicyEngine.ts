export type Personality = 'aggressive' | 'conservative' | 'social';

export type AgentPlayerState = {
  id: string;
  x: number;
  z: number;
};

export type PolicyContext = {
  self: AgentPlayerState;
  others: AgentPlayerState[];
  nearbyIds: string[];
  nowMs: number;
  patrolSection?: number;
  patrolRadius?: number;
};

export type PolicyMemory = {
  seed: number;
  roamTargetIndex?: number;
  roamTargetX?: number;
  roamTargetZ?: number;
  roamTargetUntilMs?: number;
};

export type PolicyDecision = {
  moveX: number;
  moveZ: number;
  focusId: string | null;
};

function normalize(x: number, z: number): { x: number; z: number } {
  const length = Math.hypot(x, z);
  if (length < 0.0001) {
    return { x: 0, z: 0 };
  }
  return { x: x / length, z: z / length };
}

function stableNoise(seed: number, bucket: number): number {
  const value = Math.sin(seed * 12.9898 + bucket * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function wanderDirection(memory: PolicyMemory, nowMs: number): { x: number; z: number } {
  const bucket = Math.floor(nowMs / 3000);
  const angle = stableNoise(memory.seed, bucket) * Math.PI * 2;
  return {
    x: Math.cos(angle),
    z: Math.sin(angle)
  };
}

function nearest(self: AgentPlayerState, others: AgentPlayerState[]): { target: AgentPlayerState; distance: number } | null {
  let best: { target: AgentPlayerState; distance: number } | null = null;

  for (const candidate of others) {
    const distance = Math.hypot(candidate.x - self.x, candidate.z - self.z);
    if (!best || distance < best.distance) {
      best = { target: candidate, distance };
    }
  }

  return best;
}

// Roam points moved to central, asset-rich areas (near train, castle, trees)
// instead of world edges where there are no assets.
const ROAM_POINTS: Array<{ x: number; z: number }> = [
  // Near the train (center area)
  { x: 0, z: 0 },
  { x: -15, z: 5 },
  { x: 15, z: -5 },
  // Near the castle (north-west)
  { x: -20, z: -45 },
  { x: -10, z: -35 },
  { x: -30, z: -40 },
  // Near the giant tree (north-east)
  { x: 75, z: -35 },
  { x: 85, z: -25 },
  { x: 65, z: -45 },
  // Near the logs (south-east)
  { x: 85, z: 55 },
  { x: 95, z: 65 },
  { x: 75, z: 60 },
  // Near the stump (north-west corner)
  { x: -85, z: -55 },
  { x: -95, z: -50 },
  // Central plaza areas
  { x: 25, z: 25 },
  { x: -25, z: -25 },
  { x: 30, z: -30 }
];

function crowdAvoidance(self: AgentPlayerState, others: AgentPlayerState[], radius = 9): { x: number; z: number } {
  let avoidX = 0;
  let avoidZ = 0;
  const radiusSq = radius * radius;
  for (const other of others) {
    const dx = self.x - other.x;
    const dz = self.z - other.z;
    const distSq = dx * dx + dz * dz;
    if (distSq < 0.0001 || distSq > radiusSq) {
      continue;
    }
    const dist = Math.sqrt(distSq);
    const weight = (radius - dist) / radius;
    avoidX += (dx / dist) * weight;
    avoidZ += (dz / dist) * weight;
  }
  return normalize(avoidX, avoidZ);
}

function roamDirection(self: AgentPlayerState, memory: PolicyMemory, nowMs: number): { x: number; z: number } {
  const ttl = memory.roamTargetUntilMs ?? 0;
  const currentIndex = memory.roamTargetIndex ?? (memory.seed % ROAM_POINTS.length);

  let nextIndex = currentIndex;
  if (nowMs >= ttl) {
    const step = Math.floor(stableNoise(memory.seed, Math.floor(nowMs / 5000)) * 5) + 1;
    nextIndex = (currentIndex + step) % ROAM_POINTS.length;
    memory.roamTargetIndex = nextIndex;
    memory.roamTargetUntilMs = nowMs + 7_000 + Math.floor(stableNoise(memory.seed, step + nextIndex) * 9_000);
  }

  const point = ROAM_POINTS[nextIndex] ?? { x: 0, z: 0 };
  const towardPoint = normalize(point.x - self.x, point.z - self.z);
  const wander = wanderDirection(memory, nowMs);
  return normalize(towardPoint.x * 0.72 + wander.x * 0.28, towardPoint.z * 0.72 + wander.z * 0.28);
}

// Section centers moved closer to central assets instead of world edges.
// These are used for patrol-section behavior when bots are assigned to specific areas.
const SECTION_CENTERS: Array<{ x: number; z: number }> = [
  // North-west (near castle/stump)
  { x: -35, z: -40 },
  // North-central (near train front)
  { x: 0, z: -25 },
  // North-east (near giant tree)
  { x: 70, z: -35 },
  // Central-east
  { x: 45, z: 0 },
  // South-west
  { x: -35, z: 35 },
  // South-central (near train back)
  { x: 0, z: 25 },
  // South-east (near logs)
  { x: 80, z: 55 },
  // Central-west
  { x: -50, z: 0 }
];

function sectionRoamDirection(
  self: AgentPlayerState,
  memory: PolicyMemory,
  nowMs: number,
  sectionIndex: number,
  patrolRadius: number
): { x: number; z: number } {
  const safeSection = SECTION_CENTERS[((sectionIndex % SECTION_CENTERS.length) + SECTION_CENTERS.length) % SECTION_CENTERS.length] ?? { x: 0, z: 0 };
  const ttl = memory.roamTargetUntilMs ?? 0;
  if (nowMs >= ttl || typeof memory.roamTargetX !== 'number' || typeof memory.roamTargetZ !== 'number') {
    const bucket = Math.floor(nowMs / 4200);
    const angle = stableNoise(memory.seed + sectionIndex * 101, bucket) * Math.PI * 2;
    const radius = Math.max(10, Math.min(44, patrolRadius)) * (0.35 + stableNoise(memory.seed + 7, bucket + 11) * 0.65);
    memory.roamTargetX = safeSection.x + Math.cos(angle) * radius;
    memory.roamTargetZ = safeSection.z + Math.sin(angle) * radius;
    memory.roamTargetUntilMs = nowMs + 5_500 + Math.floor(stableNoise(memory.seed, bucket + sectionIndex) * 6_500);
  }

  const towardTarget = normalize((memory.roamTargetX ?? safeSection.x) - self.x, (memory.roamTargetZ ?? safeSection.z) - self.z);
  const towardSection = normalize(safeSection.x - self.x, safeSection.z - self.z);
  const wander = wanderDirection(memory, nowMs);
  return normalize(
    towardTarget.x * 0.58 + towardSection.x * 0.24 + wander.x * 0.18,
    towardTarget.z * 0.58 + towardSection.z * 0.24 + wander.z * 0.18
  );
}

export class PolicyEngine {
  decide(personality: Personality, context: PolicyContext, memory: PolicyMemory): PolicyDecision {
    const nearestResult = nearest(context.self, context.others);
    const roam =
      typeof context.patrolSection === 'number'
        ? sectionRoamDirection(
            context.self,
            memory,
            context.nowMs,
            context.patrolSection,
            context.patrolRadius ?? 28
          )
        : roamDirection(context.self, memory, context.nowMs);
    const spacing = crowdAvoidance(context.self, context.others);

    const blend = (baseX: number, baseZ: number): { x: number; z: number } =>
      normalize(baseX * 0.84 + spacing.x * 0.16, baseZ * 0.84 + spacing.z * 0.16);

    if (!nearestResult) {
      const move = blend(roam.x, roam.z);
      return { moveX: move.x, moveZ: move.z, focusId: null };
    }

    const dx = nearestResult.target.x - context.self.x;
    const dz = nearestResult.target.z - context.self.z;
    const toward = normalize(dx, dz);
    const away = normalize(-dx, -dz);

    if (personality === 'aggressive') {
      if (nearestResult.distance > 18) {
        const move = blend(roam.x, roam.z);
        return { moveX: move.x, moveZ: move.z, focusId: null };
      }
      const move = blend(toward.x, toward.z);
      return {
        moveX: move.x,
        moveZ: move.z,
        focusId: nearestResult.target.id
      };
    }

    if (personality === 'conservative') {
      if (nearestResult.distance < 8 || context.nearbyIds.includes(nearestResult.target.id)) {
        const move = blend(away.x, away.z);
        return {
          moveX: move.x,
          moveZ: move.z,
          focusId: nearestResult.target.id
        };
      }

      const norm = blend(roam.x * 0.85 + toward.x * 0.15, roam.z * 0.85 + toward.z * 0.15);
      return { moveX: norm.x, moveZ: norm.z, focusId: null };
    }

    const strafeSign = stableNoise(memory.seed, Math.floor(context.nowMs / 2000)) > 0.5 ? 1 : -1;
    const strafe = normalize(-toward.z * strafeSign, toward.x * strafeSign);

    if (nearestResult.distance > 4.5) {
      if (nearestResult.distance > 16) {
        const move = blend(roam.x, roam.z);
        return {
          moveX: move.x,
          moveZ: move.z,
          focusId: null
        };
      }
      const move = blend(toward.x, toward.z);
      return {
        moveX: move.x,
        moveZ: move.z,
        focusId: nearestResult.target.id
      };
    }

    const move = blend(strafe.x, strafe.z);
    return {
      moveX: move.x,
      moveZ: move.z,
      focusId: nearestResult.target.id
    };
  }
}
