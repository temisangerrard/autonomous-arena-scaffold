import { handleRuntimeRequest, handleRuntimeScheduled, type RuntimeEnv } from './runtimeState.js';
import { handleWebApi, type WebApiEnv } from './webApi.js';

type ScheduledControllerLike = unknown;

type Env = RuntimeEnv & WebApiEnv & {
  WEB_UPSTREAM?: string;
  SERVER_UPSTREAM?: string;
  INTERNAL_SERVICE_TOKEN?: string;
};

type UpstreamHealth = {
  ok: boolean;
  status: number;
  url: string;
};

function normalizeOrigin(value: string | undefined): string {
  return String(value || '').trim().replace(/\/+$/, '');
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

function buildUpstreamUrl(origin: string, pathWithQuery: string): URL {
  return new URL(`${origin}${pathWithQuery.startsWith('/') ? pathWithQuery : `/${pathWithQuery}`}`);
}

async function probe(url: string, headers?: HeadersInit): Promise<UpstreamHealth> {
  try {
    const response = await fetch(url, { method: 'GET', headers });
    return { ok: response.ok, status: response.status, url };
  } catch {
    return { ok: false, status: 0, url };
  }
}

async function proxyRequest(request: Request, target: URL, init?: { internalToken?: string }): Promise<Response> {
  const headers = new Headers(request.headers);
  headers.set('x-forwarded-host', new URL(request.url).host);
  headers.set('x-forwarded-proto', 'https');
  if (init?.internalToken && !headers.has('x-internal-token')) {
    headers.set('x-internal-token', init.internalToken);
  }
  return fetch(new Request(target.toString(), {
    method: request.method,
    headers,
    body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
    redirect: 'manual',
  }));
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const webOrigin = normalizeOrigin(env.WEB_UPSTREAM);

    if (url.pathname === '/health') {
      const web = webOrigin
        ? await probe(`${webOrigin}/health`)
        : { ok: true, status: 200, url: 'worker:web-api' };
      const server = normalizeOrigin(env.SERVER_UPSTREAM)
        ? await probe(`${normalizeOrigin(env.SERVER_UPSTREAM)}/health`, env.INTERNAL_SERVICE_TOKEN ? { 'x-internal-token': env.INTERNAL_SERVICE_TOKEN } : undefined)
        : { ok: false, status: 0, url: 'unconfigured:server' };
      const runtime = {
        ok: Boolean(env.STATE_DB),
        status: env.STATE_DB ? 200 : 503,
        url: 'worker:d1-runtime',
      };
      const overallOk = web.ok && runtime.ok && server.ok;
      return json({
        ok: overallOk,
        backend: 'cloudflare-worker',
        deps: {
          web,
          server,
          runtime,
        },
      }, overallOk ? 200 : 503);
    }

    if (url.pathname.startsWith('/runtime/')) {
      const handled = await handleRuntimeRequest(request, env, url.pathname);
      if (handled) return handled;
      return json({ ok: false, reason: 'runtime_not_found' }, 404);
    }

    if (url.pathname.startsWith('/api/')) {
      const handled = await handleWebApi(request, env, url.pathname);
      if (handled) return handled;
    }

    if (url.pathname === '/status') {
      return json({ ok: true, backend: 'cloudflare-worker', runtime: 'worker:d1-runtime' });
    }

    return json({ ok: false, reason: 'not_found' }, 404);
  },

  async scheduled(_controller: ScheduledControllerLike, env: Env): Promise<void> {
    await handleRuntimeScheduled(env);
  },
};

export default worker;
