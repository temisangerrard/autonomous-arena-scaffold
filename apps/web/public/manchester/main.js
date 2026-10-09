import * as T from './vendor/three.module.min.js';
import { DISTRICTS, TRAIL_POINTS, canWalk } from './districts.js';
import {
  createDistrict,
  createAvatar,
  createBee,
  disposeWorld,
} from './world.js';
import { createControls } from './controls.js';
import { createPhone, PHONE_ACTIVITIES } from './phone.js';
import { createLife } from './life.js';
let lifeStorage;
try {
  lifeStorage = localStorage;
} catch {}
const life = createLife(lifeStorage);
let cameraMode = 'close';
let visitRewarded = false;
const cameraRay = new T.Raycaster();

const $ = (selector) => document.querySelector(selector);
const canvas = $('#world');
const renderer = new T.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: 'default',
});
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
renderer.outputColorSpace = T.SRGBColorSpace;
renderer.toneMapping = T.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
const scene = new T.Scene();
scene.background = new T.Color('#d9e3d8');
scene.fog = new T.Fog('#d9e3d8', 95, 190);
scene.add(new T.HemisphereLight('#fff1d4', '#859f99', 2));
const sun = new T.DirectionalLight('#fff0cf', 2);
sun.position.set(-35, 60, 35);
scene.add(sun);
const camera = new T.PerspectiveCamera(39, 1, 0.1, 240);
const avatar = createAvatar();
scene.add(avatar.group);
try {
  const color = localStorage.getItem('manchester-jacket-v1');
  if (
    ['#a45543', '#477a92', '#c7a03f', '#4f795f', '#d8ad50', '#8659a4'].includes(
      color
    )
  )
    avatar.setOutfit(color);
} catch {}
const bees = TRAIL_POINTS.map((point) => {
  const bee = createBee();
  bee.position.set(point.x, 1.6, point.z);
  bee.visible = false;
  scene.add(bee);
  return bee;
});
let district = null,
  world = null,
  elapsed = 0,
  yaw = 0.42,
  trail = 'idle',
  trailTime = 0,
  found = new Set(),
  lastNow = performance.now(),
  lastUI = 0,
  toastUntil = 0,
  manualUntil = 0;
let experience = null;
let experienceLoading = false;
let outdoorState = null;
let best = null;
try {
  const stored = Number(localStorage.getItem('manchester-trail-best-v1'));
  if (Number.isFinite(stored) && stored > 0) best = stored;
} catch {
  /* Private browsing still supports the whole trail. */
}
const controls = createControls(
  canvas,
  $('#joystick'),
  $('#stick'),
  (delta) => {
    if (!experience) yaw -= delta;
  }
);
const phone = createPhone({
  getDistrict: () => district.id,
  controls,
  life,
  onHome: () => startExperience('activity', null, 'apartment'),
  onTravel: () => showDialog($('#tram-dialog')),
  onActivity: (activity) => {
    if (activity.district !== district.id) {
      startExperience(
        'tram',
        DISTRICTS.find((d) => d.id === activity.district),
        activity.key
      );
    } else
      startExperience(
        activity.key === 'theatre' ? 'theatre' : 'activity',
        null,
        activity.key
      );
  },
});
const lifeBar = document.createElement('div');
lifeBar.id = 'life-bar';
lifeBar.innerHTML =
  '<span id="life-money"></span><button id="home-open">⌂ Home</button><button id="camera-mode">City view</button>';
document.body.append(lifeBar);
const refreshLife = () => {
  document.querySelector('#life-money').textContent =
    `£${life.snapshot().balance.toLocaleString('en-GB')}`;
};
life.subscribe(refreshLife);
refreshLife();
document.querySelector('#home-open').onclick = () =>
  startExperience('activity', null, 'apartment');
document.querySelector('#camera-mode').onclick = () => {
  cameraMode = cameraMode === 'close' ? 'city' : 'close';
  document.querySelector('#camera-mode').textContent =
    cameraMode === 'close' ? 'City view' : 'Follow me';
  updateCamera(1, true);
};
const target = new T.Vector3(),
  desiredCamera = new T.Vector3();
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();
function toast(message) {
  $('#toast').textContent = message;
  $('#toast').classList.add('visible');
  toastUntil = elapsed + 4;
}
function showDialog(dialog) {
  controls.reset();
  dialog.showModal();
}
$('#tram-open').addEventListener('click', () => showDialog($('#tram-dialog')));
$('#help').addEventListener('click', () => showDialog($('#help-dialog')));
document
  .querySelectorAll('[data-close]')
  .forEach((button) =>
    button.addEventListener('click', () => button.closest('dialog').close())
  );
