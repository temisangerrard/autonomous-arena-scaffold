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
      throw new Error(String(payload?.reason || `http_${response.status}`));
    }
    return payload;
  }

  return {
    buildSessionHeaders,
    apiJson
  };
}
