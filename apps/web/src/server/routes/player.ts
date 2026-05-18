import { resolveEscrowApprovalPolicy } from '@arena/shared';
import type { ChiefChatRequest } from '../../chief.js';
import { buildPlayerShell } from '../../playerShell.js';
import { preferEmailIdentityOverContinuity } from '../../identityContinuity.js';
import { readJsonBody, sendJson } from '../../lib/http.js';
import type { PlayerProfile, RouteHandler, RuntimeStatusPayload } from '../types.js';

export const handlePlayerRoutes: RouteHandler = async (req, res, requestUrl, context) => {
  const pathname = requestUrl.pathname;
  const identityTtlMs = context.config.identityTtlMs ?? 1000 * 60 * 60 * 24 * 30;

  if (pathname === '/api/player/me') {
    const auth = await context.requireRole(req, ['player', 'admin']);
    if (!auth.ok) {
      const optional = String(requestUrl.searchParams.get('optional') || '').trim().toLowerCase();
      if (optional === '1' || optional === 'true') {
        sendJson(res, { ok: false, user: null, reason: 'unauthorized' }, 200);
        return true;
      }
      sendJson(res, { ok: false, reason: 'unauthorized' }, 401);
      return true;
    }
    const identity = auth.identity;
    if (!identity.profileId || !identity.walletId) {
      try {
        await context.ensurePlayerProvisioned(identity);
      } catch {
        sendJson(res, { ok: false, reason: 'provision_failed' }, 503);
        return true;
      }
    }
    let profiles: PlayerProfile[] = [];
    try {
      profiles = await context.runtimeProfiles();
    } catch {
      if (identity.profileId && identity.walletId) {
        sendJson(res, {
          ok: true,
          degraded: true,
          user: context.sanitizeUser(identity),
          profile: {
            id: identity.profileId,
            username: identity.username || 'player',
            displayName: identity.displayName || identity.name || 'Player',
            walletId: identity.walletId,
            ownedBotIds: [],
            wallet: { id: identity.walletId, balance: 0 }
          },
          bots: [],
          bot: { id: null, connected: null },
          wsAuth: context.wsAuthForIdentity(identity)
        });
        return true;
      }
      sendJson(res, { ok: false, reason: 'runtime_unavailable' }, 503);
      return true;
    }
    let profile = identity.profileId ? profiles.find((entry) => entry.id === identity.profileId) : null;
    if (!profile) {
      const canonicalLink = await context.runtimeSubjectLink(context.externalSubjectFromIdentity(identity)).catch(() => null);
      const preferred = preferEmailIdentityOverContinuity({
        continuity: canonicalLink,
        emailIdentities: await context.sessionStore.findIdentitiesByEmail(identity.email).catch(() => [])
      });
      if (preferred?.profileId && preferred?.walletId) {
        identity.profileId = preferred.profileId;
        identity.walletId = preferred.walletId;
        identity.username = preferred.username ?? identity.username;
        identity.displayName = preferred.displayName ?? identity.displayName;
        await context.sessionStore.setIdentity(identity, identityTtlMs);
        if (identity.profileId) {
          await context.sessionStore.addSubForProfile(identity.profileId, identity.sub, identityTtlMs);
        }
        if (preferred.source === 'email') {
          await context.upsertIdentitySubjectAliases(identity, [context.externalSubjectFromIdentity(identity)]);
        }
        profile = profiles.find((entry: PlayerProfile) => entry.id === identity.profileId) ?? null;
      }
      if (!profile) {
        sendJson(res, { ok: false, reason: 'profile_unavailable' }, 503);
        return true;
      }
    }
    identity.walletId = profile.wallet?.id ?? profile.walletId;
    identity.displayName = profile.displayName;
    identity.username = profile.username;
    await context.sessionStore.setIdentity(identity, identityTtlMs);
    if (identity.profileId) {
      await context.sessionStore.addSubForProfile(identity.profileId, identity.sub, identityTtlMs);
    }
    const { bots } = await context.loadPlayerRuntimeBotContext(identity, profile);
    const ownerBot = bots[0] ?? null;
    sendJson(res, {
      ok: true,
      user: context.sanitizeUser(identity),
      profile,
      bots,
      bot: { id: ownerBot?.id ?? null, connected: typeof ownerBot?.connected === 'boolean' ? ownerBot.connected : null },
      wsAuth: context.wsAuthForIdentity(identity)
    });
    return true;
  }

  if (pathname === '/api/player/identity-wallet') {
    const auth = await context.requireRole(req, ['player', 'admin']);
    if (!auth.ok) {
      sendJson(res, { ok: false, reason: 'unauthorized' }, 401);
      return true;
    }
    const identity = auth.identity;
    if (!identity.profileId || !identity.walletId) {
      try {
        await context.ensurePlayerProvisioned(identity);
        await context.sessionStore.setIdentity(identity, identityTtlMs);
      } catch {
        sendJson(res, { ok: false, reason: 'provision_failed' }, 503);
        return true;
      }
    }
    const link = await context.runtimeSubjectLink(context.externalSubjectFromIdentity(identity));
    const profiles = await context.runtimeProfiles().catch(() => []);
    const profile = identity.profileId ? profiles.find((entry) => entry.id === identity.profileId) : null;
    sendJson(res, {
      ok: true,
      sub: identity.sub,
      email: identity.email,
      profileId: identity.profileId,
      walletId: identity.walletId,
      walletAddress: profile?.wallet?.address ?? null,
      continuitySource: link?.continuitySource ?? 'web-session-store',
      linkedAt: link?.linkedAt || identity.createdAt,
      lastVerifiedAt: Date.now()
    });
    return true;
  }

  if (pathname === '/api/player/directory') {
    const auth = await context.requireRole(req, ['admin']);
    if (!auth.ok) {
      sendJson(res, { ok: false, reason: 'forbidden' }, 403);
      return true;
    }
    const profiles = await context.runtimeProfiles().catch(() => []);
    const entries = profiles
      .filter((profile) => profile.wallet?.id ?? profile.walletId)
      .map((profile) => ({
        id: profile.id,
        username: profile.username,
        displayName: profile.displayName,
        walletId: profile.wallet?.id ?? profile.walletId,
        walletAddress: profile.wallet?.address
      }))
      .filter((entry) => entry.walletId && entry.id !== auth.identity.profileId);
    sendJson(res, { ok: true, players: entries });
    return true;
  }

  if (pathname === '/api/player/bootstrap') {
    const auth = await context.requireRole(req, ['player', 'admin']);
    if (!auth.ok) {
      sendJson(res, { ok: false, reason: 'unauthorized' }, 401);
      return true;
    }
    const identity = auth.identity;
    if (!identity.profileId || !identity.walletId) {
      try {
        await context.ensurePlayerProvisioned(identity);
      } catch {
        sendJson(res, { ok: false, reason: 'provision_failed' }, 503);
        return true;
      }
    }
    let profiles = [];
    try {
      profiles = await context.runtimeProfiles();
    } catch {
      sendJson(res, { ok: false, reason: 'runtime_unavailable' }, 503);
      return true;
    }
    let profile = identity.profileId ? profiles.find((entry) => entry.id === identity.profileId) : null;
    if (!profile) {
      const canonicalLink = await context.runtimeSubjectLink(context.externalSubjectFromIdentity(identity)).catch(() => null);
      const preferred = preferEmailIdentityOverContinuity({
        continuity: canonicalLink,
        emailIdentities: await context.sessionStore.findIdentitiesByEmail(identity.email).catch(() => [])
      });
      if (preferred?.profileId && preferred?.walletId) {
        identity.profileId = preferred.profileId;
        identity.walletId = preferred.walletId;
        identity.username = preferred.username ?? identity.username;
        identity.displayName = preferred.displayName ?? identity.displayName;
        await context.sessionStore.setIdentity(identity, identityTtlMs);
        if (identity.profileId) {
          await context.sessionStore.addSubForProfile(identity.profileId, identity.sub, identityTtlMs);
        }
        if (preferred.source === 'email') {
          await context.upsertIdentitySubjectAliases(identity, [context.externalSubjectFromIdentity(identity)]);
        }
      profile = profiles.find((entry: PlayerProfile) => entry.id === identity.profileId) ?? null;
      }
      if (!profile) {
        sendJson(res, { ok: false, reason: 'profile_unavailable' }, 503);
        return true;
      }
    }
    const walletId = profile.wallet?.id ?? profile.walletId;
    identity.walletId = walletId;
    identity.username = profile.username;
    identity.displayName = profile.displayName;
    await context.sessionStore.setIdentity(identity, identityTtlMs);
    if (identity.profileId) {
      await context.sessionStore.addSubForProfile(identity.profileId, identity.sub, identityTtlMs);
    }
    const world = requestUrl.searchParams.get('world') || 'mega';
    const playParams = new URLSearchParams({ world, name: profile.displayName, walletId, clientId: profile.id });
    if (context.config.publicGameWsUrl) {
      playParams.set('ws', context.config.publicGameWsUrl);
    }
    const { ownerWalletAddress, ownerBot } = await context.loadPlayerRuntimeBotContext(identity, profile);
    const walletSummary = await context.loadPlayerWalletSummary(identity);
    const activityPayload = await context.loadPlayerActivity(identity, 5);
    const ownerBotWallet = ownerBot?.id
      ? await context.runtimeGet<Record<string, any>>(`/bots/${encodeURIComponent(ownerBot.id)}/wallet`).catch(() => null)
      : null;
    const playerShell = buildPlayerShell({
      user: context.sanitizeUser(identity),
      profile,
      walletSummary,
      funding: {
        walletProvider: walletSummary?.wallet?.walletProvider ?? null,
        depositAddress: walletSummary?.wallet?.externalWalletAddress ?? ownerWalletAddress ?? walletSummary?.onchain?.address ?? '',
        chainId: Number.isFinite(Number(walletSummary?.onchain?.chainId)) ? Number(walletSummary.onchain.chainId) : null,
        tokenSymbol: String(walletSummary?.onchain?.tokenSymbol || 'USDC')
      },
      bot: ownerBot,
      readiness: ownerBotWallet?.readiness || ownerBotWallet || null,
      activity: Array.isArray(activityPayload?.activity) ? activityPayload.activity : [],
      loadedAt: Date.now()
    });
    sendJson(res, {
      ok: true,
      user: context.sanitizeUser(identity),
      profile,
      playerShell,
      links: {
        welcome: '/welcome',
        dashboard: '/dashboard',
        play: `/play?${playParams.toString()}`,
        admin: '/admin'
      },
      invite: {
        note: 'Invite requires sign-in. Share the arena link; they must authenticate first.',
        playUrl: '/welcome'
      }
    });
    return true;
  }

  const walletAction = async (kind: 'fund' | 'withdraw' | 'transfer') => {
    const auth = await context.requireRole(req, ['player', 'admin']);
    if (!auth.ok || !auth.identity.walletId) {
      sendJson(res, { ok: false, reason: 'unauthorized' }, 401);
      return true;
    }
    const body = await readJsonBody<{ amount?: number; toWalletId?: string }>(req);
    const amount = Math.max(0, Number(body?.amount ?? 0));
    if (kind === 'transfer') {
      const toWalletId = String(body?.toWalletId ?? '').trim();
      if (!toWalletId) {
        sendJson(res, { ok: false, reason: 'target_wallet_required' }, 400);
        return true;
      }
      if (amount <= 0) {
        sendJson(res, { ok: false, reason: 'invalid_amount' }, 400);
        return true;
      }
      try {
        sendJson(res, await context.runtimePost(`/wallets/${auth.identity.walletId}/transfer`, { toWalletId, amount }));
      } catch {
        sendJson(res, { ok: false, reason: 'runtime_unavailable' }, 503);
      }
      return true;
    }
    if (amount <= 0) {
      sendJson(res, { ok: false, reason: 'invalid_amount' }, 400);
      return true;
    }
    try {
      sendJson(res, await context.runtimePost(`/wallets/${auth.identity.walletId}/${kind}`, { amount }));
    } catch {
      sendJson(res, { ok: false, reason: 'runtime_unavailable' }, 503);
    }
    return true;
  };

  if (pathname === '/api/player/wallet/fund' && req.method === 'POST') return walletAction('fund');
  if (pathname === '/api/player/wallet/withdraw' && req.method === 'POST') return walletAction('withdraw');
  if (pathname === '/api/player/wallet/transfer' && req.method === 'POST') return walletAction('transfer');

  if (pathname === '/api/player/wallet/escrow-history') {
    const auth = await context.requireRole(req, ['player', 'admin']);
    if (!auth.ok || !auth.identity.profileId) {
      sendJson(res, { ok: false, reason: 'unauthorized' }, 401);
      return true;
    }
    const limit = Math.max(1, Math.min(120, Number(requestUrl.searchParams.get('limit') ?? 30)));
    try {
      let recent: Array<Record<string, unknown>> = [];
      for (const pid of context.candidatePlayerIds(auth.identity.profileId)) {
        const payload = await context.serverGet<{ ok?: boolean; recent?: Array<Record<string, unknown>> }>(
          `/escrow/events/recent?playerId=${encodeURIComponent(pid)}&limit=${limit}`
        ).catch(() => ({ recent: [] }));
        const next = Array.isArray(payload?.recent) ? payload.recent : [];
        if (next.length > 0) {
          recent = next;
          break;
        }
      }
      sendJson(res, { ok: true, recent });
    } catch {
      sendJson(res, { ok: false, reason: 'escrow_history_unavailable' }, 503);
    }
    return true;
  }

  if (pathname === '/api/player/activity') {
    const auth = await context.requireRole(req, ['player', 'admin']);
    if (!auth.ok || !auth.identity.profileId || !auth.identity.walletId) {
      sendJson(res, { ok: false, reason: 'unauthorized' }, 401);
      return true;
    }
    try {
      sendJson(res, await context.loadPlayerActivity(auth.identity, Math.max(1, Math.min(120, Number(requestUrl.searchParams.get('limit') ?? 30)))));
    } catch {
      sendJson(res, { ok: false, reason: 'activity_unavailable' }, 503);
    }
    return true;
  }

  if (pathname === '/api/player/wallet/summary') {
    const auth = await context.requireRole(req, ['player', 'admin']);
    if (!auth.ok || !auth.identity.walletId) {
      sendJson(res, { ok: false, reason: 'unauthorized' }, 401);
      return true;
    }
    try {
      const payload = await context.loadPlayerWalletSummary(auth.identity);
      if (!payload) {
        sendJson(res, { ok: false, reason: 'wallet_summary_unavailable' }, 503);
        return true;
      }
      sendJson(res, payload);
    } catch {
      sendJson(res, { ok: false, reason: 'wallet_summary_unavailable' }, 503);
    }
    return true;
  }

  if (pathname === '/api/player/wallet/prepare-escrow' && req.method === 'POST') {
    const auth = await context.requireRole(req, ['player', 'admin']);
    if (!auth.ok || !auth.identity.walletId) {
      sendJson(res, { ok: false, reason: 'unauthorized' }, 401);
      return true;
    }
    const body = await readJsonBody<{ amount?: number }>(req);
    const amount = Math.max(0, Number(body?.amount ?? 0));
    if (!Number.isFinite(amount) || amount <= 0) {
      sendJson(res, { ok: false, reason: 'invalid_amount' }, 400);
      return true;
    }
    const activePolicy = resolveEscrowApprovalPolicy({
      chainId: context.config.escrowApprovalChainId ?? null,
      chainHint: context.config.escrowApprovalChainHint ?? '',
      modeSepolia: context.config.escrowApprovalModeSepolia ?? 'auto',
      modeMainnet: context.config.escrowApprovalModeMainnet ?? 'manual',
      defaultMode: context.config.escrowApprovalDefaultMode ?? 'manual',
      autoApproveMaxWager: context.config.escrowAutoApproveMaxWager ?? null,
      autoApproveDailyCap: context.config.escrowAutoApproveDailyCap ?? null
    });
    if (activePolicy.mode === 'auto') {
      sendJson(res, {
        ok: true,
        mode: activePolicy.mode,
        network: activePolicy.network,
        reason: activePolicy.reason,
        results: [{ walletId: auth.identity.walletId, ok: true, source: 'super_agent', status: 'ready' }]
      });
      return true;
    }
    try {
      const payload = await context.runtimePost<Record<string, unknown>>('/wallets/onchain/prepare-escrow', {
        amount,
        walletIds: [auth.identity.walletId]
      });
      sendJson(res, { ...payload, mode: activePolicy.mode, network: activePolicy.network });
    } catch {
      sendJson(res, { ok: false, reason: 'runtime_unavailable' }, 503);
    }
    return true;
  }

  if (pathname === '/api/player/wallet/export-key' && req.method === 'POST') {
    const auth = await context.requireRole(req, ['player', 'admin']);
    if (!auth.ok || !auth.identity.walletId || !auth.identity.profileId) {
      sendJson(res, { ok: false, reason: 'unauthorized' }, 401);
      return true;
    }
    try {
      sendJson(res, await context.runtimePost(`/wallets/${auth.identity.walletId}/export-key`, { profileId: auth.identity.profileId }));
    } catch {
      sendJson(res, { ok: false, reason: 'runtime_unavailable' }, 503);
    }
    return true;
  }

  if (pathname === '/api/player/profile' && req.method === 'POST') {
    const auth = await context.requireRole(req, ['player', 'admin']);
    if (!auth.ok || !auth.identity.profileId) {
      sendJson(res, { ok: false, reason: 'unauthorized' }, 401);
      return true;
    }
    const body = await readJsonBody<{ displayName?: string; username?: string }>(req);
    if (!body) {
      sendJson(res, { ok: false, reason: 'invalid_json' }, 400);
      return true;
    }
    try {
      const payload = await context.runtimePost(`/profiles/${auth.identity.profileId}/update`, body);
      if (typeof body.displayName === 'string' && body.displayName.trim()) auth.identity.displayName = body.displayName.trim();
      if (typeof body.username === 'string' && body.username.trim()) auth.identity.username = body.username.trim();
      await context.sessionStore.setIdentity(auth.identity, identityTtlMs);
      if (auth.identity.profileId) {
        await context.sessionStore.addSubForProfile(auth.identity.profileId, auth.identity.sub, identityTtlMs);
      }
      sendJson(res, payload);
    } catch {
      sendJson(res, { ok: false, reason: 'profile_update_failed' }, 400);
    }
    return true;
  }

  if (pathname === '/api/player/onboarding' && req.method === 'GET') {
    const auth = await context.requireRole(req, ['player', 'admin']);
    if (!auth.ok || !auth.identity.profileId) {
      sendJson(res, { ok: false, reason: 'unauthorized' }, 401);
      return true;
    }
    try {
      sendJson(res, await context.runtimeGet(`/profiles/${encodeURIComponent(auth.identity.profileId)}/onboarding`));
    } catch {
      sendJson(res, { ok: false, reason: 'runtime_unavailable' }, 503);
    }
    return true;
  }
  if (pathname === '/api/player/onboarding/complete' && req.method === 'POST') {
    const auth = await context.requireRole(req, ['player', 'admin']);
    if (!auth.ok || !auth.identity.profileId) {
      sendJson(res, { ok: false, reason: 'unauthorized' }, 401);
      return true;
    }
    try {
      sendJson(res, await context.runtimePost(`/profiles/${encodeURIComponent(auth.identity.profileId)}/onboarding/complete`, { completedAt: Date.now() }));
    } catch {
      sendJson(res, { ok: false, reason: 'runtime_unavailable' }, 503);
    }
    return true;
  }

  if (pathname === '/api/player/bot/config' && req.method === 'POST') {
    const auth = await context.requireRole(req, ['player', 'admin']);
    if (!auth.ok || !auth.identity.profileId) {
      sendJson(res, { ok: false, reason: 'unauthorized' }, 401);
      return true;
    }
    const body = await readJsonBody<Record<string, unknown>>(req);
    if (!body) {
      sendJson(res, { ok: false, reason: 'invalid_json' }, 400);
      return true;
    }
    const runtimeStatus = await context.runtimeGet<RuntimeStatusPayload>('/status').catch(() => ({ bots: [] }));
    const bot = (runtimeStatus.bots ?? []).find((entry) => entry.meta?.ownerProfileId === auth.identity.profileId);
    if (!bot) {
      sendJson(res, { ok: false, reason: 'bot_not_found' }, 404);
      return true;
    }
    try {
      sendJson(res, await context.runtimePost(`/agents/${bot.id}/config`, body));
    } catch {
      sendJson(res, { ok: false, reason: 'bot_update_failed' }, 400);
    }
    return true;
  }

  if (pathname === '/api/player/bots/create' && req.method === 'POST') {
    sendJson(res, { ok: false, reason: 'bot_creation_disabled' }, 409);
    return true;
  }

  const playerBotConfigMatch = pathname.match(/^\/api\/player\/bots\/([^/]+)\/config$/);
  if (playerBotConfigMatch && req.method === 'POST') {
    const auth = await context.requireRole(req, ['player', 'admin']);
    if (!auth.ok || !auth.identity.profileId) {
      sendJson(res, { ok: false, reason: 'unauthorized' }, 401);
      return true;
    }
    const botId = playerBotConfigMatch[1];
    if (!botId) {
      sendJson(res, { ok: false, reason: 'bot_not_found' }, 404);
      return true;
    }
    const body = await readJsonBody<Record<string, unknown>>(req);
    if (!body) {
      sendJson(res, { ok: false, reason: 'invalid_json' }, 400);
      return true;
    }
    const runtimeStatus = await context.runtimeGet<RuntimeStatusPayload>('/status').catch(() => ({ bots: [] }));
    const ownerBot = (runtimeStatus.bots ?? []).find((entry) => entry.id === botId && entry.meta?.ownerProfileId === auth.identity.profileId);
    if (!ownerBot) {
      sendJson(res, { ok: false, reason: 'bot_not_owned' }, 403);
      return true;
    }
    try {
      sendJson(res, await context.runtimePost(`/agents/${botId}/config`, body));
    } catch {
      sendJson(res, { ok: false, reason: 'bot_update_failed' }, 400);
    }
    return true;
  }

  const botWalletMatch = pathname.match(/^\/api\/player\/bots\/([^/]+)\/wallet$/);
  if (botWalletMatch && req.method === 'GET') {
    const auth = await context.requireRole(req, ['player', 'admin']);
    if (!auth.ok || !auth.identity.profileId) {
      sendJson(res, { ok: false, reason: 'unauthorized' }, 401);
      return true;
    }
    const botId = botWalletMatch[1];
    const runtimeStatus = await context.runtimeGet<RuntimeStatusPayload>('/status').catch(() => ({ bots: [] }));
    const ownerBot = (runtimeStatus.bots ?? []).find((entry) => entry.id === botId && entry.meta?.ownerProfileId === auth.identity.profileId);
    if (!ownerBot) {
      sendJson(res, { ok: false, reason: 'bot_not_owned' }, 403);
      return true;
    }
    try {
      sendJson(res, await context.runtimeGet(`/bots/${botId}/wallet`));
    } catch {
      sendJson(res, { ok: false, reason: 'wallet_readiness_unavailable' }, 503);
    }
    return true;
  }

  if (pathname === '/api/game/stations/playable' && req.method === 'GET') {
    try {
      sendJson(res, await context.serverGet('/stations/playable'));
    } catch {
      sendJson(res, { ok: false, reason: 'stations_unavailable' }, 503);
    }
    return true;
  }

  if (pathname === '/api/game/stations/interact' && req.method === 'POST') {
    const auth = await context.requireRole(req, ['player', 'admin']);
    if (!auth.ok) {
      sendJson(res, { ok: false, reason: 'unauthorized' }, 401);
      return true;
    }
    const identity = auth.identity;
    if (!identity.profileId || !identity.walletId) {
      sendJson(res, { ok: false, reason: 'profile_or_wallet_missing' }, 404);
      return true;
    }
    const body = await readJsonBody<Record<string, unknown>>(req);
    if (!body) {
      sendJson(res, { ok: false, reason: 'invalid_json' }, 400);
      return true;
    }
    try {
      sendJson(res, await context.serverPost('/stations/interact', {
        playerId: `u_${identity.profileId}`,
        walletId: identity.walletId,
        displayName: identity.displayName || identity.name || identity.username || identity.profileId,
        payload: body
      }));
    } catch {
      sendJson(res, { ok: false, reason: 'station_interact_failed' }, 503);
    }
    return true;
  }

  if (pathname === '/api/chief/v1/chat' && req.method === 'POST') {
    const auth = await context.requireRole(req, ['player', 'admin']);
    if (!auth.ok) {
      sendJson(res, { ok: false, reason: 'unauthorized' }, 401);
      return true;
    }
    const body = await readJsonBody<ChiefChatRequest>(req);
    if (!body) {
      sendJson(res, { ok: false, reason: 'invalid_json' }, 400);
      return true;
    }
    const response = await context.chiefService.handleChat({ identity: auth.identity, request: body });
    sendJson(res, response, response.ok ? 200 : 400);
    return true;
  }

  const isPlayerHouseChat = (pathname === '/api/player/house/chat' || pathname === '/api/player/chief/chat') && req.method === 'POST';
  if (isPlayerHouseChat) {
    const auth = await context.requireRole(req, ['player', 'admin']);
    if (!auth.ok) {
      sendJson(res, { ok: false, reason: 'unauthorized' }, 401);
      return true;
    }
    const body = await readJsonBody<ChiefChatRequest>(req);
    if (!body) {
      sendJson(res, { ok: false, reason: 'invalid_json' }, 400);
      return true;
    }
    const response = await context.chiefService.handleChat({ identity: auth.identity, request: body, forcedMode: 'player' });
    sendJson(res, {
      ok: response.ok,
      reply: response.reply,
      actions: response.actions.map((entry) => `${entry.tool}:${entry.status}`),
      requiresConfirmation: response.requiresConfirmation,
      confirmToken: response.confirmToken,
      intent: response.intent,
      mode: response.mode,
      errors: response.errors,
      stateSnapshot: response.stateSnapshot
    }, response.ok ? 200 : 400);
    return true;
  }

  if (pathname === '/api/player/presence' && req.method === 'POST') {
    const auth = await context.requireRole(req, ['player', 'admin']);
    if (!auth.ok) {
      sendJson(res, { ok: false, reason: 'unauthorized' }, 401);
      return true;
    }
    const identity = auth.identity;
    if (!identity.profileId) {
      sendJson(res, { ok: false, reason: 'profile_missing' }, 404);
      return true;
    }
    const body = await readJsonBody<{ state?: 'online' | 'offline' }>(req);
    const state = body?.state === 'offline' ? 'offline' : 'online';
    try {
      sendJson(res, {
        ok: true,
        state,
        runtime: await context.runtimePost(
          `/owners/${identity.profileId}/presence`,
          state === 'offline'
            ? { state: 'offline', source: 'legacy_browser' }
            : { state: 'online', ttlMs: 90_000, source: 'legacy_browser' }
        )
      });
    } catch {
      sendJson(res, { ok: false, state, reason: 'presence_runtime_degraded' }, 202);
    }
    return true;
  }

  return false;
};
