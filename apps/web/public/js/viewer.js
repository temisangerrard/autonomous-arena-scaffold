import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { fitCameraToWorld, installResizeHandler, loadWorld, makeCamera, makeRenderer, makeScene, pickWorldAlias } from './world-common.js';

const canvas = document.getElementById('scene');
const renderer = makeRenderer(canvas);
const scene = makeScene();
const camera = makeCamera();
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.target.set(0, 2, 0);

installResizeHandler(camera, renderer);

const alias = pickWorldAlias();
loadWorld(scene, alias)
  .then((world) => {
    fitCameraToWorld(camera, controls.target, world);
  })
  .catch((err) => {
    console.error('Failed to load world', err);
  });

function frame() {
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

frame();
