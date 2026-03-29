import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import {
  classifyRendererProfile,
  getWorldBundlePlan,
  normalizeWorldAlias,
  normalizeWorldManifest
} from './play/runtime/world-manifest.js';

export { THREE };
export { classifyRendererProfile, getWorldBundlePlan, normalizeWorldManifest };

let worldManifestPromise = null;
const CANONICAL_WORLD_BASE_FALLBACK = 'https://pub-302820e514cd451baaf272a33bd70765.r2.dev';
const CANONICAL_WORLD_ALIAS = 'mega';

async function loadWorldManifest() {
  if (worldManifestPromise) return worldManifestPromise;
  worldManifestPromise = (async () => {
    const fallback = normalizeWorldManifest();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const res = await fetch('/api/worlds', { credentials: 'include' });
        if (!res.ok) {
          continue;
        }
        const payload = await res.json();
        return normalizeWorldManifest(payload);
      } catch {
        // retry once
      }
    }
    return fallback;
  })();
  return worldManifestPromise;
}

function resolveBundleUrl(bundle, worldBaseUrl = '') {
  const normalizedBase = worldBaseUrl ? String(worldBaseUrl).replace(/\/+$/, '') : '';
  // For CDN/external URLs use the actual filename so R2 can resolve it directly.
  // For local server requests use the alias — the server handles alias → filename resolution.
  const assetPath = normalizedBase
    ? (bundle.filename || `${bundle.alias}.glb`)
    : `${bundle.alias}.glb`;
  const rawUrl = normalizedBase
    ? `${normalizedBase}/assets/world/${assetPath}`
    : `/assets/world/${assetPath}`;
  if (!bundle.version) {
    return rawUrl;
  }
  const separator = rawUrl.includes('?') ? '&' : '?';
  return `${rawUrl}${separator}v=${encodeURIComponent(bundle.version)}`;
}

async function resolveWorldPlan(alias) {
  const loaderAlias = normalizeWorldAlias(alias);
  const params = new URL(window.location.href).searchParams;
  const configuredBase = window.__ARENA_CONFIG?.worldAssetBaseUrl || window.ARENA_CONFIG?.worldAssetBaseUrl || '';
  const worldBaseUrl = params.get('worldBase') || configuredBase || CANONICAL_WORLD_BASE_FALLBACK;
  const manifest = await loadWorldManifest();
  const bundlePlan = getWorldBundlePlan(manifest, loaderAlias);
  return {
    manifest,
    bundlePlan,
    urls: {
      shell: resolveBundleUrl(bundlePlan.shell, worldBaseUrl),
      zones: bundlePlan.zones.map((bundle) => ({ bundle, url: resolveBundleUrl(bundle, worldBaseUrl) })),
      decor: bundlePlan.decor.map((bundle) => ({ bundle, url: resolveBundleUrl(bundle, worldBaseUrl) }))
    }
  };
}

function createWorldLoader() {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder?.(MeshoptDecoder);
  return loader;
}

function createWorldRoot(scene, alias) {
  const worldRoot = new THREE.Group();
  worldRoot.name = `world_${normalizeWorldAlias(alias)}`;
  scene.add(worldRoot);
  return worldRoot;
}

function decorateWorldNode(root) {
  root.traverse((node) => {
    if (node.isMesh) {
      node.castShadow = false;
      node.receiveShadow = true;
    }
  });
}

async function loadBundleIntoWorld({ loader, worldRoot, bundle, url, onProgress }) {
  const startedAt = performance.now();
  let downloadFinishedAt = null;
  console.debug('[world-cache] load_start', url);

  const gltf = await new Promise((resolve, reject) => {
    loader.load(
      url,
      (loaded) => resolve(loaded),
      (evt) => {
        const loadedBytes = Number(evt?.loaded || 0);
        const totalBytes = Number(evt?.total || 0);
        if (totalBytes > 0 && loadedBytes >= totalBytes) {
          downloadFinishedAt = performance.now();
        }
        try {
          onProgress?.({ ...evt, bundle });
        } catch {
          // ignore progress handler failures
        }
      },
      (err) => reject(err)
    );
  });

  decorateWorldNode(gltf.scene);
  const targetRoot = bundle.replaceWorldRoot ? gltf.scene : worldRoot;
  if (!bundle.replaceWorldRoot) {
    worldRoot.add(gltf.scene);
  }
  const finishedAt = performance.now();
  const totalMs = Math.max(0, finishedAt - startedAt);
  const downloadMs = Math.max(0, (downloadFinishedAt || finishedAt) - startedAt);
  const parseMs = Math.max(0, finishedAt - (downloadFinishedAt || finishedAt));
  console.debug('[world-cache] load_done', url, `${Math.round(totalMs)}ms`);
  return {
    alias: bundle.alias,
    kind: bundle.kind,
    root: targetRoot,
    replaceWorldRoot: Boolean(bundle.replaceWorldRoot),
    metrics: { downloadMs, parseMs, totalMs }
  };
}

