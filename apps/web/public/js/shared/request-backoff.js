const BACKOFF_PREFIX = 'arena_req_backoff:';

function keyName(key) {
  return `${BACKOFF_PREFIX}${String(key || '').trim()}`;
}

function safeGet(storage, key) {
  if (!storage || typeof storage.getItem !== 'function') return '';
  try {
    return String(storage.getItem(key) || '').trim();
  } catch {
    return '';
  }
}

function safeSet(storage, key, value) {
  if (!storage || typeof storage.setItem !== 'function') return;
  try {
    storage.setItem(key, String(value));
  } catch {
    // ignore storage failures
  }
}

export function isRequestBackoffActive(storage, key, now = Date.now()) {
  const raw = safeGet(storage, keyName(key));
  const until = Number(raw);
  return Number.isFinite(until) && until > now;
}

export function setRequestBackoffFromError(storage, key, error, now = Date.now()) {
  const status = Number(error?.status || 0);
  const retryAfterMs = Number(error?.retryAfterMs || 0);
  let backoffMs = 0;
  if (status === 429) {
    backoffMs = retryAfterMs > 0 ? retryAfterMs : 60_000;
  } else if (status === 503 || status === 502 || status === 504) {
    backoffMs = 30_000;
  }
  if (backoffMs <= 0) return 0;
  const until = now + backoffMs;
  safeSet(storage, keyName(key), until);
  return until;
}

export function clearRequestBackoff(storage, key) {
  if (!storage || typeof storage.removeItem !== 'function') return;
  try {
    storage.removeItem(keyName(key));
  } catch {
    // ignore storage failures
  }
}
