import type { IdentityRecord } from '../sessionStore.js';

export type Chief2Intent =
  | 'status_explain'
  | 'runtime_ops'
  | 'user_admin'
  | 'market_ops'
  | 'unknown';

export type Chief2ActionStatus = 'planned' | 'executed' | 'blocked';

export type Chief2Action = {
  tool: string;
  status: Chief2ActionStatus;
  summary: string;
};

export type Chief2EventType = 'plan' | 'tool_call' | 'tool_result' | 'blocked' | 'fallback' | 'done';

export type Chief2Event = {
  type: Chief2EventType;
  at: number;
  tool?: string;
  message: string;
};

export type Chief2ExecutionGraph = {
  objective: string;
  steps: Array<{
    tool: string;
    status: 'planned' | 'executed' | 'blocked' | 'fallback';
    summary: string;
  }>;
  stopReason: 'completed' | 'blocked' | 'fallback';
};

export type Chief2CommandRequest = {
  message?: string;
  confirmToken?: string;
  context?: Record<string, unknown>;
};

export type Chief2CommandResponse = {
  ok: boolean;
  reply: string;
  intent: Chief2Intent;
  actions: Chief2Action[];
  executionGraph: Chief2ExecutionGraph;
  requiresConfirmation: boolean;
  confirmToken?: string;
  traceId: string;
  sessionId: string;
  stateSnapshot?: Record<string, unknown>;
  events: Chief2Event[];
};

export type Chief2Runbook = {
  id: string;
  title: string;
  description: string;
  safety: 'read_only' | 'mutating' | 'financial';
};

export type Chief2Incident = {
  id: string;
  at: number;
  severity: 'low' | 'medium' | 'high';
  title: string;
  detail: string;
  status: 'open' | 'resolved';
  traceId?: string;
};

export type Chief2Telemetry = {
  totalCommands: number;
  nonEmptyReplyCount: number;
  toolExecutionCount: number;
  confirmationRequestedCount: number;
  confirmationCompletedCount: number;
  failures: Record<string, number>;
};

export type Chief2Session = {
  id: string;
  ownerSub: string;
  createdAt: number;
  updatedAt: number;
};

export type Chief2TurnRecord = {
  at: number;
  traceId: string;
  sessionId: string;
  ownerSub: string;
  message: string;
  intent: Chief2Intent;
  actions: Chief2Action[];
  reply: string;
  executionGraph: Chief2ExecutionGraph;
};

export type Chief2Identity = IdentityRecord;

export type Chief2Deps = {
  runtimeGet: <T>(pathname: string) => Promise<T>;
  runtimePost: <T>(pathname: string, body: unknown) => Promise<T>;
  serverGet: <T>(pathname: string) => Promise<T>;
  serverPost: <T>(pathname: string, body: unknown) => Promise<T>;
  log: {
    info: (obj: Record<string, unknown> | string, msg?: string) => void;
    warn: (obj: Record<string, unknown> | string, msg?: string) => void;
    error: (obj: Record<string, unknown> | string, msg?: string) => void;
  };
  adminActions: {
    userTeleport: (params: { profileId: string; section?: number; x?: number; z?: number }) => Promise<unknown>;
    userWalletAdjust: (params: { profileId: string; direction: 'credit' | 'debit'; amount: number; reason: string }) => Promise<unknown>;
    userLogout: (params: { profileId: string }) => Promise<unknown>;
  };
};
