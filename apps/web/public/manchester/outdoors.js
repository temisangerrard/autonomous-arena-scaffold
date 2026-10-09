import * as T from './vendor/three.module.min.js';
import { createAvatar, Builder } from './world.js';
import { activityBase, SOUND_BUTTON } from './activity-common.js';
const STOPS = [
  [
    'Castlefield',
    'Brick warehouses, railway arches and the start of our compressed canal journey.',
  ],
  [
    'Pomona',
    'The city opens out. Watch the old industrial waterfront pass by.',
  ],
  [
    'Stretford',
    'Beyond the busy centre, the towpath becomes greener and the pace slows.',
  ],
  [
    'Sale',
    'You’ve reached Sale. Take a moment by the water before returning to your departure point.',
  ],
];
export function createActivity(context) {
  const mode = context.activityKey,
    run = mode === 'run',
    rowing = mode === 'rowing',
    tour = mode === 'tour' || mode === 'sunset-tour';
  const sunset = mode === 'sunset-tour';
  const a = activityBase(
      context,
      run
        ? 'A run by the water.'
        : rowing
          ? 'Find your rowing rhythm.'
          : sunset
            ? 'Your private sunset cruise.'
            : 'The slow way to Sale.',
      run
        ? 'Salford Quays · Waterfront run'
        : rowing
          ? 'Salford Quays · Rowing challenge'
          : 'Castlefield to Sale · Compressed fictional canal tour'
    ),
    b = a.builder;
  b.box(0, -0.6, 0, 65, 0.5, 180, '#769688');
  b.box(-4, -0.15, 0, 23, 0.2, 180, sunset ? '#be8e91' : '#679d9d');
  b.box(13, -0.05, 0, 11, 0.25, 180, '#c9c5ab');
  for (let z = -70; z < 70; z += 12) {
    b.tree(22, z, 1.2);
    b.tree(-19, z, 1.1);
    b.building(-25, z, 7, 7, 5 + ((z + 70) % 4), '#b6a78e', { glass: true });
    b.lamp(18, z);
    b.box(-3, 0.02, z, 17, 0.02, 0.06, '#90bdb4');
  }
  if (run) {
    for (const x of [9, 17]) b.box(x, 0.1, 0, 0.09, 0.04, 175, '#f7edc9');
    for (let i = 0; i < 10; i++) {
      b.shape(
        'cone',
        i % 2 ? 15 : 11,
        0.5,
        20 - (10 + i * 7) * 0.72,
        0.3,
        0.9,
        0.3,
        '#b2754f'
      );
    }
  }
  b.building(-24, -30, 10, 10, 16, '#a0afa3', { glass: true });
  b.building(-24, -50, 10, 10, 21, '#b3baab', { glass: true });
  a.finish();
  const runner = createAvatar();
  runner.group.position.set(13, 0.16, 20);
  runner.group.rotation.y = Math.PI;
  runner.group.visible = run;
  a.group.add(runner.group);
  const boat = new T.Group();
  for (const [w, h, d, y, color] of [
    [rowing ? 1.4 : 3, 0.55, rowing ? 4 : 7, 0, '#7b3d48'],
    [rowing ? 1 : 2.6, 0.5, rowing ? 1.8 : 4, 0.45, '#cbbb92'],
  ]) {
    const mesh = new T.Mesh(
      new T.BoxGeometry(w, h, d),
      new T.MeshStandardMaterial({ color })
    );
    mesh.position.y = y;
    boat.add(mesh);
  }
  boat.position.set(0, 0.3, 20);
  boat.visible = !run;
  a.group.add(boat);
  const oars = [-1, 1].map((side) => {
    const g = new T.Group();
    const shaft = new T.Mesh(
      new T.BoxGeometry(3, 0.08, 0.1),
      new T.MeshStandardMaterial({ color: '#dfcda0' })
    );
    shaft.position.x = side * 1.5;
    g.add(shaft);
    g.position.x = side * 0.6;
    g.visible = rowing;
    boat.add(g);
    return g;
  });
  let state = 'ready',
    time = 0,
    distance = 0,
    stamina = 100,
    sprint = false,
    lane = 13,
    lastStroke = null,
    lastStrokeTime = -1,
    strokes = 0,
    balance = 0,
    collisions = new Set(),
    cue = -1,
    paused = false;
  function actions() {
    a.ui.actions(
      run
        ? `<button id="outdoor-start" class="primary-action">Start run</button><button id="run-left">← Left</button><button id="run-pace">Sprint</button><button id="run-right">Right →</button>${SOUND_BUTTON}`
        : rowing
          ? `<button id="outdoor-start" class="primary-action">Launch boat</button><button id="row-left">Left oar · A</button><button id="row-right">Right oar · D</button>${SOUND_BUTTON}`
          : `<button id="outdoor-start" class="primary-action">Begin boat tour</button><button id="tour-pause" disabled>Pause & look</button>${SOUND_BUTTON}`
    );
    a.audio();
    a.ui.on('outdoor-start', () => {
      state = 'playing';
      time = distance = strokes = balance = 0;
      stamina = 100;
      sprint = false;
      lastStroke = null;
      lastStrokeTime = -1;
      collisions = new Set();
      cue = -1;
      paused = false;
      lane = 13;
      a.ui.root.querySelector('#outdoor-start').textContent = 'Start again';
      if (tour) {
        a.ui.root.querySelector('#tour-pause').disabled = false;
        a.ui.root.querySelector('#tour-pause').textContent = 'Pause & look';
      }
      if (run) a.ui.root.querySelector('#run-pace').textContent = 'Sprint';
    });
    if (run) {
      a.ui.on('run-left', () => (lane = Math.max(9, lane - 2)));
      a.ui.on('run-right', () => (lane = Math.min(17, lane + 2)));
      a.ui.on('run-pace', () => {
        sprint = !sprint;
        a.ui.root.querySelector('#run-pace').textContent = sprint
          ? 'Jog'
          : 'Sprint';
      });
    }
    if (rowing) {
      a.ui.on('row-left', () => stroke('left'));
      a.ui.on('row-right', () => stroke('right'));
    }
    if (tour)
      a.ui.on('tour-pause', () => {
        paused = !paused;
        a.ui.root.querySelector('#tour-pause').textContent = paused
          ? 'Continue cruising'
          : 'Pause & look';
      });
  }
  function stroke(side) {
    if (state !== 'playing' || time - lastStrokeTime < 0.18) return;
    const alternating = lastStroke !== side;
    distance = Math.min(100, distance + (alternating ? 4 : 1));
    balance = T.MathUtils.clamp(balance + (side === 'left' ? 1 : -1), -5, 5);
    strokes++;
    lastStroke = side;
    lastStrokeTime = time;
    a.sound.note(side === 'left' ? 261 : 329, 0.15);
    if (distance >= 100) complete();
  }
  function complete() {
    state = 'complete';
    sprint = false;
    a.sound.chord();
    a.ui.caption(
      run ? 'Run complete' : rowing ? 'Row complete' : 'Welcome to Sale',
      run
        ? `100 metres in ${time.toFixed(1)} seconds. ${collisions.size} cones clipped. Try another lap.`
        : rowing
          ? `100 metres in ${strokes} strokes. Alternate your oars to keep a steady rhythm.`
          : 'You’ve reached the end of this miniature tour. Use Back to the street to return to your departure point.'
    );
    a.ui.root.querySelector('#outdoor-start').textContent = tour
      ? 'Take the tour again'
      : 'Try again';
    if (tour) a.ui.root.querySelector('#tour-pause').disabled = true;
  }
  actions();
  a.ui.caption(
    run
      ? 'Your route · 100 metres'
      : rowing
        ? 'Your boat · 100 metres'
        : 'Four chapters · 48 seconds',
    run
      ? 'Jog or sprint, steer left and right, and avoid the cones. Sprinting uses energy.'
      : rowing
        ? 'Alternate the left and right oars. Repeating one side turns the boat and slows your progress.'
        : 'A short interpretation of a canal journey through Castlefield, Pomona, Stretford and Sale. Not a real-world navigation route.'
  );
  function key(e) {
    if (e.repeat || !rowing) return;
    if (e.code === 'KeyA') stroke('left');
    if (e.code === 'KeyD') stroke('right');
  }
  window.addEventListener('keydown', key);
  let display = 0;
  return {
    group: a.group,
    background: sunset ? '#edbb9a' : '#c9ddd3',
    update(dt, input) {
      if (state === 'playing' && !paused) {
        time += dt;
        if (run) {
          const fast = sprint && stamina > 0;
          distance = Math.min(100, distance + dt * (fast ? 7 : 3.6));
          stamina = T.MathUtils.clamp(stamina + dt * (fast ? -20 : 9), 0, 100);
          lane = T.MathUtils.clamp(lane + input.x * dt * 5, 9, 17);
          if (stamina === 0) {
            sprint = false;
            a.ui.root.querySelector('#run-pace').textContent = 'Sprint';
          }
          for (let i = 0; i < 10; i++) {
            const coneD = 10 + i * 7;
            if (
              Math.abs(distance - coneD) < 0.5 &&
              Math.abs(lane - (i % 2 ? 15 : 11)) < 0.7 &&
              !collisions.has(i)
            ) {
              collisions.add(i);
              stamina = Math.max(0, stamina - 15);
              time += 1.5;
            }
          }
          if (distance >= 100) complete();
        } else if (tour) {
          distance = Math.min(100, (time / 48) * 100);
          const index = Math.min(3, Math.floor(time / 12));
          if (index !== cue) {
            cue = index;
            a.ui.caption(...STOPS[index]);
            a.sound.note(329, 0.6);
          }
          if (time >= 48) complete();
        }
      }
      const z = 20 - distance * 0.72;
      runner.group.position.set(lane, 0.16, z);
      runner.animate(time, state === 'playing' && !context.reducedMotion);
      boat.position.set(rowing ? balance * 0.22 : 0, 0.3, z);
      boat.rotation.y = rowing ? balance * 0.05 : 0;
      oars.forEach(
        (o, i) =>
          (o.rotation.y = context.reducedMotion
            ? 0
            : Math.sin((time - lastStrokeTime) * 8) *
              Math.exp(-Math.max(0, time - lastStrokeTime) * 4) *
              (i ? 1 : -1))
      );
      if (run) {
        context.camera.position.set(23, 13, z + 20);
        context.camera.lookAt(13, 0, z - 1);
      } else {
        context.camera.position.set(
          context.camera.aspect < 0.85 ? 19 : 23,
          tour ? 23 : 22,
          z + 26
        );
        context.camera.lookAt(0, 0, z - 1);
      }
      display += dt;
      if (display > 0.2 && state === 'playing' && !tour) {
        a.ui.caption(
          `${Math.floor(distance)} / 100 m`,
          run
            ? `${sprint ? 'Sprinting' : 'Jogging'} · Energy ${Math.round(stamina)}% · ${time.toFixed(1)}s`
            : `${strokes} strokes · ${Math.abs(balance) < 2 ? 'Steady course' : 'Balance your strokes'} · ${time.toFixed(1)}s`
        );
        display = 0;
      }
    },
    snapshot() {
      return {
        type: mode,
        state,
        time: +time.toFixed(2),
        distance: +distance.toFixed(1),
        stamina: Math.round(stamina),
        strokes,
        balance,
        paused,
        chapter: cue,
      };
    },
    dispose() {
      window.removeEventListener('keydown', key);
      a.dispose();
    },
  };
}
