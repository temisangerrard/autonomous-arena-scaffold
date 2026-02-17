// Re-export types
export * from './types/index.js';

export const SERVICE_NAMES = ['server', 'agent-runtime', 'web'] as const;

export type ServiceName = (typeof SERVICE_NAMES)[number];

export type HealthStatus = {
  ok: true;
  service: ServiceName;
  timestamp: string;
};

export * from './wsAuth.js';
export * from './escrowApprovalPolicy.js';
