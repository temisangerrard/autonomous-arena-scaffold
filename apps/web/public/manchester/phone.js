import { renderShop } from './phone-shop.js';
import { REWARDS } from './life.js';
export const PHONE_ACTIVITIES = [
  ...[['gallery', 'Manchester Art Gallery', 'Curate a colourful exhibition'], ['museum', 'Manchester Museum', 'Assemble a prehistoric fossil'], ['industry', 'Science and Industry Museum', 'Power a working model engine']].map(([key, name, description]) => ({ key, name, description, district: key, module: './culture.js' })),
  {
    key: 'sunset-tour',
    district: 'castlefield',
    name: 'Private sunset cruise',
    description: 'Your exclusive golden-hour canal escape',
    module: './outdoors.js',
    requires: 'rowing',
  },
  {
    key: 'theatre',
    district: 'quays',
    name: 'The Last Tram Home',
    description: 'Take a seat at the Lowry · 91 sec',
    module: './theatre.js',
  },
  {
    key: 'run',
    district: 'quays',
    name: 'Waterfront run',
    description: 'A 100 m jog or sprint along the Quays',
    module: './outdoors.js',
  },
  {
    key: 'rowing',
    district: 'quays',
    name: 'Row the Quays',
    description: 'Take the oars · find a steady rhythm',
    module: './outdoors.js',
  },
  {
    key: 'penalties',
    district: 'trafford',
    name: 'Penalty practice',
    description: 'Five shots at Old Trafford',
    module: './penalties.js',
  },
  {
    key: 'wardrobe',
    district: 'centre',
    name: 'Your Manchester look',
    description: 'Try a colour at the Trafford Centre',
    module: './wardrobe.js',
  },
  {
    key: 'rhythm',
    district: 'northern',
    name: 'Northern Sessions',
    description: 'Four pads · sixteen beats',
    module: './rhythm.js',
  },
  {
    key: 'canal',
    district: 'castlefield',
    name: 'Work the lock',
    description: 'Guide a narrowboat to the upper canal',
    module: './canal.js',
  },
  {
    key: 'tour',
    district: 'castlefield',
    name: 'The slow way to Sale',
    description: 'A short narrated canal tour · captions',
    module: './outdoors.js',
  },
];
export function createPhone({
  getDistrict,
  onActivity,
  onTravel,
  controls,
  life,
  onHome,
}) {
  const button = document.createElement('button');
  button.id = 'phone-open';
  button.textContent = '▯ Phone';
  button.setAttribute('aria-label', 'Open your in-world phone');
  document.body.append(button);
  const dialog = document.createElement('dialog');
  dialog.id = 'phone-dialog';
  dialog.setAttribute('aria-labelledby', 'phone-title');
  document.body.append(dialog);
  let journal = [];
  try {
    const parsed = JSON.parse(
      localStorage.getItem('manchester-journal-v1') || '[]'
    );
    if (Array.isArray(parsed))
      journal = parsed
        .filter(
          (x) =>
            typeof x === 'string' && PHONE_ACTIVITIES.some((a) => a.key === x)
        )
        .slice(-20);
  } catch {}
  function render() {
    dialog.innerHTML =
      '<button class="dialog-close" id="phone-close" aria-label="Close phone">×</button><div class="phone-status"><span>mcr mobile</span><span>●●●  5G ▰</span></div><div class="eyebrow">YOUR CITY, IN YOUR POCKET</div><h2 id="phone-title">Manchester.</h2><p id="phone-balance"></p><button id="phone-home" class="phone-home">⌂ Your apartment · Salford Quays ↗</button><nav class="phone-tabs"><button id="phone-do" aria-pressed="true">Things to do</button><button id="phone-journeys">Travel</button><button id="phone-me">My day</button><button id="phone-shop">Shop</button></nav><div id="phone-content"></div><button id="phone-launcher" aria-label="Phone home screen">Home screen</button>';
    dialog.querySelector('#phone-balance').textContent =
      `£${life.snapshot().balance.toLocaleString('en-GB')} · Game money · Energy ${Math.round(life.snapshot().energy)}%`;
    if (document.body.classList.contains('in-experience')) {
      dialog.querySelector('#phone-do').hidden = true;
      dialog.querySelector('#phone-journeys').hidden = true;
    }
    dialog.querySelector('#phone-home').onclick = () => {
      dialog.close();
      onHome();
    };
    dialog.querySelector('#phone-launcher').onclick = launcher;
    dialog.querySelector('#phone-shop').onclick = () => {
      dialog.classList.remove('phone-launcher');
      dialog
        .querySelectorAll('.phone-tabs button')
        .forEach((b) =>
          b.setAttribute('aria-pressed', String(b.id === 'phone-shop'))
        );
      renderShop(dialog.querySelector('#phone-content'), life, () => {
        dialog.querySelector('#phone-balance').textContent =
          `£${life.snapshot().balance.toLocaleString('en-GB')} · Game money`;
      });
    };
    dialog.querySelector('#phone-close').onclick = () => dialog.close();
    dialog.querySelector('#phone-do').onclick = activities;
    dialog.querySelector('#phone-journeys').onclick = () => {
      dialog.close();
      onTravel();
    };
    dialog.querySelector('#phone-me').onclick = () => {
      dialog.classList.remove('phone-launcher');
      dialog
        .querySelectorAll('.phone-tabs button')
        .forEach((b) =>
          b.setAttribute('aria-pressed', String(b.id === 'phone-me'))
        );
      const box = dialog.querySelector('#phone-content');
      box.innerHTML = '<h3>Your collection</h3>';
      for (const key of life.snapshot().achievements) {
        const p = document.createElement('p');
        p.textContent = '✦ ' + REWARDS[key].name;
        box.append(p);
      }
      if (!life.snapshot().achievements.length) {
        const p = document.createElement('p');
        p.textContent =
          'Finish activities to collect exclusive looks, titles and experiences.';
        box.append(p);
      }
      const heading = document.createElement('h3');
      heading.textContent = 'Your recent visits';
      box.append(heading);
      if (!journal.length) {
        const p = document.createElement('p');
        p.textContent =
          'Your story starts with a first visit. Choose something to do.';
        box.append(p);
      }
      journal
        .slice()
        .reverse()
        .forEach((key) => {
          const p = document.createElement('p');
          p.className = 'journal-entry';
          p.textContent = PHONE_ACTIVITIES.find((a) => a.key === key).name;
          box.append(p);
        });
    };
    launcher();
  }
  function launcher() {
    dialog.classList.add('phone-launcher');
    const box = dialog.querySelector('#phone-content');
    const now = new Date();
    box.innerHTML = `<div class="phone-clock">${now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</div><p class="phone-date">${now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })} · Manchester</p><div class="phone-life-card"><span>THE GOOD LIFE</span><strong>Your city. Your own pace.</strong><p>A place by the water. A whole city outside.</p></div><div class="phone-app-grid"></div><p class="phone-location">⌖ ${document.body.classList.contains('in-apartment') ? 'At home · Salford Quays' : 'Manchester is yours to explore'}</p>`;
    const apps = [
      ['phone-do', 'Things to do', '☀', 'peach'],
      ['phone-journeys', 'Tram & map', '🚋', 'yellow'],
      ['phone-shop', 'Quays & Co.', '🛍', 'rose'],
      ['phone-home', 'My apartment', '⌂', 'mint'],
      ['phone-me', 'My collection', '✦', 'lilac'],
      ['music', 'Music & shows', '♫', 'blue'],
    ];
    for (const [id, label, icon, colour] of apps) {
      if (document.body.classList.contains('in-experience') && ['phone-do', 'phone-journeys', 'music'].includes(id)) continue;
      const app = document.createElement('button');
      app.className = 'phone-app';
      app.setAttribute('aria-label', label);
      app.innerHTML = `<span class="app-icon ${colour}" aria-hidden="true">${icon}</span><span>${label}</span>`;
      app.onclick = () => id === 'music' ? activities(['theatre', 'rhythm']) : dialog.querySelector('#' + id).click();
      box.querySelector('.phone-app-grid').append(app);
    }
  }
  function activities(keys) {
    dialog.classList.remove('phone-launcher');
    dialog
      .querySelectorAll('.phone-tabs button')
      .forEach((b) =>
        b.setAttribute('aria-pressed', String(b.id === 'phone-do'))
      );
    const box = dialog.querySelector('#phone-content');
    box.innerHTML = '';
    PHONE_ACTIVITIES.filter(
      (a) => (!Array.isArray(keys) || keys.includes(a.key)) && (!a.requires || life.snapshot().achievements.includes(a.requires))
    ).forEach((activity) => {
      const b = document.createElement('button');
      b.className = 'phone-activity';
      const name = document.createElement('strong');
      name.textContent = activity.name;
      const detail = document.createElement('small');
      const reward =
        REWARDS[activity.key === 'canal' ? 'canal-lock' : activity.key];
      detail.textContent =
        activity.description + (reward ? ` · Unlock: ${reward.name}` : '');
      const location = document.createElement('span');
      location.textContent =
        activity.district === getDistrict() ? 'Here now ↗' : 'Take the tram ↗';
      b.append(name, detail, location);
      b.onclick = () => {
        dialog.close();
        onActivity(activity);
      };
      box.append(b);
    });
  }
  button.onclick = () => {
    controls.reset();
    render();
    dialog.showModal();
  };
  dialog.addEventListener('close', controls.reset);
  return {
    record(key) {
      if (!PHONE_ACTIVITIES.some((a) => a.key === key)) return;
      journal.push(key);
      journal = journal.slice(-20);
      try {
        localStorage.setItem('manchester-journal-v1', JSON.stringify(journal));
      } catch {}
    },
    snapshot() {
      return { open: dialog.open, visits: journal.length };
    },
  };
}
