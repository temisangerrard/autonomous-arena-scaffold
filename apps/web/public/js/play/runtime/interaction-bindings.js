export function bindInteractionUi(params) {
  const {
    interactionPrompt,
    interactionClose,
    interactionHelpToggle,
    interactionHelp,
    getUiTargetId,
    setInteractOpen
  } = params;

  function bindTapAction(target, handler) {
    if (!target) return;
    let suppressClick = false;

    const run = (event) => {
      event?.preventDefault?.();
      event?.stopPropagation?.();
      handler();
    };

    target.addEventListener('pointerup', (event) => {
      if (event?.isPrimary === false) return;
      suppressClick = true;
      run(event);
    });

    target.addEventListener('click', (event) => {
      const shouldSuppress = suppressClick;
      suppressClick = false;
      event?.preventDefault?.();
      event?.stopPropagation?.();
      if (shouldSuppress) return;
      handler();
    });
  }

  interactionPrompt?.addEventListener('click', () => {
    if (!getUiTargetId()) {
      return;
    }
    setInteractOpen(true);
  });
  bindTapAction(interactionClose, () => setInteractOpen(false));
  bindTapAction(interactionHelpToggle, () => {
    if (!interactionHelp) return;
    const nextOpen = interactionHelp.hidden;
    interactionHelp.hidden = !nextOpen;
    interactionHelpToggle.setAttribute('aria-expanded', nextOpen ? 'true' : 'false');
  });
}
