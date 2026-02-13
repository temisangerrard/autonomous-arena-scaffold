import type { HealthStatus } from '@arena/shared';

export function createHealthStatus(): HealthStatus {
  return {
    ok: true,
    service: 'agent-runtime',
    timestamp: new Date().toISOString()
  };
}
