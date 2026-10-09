import * as T from './vendor/three.module.min.js';
import { createAvatar } from './world.js';
import { activityBase, SOUND_BUTTON } from './activity-common.js';
export function createActivity(context) {
  const a = activityBase(
      context,
      'Five shots. Your moment.',
      'Old Trafford · Penalty practice'
    ),
    b = a.builder;
  b.box(0, -0.2, 0, 26, 0.4, 34, '#6e9467');
  for (let z = -15; z < 16; z += 4) b.box(0, 0.01, z, 25, 0.02, 2, '#799e70');
  for (const x of [-5, 5]) b.beam([x, 0, -10], [x, 3.6, -10], 0.1, '#f5ecda');
  b.beam([-5, 3.6, -10], [5, 3.6, -10], 0.1, '#f5ecda');
  for (let x = -5; x <= 5; x += 0.5)
    b.beam([x, 0, -11], [x, 3.6, -11], 0.012, '#d2d5bb');
  for (let y = 0; y <= 3.6; y += 0.4)
    b.beam([-5, y, -11], [5, y, -11], 0.012, '#d2d5bb');
  b.box(0, 1, -14, 24, 2, 1, '#8b4650');
  b.label('OLD TRAFFORD · PRACTICE', 0, 2.3, -13.4, 16);
  b.box(0, 0.04, 4, 13, 0.02, 0.08, '#e1e6cd');
  a.finish();
  const keeper = createAvatar();
  keeper.group.position.set(0, 0.1, -9.5);
  keeper.group.scale.setScalar(1.4);
  a.group.add(keeper.group);
  const ball = new T.Mesh(
    new T.IcosahedronGeometry(0.35, 1),
    new T.MeshStandardMaterial({ color: '#fbf2de' })
  );
  ball.position.set(0, 0.4, 8);
  a.group.add(ball);
  const marker = new T.Mesh(
    new T.TorusGeometry(0.3, 0.05, 5, 18),
    new T.MeshBasicMaterial({ color: '#edc16c' })
  );
  marker.position.set(0, 1.5, -10);
  a.group.add(marker);
  let time = 0,
    shots = 0,
    goals = 0,
    power = 0,
    flight = null,
    result = '',
    uiTick = 0;
  a.ui.actions(
    `<label>Aim <input id="penalty-aim" type="range" min="-4.5" max="4.5" step="0.1" value="0" aria-label="Shot aim"></label><label>Power <progress id="penalty-power" max="1" value="0"></progress></label><button id="penalty-shoot" class="primary-action">Shoot</button><button id="penalty-reset">New round</button>${SOUND_BUTTON}`
  );
  a.audio();
  a.ui.caption(
    '0 / 5 shots',
    'Aim away from the keeper. Shoot when the power bar is between one third and three quarters.'
  );
  a.ui.on('penalty-reset', () => {
    shots = goals = 0;
    flight = null;
    result = '';
    ball.position.set(0, 0.4, 8);
    a.ui.root.querySelector('#penalty-shoot').disabled = false;
    a.ui.caption('New round', 'Five shots. Aim, time your power, and shoot.');
  });
  a.ui.on('penalty-shoot', () => {
    if (flight || shots >= 5) return;
    const aim = Number(a.ui.root.querySelector('#penalty-aim').value);
    flight = { t: 0, aim, power, keeper: keeper.group.position.x };
    shots++;
    a.ui.root.querySelector('#penalty-shoot').disabled = true;
  });
  return {
    group: a.group,
    background: '#bccfc0',
    update(dt) {
      time += dt;
      power = (Math.sin(time * 2.4) + 1) / 2;
      marker.position.x = Number(a.ui.root.querySelector('#penalty-aim').value);
      if (!flight) keeper.group.position.x = Math.sin(time * 1.4) * 3.7;
      if (flight) {
        flight.t += dt;
        const t = Math.min(1, flight.t);
        ball.position.set(
          flight.aim * t,
          0.4 + Math.sin(t * Math.PI) * 2 * flight.power,
          8 - 18 * t
        );
        if (t === 1) {
          const goal =
            flight.power >= 0.33 &&
            flight.power <= 0.78 &&
            Math.abs(flight.aim - flight.keeper) > 1.15;
          if (goal) goals++;
          result = goal
            ? 'Goal!'
            : flight.power < 0.33
              ? 'Too soft.'
              : flight.power > 0.78
                ? 'Over the bar!'
                : 'Saved!';
          a.sound.note(goal ? 660 : 180, 0.5);
          a.ui.caption(
            `${goals} goals · ${shots} / 5 shots`,
            result +
              (shots === 5
                ? ' Round complete. Try to beat your score.'
                : ' Line up your next shot.')
          );
          flight = null;
          if (shots < 5) {
            a.ui.root.querySelector('#penalty-shoot').disabled = false;
            ball.position.set(0, 0.4, 8);
          }
        }
      }
      uiTick += dt;
      if (uiTick > 0.1) {
        a.ui.root.querySelector('#penalty-power').value = power;
        uiTick = 0;
      }
      context.camera.position.set(0, 8, context.camera.aspect < 0.85 ? 30 : 22);
      context.camera.lookAt(0, 1, -4);
    },
    snapshot() {
      return {
        type: 'penalties',
        shots,
        goals,
        power: +power.toFixed(2),
        keeper: +keeper.group.position.x.toFixed(2),
        shooting: !!flight,
        result,
      };
    },
    dispose: a.dispose,
  };
}
