import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export { THREE };

export function pickWorldAlias() {
  const alias = new URL(window.location.href).searchParams.get('world');
  return alias || 'train_world';
}

export function makeRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  return renderer;
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
  const url = `/assets/world/${alias}.glb`;

  const gltf = await loader.loadAsync(url);
  gltf.scene.traverse((node) => {
    if (node.isMesh) {
      node.castShadow = false;
      node.receiveShadow = true;
    }
  });
  scene.add(gltf.scene);
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
