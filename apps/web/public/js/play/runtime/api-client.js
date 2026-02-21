export function createApiJsonClient() {
  function buildSessionHeaders(existingHeaders) {
    return new Headers(existingHeaders || {});
  }

  async function apiJson(path, init = {}) {
    const response = await fetch(path, {
      credentials: 'include',
      ...init,
      headers: buildSessionHeaders(init.headers)
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const reason = String(payload?.reason || `http_${response.status}`);
      const error = new Error(reason);
      error.status = Number(response.status || 0);
      error.reason = reason;
      const retryAfter = response.headers.get('retry-after');
      if (retryAfter) {
        const asSeconds = Number(retryAfter);
        if (Number.isFinite(asSeconds) && asSeconds > 0) {
          error.retryAfterMs = Math.max(1_000, Math.floor(asSeconds * 1_000));
        } else {
          const retryAt = Date.parse(retryAfter);
          if (Number.isFinite(retryAt)) {
            error.retryAfterMs = Math.max(1_000, retryAt - Date.now());
          }
        }
      }
      throw error;
    }
    return payload;
  }

  return {
    buildSessionHeaders,
    apiJson
  };
}
