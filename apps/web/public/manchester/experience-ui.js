export function experienceUI(title, subtitle) {
  const root = document.createElement('section');
  root.id = 'experience-ui';
  root.innerHTML = `<header class="experience-header"><span class="experience-kicker"></span><h1></h1><button id="experience-exit">Back to the Quays ↗</button></header><div class="experience-caption" aria-live="polite"><strong id="speaker"></strong><p id="line"></p></div><div class="experience-actions"></div>`;
  root.querySelector('h1').textContent = title;
  root.querySelector('.experience-kicker').textContent = subtitle;
  document.body.append(root);
  const actions = root.querySelector('.experience-actions');
  return {
    root,
    caption(speaker, line) {
      root.querySelector('#speaker').textContent = speaker;
      root.querySelector('#line').textContent = line;
    },
    actions(html) {
      actions.innerHTML = html;
    },
    on(id, fn) {
      root.querySelector(`#${id}`).addEventListener('click', fn);
    },
    dispose() {
      root.remove();
    },
  };
}
