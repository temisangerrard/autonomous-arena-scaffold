declare module '*request-backoff.js' {
  export function isRequestBackoffActive(
    storage: { getItem?: (key: string) => string | null } | null | undefined,
    key: string,
    now?: number
  ): boolean;

  export function setRequestBackoffFromError(
    storage: { setItem?: (key: string, value: string) => void } | null | undefined,
    key: string,
    error: { status?: number; retryAfterMs?: number } | null | undefined,
    now?: number
  ): number;

  export function clearRequestBackoff(
    storage: { removeItem?: (key: string) => void } | null | undefined,
    key: string
  ): void;
}

declare module '*socket-runtime.js' {
  export function connectSocketRuntime(deps: Record<string, unknown>): Promise<void>;
}
