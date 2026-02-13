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
};

export type PolicyMemory = {
  seed: number;
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

export class PolicyEngine {
  decide(personality: Personality, context: PolicyContext, memory: PolicyMemory): PolicyDecision {
    const nearestResult = nearest(context.self, context.others);

    if (!nearestResult) {
      const wander = wanderDirection(memory, context.nowMs);
      const norm = normalize(wander.x, wander.z);
      return { moveX: norm.x, moveZ: norm.z, focusId: null };
    }

    const dx = nearestResult.target.x - context.self.x;
    const dz = nearestResult.target.z - context.self.z;
    const toward = normalize(dx, dz);
    const away = normalize(-dx, -dz);

    if (personality === 'aggressive') {
      return {
        moveX: toward.x,
        moveZ: toward.z,
        focusId: nearestResult.target.id
      };
    }

    if (personality === 'conservative') {
      if (nearestResult.distance < 8 || context.nearbyIds.includes(nearestResult.target.id)) {
        return {
          moveX: away.x,
          moveZ: away.z,
          focusId: nearestResult.target.id
        };
      }

      const wander = wanderDirection(memory, context.nowMs);
      const norm = normalize(wander.x * 0.7 + toward.x * 0.3, wander.z * 0.7 + toward.z * 0.3);
      return { moveX: norm.x, moveZ: norm.z, focusId: null };
    }

    const strafeSign = stableNoise(memory.seed, Math.floor(context.nowMs / 2000)) > 0.5 ? 1 : -1;
    const strafe = normalize(-toward.z * strafeSign, toward.x * strafeSign);

    if (nearestResult.distance > 4.5) {
      return {
        moveX: toward.x,
        moveZ: toward.z,
        focusId: nearestResult.target.id
      };
    }

    return {
      moveX: strafe.x,
      moveZ: strafe.z,
      focusId: nearestResult.target.id
    };
  }
}
