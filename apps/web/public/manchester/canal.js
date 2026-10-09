import * as T from './vendor/three.module.min.js';
import { activityBase, SOUND_BUTTON } from './activity-common.js';
export function createActivity(context) {
  const a = activityBase(
      context,
      'Work the lock.',
      'Castlefield · A narrowboat journey'
    ),
    b = a.builder;
  b.box(0, -1.5, 0, 25, 1, 35, '#a49c80');
  for (const x of [-5, 5]) {
    b.box(x, 1, 0, 3, 4, 29, '#9a7155');
    b.box(x, 3.1, 0, 3.4, 0.2, 29, '#c4b395');
  }
  b.box(0, -0.5, 11, 7, 0.2, 8, '#5a9697');
  b.box(0, 1.5, -11, 7, 0.2, 8, '#5a9697');
  for (const x of [-10, 10]) {
    b.tree(x, -8);
    b.bench(x, 7);
    b.lamp(x, 1);
  }
  b.label('CASTLEFIELD LOCK', 0, 6, -15, 15);
  a.finish();
  const water = new T.Mesh(
    new T.BoxGeometry(7, 0.12, 14),
    new T.MeshStandardMaterial({ color: '#619d9d', roughness: 0.6 })
  );
  water.position.y = -0.5;
  a.group.add(water);
  const boat = new T.Group();
  for (const [w, h, d, y, color] of [
    [2.5, 0.7, 5, 0.2, '#7d3d48'],
    [2.2, 0.8, 3, 0.95, '#d5bc8b'],
    [2.5, 0.2, 3.5, 1.45, '#455d59'],
  ]) {
    const m = new T.Mesh(
      new T.BoxGeometry(w, h, d),
      new T.MeshStandardMaterial({ color })
    );
    m.position.y = y;
    boat.add(m);
  }
  boat.position.set(0, -0.5, 11);
  a.group.add(boat);
  const gates = [7, -7].map((z) => {
    const m = new T.Mesh(
      new T.BoxGeometry(7, 3, 0.3),
      new T.MeshStandardMaterial({ color: '#624c3a' })
    );
    m.position.set(0, 0.8, z);
    a.group.add(m);
    return m;
  });
  gates[0].position.x = 7;
  let state = 'ready',
    time = 0,
    level = 0;
  const instructions = {
    ready: 'The lower gate is open. Bring the boat into the lock.',
    entering: 'The boat is entering. Wait until it is safely inside.',
    inside: 'Close the lower gate before raising the water.',
    sealed: 'Both gates are closed. Fill the lock to reach the upper canal.',
    filling: 'The water is rising. The boat rises with it.',
    full: 'Water levels match. Open the upper gate.',
    open: 'The way is clear. Guide the boat out.',
    leaving: 'Safe passage. Your boat is heading into Castlefield.',
    complete:
      'You worked the lock. A small bit of Manchester engineering, in your hands.',
  };
  function ui() {
    a.ui.actions(
      `<button id="lock-action" class="primary-action" ${['entering', 'filling', 'leaving'].includes(state) ? 'disabled' : ''}>${{ ready: 'Bring boat in', entering: 'Entering…', inside: 'Close lower gate', sealed: 'Fill the lock', filling: 'Filling…', full: 'Open upper gate', open: 'Sail out', leaving: 'Sailing…', complete: 'Run the lock again' }[state]}</button><button id="lock-reset">Reset lock</button>${SOUND_BUTTON}`
    );
    a.ui.caption(
      state === 'complete' ? 'Journey complete' : 'The lock keeper',
      instructions[state]
    );
    a.audio();
    a.ui.on('lock-reset', reset);
    a.ui.on('lock-action', () => {
      if (state === 'ready') {
        state = 'entering';
        time = 0;
      } else if (state === 'inside') {
        state = 'sealed';
        gates[0].position.x = 0;
      } else if (state === 'sealed') {
        state = 'filling';
        time = 0;
      } else if (state === 'full') {
        state = 'open';
        gates[1].position.x = 7;
      } else if (state === 'open') {
        state = 'leaving';
        time = 0;
      } else if (state === 'complete') {
        reset();
        return;
      }
      ui();
      a.sound.note(220, 0.3);
    });
  }
  function reset() {
    state = 'ready';
    time = level = 0;
    boat.position.set(0, -0.5, 11);
    water.position.y = -0.5;
    gates[0].position.x = 7;
    gates[1].position.x = 0;
    ui();
  }
  ui();
  return {
    group: a.group,
    background: '#c4cec0',
    update(dt) {
      time += dt;
      if (state === 'entering') {
        boat.position.z = 11 - Math.min(time / 4, 1) * 11;
        if (time >= 4) {
          state = 'inside';
          ui();
        }
      } else if (state === 'filling') {
        level = Math.min(time / 5, 1);
        water.position.y = -0.5 + level * 2;
        boat.position.y = water.position.y;
        if (time >= 5) {
          state = 'full';
          ui();
        }
      } else if (state === 'leaving') {
        boat.position.z = -Math.min(time / 4, 1) * 12;
        if (time >= 4) {
          state = 'complete';
          ui();
          a.sound.chord();
        }
      }
      context.camera.position.set(
        context.camera.aspect < 0.85 ? 15 : 18,
        22,
        context.camera.aspect < 0.85 ? 31 : 25
      );
      context.camera.lookAt(0, 1, 0);
    },
    snapshot() {
      return {
        type: 'canal-lock',
        state,
        waterLevel: +level.toFixed(2),
        boatZ: +boat.position.z.toFixed(2),
      };
    },
    dispose: a.dispose,
  };
}
