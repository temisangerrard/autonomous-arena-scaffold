import { readJsonBody, sendJson } from '../../lib/http.js';
import type { RouteHandler } from '../types.js';

export const handleChiefRoutes: RouteHandler = async (req, res, requestUrl, context) => {
  const pathname = requestUrl.pathname;

  if (pathname === '/api/chief/v1/heartbeat') {
    const heartbeat = await context.chiefService.heartbeat();
    sendJson(res, {
      service: 'chief',
      timestamp: new Date().toISOString(),
      ...heartbeat
    }, heartbeat.ok ? 200 : 503);
    return true;
  }

  if (pathname === '/api/chief/v1/skills' && req.method === 'GET') {
    const auth = await context.requireRole(req, ['admin']);
    if (!auth.ok) {
      sendJson(res, { ok: false, reason: 'forbidden' }, 403);
      return true;
    }
    sendJson(res, { ok: true, skills: await context.chiefService.listSkills() });
    return true;
  }

  if (pathname === '/api/chief/v1/runbooks' && req.method === 'GET') {
    const auth = await context.requireRole(req, ['admin']);
    if (!auth.ok) {
      sendJson(res, { ok: false, reason: 'forbidden' }, 403);
      return true;
    }
    sendJson(res, { ok: true, runbooks: context.chiefService.listRunbooks() });
    return true;
  }

  if (pathname === '/api/chief/v1/ops/state' && req.method === 'GET') {
    const auth = await context.requireRole(req, ['admin']);
    if (!auth.ok) {
      sendJson(res, { ok: false, reason: 'forbidden' }, 403);
      return true;
    }
    sendJson(res, { ok: true, state: await context.chiefService.getOpsState(auth.identity) });
    return true;
  }

  if (pathname === '/api/admin/chief/workspace/bootstrap' && req.method === 'GET') {
    const auth = await context.requireRole(req, ['admin']);
    if (!auth.ok) {
      sendJson(res, { ok: false, reason: 'forbidden' }, 403);
      return true;
    }
    sendJson(res, await context.chief2Service.bootstrap());
    return true;
  }

  if (pathname === '/api/admin/chief/workspace/incidents' && req.method === 'GET') {
    const auth = await context.requireRole(req, ['admin']);
    if (!auth.ok) {
      sendJson(res, { ok: false, reason: 'forbidden' }, 403);
      return true;
    }
    const limit = Math.max(1, Math.min(200, Number(requestUrl.searchParams.get('limit') || 80)));
    sendJson(res, { ok: true, incidents: context.chief2Service.listIncidents(limit) });
    return true;
  }

  if (pathname === '/api/admin/chief/workspace/runbooks' && req.method === 'GET') {
    const auth = await context.requireRole(req, ['admin']);
    if (!auth.ok) {
      sendJson(res, { ok: false, reason: 'forbidden' }, 403);
      return true;
    }
    sendJson(res, { ok: true, runbooks: context.chief2Service.listRunbooks() });
    return true;
  }

  if (pathname === '/api/admin/chief/workspace/command' && req.method === 'POST') {
    const auth = await context.requireRole(req, ['admin']);
    if (!auth.ok) {
      sendJson(res, { ok: false, reason: 'forbidden' }, 403);
      return true;
    }
    const body = await readJsonBody<{ message?: string; confirmToken?: string; context?: Record<string, unknown> }>(req);
    if (!body) {
      sendJson(res, { ok: false, reason: 'invalid_json' }, 400);
      return true;
    }
    const payload = await context.chief2Service.command(auth.identity, body);
    sendJson(res, payload, payload.ok ? 200 : 400);
    return true;
  }

  if (pathname === '/api/ops/runtime-sponsorship' && req.method === 'GET') {
    const auth = await context.requireRole(req, ['admin']);
    if (!auth.ok) {
      sendJson(res, { ok: false, reason: 'forbidden' }, 403);
      return true;
    }
    try {
      const runtime = await context.runtimeGet<any>('/status');
      sendJson(res, {
        ok: true,
        runtime: {
          wsAuthMismatchLikely: Boolean(runtime?.wsAuthMismatchLikely),
          connectedBotCount: Number(runtime?.connectedBotCount || 0),
          configuredBotCount: Number(runtime?.configuredBotCount || 0),
          houseWalletId: String(runtime?.house?.wallet?.id || ''),
          houseWalletBalance: Number(runtime?.house?.wallet?.balance || 0),
          samplePlayerWalletId: String(runtime?.profiles?.find((entry: any) => String(entry?.walletId || '').length > 0)?.walletId || '')
        }
      });
    } catch (error) {
      sendJson(res, {
        ok: false,
        reason: 'runtime_unavailable',
        detail: String((error as Error)?.message || 'unknown')
      }, 503);
    }
    return true;
  }

  return false;
};