document
  .querySelectorAll('dialog')
  .forEach((dialog) => dialog.addEventListener('close', controls.reset));
function updateTrailUI() {
  $('#trail-dots').innerHTML = Array.from(
    { length: 5 },
    (_, i) => `<i class="${i < found.size ? 'found' : ''}"></i>`
  ).join('');
  $('#trail-dots').setAttribute('aria-label', `${found.size} of 5 found`);
  $('#trail-time').textContent =
    trail === 'idle' ? 'Take your time' : `${trailTime.toFixed(1)}s`;
  $('#trail-copy').textContent =
    district.id !== 'quays'
      ? 'The local trail starts at Salford Quays.'
      : trail === 'complete'
        ? 'All five found. Fancy another lap?'
        : trail === 'running'
          ? `${found.size} of 5 found. Follow the golden bees.`
          : 'Find five golden bees around the Quays.';
  $('#trail-start').innerHTML =
    district.id !== 'quays'
      ? 'Visit the Quays <span>↗</span>'
      : trail === 'running'
        ? 'Restart trail <span>↻</span>'
        : trail === 'complete'
          ? 'Try again <span>↻</span>'
          : 'Start exploring <span>↗</span>';
  $('#trail-best').textContent = best
    ? `Personal best · ${best.toFixed(1)}s`
    : '';
}
function resetTrail() {
  trail = 'idle';
  trailTime = 0;
  found = new Set();
  bees.forEach((b) => (b.visible = false));
}
function travel(id) {
  const next = DISTRICTS.find((d) => d.id === id);
  if (!next) return;
  controls.reset();
  document.body.classList.remove('exploring');
  resetTrail();
  if (world) {
    scene.remove(world.group);
    disposeWorld(world.group);
  }
  district = next;
  world = createDistrict(id);
  scene.add(world.group);
  avatar.group.position.set(...[next.spawn[0], 0.18, next.spawn[1]]);
  avatar.group.rotation.y = Math.PI;
  yaw = 0.42;
  updateCamera(1, true);
  $('#district-title').innerHTML = next.heading;
  $('#district-description').textContent = next.subtitle;
  $('#district-name').textContent = next.label;
  $('#footer-place').textContent = next.name;
  $('.district-marker div span').textContent = next.coordinates;
  $('#district-number').textContent = `0${DISTRICTS.indexOf(next) + 1} / 05`;
  document.querySelectorAll('.stop').forEach((button) => {
    const active = button.dataset.id === id;
    button.classList.toggle('active', active);
    button.setAttribute('aria-current', String(active));
  });
  $('#venue-open').textContent = next.activity;
  $('#venue-open').hidden = false;
  updateTrailUI();
}
$('#tram-stops').innerHTML = DISTRICTS.map(
  (d, i) =>
    `<button class="stop" data-id="${d.id}"><span class="stop-number">${i + 1}</span><span><strong>${d.name}</strong><small>${d.detail}</small></span><span>↗</span></button>`
).join('');
document.querySelectorAll('.stop').forEach((button) =>
  button.addEventListener('click', () => {
    const destination = DISTRICTS.find((d) => d.id === button.dataset.id);
    $('#tram-dialog').close();
    if (destination.id === district.id) {
      toast('You are already at this stop.');
      return;
    }
    startExperience('tram', destination);
  })
);
async function startExperience(type, destination, activityKey) {
  const activity = PHONE_ACTIVITIES.find((a) => a.key === activityKey);
  if (experience || experienceLoading) return;
  experienceLoading = true;
  controls.reset();
  try {
    const module = await import(
      type === 'theatre'
        ? './theatre.js'
        : type === 'tram'
          ? './tram.js'
          : activityKey === 'apartment'
            ? './apartment.js'
            : (activity?.module ?? district.module)
    );
    outdoorState = {
      position: avatar.group.position.clone(),
      background: scene.background,
      fog: scene.fog,
      bees: bees.map((b) => b.visible),
    };
    const onExit = (destinationId = null) => {
      if (!experience) return;
      scene.remove(experience.group);
      experience.dispose();
      experience = null;
      world.group.visible = true;
      avatar.group.visible = true;
      avatar.group.rotation.set(0, Math.PI, 0);
      avatar.group.position.copy(outdoorState.position);
      scene.background = outdoorState.background;
      scene.fog = outdoorState.fog;
      scene.children
        .filter((o) => o.isLight)
        .forEach((o) => (o.visible = true));
      bees.forEach((b, i) => (b.visible = outdoorState.bees[i]));
      document.body.classList.remove('in-experience', 'experience-seated');
      controls.reset();
      if (destinationId) travel(destinationId);
      else updateCamera(1, true);
      outdoorState = null;
      if (type !== 'tram')
        phone.record(
          activityKey ||
            (type === 'theatre' ? 'theatre' : district.module.slice(2, -3))
        );
      if (destinationId && activityKey)
        startExperience(
          activityKey === 'theatre' ? 'theatre' : 'activity',
          null,
          activityKey
        );
    };
    const context = {
      avatar,
      camera,
      controls,
      onExit,
      reducedMotion,
      origin: district,
      destination,
      activityKey,
      life,
    };
    visitRewarded = false;
    experience =
      type === 'theatre'
        ? module.createTheatre(context)
        : type === 'tram'
          ? module.createTram(context)
          : module.createActivity(context);
    world.group.visible = false;
    bees.forEach((b) => (b.visible = false));
    scene.children.filter((o) => o.isLight).forEach((o) => (o.visible = false));
    scene.fog = null;
    scene.background = new T.Color(experience.background);
    scene.add(experience.group);
    document.body.classList.add('in-experience');
    experience.update(0, { x: 0, z: 0, run: false });
  } catch (error) {
    console.error('Could not open experience', error);
    toast('This visit could not load. Please try again.');
  } finally {
    experienceLoading = false;
  }
}
$('#venue-open').addEventListener('click', () =>
  startExperience(district.id === 'quays' ? 'theatre' : 'activity')
);
window.addEventListener('keydown', (e) => {
  if (
    e.code === 'KeyE' &&
    !e.repeat &&
    !document.querySelector('dialog[open]') &&
    district.id === 'quays' &&
    Math.hypot(avatar.group.position.x + 29, avatar.group.position.z - 11) < 7
  )
    startExperience('theatre');
});
$('#trail-start').addEventListener('click', () => {
  if (district.id !== 'quays') travel('quays');
  resetTrail();
  trail = 'running';
  document.body.classList.add('exploring');
  avatar.group.position.set(12, 0.18, 26);
  bees.forEach((b) => (b.visible = true));
  controls.reset();
  updateCamera(1, true);
  updateTrailUI();
  $('#trail-start').blur();
  toast('Walk into the golden bees. The first is by the promenade.');
});
function updateCamera(dt, snap = false) {
  // Broad, elevated view keeps landmarks and paths legible on a small screen.
  const mobile = camera.aspect < 0.85;
  const close = cameraMode === 'close';
  const distance = close ? (mobile ? 8 : 10) : mobile ? 54 : 66;
  target.set(
    avatar.group.position.x * (close || mobile ? 1 : 0.65),
    1,
    avatar.group.position.z * (close || mobile ? 1 : 0.7) - (close ? 0 : 5)
  );
  desiredCamera.set(
    target.x + Math.sin(yaw) * distance,
    close ? 5.5 : mobile ? 44 : 51,
    target.z + Math.cos(yaw) * distance
  );
  if (close && world) {
    const direction = desiredCamera.clone().sub(target);
    cameraRay.set(target, direction.clone().normalize());
    cameraRay.far = direction.length();
    const hit = cameraRay.intersectObject(world.group, true)[0];
    if (hit)
      desiredCamera
        .copy(target)
        .addScaledVector(
          direction.normalize(),
          Math.max(2, hit.distance - 0.6)
        );
  }
  if (snap) camera.position.copy(desiredCamera);
  else camera.position.lerp(desiredCamera, 1 - Math.exp(-dt * 5));
  camera.lookAt(target);
}
function update(dt) {
  elapsed += dt;
  const paused = Boolean(document.querySelector('dialog[open]'));
  if (experience) {
    if (!paused) {
      experience.update(dt, controls.read());
      const state = experience?.snapshot();
      const complete =
        state &&
        (state.state === 'complete' ||
          (state.type === 'penalties' &&
            state.shots === 5 &&
            !state.shooting) ||
          (state.type === 'rhythm' &&
            state.state === 'ended' &&
            state.score > 0));
      if (complete && !visitRewarded) {
        visitRewarded = true;
        const earned = life.reward(state.type);
        if (earned) {
          const notice = document.createElement('div');
          notice.className = 'reward-notice';
          notice.textContent = `Unlocked: ${earned}`;
          document.querySelector('#experience-ui')?.append(notice);
        }
      }
    }
    return;
  }
  if (experienceLoading) return;
  const input = controls.read(),
    speed = input.run ? 10 : 6;
  const dx = (input.x * Math.cos(yaw) + input.z * Math.sin(yaw)) * speed * dt;
  const dz = (-input.x * Math.sin(yaw) + input.z * Math.cos(yaw)) * speed * dt;
  const p = avatar.group.position;
  const beforeX = p.x,
    beforeZ = p.z;
  // Axis-separated collision lets the avatar slide along walls instead of sticking.
  if (canWalk(p.x + dx, p.z, world.obstacles)) p.x += dx;
  if (canWalk(p.x, p.z + dz, world.obstacles)) p.z += dz;
  const moving = Math.hypot(p.x - beforeX, p.z - beforeZ) > 0.00001;
  if (moving) document.body.classList.add('exploring');
  if (moving) avatar.group.rotation.y = Math.atan2(dx, dz);
  avatar.animate(elapsed, moving && !reducedMotion);
  if (trail === 'running' && !paused) {
    trailTime += dt;
    TRAIL_POINTS.forEach((point, i) => {
      if (!found.has(i) && Math.hypot(p.x - point.x, p.z - point.z) < 1.8) {
        found.add(i);
        bees[i].visible = false;
        toast(`${point.name} · ${found.size} of 5`);
        if (found.size === 5) {
          trail = 'complete';
          if (!best || trailTime < best) {
            best = trailTime;
            try {
              localStorage.setItem('manchester-trail-best-v1', String(best));
            } catch {
              /* Best remains valid for this session. */
            }
          }
          toast(
            `The Quays, explored. Five bees in ${trailTime.toFixed(1)} seconds!`
          );
        }
        updateTrailUI();
      }
    });
  }
  if (!reducedMotion)
    bees.forEach((bee, i) => {
      bee.position.y = 1.65 + Math.sin(elapsed * 2 + i) * 0.18;
      bee.rotation.y = elapsed * 0.5;
    });
  if (elapsed - lastUI > 0.1) {
    if (trail === 'running')
      $('#trail-time').textContent = `${trailTime.toFixed(1)}s`;
    lastUI = elapsed;
  }
  if (elapsed > toastUntil) $('#toast').classList.remove('visible');
  updateCamera(dt);
}
function render() {
  renderer.render(scene, camera);
}
canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  $('#error').hidden = false;
  $('#error-message').textContent =
    'Your browser paused the 3D renderer. Reload to return to the Quays.';
});
travel('quays');
render();
$('#loading').hidden = true;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastNow) / 1000, 0.05);
  lastNow = now;
  if (document.hidden || now < manualUntil) return;
  update(dt);
  render();
}
requestAnimationFrame(frame);
window.advanceTime = (ms) => {
  manualUntil = performance.now() + 150;
  const seconds = Math.min(Math.max(Number(ms) || 0, 0), 60000) / 1000;
  const steps = Math.max(1, Math.ceil(seconds * 60));
  for (let i = 0; i < steps; i++) update(seconds / steps);
  render();
};
window.render_game_to_text = () =>
  JSON.stringify({
    mode: 'solo-world-scaffold',
    district: district.id,
    experience: experience?.snapshot() ?? null,
    experienceLoading,
    phone: phone.snapshot(),
    coordinates: 'metres; +x east, +z south, y up; movement relative to camera',
    player: {
      x: +avatar.group.position.x.toFixed(2),
      z: +avatar.group.position.z.toFixed(2),
    },
    life: life.snapshot(),
    cameraMode,
    cameraDistance: +camera.position
      .distanceTo(avatar.group.position)
      .toFixed(2),
    cameraYaw: +yaw.toFixed(3),
    trail: {
      status: trail,
      collected: found.size,
      elapsed: +trailTime.toFixed(2),
      best,
    },
    remaining:
      trail === 'running' ? TRAIL_POINTS.filter((_, i) => !found.has(i)) : [],
    obstacles: world.obstacles,
    dialogOpen: Boolean(document.querySelector('dialog[open]')),
    renderer: {
      calls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      geometries: renderer.info.memory.geometries,
      textures: renderer.info.memory.textures,
      pixelRatio: renderer.getPixelRatio(),
    },
  });
