import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

export { THREE };

let worldManifestPromise = null;
const CANONICAL_WORLD_ALIAS = 'mega';
const CANONICAL_WORLD_BASE_FALLBACK = 'https://storage.googleapis.com/junipalee-arena-assets';
const WORLD_FILENAME_FALLBACK = {
  train_world: 'train_station_mega_world.glb',
  'train-world': 'train_station_mega_world.glb',
  mega: 'train_station_mega_world.glb',
  plaza: 'train_station_mega_world.glb',
  base: 'train_station_mega_world.glb',
  world: 'train_station_mega_world.glb'
};
const WORLD_VERSION_FALLBACK = {
  train_world: '2026-02-17.2',
  'train-world': '2026-02-17.2',
  mega: '2026-02-17.2',
  plaza: '2026-02-17.2',
  base: '2026-02-17.2',
  world: '2026-02-17.2'
};

function normalizeWorldAlias(alias) {
  const normalized = String(alias || '').toLowerCase().replace(/\.glb$/i, '');
  if (!normalized || normalized === CANONICAL_WORLD_ALIAS) return CANONICAL_WORLD_ALIAS;
  if (normalized === 'train_world' || normalized === 'train-world' || normalized === 'base' || normalized === 'plaza' || normalized === 'world') {
    return CANONICAL_WORLD_ALIAS;
  }
  return CANONICAL_WORLD_ALIAS;
}

async function loadWorldManifest() {
  if (worldManifestPromise) return worldManifestPromise;
  worldManifestPromise = (async () => {
    const fallback = {
      filenameByAlias: WORLD_FILENAME_FALLBACK,
      versionByAlias: WORLD_VERSION_FALLBACK
    };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const res = await fetch('/api/worlds', { credentials: 'include' });
        if (!res.ok) {
          continue;
        }
        const payload = await res.json();
        return {
          filenameByAlias: payload?.filenameByAlias || WORLD_FILENAME_FALLBACK,
          versionByAlias: payload?.versionByAlias || WORLD_VERSION_FALLBACK
        };
      } catch {
        // retry once
      }
    }
    return fallback;
  })();
  return worldManifestPromise;
}

async function resolveWorldUrl(alias) {
  const loaderAlias = normalizeWorldAlias(alias);
  const params = new URL(window.location.href).searchParams;
  const configuredBase = window.__ARENA_CONFIG?.worldAssetBaseUrl || window.ARENA_CONFIG?.worldAssetBaseUrl || '';
  const worldBaseUrl = params.get('worldBase') || configuredBase || CANONICAL_WORLD_BASE_FALLBACK;
  const normalizedBase = worldBaseUrl ? String(worldBaseUrl).replace(/\/+$/, '') : '';
  const gcsMode = normalizedBase.includes('storage.googleapis.com') || normalizedBase.startsWith('gs://');

  const manifest = await loadWorldManifest();
  const filenameByAlias = manifest.filenameByAlias || WORLD_FILENAME_FALLBACK;
  const versionByAlias = manifest.versionByAlias || WORLD_VERSION_FALLBACK;
  const filename = filenameByAlias?.[loaderAlias] || filenameByAlias?.[CANONICAL_WORLD_ALIAS] || `${CANONICAL_WORLD_ALIAS}.glb`;
  const version = String(versionByAlias?.[loaderAlias] || versionByAlias?.[CANONICAL_WORLD_ALIAS] || '');

  let rawUrl = '';
  if (!normalizedBase) {
    rawUrl = `/assets/world/${loaderAlias}.glb`;
  } else if (gcsMode) {
    rawUrl = `${normalizedBase}/world/${filename}`;
  } else {
    rawUrl = `${normalizedBase}/assets/world/${loaderAlias}.glb`;
  }
  if (!version) {
    return rawUrl;
  }
  const separator = rawUrl.includes('?') ? '&' : '?';
  return `${rawUrl}${separator}v=${encodeURIComponent(version)}`;
}

export function pickWorldAlias() {
  const alias = new URL(window.location.href).searchParams.get('world');
  return normalizeWorldAlias(alias || CANONICAL_WORLD_ALIAS);
}

export function makeRenderer(canvas) {
  try {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
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

  const hemi = new THREE.HemisphereLight(0xf8f3e8, 0x4f6e67, 1.2);
  scene.add(hemi);

  const dir = new THREE.DirectionalLight(0xffffff, 1.2);
  dir.position.set(25, 40, 22);
  dir.castShadow = true;
  scene.add(dir);

  return scene;
}

export function makeCamera() {
  const camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 2000);
  camera.position.set(0, 8, 14);
  return camera;
}

export async function loadWorld(scene, alias) {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder?.(MeshoptDecoder);
  const url = await resolveWorldUrl(alias);
  const startedAt = performance.now();
  console.debug('[world-cache] load_start', url);

  const gltf = await loader.loadAsync(url);
  gltf.scene.traverse((node) => {
    if (node.isMesh) {
      node.castShadow = false;
      node.receiveShadow = true;
    }
  });
  scene.add(gltf.scene);
  console.debug('[world-cache] load_done', url, `${Math.round(performance.now() - startedAt)}ms`);
  return gltf.scene;
}

export async function loadWorldWithProgress(scene, alias, onProgress) {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder?.(MeshoptDecoder);
  const url = await resolveWorldUrl(alias);
  const startedAt = performance.now();
  console.debug('[world-cache] load_start', url);

  const gltf = await new Promise((resolve, reject) => {
    loader.load(
      url,
      (loaded) => resolve(loaded),
      (evt) => {
        try {
          onProgress?.(evt);
        } catch {
          // ignore progress handler failures
        }
      },
      (err) => reject(err)
    );
  });

  gltf.scene.traverse((node) => {
    if (node.isMesh) {
      node.castShadow = false;
      node.receiveShadow = true;
    }
  });
  scene.add(gltf.scene);
  console.debug('[world-cache] load_done', url, `${Math.round(performance.now() - startedAt)}ms`);
  return gltf.scene;
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
