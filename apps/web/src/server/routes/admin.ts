import { rewriteEmailIdentityBindings } from '../../adminWalletRelink.js';
import { readJsonBody, sendJson } from '../../lib/http.js';
import type { RouteHandler } from '../types.js';

export const handleAdminRoutes: RouteHandler = async (req, res, requestUrl, context) => {
  const pathname = requestUrl.pathname;

  if (pathname.startsWith('/api/admin/runtime')) {
    const auth = await context.requireRole(req, ['admin']);
    if (!auth.ok) {
      sendJson(res, { ok: false, reason: 'forbidden' }, 403);
      return true;
    }
    const subpath = pathname.slice('/api/admin/runtime'.length) || '/';
    const allowGet = new Set(['/status', '/super-agent/status', '/super-agent/ethskills', '/house/status', '/onchain/status']);
    const allowPostExact = new Set([
      '/super-agent/config',
      '/capabilities/wallet',
      '/secrets/openrouter',
      '/super-agent/delegate/apply',
      '/super-agent/ethskills/sync',
      '/house/config',
      '/house/transfer',
      '/house/refill',
      '/house/wallet/transfer',
      '/house/treasury/withdraw',
      '/wallets/onchain/prepare-escrow',
      '/profiles/create',
      '/agents/reconcile',
      '/super-agent/chat'
    ]);
    const allowPostRegex = [
      /^\/wallets\/[^/]+\/(fund|withdraw|export-key|transfer)$/i,
      /^\/agents\/[^/]+\/config$/i,
      /^\/profiles\/[^/]+\/bots\/create$/i
    ];

    if (subpath === '/markets' && req.method === 'GET') {
      try {
        sendJson(res, await context.serverGet('/admin/markets'));
      } catch (error) {
        const upstream = context.upstreamErrorJson(error, 'server_unavailable', 400);
        sendJson(res, upstream.body, upstream.status);
      }
      return true;
    }
    if (subpath === '/markets/player-view' && req.method === 'GET') {
      try {
        sendJson(res, await context.serverGet('/admin/markets/player-view'));
      } catch (error) {
        const upstream = context.upstreamErrorJson(error, 'server_unavailable', 400);
        sendJson(res, upstream.body, upstream.status);
      }
      return true;
    }
    if (subpath === '/markets/reconcile' && req.method === 'GET') {
      const includeLegacy = String(requestUrl.searchParams.get('includeLegacy') || '').toLowerCase() === 'true';
      const limit = Math.max(1, Math.min(400, Number(requestUrl.searchParams.get('limit') || 120)));
      try {
        sendJson(res, await context.serverGet(`/admin/markets/reconcile?includeLegacy=${includeLegacy ? 'true' : 'false'}&limit=${limit}`));
      } catch (error) {
        const upstream = context.upstreamErrorJson(error, 'server_unavailable', 400);
        sendJson(res, upstream.body, upstream.status);
      }
      return true;
    }
    if (subpath === '/markets/quote' && req.method === 'POST') {
      const body = await readJsonBody<unknown>(req);
      try {
        sendJson(res, await context.serverPost('/admin/markets/quote', body ?? {}));
      } catch (error) {
        const upstream = context.upstreamErrorJson(error, 'server_request_failed', 400);
        sendJson(res, upstream.body, upstream.status);
      }
      return true;
    }
    if ((subpath === '/markets/refresh'
      || subpath === '/markets/activate'
      || subpath === '/markets/deactivate'
      || subpath === '/markets/config'
      || subpath === '/markets/reconcile/repair')
      && req.method === 'POST') {
      const body = await readJsonBody<unknown>(req);
      try {
        sendJson(res, await context.serverPost(`/admin${subpath}`, body ?? {}));
      } catch (error) {
        const upstream = context.upstreamErrorJson(error, 'server_request_failed', 400);
        sendJson(res, upstream.body, upstream.status);
      }
      return true;
    }

    if (req.method === 'GET') {
      if (!allowGet.has(subpath)) {
        sendJson(res, { ok: false, reason: 'admin_proxy_not_allowed' }, 404);
        return true;
      }
      try {
        sendJson(res, await context.runtimeGet(subpath));
      } catch {
        sendJson(res, { ok: false, reason: 'runtime_unavailable' }, 400);
      }
      return true;
    }
    if (req.method === 'POST') {
      const allowed = allowPostExact.has(subpath) || allowPostRegex.some((re) => re.test(subpath));
      if (!allowed) {
        sendJson(res, { ok: false, reason: 'admin_proxy_not_allowed' }, 404);
        return true;
      }
      const body = await readJsonBody<unknown>(req);
      try {
        sendJson(res, await context.runtimePost(subpath, body ?? {}));
      } catch {
        sendJson(res, { ok: false, reason: 'runtime_request_failed' }, 400);
      }
      return true;
    }
    sendJson(res, { ok: false, reason: 'method_not_allowed' }, 405);
    return true;
  }

  if (pathname === '/api/admin/users') {
    const auth = await context.requireRole(req, ['admin']);
    if (!auth.ok) {
      sendJson(res, { ok: false, reason: 'forbidden' }, 403);
      return true;
    }
    try {
      const [profiles, presencePayload] = await Promise.all([
        context.runtimeProfiles().catch(() => []),
        context.serverGet<{ ok?: boolean; players?: Array<{ playerId: string; serverId: string; x: number; z: number; updatedAt: number }> }>('/presence')
          .catch(() => ({ players: [] }))
      ]);
      const presenceByPlayerId = new Map<string, { serverId: string; x: number; z: number; updatedAt: number }>();
      for (const entry of presencePayload.players ?? []) {
        if (entry?.playerId) {
          presenceByPlayerId.set(entry.playerId, {
            serverId: String(entry.serverId || ''),
            x: Number(entry.x || 0),
            z: Number(entry.z || 0),
            updatedAt: Number(entry.updatedAt || 0)
          });
        }
      }
      const users = await Promise.all(profiles.map(async (profile) => {
        const playerId = `u_${profile.id}`;
        const presence = presenceByPlayerId.get(playerId) ?? null;
        const subs = await context.sessionStore.listSubsForProfile(profile.id).catch(() => []);
        const firstSub = String(subs[0] || '').trim();
        const continuity = firstSub ? await context.runtimeSubjectLink(context.externalSubjectFromSub(firstSub)).catch(() => null) : null;
        return {
          profileId: profile.id,
          playerId,
          username: profile.username,
          displayName: profile.displayName,
          walletId: profile.wallet?.id ?? profile.walletId,
          walletAddress: profile.wallet?.address ?? null,
          walletBalance: Number(profile.wallet?.balance ?? 0),
          online: Boolean(presence),
          serverId: presence?.serverId ?? null,
          x: presence?.x ?? null,
          z: presence?.z ?? null,
          lastSeen: presence?.updatedAt ?? null,
          subjectHash: firstSub ? context.subjectHashForAdmin(firstSub) : null,
          continuitySource: continuity?.continuitySource ?? null
        };
      }));
      sendJson(res, { ok: true, users });
    } catch {
      sendJson(res, { ok: false, reason: 'admin_users_failed' }, 503);
    }
    return true;
  }

  const adminTeleportMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)\/teleport$/);
  if (adminTeleportMatch && req.method === 'POST') {
    const auth = await context.requireRole(req, ['admin']);
    if (!auth.ok) {
      sendJson(res, { ok: false, reason: 'forbidden' }, 403);
      return true;
    }
    const profileId = String(adminTeleportMatch[1] ?? '').trim();
    if (!profileId) {
      sendJson(res, { ok: false, reason: 'profile_required' }, 400);
      return true;
    }
    const body = await readJsonBody<{ x?: number; z?: number; section?: number }>(req);
    try {
      sendJson(res, await context.serverPost('/admin/teleport', {
        playerId: `u_${profileId}`,
        x: body?.x,
        z: body?.z,
        section: body?.section
      }));
    } catch {
      sendJson(res, { ok: false, reason: 'server_unavailable' }, 503);
    }
    return true;
  }

  const adminWalletAdjustMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)\/wallet\/adjust$/);
  if (adminWalletAdjustMatch && req.method === 'POST') {
    const auth = await context.requireRole(req, ['admin']);
    if (!auth.ok) {
      sendJson(res, { ok: false, reason: 'forbidden' }, 403);
      return true;
    }
    const profileId = String(adminWalletAdjustMatch[1] ?? '').trim();
    const body = await readJsonBody<{ amount?: number; direction?: 'credit' | 'debit'; reason?: string }>(req);
    const amount = Math.max(0, Number(body?.amount ?? 0));
    const direction = body?.direction === 'debit' ? 'debit' : 'credit';
    const reason = String(body?.reason ?? 'admin_adjust').trim() || 'admin_adjust';
    if (!profileId || amount <= 0) {
      sendJson(res, { ok: false, reason: 'invalid_adjust_payload' }, 400);
      return true;
    }
    try {
      const profiles = await context.runtimeProfiles();
      const profile = profiles.find((entry) => entry.id === profileId);
      if (!profile) {
        sendJson(res, { ok: false, reason: 'profile_not_found' }, 404);
        return true;
      }
      const walletId = profile.wallet?.id ?? profile.walletId;
      if (!walletId) {
        sendJson(res, { ok: false, reason: 'wallet_not_found' }, 404);
        return true;
      }
      if (direction === 'credit') {
        sendJson(res, { ok: true, direction, amount, walletId, runtime: await context.runtimePost('/house/transfer', { toWalletId: walletId, amount, reason }) });
        return true;
      }
      const houseStatus = await context.runtimeGet<any>('/house/status');
      const houseWalletId = String(houseStatus?.house?.wallet?.id ?? '').trim();
      if (!houseWalletId) {
        sendJson(res, { ok: false, reason: 'house_wallet_missing' }, 500);
        return true;
      }
      sendJson(res, {
        ok: true,
        direction,
        amount,
        walletId,
        runtime: await context.runtimePost(`/wallets/${walletId}/transfer`, { toWalletId: houseWalletId, amount })
      });
    } catch {
      sendJson(res, { ok: false, reason: 'runtime_unavailable' }, 503);
    }
    return true;
  }

  const adminWalletRebindMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)\/wallet\/rebind$/);
  if (adminWalletRebindMatch && req.method === 'POST') {
    const auth = await context.requireRole(req, ['admin']);
    if (!auth.ok) {
      sendJson(res, { ok: false, reason: 'forbidden' }, 403);
      return true;
    }
    const profileId = String(adminWalletRebindMatch[1] ?? '').trim();
    const body = await readJsonBody<{ walletId?: string; walletAddress?: string; email?: string; purgeConflictingSessions?: boolean }>(req);
    const walletId = String(body?.walletId ?? '').trim();
    const walletAddress = String(body?.walletAddress ?? '').trim();
    const email = String(body?.email ?? '').trim().toLowerCase();
    const purgeConflictingSessions = body?.purgeConflictingSessions !== false;
    if (!profileId || (!walletId && !walletAddress)) {
      sendJson(res, { ok: false, reason: 'profile_and_wallet_required' }, 400);
      return true;
    }
    try {
      const profiles = await context.runtimeProfiles();
      const profile = profiles.find((entry) => entry.id === profileId);
      if (!profile) {
        sendJson(res, { ok: false, reason: 'profile_not_found' }, 404);
        return true;
      }
      const knownSubs = await context.sessionStore.listSubsForProfile(profileId).catch(() => []);
      const emailIdentities = email ? await context.sessionStore.findIdentitiesByEmail(email).catch(() => []) : [];
      const subjects = [...new Set([...knownSubs, ...emailIdentities.map((entry) => entry.sub)].map((entry) => String(entry || '').trim()).filter(Boolean))];
      const runtimePayload = await context.runtimePost<any>(`/profiles/${encodeURIComponent(profileId)}/wallet/rebind`, {
        walletId: walletId || undefined,
        walletAddress: walletAddress || undefined,
        subjects
      });
      const reboundWalletId = String(runtimePayload?.profile?.wallet?.id ?? runtimePayload?.profile?.walletId ?? walletId).trim();
      const reboundWalletAddress = String(runtimePayload?.profile?.wallet?.address ?? walletAddress).trim() || null;
      const rewrite = email
        ? rewriteEmailIdentityBindings({
            identities: emailIdentities,
            profileId,
            walletId: reboundWalletId,
            username: runtimePayload?.profile?.username ?? profile.username,
            displayName: runtimePayload?.profile?.displayName ?? profile.displayName
          })
        : { updated: [], conflictingProfileIds: [] as string[] };

      for (const identity of rewrite.updated) {
        await context.sessionStore.setIdentity(identity, context.config.identityTtlMs ?? 1000 * 60 * 60 * 24 * 30);
        if (identity.profileId) {
          await context.sessionStore.addSubForProfile(identity.profileId, identity.sub, context.config.identityTtlMs ?? 1000 * 60 * 60 * 24 * 30);
        }
      }
      const purgeTargets = purgeConflictingSessions
        ? [...new Set(rewrite.conflictingProfileIds.filter((entry) => entry && entry !== profileId))]
        : [];
      let purgedSessions = 0;
      for (const conflictingProfileId of purgeTargets) {
        purgedSessions += await context.sessionStore.purgeSessionsForProfile(conflictingProfileId).catch(() => 0);
      }
      sendJson(res, {
        ok: true,
        profileId,
        walletId: reboundWalletId,
        walletAddress: reboundWalletAddress,
        email: email || null,
        swappedProfileId: runtimePayload?.swappedProfileId ?? null,
        rewrittenIdentities: rewrite.updated.length,
        purgedSessions
      });
    } catch {
      sendJson(res, { ok: false, reason: 'wallet_rebind_failed' }, 503);
    }
    return true;
  }

  const adminLogoutMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)\/logout$/);
  if (adminLogoutMatch && req.method === 'POST') {
    const auth = await context.requireRole(req, ['admin']);
    if (!auth.ok) {
      sendJson(res, { ok: false, reason: 'forbidden' }, 403);
      return true;
    }
    const profileId = String(adminLogoutMatch[1] ?? '').trim();
    if (!profileId) {
      sendJson(res, { ok: false, reason: 'profile_required' }, 400);
      return true;
    }
    try {
      sendJson(res, { ok: true, profileId, sessionsDeleted: await context.sessionStore.purgeSessionsForProfile(profileId) });
    } catch {
      sendJson(res, { ok: false, reason: 'logout_failed' }, 500);
    }
    return true;
  }

  if (pathname === '/api/admin/challenges/recent') {
    const auth = await context.requireRole(req, ['admin']);
    if (!auth.ok) {
      sendJson(res, { ok: false, reason: 'forbidden' }, 403);
      return true;
    }
    const limit = Math.max(1, Math.min(300, Number(requestUrl.searchParams.get('limit') ?? 60)));
    try {
      sendJson(res, await context.serverGet(`/challenges/recent?limit=${limit}`));
    } catch {
      sendJson(res, { ok: false, reason: 'server_unavailable' }, 400);
    }
    return true;
  }

  if (pathname === '/api/super-agent/chat' && req.method === 'POST') {
    const auth = await context.requireRole(req, ['admin']);
    if (!auth.ok) {
      sendJson(res, { ok: false, reason: 'forbidden' }, 403);
      return true;
    }
    const body = await readJsonBody<{ message?: string; includeStatus?: boolean }>(req);
    if (!body?.message || !body.message.trim()) {
      sendJson(res, { ok: false, reason: 'message_required' }, 400);
      return true;
    }
    try {
      sendJson(res, await context.runtimePost('/super-agent/chat', {
        message: body.message.trim(),
        includeStatus: Boolean(body.includeStatus)
      }));
    } catch {
      sendJson(res, { ok: false, reason: 'super_agent_chat_failed' }, 400);
    }
    return true;
  }

  return false;
};
