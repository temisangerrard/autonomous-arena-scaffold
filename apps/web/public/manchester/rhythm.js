import * as T from './vendor/three.module.min.js';
import { activityBase, SOUND_BUTTON } from './activity-common.js';
const SEQUENCE = [0, 1, 2, 3, 0, 2, 1, 3, 3, 1, 0, 2, 0, 1, 2, 3];
export function createActivity(context) {
  const a = activityBase(
      context,
      'Find the beat.',
      'Northern Quarter · Four-pad street session'
    ),
    b = a.builder;
  b.box(0, -0.2, 0, 24, 0.4, 27, '#685c69');
  b.box(0, 4, -12, 24, 8, 0.4, '#9f7059');
  b.label('NORTHERN SESSIONS', 0, 5, -11.6, 17, '#e5c28a', '#384b58');
  for (let i = 0; i < 4; i++) {
    b.box(
      (i - 1.5) * 3,
      0.01,
      -1,
      2.6,
      0.04,
      19,
      ['#ab765f', '#6f9993', '#b29c5f', '#8e7d9b'][i]
    );
    b.box((i - 1.5) * 3, 0.1, 7, 2.6, 0.12, 0.2, '#f5e1b0');
  }
  a.finish();
  const notes = SEQUENCE.map((lane, i) => {
    const mesh = new T.Mesh(
      new T.BoxGeometry(1.6, 0.25, 0.8),
      new T.MeshStandardMaterial({ color: '#f5dca1' })
    );
    mesh.position.set((lane - 1.5) * 3, 0.4, -20);
    a.group.add(mesh);
    return mesh;
  });
  let time = 0,
    state = 'ready',
    score = 0,
    combo = 0,
    judged = new Set(),
    lastBeat = -1;
  a.ui.actions(
    `<button id="rhythm-start" class="primary-action">Start session</button>${[1, 2, 3, 4].map((n) => `<button id="pad-${n}" class="rhythm-pad">${n}</button>`).join('')}${SOUND_BUTTON}`
  );
  a.audio();
  a.ui.caption(
    '16 beats · Keys 1–4 or tap the pads',
    'Hit the matching pad as its note crosses the gold line. Sound is optional.'
  );
  a.ui.on('rhythm-start', () => {
    time = 0;
    state = 'playing';
    score = combo = 0;
    judged = new Set();
    lastBeat = -1;
    notes.forEach((n) => (n.visible = true));
    a.ui.caption('Get ready…', 'Follow the notes to the gold line.');
  });
  function hit(lane) {
    if (state !== 'playing') return;
    const index = SEQUENCE.findIndex(
      (n, i) => n === lane && !judged.has(i) && Math.abs(time - (3 + i)) <= 0.28
    );
    a.sound.note([261.63, 329.63, 392, 523.25][lane], 0.2);
    if (index >= 0) {
      judged.add(index);
      notes[index].visible = false;
      score += Math.abs(time - (3 + index)) < 0.12 ? 100 : 60;
      combo++;
      a.ui.caption(
        `${score} points · ${combo} combo`,
        Math.abs(time - (3 + index)) < 0.12 ? 'Perfect.' : 'Good timing.'
      );
    } else {
      combo = 0;
      a.ui.caption(
        `${score} points`,
        'A little early or late. Watch the gold line.'
      );
    }
  }
  for (let i = 0; i < 4; i++) a.ui.on(`pad-${i + 1}`, () => hit(i));
  function key(e) {
    if (!e.repeat && /^Digit[1-4]$/.test(e.code))
      hit(Number(e.code.slice(-1)) - 1);
  }
  window.addEventListener('keydown', key);
  return {
    group: a.group,
    background: '#373e50',
    update(dt) {
      if (state === 'playing') {
        time += dt;
        const beat = Math.floor(time);
        if (beat !== lastBeat) {
          lastBeat = beat;
          a.sound.note(120, 0.08);
        }
        notes.forEach((note, i) => {
          note.position.z = 7 - (3 + i - time) * 5;
          note.visible =
            !judged.has(i) && note.position.z > -11 && note.position.z < 9;
          if (time > 3 + i + 0.28 && !judged.has(i)) {
            judged.add(i);
            combo = 0;
          }
        });
        if (time > 19) {
          state = 'ended';
          a.ui.caption(
            'Session complete',
            `${score} / 1600 points. Start another session to find your groove.`
          );
          a.ui.root.querySelector('#rhythm-start').textContent = 'Play again';
        }
      }
      context.camera.position.set(
        0,
        17,
        context.camera.aspect < 0.85 ? 30 : 23
      );
      context.camera.lookAt(0, 0, -1);
    },
    snapshot() {
      return {
        type: 'rhythm',
        state,
        time: +time.toFixed(2),
        score,
        combo,
        judged: judged.size,
      };
    },
    dispose() {
      window.removeEventListener('keydown', key);
      a.dispose();
    },
  };
}
