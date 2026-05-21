import path from 'node:path';
import { createHealthStatus } from '../../health.js';
import { log } from '../../logger.js';
import { sendFile, sendFileCached, sendJson } from '../../lib/http.js';
import {
  availableWorldAliases,
  resolveWorldAssetPath,
  worldBundleForAssetAlias,
  worldBundlesByAlias,
  worldFilenameByAlias,
  worldFilenameForAlias,
  worldVersionByAlias
} from '../../worldAssets.js';
import type { RouteHandler } from '../types.js';

export const handlePublicRoutes: RouteHandler = async (req, res, requestUrl, context) => {
  const pathname = requestUrl.pathname;
  const publicDir = context.config.publicDir ?? '';

  if (pathname === '/health') {
    const base = createHealthStatus();
    const [redisOk, runtimeOk, serverOk] = await Promise.all([
      context.sessionStore.ping().catch(() => false),
      context.runtimeStatusOk().catch(() => false),
      context.serverHealthOk().catch(() => false)
    ]);
    sendJson(res, {
      ...base,
      deps: { redis: redisOk, runtime: runtimeOk, server: serverOk }
    });
    return true;
  }

  if (pathname === '/api/worlds') {
    sendJson(res, {
      canonicalAlias: 'mega',
      compatibilityAliases: ['train_world', 'train-world', 'base', 'plaza', 'world'],
      aliases: availableWorldAliases(),
      filenameByAlias: worldFilenameByAlias(),
      versionByAlias: worldVersionByAlias(),
      bundlesByAlias: worldBundlesByAlias()
    });
    return true;
  }

  if (pathname === '/api/config') {
    const effectiveWorldAssetBaseUrl = context.config.publicWorldAssetBaseUrl || context.config.defaultWorldAssetBaseUrl;
    sendJson(res, {
      authEnabled: Boolean(context.config.emailAuthEnabled || context.config.firebaseGoogleAuthEnabled || context.config.googleAuthEnabled),
      emailAuthEnabled: Boolean(context.config.emailAuthEnabled),
      googleAuthEnabled: Boolean(context.config.googleAuthEnabled),
      googleClientId: context.config.googleClientId ?? '',
      firebaseGoogleAuthEnabled: Boolean(context.config.firebaseGoogleAuthEnabled),
      firebaseClientAuthEnabled: Boolean(context.config.firebaseClientAuthEnabled),
      firebaseWebApiKey: context.config.firebaseWebApiKey ?? '',
      firebaseAuthDomain: context.config.firebaseAuthDomain ?? '',
      firebaseProjectId: context.config.firebaseProjectId ?? '',
      cdpProjectId: context.config.cdpProjectId ?? '',
      localAuthEnabled: Boolean(context.config.localAuthEnabled),
      realtimeEnabled: Boolean(context.config.realtimeEnabled),
      gameWsUrl: context.config.publicGameWsUrl ?? '',
      worldAssetBaseUrl: effectiveWorldAssetBaseUrl,
      escrowApprovalPolicy: {
        chainId: context.config.escrowApprovalChainId ?? null,
        chainHint: context.config.escrowApprovalChainHint ?? '',
        modeSepolia: context.config.escrowApprovalModeSepolia ?? 'auto',
        modeMainnet: context.config.escrowApprovalModeMainnet ?? 'manual',
        defaultMode: context.config.escrowApprovalDefaultMode ?? 'manual',
        autoApproveMaxWager: context.config.escrowAutoApproveMaxWager ?? null,
        autoApproveDailyCap: context.config.escrowAutoApproveDailyCap ?? null,
        effective: context.config.escrowApprovalResolved ?? null
      }
    });
    return true;
  }

  const worldMatch = pathname.match(/^\/assets\/world\/([a-zA-Z0-9_-]+)\.glb$/);
  if (worldMatch) {
    const alias = worldMatch[1];
    if (!alias) {
      res.statusCode = 400;
      res.end('Invalid world alias');
      return true;
    }
    const worldPath = resolveWorldAssetPath(alias);
    if (!worldPath) {
      const requestedBundle = worldBundleForAssetAlias(alias);
      const canonicalFilename = worldFilenameForAlias(alias) || worldFilenameForAlias('mega') || 'mega-world.glb';
      const normalizedBase = String(context.config.publicWorldAssetBaseUrl || context.config.defaultWorldAssetBaseUrl || '').replace(/\/+$/, '');
      if (!normalizedBase) {
        log.error({ reason: 'local_world_missing_no_fallback', alias, canonicalFilename }, 'world asset missing locally and no fallback base configured');
        res.statusCode = 404;
        res.end('World asset unavailable');
        return true;
      }
      const versionByAlias = worldVersionByAlias();
      const normalizedAlias = String(alias || '').toLowerCase().replace(/\.glb$/i, '');
      const version = String(requestedBundle?.version || versionByAlias[normalizedAlias] || versionByAlias.mega || '');
      let fallbackUrl = `${normalizedBase}/assets/world/${encodeURIComponent(normalizedAlias)}.glb`;
      if (version) {
        fallbackUrl += `${fallbackUrl.includes('?') ? '&' : '?'}v=${encodeURIComponent(version)}`;
      }
      log.warn({ reason: 'local_world_missing', alias, canonicalFilename, fallbackUrl }, 'world asset missing locally; redirecting to canonical cloud asset');
      res.statusCode = 302;
      res.setHeader('location', fallbackUrl);
      res.end();
      return true;
    }
    await sendFileCached(req, res, worldPath, 'model/gltf-binary', {
      cacheControl: 'public, max-age=31536000, immutable'
    });
    return true;
  }

  if (pathname.startsWith('/js/')) {
    await sendFile(res, path.join(publicDir, pathname), 'text/javascript; charset=utf-8');
    return true;
  }
  if (pathname.startsWith('/img/')) {
    const filePath = path.join(publicDir, pathname);
    const ext = path.extname(filePath).toLowerCase();
    const contentType = ext === '.svg'
      ? 'image/svg+xml'
      : ext === '.png'
        ? 'image/png'
        : 'application/octet-stream';
    await sendFile(res, filePath, contentType);
    return true;
  }
  if (pathname.startsWith('/css/')) {
    await sendFile(res, path.join(publicDir, pathname), 'text/css; charset=utf-8');
    return true;
  }
  if (pathname === '/runtime-config.js') {
    await sendFile(res, path.join(publicDir, 'runtime-config.js'), 'text/javascript; charset=utf-8');
    return true;
  }
  if (pathname === '/styles.css') {
    await sendFile(res, path.join(publicDir, 'styles.css'), 'text/css; charset=utf-8');
    return true;
  }
  if (pathname === '/sitemap.xml') {
    await sendFile(res, path.join(publicDir, 'sitemap.xml'), 'application/xml; charset=utf-8');
    return true;
  }

  const identity = await context.getIdentityFromReq(req);
  const htmlFile = context.htmlRouteToFile(pathname, identity, res);
  if (htmlFile) {
    await sendFile(res, htmlFile, 'text/html; charset=utf-8');
    return true;
  }

  return false;
};
