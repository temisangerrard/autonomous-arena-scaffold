import * as T from './vendor/three.module.min.js';
import { Builder, createAvatar, disposeWorld } from './world.js';
import { canWalk } from './districts.js';
import { experienceUI } from './experience-ui.js';
import { createSound } from './sound.js';

const LINES = [
  [
    'Scene one · The stop',
    'Manchester. One wet evening. Two strangers. One last tram.',
  ],
  ['Mara', 'It said two minutes when I got here. That was twelve minutes ago.'],
  ['Eli', 'Manchester minutes. They stretch in the rain.'],
  [
    'Mara',
    'First night on stage. Twenty-seven people watched me forget my name.',
  ],
  ['Eli', 'Did they leave?'],
  ['Mara', 'No. Someone in the back started clapping. Then everyone did.'],
  ['Eli', 'Sounds like they remembered you, then.'],
  [
    'Scene two · A small kindness',
    'The rain eases. Eli moves the umbrella between them.',
  ],
  ['Mara', 'What about you? Where are you going?'],
  ['Eli', 'Home. Eventually. I came out because the flat was too quiet.'],
  [
    'Mara',
    'Come tomorrow. There’ll be twenty-eight of you. I might remember my name.',
  ],
  ['Eli', 'I’ll sit at the back. Just in case you need someone to start.'],
  [
    'Final scene · Homeward',
    'A bell sounds. The last tram arrives. They step forward together.',
  ],
];
const DURATION = LINES.length * 7;
function foyer() {
  const b = new Builder();
  b.box(0, -0.2, 6, 24, 0.4, 27, '#bca88c');
  b.box(0, 5, -7, 24, 10, 0.5, '#746757');
  b.box(-12, 4, 6, 0.4, 8, 27, '#b28b68');
  b.box(12, 4, 6, 0.4, 8, 27, '#b28b68');
  b.box(0, 0.02, 6, 5, 0.035, 25, '#773b49');
  for (const x of [-10, -5, 5, 10]) {
    b.shape('cylinder', x, 4, 0, 0.25, 8, 0.25, '#d6bd92');
    b.block(x, 0, 0.5, 0.5);
  }
  b.box(-7, 1.2, 6, 6, 2.4, 2, '#704c40');
  b.block(-7, 6, 6, 2);
  b.label('BOX OFFICE', -7, 3.1, 7.1, 5);
  b.box(0, 2.6, -6.6, 5, 5.2, 0.3, '#3a2631');
  b.box(0, 2.4, -6.35, 0.08, 4.8, 0.04, '#c6a068');
  b.label('THE LYRIC · AUDITORIUM', 0, 6.1, -6.2, 11, '#e8d1a1', '#46333b');
  b.label('THE LAST TRAM HOME', 7, 4.5, -6.1, 8, '#f0d3a0', '#753847');
  b.label('AN ORIGINAL MINIATURE PLAY', 7, 3.1, -6.1, 8, '#f0d3a0', '#753847');
  for (const x of [-8, 8]) {
    b.bench(x, 13);
    b.tree(x, 16, 0.7);
  }
  const result = b.finish();
  result.group.add(new T.HemisphereLight('#ffe5bd', '#6a5766', 2.3));
  return result;
}
function auditorium() {
  const b = new Builder();
  b.box(0, -0.3, 1, 29, 0.6, 39, '#352f3b');
  b.box(0, 7, -18, 29, 14, 0.5, '#182535');
  b.box(-14, 5, 0, 0.4, 10, 36, '#703c47');
  b.box(14, 5, 0, 0.4, 10, 36, '#703c47');
  for (const x of [-13, 13]) {
    b.box(x, 6, -12, 1, 12, 4, '#b39159');
    b.box(x, 6, -10, 1.6, 12, 0.4, '#d1b477');
  }
  b.box(0, 11.5, -10, 27, 1.2, 1, '#ae8148');
  b.box(0, 10.7, -10, 25, 0.5, 0.6, '#79534a');
  b.box(0, 0.6, -12, 25, 1.2, 11, '#94704d');
  b.box(0, 1.22, -12, 22, 0.025, 9, '#65554a');
  for (const x of [-11.7, 11.7])
    for (let i = 0; i < 5; i++)
      b.shape('cylinder', x + i * 0.25, 6, -11, 0.35, 10, 0.45, '#7b3146');
  for (let row = 0; row < 5; row++)
    for (const side of [-1, 1])
      for (let col = 0; col < 5; col++) {
        const x = side * (2 + col * 1.8),
          z = -2 + row * 3;
        b.box(x, 0.6, z, 1.4, 0.4, 1.4, '#7b344a');
        b.box(x, 1.3, z + 0.5, 1.4, 1.2, 0.3, '#8f4658');
        b.block(x, z, 1.4, 1.7);
      }
  for (const z of [-3, 0, 3, 6, 9, 12])
    for (const x of [-0.8, 0.8]) b.box(x, 0.05, z, 0.12, 0.08, 0.3, '#dfb46c');
  // Original miniature stage set: brick skyline, shelter and tram sign.
  for (let i = 0; i < 9; i++) {
    const h = 3 + ((i * 7) % 5);
    b.box(
      -10 + i * 2.5,
      1.2 + h / 2,
      -17,
      2.2,
      h,
      0.7,
      i % 2 ? '#3d5763' : '#4c6670'
    );
    for (let r = 0; r < 3; r++)
      b.box(-10 + i * 2.5, 2 + r * 1.5, -16.6, 0.5, 0.65, 0.06, '#d2b374');
  }
  b.box(4, 3.3, -14.5, 0.12, 4, 0.12, '#c7b78b');
  b.box(4, 5.1, -14.5, 2.4, 0.65, 0.2, '#d4b047');
  b.label('LAST TRAM', 4, 5.1, -14.35, 2.3, '#334d50', '#e9c760');
  b.bench(3, -14);
  b.box(-4, 3, -15, 5, 0.12, 3, '#536c72');
  b.box(-6.3, 2, -15, 0.1, 2, 0.1, '#a7b4b0');
  const result = b.finish();
  result.group.add(new T.HemisphereLight('#f6ce91', '#344468', 1.5));
  const key = new T.PointLight('#ffd49a', 80, 30, 1.3);
  key.position.set(-3, 8, -8);
  result.group.add(key);
  const blue = new T.PointLight('#7caedc', 35, 25, 1.2);
  blue.position.set(7, 6, -13);
  result.group.add(blue);
  result.key = key;
  return result;
}
export function createTheatre({
  avatar,
  camera,
  controls,
  onExit,
  reducedMotion,
}) {
  const group = new T.Group(),
    lobby = foyer(),
    hall = auditorium();
  group.add(lobby.group, hall.group);
  hall.group.visible = false;
  const actors = [createAvatar(), createAvatar()];
  actors.forEach((a, i) => {
    a.group.scale.setScalar(1.65);
    a.group.position.set(i ? 3 : -3, 1.25, -11.5);
    hall.group.add(a.group);
  });
  const ui = experienceUI(
    'An evening at the Lowry',
    'Salford Quays · Fictional interior & original production'
  );
  const sound = createSound();
  let room = 'foyer',
    seat = 'middle',
    status = 'ready',
    time = 0,
    line = -1,
    bow = 0,
    applauds = 0,
    view = 'seat',
    disposed = false;
  avatar.group.position.set(0, 0.18, 13);
  avatar.group.visible = true;
  ui.on('experience-exit', () => onExit());
  function audioButton() {
    return `<button id="show-sound" aria-pressed="${sound.enabled}">${sound.enabled ? 'Sound on' : 'Enable sound'}</button>`;
  }
  function wireSound() {
    ui.on('show-sound', async () => {
      const enabled = await sound.toggle();
      if (disposed) return;
      const b = ui.root.querySelector('#show-sound');
      b.textContent = enabled ? 'Sound on' : 'Enable sound';
      b.setAttribute('aria-pressed', String(enabled));
      if (enabled) sound.chord();
    });
  }
  function actions() {
    if (room === 'foyer') {
      ui.actions(
        `<button id="auditorium-enter" class="primary-action">Enter the auditorium ↗</button>${audioButton()}`
      );
      ui.caption(
        'The foyer',
        'Have a wander, then head through to the auditorium. Your seat is waiting.'
      );
      ui.on('auditorium-enter', () => {
        room = 'auditorium';
        lobby.group.visible = false;
        hall.group.visible = true;
        avatar.group.position.set(0, 0.18, 15);
        controls.reset();
        actions();
      });
    } else if (room === 'auditorium') {
      ui.actions(
        `<label>Your seat <select id="seat-choice"><option value="front">Front row</option><option value="middle" selected>Middle stalls</option><option value="back">Back row</option></select></label><button id="take-seat" class="primary-action">Take a seat</button><button id="show-foyer">Foyer</button>${audioButton()}`
      );
      ui.caption(
        'The auditorium',
        'Walk down the centre aisle, or choose a row and take your seat.'
      );
      ui.on('take-seat', () => {
        seat = ui.root.querySelector('#seat-choice').value;
        room = 'seated';
        document.body.classList.add('experience-seated');
        avatar.group.visible = false;
        controls.reset();
        actions();
      });
      ui.on('show-foyer', () => {
        room = 'foyer';
        lobby.group.visible = true;
        hall.group.visible = false;
        avatar.group.position.set(0, 0.18, 13);
        actions();
      });
    } else {
      ui.actions(
        `<button id="show-start" class="primary-action">${status === 'playing' ? 'Pause' : status === 'paused' ? 'Resume' : status === 'ended' ? 'Watch again' : 'Begin the play'}</button><button id="applaud">Applaud${applauds ? ' · ' + applauds : ''}</button><button id="show-view">${view === 'seat' ? 'Stage close-up' : 'Seat view'}</button><button id="stand-up">Leave seat</button>${audioButton()}`
      );
      if (status === 'ready')
        ui.caption(
          'The Last Tram Home · 91 seconds',
          'Two strangers, a rainy evening, and a small kindness. An original captioned play.'
        );
      ui.on('show-start', () => {
        if (status === 'playing') status = 'paused';
        else if (status === 'paused') status = 'playing';
        else {
          status = 'playing';
          time = 0;
          line = -1;
          sound.chord();
        }
        actions();
      });
      ui.on('applaud', () => {
        if (bow > 0) return;
        bow = 2;
        applauds++;
        sound.applause();
        ui.root.querySelector('#applaud').textContent = `Applaud · ${applauds}`;
      });
      ui.on('show-view', () => {
        view = view === 'seat' ? 'stage' : 'seat';
        ui.root.querySelector('#show-view').textContent =
          view === 'seat' ? 'Stage close-up' : 'Seat view';
      });
      ui.on('stand-up', () => {
        room = 'auditorium';
        if (status === 'playing') status = 'paused';
        document.body.classList.remove('experience-seated');
        avatar.group.visible = true;
        avatar.group.position.set(0, 0.18, 12);
        controls.reset();
        actions();
      });
    }
    wireSound();
  }
  actions();
  let motionTime = 0;
  return {
    group,
    background: '#171e2a',
    update(dt, input) {
      motionTime += dt;
      if (room !== 'seated') {
        const p = avatar.group.position,
          obs = room === 'foyer' ? lobby.obstacles : hall.obstacles;
        const nx = T.MathUtils.clamp(p.x + input.x * dt * 4, -11, 11),
          nz = T.MathUtils.clamp(p.z + input.z * dt * 4, -4, 17);
        if (canWalk(nx, p.z, obs)) p.x = nx;
        if (canWalk(p.x, nz, obs)) p.z = nz;
        const moving = Math.hypot(input.x, input.z) > 0.1;
        if (moving) avatar.group.rotation.y = Math.atan2(input.x, input.z);
        avatar.animate(motionTime, moving && !reducedMotion);
      }
      if (status === 'playing' && room === 'seated') {
        time = Math.min(DURATION, time + dt);
        const next = Math.min(LINES.length - 1, Math.floor(time / 7));
        if (next !== line) {
          line = next;
          ui.caption(...LINES[line]);
          sound.note(line % 2 ? 329.63 : 261.63, 0.5);
        }
        if (time >= DURATION) {
          status = 'ended';
          bow = 3;
          ui.caption(
            'Curtain call',
            'A little kindness goes a long way. Thank you for being our audience.'
          );
          sound.chord();
          actions();
        }
      }
      bow = Math.max(0, bow - dt);
      actors.forEach((actor, i) => {
        const moving = status === 'playing' && (time < 7 || time > 84),
          t = Math.min(1, time / 7);
        actor.group.position.x =
          time < 7
            ? i
              ? 6 - 3 * t
              : -6 + 3 * t
            : time > 84
              ? (i ? 3 : -3) + (time - 84) * 0.35
              : i
                ? 3
                : -3;
        actor.group.rotation.y = i ? -0.3 : 0.3;
        actor.group.rotation.x =
          bow > 0 && !reducedMotion ? Math.sin((bow / 3) * Math.PI) * 0.3 : 0;
        actor.animate(time, moving && !reducedMotion);
        if (!moving && status === 'playing' && !reducedMotion)
          actor.group.rotation.z =
            Math.sin(time * 2) * (line % 2 === i ? 0.035 : 0.01);
      });
      hall.key.color.set(time > 49 ? '#ffe0a8' : '#b2c6ef');
      if (room === 'foyer') {
        camera.position.set(15, 18, 27);
        camera.lookAt(0, 1, 3);
      } else if (room === 'auditorium') {
        camera.position.set(12, 19, 27);
        camera.lookAt(0, 1, -2);
      } else {
        const z =
          view === 'stage' ? -3 : { front: 0, middle: 6, back: 13 }[seat];
        camera.position.set(
          0,
          view === 'stage' ? 4.5 : 3.5,
          z + (camera.aspect < 0.85 ? 7 : 0)
        );
        camera.lookAt(0, 3.4, -12);
      }
    },
    snapshot() {
      return {
        type: 'theatre',
        room,
        seat,
        status,
        time: +time.toFixed(2),
        duration: DURATION,
        line,
        applauds,
        sound: sound.enabled,
        view,
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
