const CANONICAL_WORLD_ALIAS = 'mega';
const COMPATIBILITY_ALIASES = ['train_world', 'train-world', 'base', 'plaza', 'world'];
const WORLD_FILENAME_FALLBACK = {
  train_world: 'train_station_mega_world_clean.glb',
  'train-world': 'train_station_mega_world_clean.glb',
  mega: 'train_station_mega_world_clean.glb',
  plaza: 'train_station_mega_world_clean.glb',
  base: 'train_station_mega_world_clean.glb',
  world: 'train_station_mega_world_clean.glb'
};
const WORLD_VERSION_FALLBACK = {
  train_world: '2026-03-28.1',
  'train-world': '2026-03-28.1',
  mega: '2026-03-28.1',
  plaza: '2026-03-28.1',
  base: '2026-03-28.1',
  world: '2026-03-28.1'
};

function cloneBundle(bundle, fallbackKind = 'shell') {
  if (!bundle || typeof bundle !== 'object') return null;
  const alias = String(bundle.alias || '').trim();
  const filename = String(bundle.filename || '').trim();
  const version = String(bundle.version || '').trim();
  if (!alias || !filename) return null;
  return {
    alias,
    filename,
    version,
    kind: String(bundle.kind || fallbackKind),
    replaceWorldRoot: Boolean(bundle.replaceWorldRoot)
  };
}

function normalizeExplicitBundlePlan(plan) {
  if (!plan || typeof plan !== 'object') return null;
  const shell = cloneBundle(plan.shell, 'shell');
  if (!shell) return null;
  const zones = Array.isArray(plan.zones) ? plan.zones.map((entry) => cloneBundle(entry, 'zone')).filter(Boolean) : [];
  const decor = Array.isArray(plan.decor) ? plan.decor.map((entry) => cloneBundle(entry, 'decor')).filter(Boolean) : [];
  return { shell, zones, decor };
}

function legacyBundleForAlias(alias, filenameByAlias, versionByAlias) {
  const filename = String(filenameByAlias?.[alias] || filenameByAlias?.[CANONICAL_WORLD_ALIAS] || '').trim();
  if (!filename) return null;
  const version = String(versionByAlias?.[alias] || versionByAlias?.[CANONICAL_WORLD_ALIAS] || '').trim();
  return {
    shell: {
      alias: `${normalizeWorldAlias(alias)}-shell`,
      filename,
      version,
      kind: 'shell'
    },
    zones: [],
    decor: []
  };
}

export function normalizeWorldAlias(alias) {
  const normalized = String(alias || '').toLowerCase().replace(/\.glb$/i, '');
  if (!normalized || normalized === CANONICAL_WORLD_ALIAS) return CANONICAL_WORLD_ALIAS;
  if (COMPATIBILITY_ALIASES.includes(normalized)) return CANONICAL_WORLD_ALIAS;
  return CANONICAL_WORLD_ALIAS;
}

export function normalizeWorldManifest(payload = {}) {
  const filenameByAlias = { ...WORLD_FILENAME_FALLBACK, ...(payload?.filenameByAlias || {}) };
  const versionByAlias = { ...WORLD_VERSION_FALLBACK, ...(payload?.versionByAlias || {}) };
  const canonicalAlias = normalizeWorldAlias(payload?.canonicalAlias || CANONICAL_WORLD_ALIAS);
  const aliases = Array.from(new Set([
    canonicalAlias,
    ...COMPATIBILITY_ALIASES,
    ...Object.keys(filenameByAlias || {}),
    ...Object.keys(payload?.bundlesByAlias || {})
  ]));
  const bundlesByAlias = {};

  for (const alias of aliases) {
    const explicit = normalizeExplicitBundlePlan(payload?.bundlesByAlias?.[alias]);
    bundlesByAlias[alias] = explicit || legacyBundleForAlias(alias, filenameByAlias, versionByAlias);
  }

  if (!bundlesByAlias[canonicalAlias]) {
    bundlesByAlias[canonicalAlias] = legacyBundleForAlias(canonicalAlias, filenameByAlias, versionByAlias);
  }

  return {
    canonicalAlias,
    compatibilityAliases: [...COMPATIBILITY_ALIASES],
    aliases,
    filenameByAlias,
    versionByAlias,
    bundlesByAlias
  };
}

export function getWorldBundlePlan(manifest, alias) {
  const normalizedManifest = normalizeWorldManifest(manifest);
  const normalizedAlias = normalizeWorldAlias(alias);
  return (
    normalizedManifest.bundlesByAlias?.[alias]
    || normalizedManifest.bundlesByAlias?.[normalizedAlias]
    || normalizedManifest.bundlesByAlias?.[normalizedManifest.canonicalAlias]
  );
}

export function classifyRendererProfile(input = {}) {
  const width = Number(input.innerWidth || 0);
  const dpr = Number(input.devicePixelRatio || 1) || 1;
  const touchPoints = Number(input.maxTouchPoints || 0);
  const hardwareConcurrency = Number(input.hardwareConcurrency || 0);
  const deviceMemory = Number(input.deviceMemory || 0);
  const userAgent = String(input.userAgent || '');
  const touchLike = touchPoints > 0;
  const smallViewport = width > 0 && width < 768;
  const lowCpu = hardwareConcurrency > 0 && hardwareConcurrency <= 4;
  const lowMemory = deviceMemory > 0 && deviceMemory <= 4;
  const mobileUa = /Mobi|Android|iPhone|iPad|iPod/i.test(userAgent);
  const lowTier = Boolean(mobileUa || (touchLike && smallViewport) || lowCpu || lowMemory);

  return {
    lowTier,
    maxPixelRatio: lowTier ? Math.min(dpr, 1.25) : Math.min(dpr, 2),
    antialias: !lowTier,
    shadowMapEnabled: !lowTier,
    cameraFar: lowTier ? 800 : 2000
  };
}
