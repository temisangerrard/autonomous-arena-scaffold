import { readJsonBody, sendJson, type SimpleRouter } from '../lib/http.js';

export function registerHouseRoutes(router: SimpleRouter, deps: {
  isInternalAuthorized: (req: import('node:http').IncomingMessage) => boolean;
  runtimeStatus: () => { house: unknown };
  ensureSeedBalances: () => void;
  schedulePersistState: () => void;
  transferFromHouse: (toWalletId: string, amount: number, reason: string) => { ok: true; amount: number } | { ok: false; reason: string };
  refillHouse: (amount: number, reason: string) => { ok: true; amount: number } | { ok: false; reason: string };
  setOwnerOnline: (profileId: string, ttlMs: number) => void;
  setOwnerOffline: (profileId: string) => void;
  ownerPresence: Map<string, { until: number }>;
  getHouseConfig: () => { npcWalletFloor: number; npcWalletTopupAmount: number; superAgentWalletFloor: number };
  setHouseConfig: (patch: { npcWalletFloor?: number; npcWalletTopupAmount?: number; superAgentWalletFloor?: number }) => void;
}) {
  router.get('/house/status', (_req, res) => {
    sendJson(res, { ok: true, house: deps.runtimeStatus().house });
  });

  router.post('/house/config', async (req, res) => {
    if (!deps.isInternalAuthorized(req)) {
      sendJson(res, { ok: false, reason: 'unauthorized_internal' }, 401);
      return;
    }
    const body = await readJsonBody<{ npcWalletFloor?: number; npcWalletTopupAmount?: number; superAgentWalletFloor?: number }>(req);
    if (!body) {
      sendJson(res, { ok: false, reason: 'invalid_json' }, 400);
      return;
    }
    deps.setHouseConfig(body);
    deps.ensureSeedBalances();
    deps.schedulePersistState();
    sendJson(res, { ok: true, house: deps.runtimeStatus().house });
  });

  router.post('/house/transfer', async (req, res) => {
    if (!deps.isInternalAuthorized(req)) {
      sendJson(res, { ok: false, reason: 'unauthorized_internal' }, 401);
      return;
    }
    const body = await readJsonBody<{ toWalletId?: string; amount?: number; reason?: string }>(req);
    const toWalletId = String(body?.toWalletId ?? '').trim();
    const amount = Math.max(0, Number(body?.amount ?? 0));
    const reason = String(body?.reason ?? 'admin_transfer').trim() || 'admin_transfer';
    if (!toWalletId || amount <= 0) {
      sendJson(res, { ok: false, reason: 'invalid_transfer_payload' }, 400);
      return;
    }
    const result = deps.transferFromHouse(toWalletId, amount, reason);
    if (!result.ok) {
      sendJson(res, result, 400);
      return;
    }
    sendJson(res, { ok: true, transferred: result.amount, house: deps.runtimeStatus().house });
  });

  router.post('/house/refill', async (req, res) => {
    if (!deps.isInternalAuthorized(req)) {
      sendJson(res, { ok: false, reason: 'unauthorized_internal' }, 401);
      return;
    }
    const body = await readJsonBody<{ amount?: number; reason?: string }>(req);
    const amount = Math.max(0, Number(body?.amount ?? 0));
    const reason = String(body?.reason ?? 'admin_refill').trim() || 'admin_refill';
    if (amount <= 0) {
      sendJson(res, { ok: false, reason: 'invalid_amount' }, 400);
      return;
    }
    const result = deps.refillHouse(amount, reason);
    if (!result.ok) {
      sendJson(res, result, 400);
      return;
    }
    sendJson(res, { ok: true, refilled: result.amount, house: deps.runtimeStatus().house });
  });

  router.post('/owners/:profileId/presence', async (req, res, params) => {
    if (!deps.isInternalAuthorized(req)) {
      sendJson(res, { ok: false, reason: 'unauthorized_internal' }, 401);
      return;
    }
    const profileId = String(params?.profileId ?? '').trim();
    if (!profileId) {
      sendJson(res, { ok: false, reason: 'profile_required' }, 400);
      return;
    }
    const body = await readJsonBody<{ state?: 'online' | 'offline'; ttlMs?: number }>(req);
    const state = body?.state === 'offline' ? 'offline' : 'online';
    if (state === 'online') {
      deps.setOwnerOnline(profileId, Number(body?.ttlMs ?? 90_000));
      deps.schedulePersistState();
      sendJson(res, { ok: true, state: 'online', until: deps.ownerPresence.get(profileId)?.until ?? null });
      return;
    }
    deps.setOwnerOffline(profileId);
    deps.schedulePersistState();
    sendJson(res, { ok: true, state: 'offline' });
  });
}

