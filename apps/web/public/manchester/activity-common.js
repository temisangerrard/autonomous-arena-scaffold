import * as T from './vendor/three.module.min.js';
import { Builder, disposeWorld } from './world.js';
import { experienceUI } from './experience-ui.js';
import { createSound } from './sound.js';
export function activityBase(context, title, subtitle) {
  const builder = new Builder(),
    group = new T.Group(),
    ui = experienceUI(title, subtitle),
    sound = createSound();
  group.add(new T.HemisphereLight('#fff0d6', '#607782', 2));
  const sun = new T.DirectionalLight('#fff0d0', 2);
  sun.position.set(-10, 20, 12);
  group.add(sun);
  context.avatar.group.visible = false;
  document.body.classList.add('experience-seated');
  ui.root.querySelector('#experience-exit').textContent =
    'Back to the street ↗';
  ui.on('experience-exit', () => context.onExit());
  let disposed = false;
  return {
    builder,
    group,
    ui,
    sound,
    finish() {
      group.add(builder.finish().group);
    },
    audio() {
      ui.on('activity-sound', async () => {
        const enabled = await sound.toggle();
        if (disposed) return;
        const b = ui.root.querySelector('#activity-sound');
        b.textContent = enabled ? 'Sound on' : 'Enable sound';
        b.setAttribute('aria-pressed', String(enabled));
      });
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
export const SOUND_BUTTON =
  '<button id="activity-sound" aria-pressed="false">Enable sound</button>';
