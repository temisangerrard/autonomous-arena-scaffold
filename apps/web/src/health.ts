import type { HealthStatus } from '@arena/shared';

export function createHealthStatus(): HealthStatus {
  return {
    ok: true,
    service: 'web',
    timestamp: new Date().toISOString()
  };
}
