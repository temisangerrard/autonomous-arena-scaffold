import * as T from './vendor/three.module.min.js';
import { Builder, disposeWorld, createAvatar } from './world.js';
import { experienceUI } from './experience-ui.js';
import { createSound } from './sound.js';

export function createTram({
  origin,
  destination,
  camera,
  avatar,
  onExit,
  reducedMotion,
}) {
  const group = new T.Group(),
    b = new Builder();
  // Open cutaway carriage keeps the seats, doors and passing street visible on phones.
  b.box(0, -0.2, 0, 5.8, 0.4, 14, '#606b68');
  b.box(0, 0.01, 0, 1.5, 0.04, 14, '#b5ad80');
  b.box(-2.8, 0.6, 0, 0.2, 1.2, 14, '#e0b74c');
  b.box(2.8, 0.6, 0, 0.2, 1.2, 14, '#e0b74c');
  for (const x of [-2.8, 2.8])
    for (const z of [-6, -2, 2, 6]) {
      b.box(x, 2.1, z, 0.13, 3, 0.14, '#dfd7b5');
      if (x < 0) b.box(x, 3.7, z, 0.2, 0.15, 4, '#d6bb72');
    }
  for (const x of [-1.85, 1.85])
    for (const z of [-4.5, -1.5, 1.5, 4.5]) {
      b.box(x, 0.65, z, 1.2, 0.3, 1.9, '#4e7272');
      b.box(x + (x < 0 ? -0.45 : 0.45), 1.15, z, 0.3, 1, 1.9, '#597f79');
    }
  b.box(0, 1.8, -7, 5.8, 3.6, 0.2, '#e4ce91');
  b.box(0, 2.2, -6.8, 3.9, 1.7, 0.08, '#627f7d');
  b.label('MANCHESTER', 0, 3.4, -6.6, 4, '#263e3e', '#e8c468');
  for (const z of [-5, 0, 5])
    b.shape('cylinder', 0.8, 1.9, z, 0.04, 3.8, 0.04, '#d2b461');
  const car = b.finish();
  group.add(car.group);
  const riders = [];
  const riderSpecs = [
    { x: -1.85, z: 1.5, color: avatar.getOutfit(), skinTone: '#a96946', hairColor: '#29221f', player: true },
    { x: 1.85, z: -1.5, color: '#487a91', skinTone: '#70462f', hairColor: '#201c1b' },
    { x: -1.85, z: -4.5, color: '#d1a149', skinTone: '#e2b28f', hairColor: '#704735' },
    { x: 1.85, z: 4.5, color: '#718b69', skinTone: '#bf8962', hairColor: '#b5b1a6' },
  ];
  for (const spec of riderSpecs) {
    const rider = createAvatar(spec);
    rider.setOutfit(spec.color);
    rider.group.position.set(spec.x + (spec.x < 0 ? 0.35 : -0.35), 0, spec.z);
    rider.group.rotation.y = spec.x < 0 ? Math.PI / 2 : -Math.PI / 2;
    // Ground shadow belongs to walking avatars, not seated passengers.
    rider.group.children.find(child => child.isMesh).visible = false;
    rider.sit();
    group.add(rider.group);
    riders.push(rider);
  }
  const seatMarker = new Builder();
  seatMarker.label('YOU', -1.85, 2.45, 1.5, 0.9, '#24483e', '#e9efd8');
  group.add(seatMarker.finish().group);
  const scenery = new T.Group();
  group.add(scenery);
  const blocks = [];
  for (let i = 0; i < 7; i++) {
    const block = new Builder();
    block.box(0, -0.6, 0, 80, 0.5, 18, '#bfbaa4');
    for (const x of [-12, 14]) {
      block.building(
        x,
        0,
        8,
        9,
        6 + (i % 3) * 3,
        i % 2 ? '#a5755a' : '#92a299'
      );
      block.tree(x + (x < 0 ? 6 : -6), 5, 0.7);
    }
    const built = block.finish().group;
    built.position.z = i * 18 - 60;
    scenery.add(built);
    blocks.push(built);
  }
  group.add(new T.HemisphereLight('#fff1cf', '#778d87', 2.4));
  const sun = new T.DirectionalLight('#fff0ce', 1.8);
  sun.position.set(-10, 20, 10);
  group.add(sun);
  const ui = experienceUI(
      'Next stop: ' + destination.name,
      `On the tram · From ${origin.name}`
    ),
    sound = createSound();
  let time = 0,
    requested = false,
    view = 'carriage',
    arrived = false,
    disposed = false;
  avatar.group.visible = false;
  document.body.classList.add('experience-seated');
  ui.root.querySelector('#experience-exit').textContent = 'Cancel ride ↗';
  ui.on('experience-exit', () => onExit(null));
  ui.actions(
    '<button id="tram-view" class="primary-action">Look out the window</button><button id="tram-bell">Request stop · Ring bell</button><button id="tram-sound" aria-pressed="false">Enable sound</button><button id="tram-leave" disabled>Arriving shortly…</button>'
  );
  ui.caption(
    'Doors closing',
    `Find your seat. We’re heading to ${destination.name}. This short ride takes about 20 seconds.`
  );
  ui.on('tram-view', () => {
    view = view === 'carriage' ? 'window' : 'carriage';
    ui.root.querySelector('#tram-view').textContent =
      view === 'carriage' ? 'Look out the window' : 'Back to your seat';
  });
  ui.on('tram-bell', () => {
    if (requested) return;
    requested = true;
    sound.note(660, 0.5);
    sound.note(880, 0.7, 0.15);
    ui.root.querySelector('#tram-bell').textContent = 'Stop requested ✓';
    ui.root.querySelector('#tram-bell').setAttribute('aria-pressed', 'true');
    ui.caption(
      'Stop requested',
      `The driver will stop at ${destination.name}.`
    );
  });
  ui.on('tram-sound', async () => {
    const enabled = await sound.toggle();
    if (disposed) return;
    ui.root.querySelector('#tram-sound').textContent = enabled
      ? 'Sound on'
      : 'Enable sound';
    ui.root
      .querySelector('#tram-sound')
      .setAttribute('aria-pressed', String(enabled));
    if (enabled) sound.note(440, 0.4);
  });
  ui.on('tram-leave', () => {
    if (arrived) onExit(destination.id);
  });
  return {
    group,
    background: '#cbdcd5',
    update(dt) {
      time = Math.min(20, time + dt);
      if (!reducedMotion)
        blocks.forEach(
          (block, i) => (block.position.z = ((i * 18 + time * 5) % 126) - 63)
        );
      if (time >= 20 && !arrived) {
        arrived = true;
        sound.note(660, 0.5);
        ui.caption(
          'Doors open',
          `${destination.name}. Mind the gap, and enjoy your visit.`
        );
        const leave = ui.root.querySelector('#tram-leave');
        leave.disabled = false;
        leave.textContent = 'Step off the tram ↗';
        leave.classList.add('primary-action');
      }
      riders.forEach((rider, i) => rider.sit(reducedMotion ? 0 : time + i));
      const sway = reducedMotion || arrived ? 0 : Math.sin(time * 2) * 0.045;
      if (view === 'carriage') {
        camera.position.set(camera.aspect < 0.85 ? 6.8 : 7, 5.4, camera.aspect < 0.85 ? 10 : 8);
        camera.lookAt(0, 1.2, 0.7);
      } else {
        camera.position.set(0.2, 2.1 + sway, 1);
        camera.lookAt(-12, 3, -6);
      }
    },
    snapshot() {
      return {
        type: 'tram',
        passengers: riders.length,
        playerSeated: true,
        playerOutfit: riders[0].getOutfit(),
        origin: origin.id,
        destination: destination.id,
        time: +time.toFixed(2),
        requested,
        arrived,
        view,
        sound: sound.enabled,
      };
    },
    dispose() {
      disposed = true;
      ui.dispose();
      sound.dispose();
      disposeWorld(group);
      document.body.classList.remove('experience-seated');
    },
  };
}
