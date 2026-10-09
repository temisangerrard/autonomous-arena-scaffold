import * as T from './vendor/three.module.min.js';
import { createAvatar, disposeWorld } from './world.js';
import { activityBase } from './activity-common.js';
import { DECOR } from './life.js';
import {
  ROOMS,
  PORTALS,
  OPPOSITE,
  pathTo,
  buildHomeRoom,
} from './home-rooms.js';
export function createActivity(context) {
  const a = activityBase(
    context,
    'Your Quays penthouse.',
    'HOME · TWO FLOORS · SEVEN ROOMS'
  );
  document.body.classList.remove('experience-seated');
  document.body.classList.add('in-apartment');
  const model = createAvatar();
  try {
    const c = localStorage.getItem('manchester-jacket-v1');
    if (/^#[a-f0-9]{6}$/i.test(c || '')) model.setOutfit(c);
  } catch {}
  a.group.add(model.group);
  let room = 'lounge',
    built = null,
    clock = 0,
    mode = null,
    stage = 0,
    progress = 0,
    heat = 0,
    temp = 30,
    shots = 0,
    score = 0,
    aim = 0,
    routine = 0,
    lastBreath = -100,
    lastThrow = -100,
    channel = 0,
    view = 0,
    seen = new Set(),
    route = [],
    centreFirst = true,
    closedCurtains = false;
  const completed = new Set();
  const stats = document.createElement('div');
  stats.className = 'home-stats';
  a.ui.root.append(stats);
  const nav = document.createElement('nav');
  nav.className = 'home-rooms';
  nav.setAttribute('aria-label', 'Penthouse rooms');
  nav.innerHTML = Object.entries(ROOMS)
    .map(([id, r]) => `<button data-room="${id}">${r.name}</button>`)
    .join('');
  a.ui.root.append(nav);
  nav.querySelectorAll('button').forEach(
    (btn) =>
      (btn.onclick = () => {
        stop();
        route = pathTo(room, btn.dataset.room);
        centreFirst = true;
        a.ui.caption(
          'On our way',
          `Walking to ${ROOMS[btn.dataset.room].name}. Use the stick or arrow keys to take over.`
        );
      })
  );
  const screen = new T.Mesh(
    new T.PlaneGeometry(2.8, 1.5),
    new T.MeshBasicMaterial({ color: '#82aaa1' })
  );
  screen.position.set(3, 1.2, -3.68);
  a.group.add(screen);
  const windowPane = new T.Mesh(
    new T.PlaneGeometry(2.8, 1.6),
    new T.MeshBasicMaterial({ color: '#82aaa1' })
  );
  windowPane.position.set(-3.6, 2.85, -5.35);
  a.group.add(windowPane);
  const drapes = [-1, 1].map((side) => {
    const mesh = new T.Mesh(
      new T.BoxGeometry(1, 1.8, 0.12),
      new T.MeshStandardMaterial({ color: '#8e6659' })
    );
    mesh.position.set(-3.6 + side, 2.85, -5.22);
    a.group.add(mesh);
    return mesh;
  });
  const board = new T.Mesh(
    new T.CircleGeometry(1.1, 32),
    new T.MeshStandardMaterial({ color: '#cfaa69' })
  );
  board.position.set(0, 2, -5.35);
  a.group.add(board);
  const dart = new T.Mesh(
    new T.SphereGeometry(0.12, 8, 8),
    new T.MeshStandardMaterial({ color: '#9a4347' })
  );
  a.group.add(dart);
  function status() {
    const s = context.life.snapshot();
    stats.textContent = `${ROOMS[room].floor ? 'UPSTAIRS' : 'DOWNSTAIRS'} · ${ROOMS[room].name} · Energy ${Math.round(s.energy)}%`;
    nav
      .querySelectorAll('button')
      .forEach((btn) =>
        btn.setAttribute('aria-current', String(btn.dataset.room === room))
      );
  }
  let furnitureVersion = JSON.stringify(context.life.snapshot().furniture);
  const unsubscribe = context.life.subscribe(() => {
    status();
    const next = JSON.stringify(context.life.snapshot().furniture);
    if (built && next !== furnitureVersion) {
      a.group.remove(built.group);
      disposeWorld(built.group);
      built = buildHomeRoom(room, context.life.snapshot());
      a.group.add(built.group);
    }
    furnitureVersion = next;
  });
  function enter(id, side) {
    if (built) {
      a.group.remove(built.group);
      disposeWorld(built.group);
    }
    room = id;
    built = buildHomeRoom(id, context.life.snapshot());
    a.group.add(built.group);
    screen.visible = id === 'lounge';
    board.visible = id === 'games';
    dart.visible = id === 'games';
    const p = side ? PORTALS[side] : { x: 0, z: 3.5 };
    model.group.position.set(p.x * 0.84, 0.05, p.z * 0.84);
    model.group.rotation.set(0, 0, 0);
    mode = null;
    status();
    actions();
    a.ui.caption(
      ROOMS[id].name,
      'Walk through the doorways, or choose a room to walk there. Every room has something to do.'
    );
  }
  function stop() {
    if (mode) model.group.position.set(0, 0.05, 2.5);
    mode = null;
    model.group.rotation.x = 0;
    progress = 0;
    route = [];
    a.ui.root.classList.remove('home-shopping');
    document.body.classList.remove('home-busy');
    actions();
  }
  function done(title, text) {
    completed.add(mode);
    model.group.position.set(0, 0.05, 2.5);
    model.group.rotation.x = 0;
    mode = null;
    document.body.classList.remove('home-busy');
    actions();
    a.ui.caption(title, text);
  }
  function start(next) {
    route = [];
    mode = next;
    lastBreath = lastThrow = -100;
    const spots = {
      cook: [-4, -2.4],
      darts: [0, 2],
      shower: [4, -3],
      rest: [-3.6, -2.9],
      relax: [0, 1],
      tv: [-3, -1.4],
      telescope: [0, -2.2],
    };
    if (spots[next])
      model.group.position.set(spots[next][0], 0.05, spots[next][1]);
    if (next === 'shower') temp = 30;
    stage = progress = shots = score = routine = 0;
    seen = new Set();
    document.body.classList.add('home-busy');
    controls();
  }
  const button = (id, label) => `<button id="${id}">${label}</button>`;
  function actions() {
    a.ui.root.classList.remove('home-shopping');
    const options = {
      lounge: [
        ['tv', 'Watch television'],
        ['relax', 'Breathing break'],
      ],
      kitchen: [['cook', 'Cook dinner']],
      games: [['darts', 'Play three-dart challenge']],
      bedroom: [
        ['rest', 'Wind down & sleep'],
        ['curtains', 'Open / close curtains'],
      ],
      guest: [['relax', 'Guided breathing']],
      bathroom: [['shower', 'Take a warm shower']],
      balcony: [['telescope', 'Explore the skyline']],
    };
    a.ui.actions(
      options[room].map(([id, label]) => button('home-' + id, label)).join('') +
        button('home-decor', 'Decorate')
    );
    for (const [id] of options[room])
      a.ui.on('home-' + id, () => {
        if (id === 'curtains') {
          closedCurtains = !closedCurtains;
          a.ui.caption(
            'Bedroom curtains',
            closedCurtains
              ? 'Curtains closed. Time to unwind.'
              : 'Curtains open. Let the daylight in.'
          );
        } else start(id);
      });
    a.ui.on('home-decor', shop);
  }
  function controls() {
    let html = '';
    if (mode === 'cook') {
      html =
        stage === 0
          ? button('chop', 'Chop ingredients')
          : stage === 1
            ? button('serve', 'Take pan off the heat')
            : button('eat', 'Serve & taste');
      a.ui.caption(
        stage === 0
          ? 'Prep your dinner'
          : stage === 1
            ? 'Watch the pan'
            : 'Ready to plate',
        stage === 0
          ? `${progress} / 6 chops. Tap to prepare your ingredients.`
          : stage === 1
            ? 'Take the pan off when the heat meter reaches 40–70%.'
            : 'Your ingredients are cooked. Serve your meal.'
      );
    }
    if (mode === 'darts') {
      html =
        '<label>Aim <input id="dart-aim" type="range" min="-1" max="1" step="0.05" value="0"></label>' +
        button('dart-throw', 'Throw dart');
      a.ui.caption(
        'Three darts · 150 possible',
        'Aim left or right. Throw when the moving marker is closest to the centre.'
      );
    }
    if (mode === 'shower') {
      html =
        '<label>Water °C <input id="water-temp" type="range" min="20" max="50" value="30"></label>';
      a.ui.caption(
        'Find your perfect shower',
        'Keep the water between 36°C and 40°C for six seconds. Adjust as it drifts.'
      );
    }
    if (mode === 'rest' || mode === 'relax') {
      html = button('breathe', 'Take a slow breath');
      a.ui.caption(
        mode === 'rest' ? 'Unwind before bed' : 'A little breathing space',
        'Tap for a breath when the meter is in the calm zone (40–70%). Three calm breaths finish the routine.'
      );
    }
    if (mode === 'tv') {
      html = button('tv-next', 'Change channel');
      a.ui.caption(
        'On your television',
        [
          'Canal Life · A quiet evening beside the water.',
          'Matchday · The crowd erupts as the winner goes in!',
          'Northern Sessions · Tonight’s house band is warming up.',
        ][channel]
      );
    }
    if (mode === 'telescope') {
      html =
        button('sky-next', 'Turn telescope') +
        button('sky-spot', 'Spot this landmark');
      a.ui.caption(
        ['The Lowry', 'MediaCity towers', 'Quays waterfront'][view],
        `${seen.size} / 3 views collected. Turn the telescope and spot all three.`
      );
    }
    a.ui.actions(html + button('home-cancel', 'Back to room'));
    if (mode === 'cook') {
      if (stage === 0)
        a.ui.on('chop', () => {
          progress++;
          if (progress >= 6) {
            stage = 1;
            progress = 0;
          }
          controls();
        });
      else if (stage === 1)
        a.ui.on('serve', () => {
          if (heat >= 40 && heat <= 70) {
            stage = 2;
            controls();
          } else
            a.ui.caption(
              'A little more practice',
              'Wait for 40–70% on the heat meter, then take the pan off.'
            );
        });
      else
        a.ui.on('eat', () => {
          context.life.cook();
          done(
            'Dinner is served.',
            'You prepared, cooked and plated your meal. On the house, of course.'
          );
        });
    }
    if (mode === 'darts') {
      a.ui.root.querySelector('#dart-aim').oninput = (e) =>
        (aim = +e.target.value);
      a.ui.on('dart-throw', () => {
        if (clock - lastThrow < 0.8) return;
        lastThrow = clock;
        const points = Math.round(
          50 * Math.max(0, 1 - Math.hypot(aim, Math.sin(clock * 2)))
        );
        score += points;
        shots++;
        if (shots === 3)
          done('Round complete', `${score} / 150. Fancy another round?`);
        else
          a.ui.caption(
            `${shots} / 3 darts · ${score} points`,
            `${points} points on that throw. Line up the next one.`
          );
      });
    }
    if (mode === 'shower')
      a.ui.root.querySelector('#water-temp').oninput = (e) =>
        (temp = +e.target.value);
    if (mode === 'rest' || mode === 'relax')
      a.ui.on('breathe', () => {
        if (clock - lastBreath < 0.8) return;
        if (heat >= 40 && heat <= 70) {
          lastBreath = clock;
          routine++;
          if (routine === 3) {
            const rest = mode === 'rest';
            rest ? context.life.rest() : context.life.relax();
            done(
              rest ? 'A good rest.' : 'Calm and refreshed.',
              'Energy restored. Head back into the city whenever you like.'
            );
          } else
            a.ui.caption(
              `${routine} / 3 calm breaths`,
              'Wait for the calm zone again.'
            );
        } else
          a.ui.caption(
            'Slow down',
            'Wait until the meter reaches the calm zone (40–70%).'
          );
      });
    if (mode === 'tv')
      a.ui.on('tv-next', () => {
        channel = (channel + 1) % 3;
        controls();
      });
    if (mode === 'telescope') {
      a.ui.on('sky-next', () => {
        view = (view + 1) % 3;
        controls();
      });
      a.ui.on('sky-spot', () => {
        seen.add(view);
        if (seen.size === 3)
          done(
            'You know your skyline.',
            'All three views spotted from your own terrace.'
          );
        else controls();
      });
    }
    a.ui.on('home-cancel', () => {
      stop();
      a.ui.caption(ROOMS[room].name, 'Make yourself at home.');
    });
  }
  function shop() {
    route = [];
    a.ui.root.classList.add('home-shopping');
    a.ui.actions(
      DECOR.map(
        (d) =>
          `<button data-buy="${d.id}">${context.life.snapshot().hiddenDecor.includes(d.id) ? 'Show' : 'Put away'} ${d.name}</button>`
      ).join('') + button('home-done', 'Done')
    );
    a.ui.root.querySelectorAll('[data-buy]').forEach(
      (btn) =>
        (btn.onclick = () => {
          context.life.toggleDecor(btn.dataset.buy);
          const p = model.group.position.clone();
          enter(room);
          model.group.position.copy(p);
          shop();
        })
    );
    a.ui.on('home-done', actions);
    a.ui.caption(
      'All yours',
      'Your decor choices are saved across the penthouse.'
    );
  }
  const meter = document.createElement('div');
  meter.className = 'home-meter';
  a.ui.root.append(meter);
  enter('lounge');
  return {
    group: a.group,
    background: '#c2d5cc',
    update(dt, input) {
      clock += dt;
      heat = (Math.sin(clock * 2) + 1) * 50;
      if (mode === 'shower') {
        const actual = temp + Math.sin(clock) * 1.5;
        if (actual >= 36 && actual <= 40) progress += dt;
        else progress = Math.max(0, progress - dt);
        if (progress >= 6) {
          context.life.relax();
          done(
            'Freshened up.',
            'A perfect warm shower. You’re ready for the rest of the day.'
          );
        }
      }
      meter.hidden = !['cook', 'rest', 'relax', 'shower', 'darts'].includes(
        mode
      );
      meter.textContent =
        mode === 'shower'
          ? `Water ${(temp + Math.sin(clock) * 1.5).toFixed(1)}°C · ${progress.toFixed(1)} / 6s`
          : mode === 'darts'
            ? `${shots} / 3 darts · ${score} points`
            : `${mode === 'cook' ? 'Heat' : 'Calm'} ${Math.round(heat)}% · target 40–70%`;
      let ix = input.x,
        iz = input.z;
      if (Math.hypot(ix, iz) > 0.1) route = [];
      const p = model.group.position;
      if (route.length && !mode) {
        const side = Object.keys(ROOMS[room].doors).find(
          (k) => ROOMS[room].doors[k] === route[0]
        );
        const target = centreFirst ? { x: 0, z: 0 } : PORTALS[side];
        const dx = target.x - p.x,
          dz = target.z - p.z,
          len = Math.hypot(dx, dz);
        if (centreFirst && len < 0.15) centreFirst = false;
        ix = len ? (0.95 * dx) / len : 0;
        iz = len ? (0.95 * dz) / len : 0;
      }
      const moving = !mode && Math.hypot(ix, iz) > 0.01;
      if (moving) {
        const free = (x, z) =>
          !built.blocks.some(
            (o) =>
              Math.abs(x - o.x) < o.w / 2 + 0.24 &&
              Math.abs(z - o.z) < o.d / 2 + 0.24
          ) &&
          Math.abs(x) < 6.4 &&
          Math.abs(z) < 5.4 &&
          (Math.abs(x) < 6 || Math.abs(z) < 1.05) &&
          (Math.abs(z) < 5 || Math.abs(x) < 1.05);
        const dx = ix * dt * 3.5,
          dz = iz * dt * 3.5;
        if (free(p.x + dx, p.z)) p.x += dx;
        if (free(p.x, p.z + dz)) p.z += dz;
        model.group.rotation.y = Math.atan2(dx, dz);
        for (const [side, dest] of Object.entries(ROOMS[room].doors)) {
          const portal = PORTALS[side];
          if (Math.hypot(p.x - portal.x, p.z - portal.z) < 0.25) {
            if (route[0] === dest) route.shift();
            centreFirst = true;
            enter(dest, OPPOSITE[side]);
            break;
          }
        }
      }
      model.group.position.y =
        room === 'lounge' && p.z < -2 && Math.abs(p.x) < 1.1
          ? 0.05 + (-p.z - 2) * 0.25
          : 0.05;
      if (mode === 'rest') {
        model.group.position.y = 1.3;
        model.group.rotation.x = -Math.PI / 2;
      }
      model.animate(clock, moving && !context.reducedMotion);
      windowPane.visible = ['bedroom', 'guest'].includes(room);
      drapes.forEach((d, i) => {
        d.visible = windowPane.visible;
        d.scale.x = closedCurtains ? 1.4 : 0.25;
        d.position.x = -3.6 + (i ? 1 : -1) * (closedCurtains ? 0.7 : 1.35);
      });
      screen.material.color.set(['#6fa4a5', '#6b945f', '#a47591'][channel]);
      dart.position.set(aim, 2 + Math.sin(clock * 2), -5.2);
      a.group.children
        .filter((o) => o.isLight)
        .forEach(
          (o) =>
            (o.intensity =
              closedCurtains && ['bedroom', 'guest'].includes(room) ? 0.65 : 2)
        );
      const portrait = context.camera.aspect < 0.85;
      context.camera.position.set(
        portrait ? 14 : 12,
        portrait ? 29 : 15,
        portrait ? 34 : 18
      );
      context.camera.lookAt(
        mode === 'telescope' ? (view - 1) * 12 : 0,
        0.4,
        mode === 'telescope' ? -17 : 0
      );
    },
    snapshot() {
      return {
        type: 'apartment',
        room,
        floor: ROOMS[room].floor,
        action: mode,
        stage,
        progress: +progress.toFixed(2),
        meter: +heat.toFixed(1),
        temperature: temp,
        shots,
        score,
        breaths: routine,
        channel,
        view,
        seen: [...seen],
        completed: [...completed],
        route: [...route],
        player: {
          x: +model.group.position.x.toFixed(2),
          z: +model.group.position.z.toFixed(2),
        },
        ...context.life.snapshot(),
      };
    },
    dispose() {
      unsubscribe();
      a.dispose();
      document.body.classList.remove('in-apartment', 'home-busy');
    },
  };
}
