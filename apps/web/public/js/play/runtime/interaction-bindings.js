export function bindInteractionUi(params) {
  const {
    interactionPrompt,
    interactionClose,
    interactionHelpToggle,
    interactionHelp,
    getUiTargetId,
    setInteractOpen
  } = params;

  interactionPrompt?.addEventListener('click', () => {
    if (!getUiTargetId()) {
      return;
    }
    setInteractOpen(true);
  });
  interactionClose?.addEventListener('click', () => setInteractOpen(false));
  interactionHelpToggle?.addEventListener('click', () => {
    if (!interactionHelp) return;
    const nextOpen = interactionHelp.hidden;
    interactionHelp.hidden = !nextOpen;
    interactionHelpToggle.setAttribute('aria-expanded', nextOpen ? 'true' : 'false');
  });
}