export function pickWorldAlias() {
  const alias = new URL(window.location.href).searchParams.get('world');
  return normalizeWorldAlias(alias || CANONICAL_WORLD_ALIAS);
}

export function makeRenderer(canvas) {
  try {
    const profile = classifyRendererProfile({
      innerWidth: window.innerWidth,
      devicePixelRatio: window.devicePixelRatio || 1,
      maxTouchPoints: navigator.maxTouchPoints || 0,
      hardwareConcurrency: navigator.hardwareConcurrency || 0,
      deviceMemory: navigator.deviceMemory || 0,
      userAgent: navigator.userAgent || ''
    });
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: profile.antialias });
    renderer.shadowMap.enabled = profile.shadowMapEnabled;
    renderer.setPixelRatio(profile.maxPixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    return renderer;
  } catch (error) {
    // Keep runtime logic/test hooks alive when WebGL context creation fails
    // (common in some headless CI/container environments).
    console.warn('WebGL renderer unavailable; using noop renderer fallback.', error);
    return {
      domElement: canvas,
      setPixelRatio() {},
      setSize() {},
      render() {},
      dispose() {}
    };
  }
}

export function makeScene() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xbfd7d8);
  // Atmospheric depth fog — matches background color so horizon fades naturally
  scene.fog = new THREE.FogExp2(0xbfd7d8, 0.018);

  // Sky/ground hemisphere for warm ambient fill
  const hemi = new THREE.HemisphereLight(0xf8f3e8, 0x4f6e67, 1.2);
  scene.add(hemi);

  // Primary sun light
  const dir = new THREE.DirectionalLight(0xffffff, 1.2);
  dir.position.set(25, 40, 22);
  const profile = classifyRendererProfile({
    innerWidth: window.innerWidth,
    devicePixelRatio: window.devicePixelRatio || 1,
    maxTouchPoints: navigator.maxTouchPoints || 0,
    hardwareConcurrency: navigator.hardwareConcurrency || 0,
    deviceMemory: navigator.deviceMemory || 0,
    userAgent: navigator.userAgent || ''
  });
  dir.castShadow = profile.shadowMapEnabled;
  scene.add(dir);

  // Cool fill light from opposite side — softens harsh shadow edges on characters
  const fill = new THREE.DirectionalLight(0xd4e8ff, 0.35);
  fill.position.set(-20, 10, -15);
  scene.add(fill);

  return scene;
}

export function makeCamera() {
  const profile = classifyRendererProfile({
    innerWidth: window.innerWidth,
    devicePixelRatio: window.devicePixelRatio || 1,
    maxTouchPoints: navigator.maxTouchPoints || 0,
    hardwareConcurrency: navigator.hardwareConcurrency || 0,
    deviceMemory: navigator.deviceMemory || 0,
    userAgent: navigator.userAgent || ''
  });
  const camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, profile.cameraFar);
  camera.position.set(0, 8, 14);
  return camera;
}

export async function loadWorld(scene, alias) {
  const { urls, bundlePlan } = await resolveWorldPlan(alias);
  const worldRoot = createWorldRoot(scene, alias);
  const loader = createWorldLoader();
  await loadBundleIntoWorld({ loader, worldRoot, bundle: bundlePlan.shell, url: urls.shell });
  const extraBundles = [...urls.zones, ...urls.decor];
  for (const entry of extraBundles) {
    await loadBundleIntoWorld({ loader, worldRoot, bundle: entry.bundle, url: entry.url });
  }
  return worldRoot;
}

export async function loadWorldWithProgress(scene, alias, onProgress) {
  const { urls, bundlePlan } = await resolveWorldPlan(alias);
  const worldRoot = createWorldRoot(scene, alias);
  const loader = createWorldLoader();
  const shellResult = await loadBundleIntoWorld({
    loader,
    worldRoot,
    bundle: bundlePlan.shell,
    url: urls.shell,
    onProgress
  });
  const extraBundles = [...urls.zones, ...urls.decor];
  const backgroundLoads = extraBundles.length > 0
    ? Promise.allSettled(
      extraBundles.map(async (entry) => await loadBundleIntoWorld({
        loader,
        worldRoot,
        bundle: entry.bundle,
        url: entry.url
      }))
    )
    : null;
  return {
    worldRoot,
    shellRoot: shellResult.root,
    shellMetrics: shellResult.metrics,
    bundlePlan,
    backgroundLoads
  };
}

export function fitCameraToWorld(camera, controlsTarget, worldRoot) {
  const box = new THREE.Box3().setFromObject(worldRoot);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  controlsTarget.copy(center);

  const distance = Math.max(20, size.length() * 0.45);
  camera.position.set(center.x + distance * 0.35, center.y + distance * 0.22, center.z + distance * 0.75);
  camera.lookAt(center);
}

export function installResizeHandler(camera, renderer) {
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}
