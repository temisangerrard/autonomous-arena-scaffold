export function handleActionKeyDown(event, state, actions) {
  if (event.code === 'KeyE') {
    if (!actions.getUiTargetId?.()) return false;
    event.preventDefault();
    actions.setInteractOpen?.(!state.ui.interactOpen);
    return true;
  }
  if (event.code === 'Tab') {
    event.preventDefault();
    actions.cycleNearbyTarget?.(!event.shiftKey);
    return true;
  }
  if (event.code === 'Escape') {
    actions.setInteractOpen?.(false);
    return true;
  }
  return false;
}
