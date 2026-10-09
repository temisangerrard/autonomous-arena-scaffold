import { REWARDS } from './life.js';
import * as T from './vendor/three.module.min.js';
import { createAvatar } from './world.js';
import { activityBase } from './activity-common.js';
export const LOOKS = [
  { name: 'Northern red', color: '#a45543' },
  { name: 'Canal blue', color: '#477a92' },
  { name: 'Tram yellow', color: '#c7a03f' },
  { name: 'Forest green', color: '#4f795f' },
];
export function createActivity(context) {
  const looks = [
    ...LOOKS,
    ...context.life
      .snapshot()
      .achievements.filter((k) => REWARDS[k]?.color)
      .map((k) => ({ name: REWARDS[k].name, color: REWARDS[k].color })),
  ];
  const a = activityBase(
      context,
      'Find your Manchester look.',
      'Trafford Centre · The fitting room'
    ),
    b = a.builder;
  b.box(0, -0.2, 0, 20, 0.4, 20, '#d6c2a1');
  b.box(0, 5, -6, 20, 10, 0.3, '#e2cdb1');
  for (const x of [-8, 8]) {
    b.shape('cylinder', x, 4, -4, 0.35, 8, 0.35, '#f2e3c6');
    b.box(x, 1.5, 1, 3, 3, 1, '#ad8d6b');
  }
  b.shape('cylinder', 0, 0.2, 0, 3.2, 0.4, 3.2, '#bda075');
  b.label('YOUR CITY. YOUR STYLE.', 0, 5.8, -5.7, 12, '#675646', '#e8d4b4');
  looks.forEach((look, i) => {
    b.box(-6 + i * 4, 2.8, -5, 0.9, 1.8, 0.5, look.color);
  });
  a.finish();
  const model = createAvatar();
  model.group.scale.setScalar(2.1);
  model.group.position.y = 0.4;
  a.group.add(model.group);
  let selected = 0,
    turn = 0,
    saved = false;
  try {
    const color = localStorage.getItem('manchester-jacket-v1');
    const index = looks.findIndex((l) => l.color === color);
    if (index >= 0) selected = index;
  } catch {}
  model.setOutfit(looks[selected].color);
  a.ui.actions(
    `<label>Jacket <select id="look-choice">${looks.map((l, i) => `<option value="${i}" ${i === selected ? 'selected' : ''}>${l.name}</option>`).join('')}</select></label><button id="look-turn">Turn around</button><button id="look-save" class="primary-action">Wear this look</button>`
  );
  a.ui.caption(
    'The fitting room',
    'Try a colour, turn around, then wear your choice back out in the city.'
  );
  a.ui.root.querySelector('#look-choice').addEventListener('change', (e) => {
    selected = Number(e.target.value);
    saved = false;
    model.setOutfit(looks[selected].color);
    a.ui.caption(
      looks[selected].name,
      'Looking good. Choose “Wear this look” to take it into the city.'
    );
  });
  a.ui.on('look-turn', () => {
    turn += Math.PI / 2;
  });
  a.ui.on('look-save', () => {
    context.avatar.setOutfit(looks[selected].color);
    saved = true;
    let persisted = true;
    try {
      localStorage.setItem('manchester-jacket-v1', looks[selected].color);
    } catch {
      persisted = false;
    }
    a.ui.caption(
      'It’s yours.',
      persisted
        ? 'Your look is saved on this device. Head outside and wear it.'
        : 'You’re wearing it for this visit. This browser could not save it for next time.'
    );
  });
  return {
    group: a.group,
    background: '#d6c9b6',
    update() {
      model.group.rotation.y = turn;
      context.camera.position.set(
        0,
        4.5,
        context.camera.aspect < 0.85 ? 18 : 14
      );
      context.camera.lookAt(0, 2.5, 0);
    },
    snapshot() {
      return {
        type: 'wardrobe',
        selected: looks[selected].name,
        color: looks[selected].color,
        turn,
        saved,
      };
    },
    dispose: a.dispose,
  };
}
