export function renderMobileControlsRuntime(params) {
  const {
    computeMobileControlVisibility,
    isTouchLikeDevice,
    windowRef,
    mobileControls,
    worldMapPanel,
    getUiTargetId,
    challengeController,
    describeInteractionPhase,
    state,
    interactionCard,
    mobileInteract,
    mobileSend,
    mobileAccept,
    mobileDecline,
    mobileMoves,
    mobileMove1,
    mobileMove2,
    mobileMove3,
    mobileMoveH,
    mobileMoveT,
    mobileMoveD1,
    mobileMoveD2,
    mobileMoveD3,
    mobileMoveD4,
    mobileMoveD5,
    mobileMoveD6,
    featureMobileV2
  } = params;

  if (!mobileControls) {
    return;
  }
  const isCoarse = isTouchLikeDevice(windowRef);
  if (!isCoarse) {
    mobileControls.setAttribute('aria-hidden', 'true');
    if (worldMapPanel instanceof HTMLElement) {
      worldMapPanel.classList.remove('mobile-obscured');
    }
    return;
  }
  mobileControls.setAttribute('aria-hidden', 'false');

  const hasTarget = Boolean(getUiTargetId());
  const context = challengeController.computeControlContext();
  const interactionPhase = describeInteractionPhase(state);
  const interactionVisible = interactionCard instanceof HTMLElement
    && interactionCard.getAttribute('aria-hidden') !== 'true';
  const visibility = computeMobileControlVisibility({
    hasTarget,
    context,
    interactionOpen: Boolean(state.ui?.interactOpen),
    interactionVisible,
    dealerState: state.ui?.dealer?.state
  });

  if (mobileInteract) mobileInteract.style.display = visibility.interact ? 'inline-flex' : 'none';
  if (mobileSend) mobileSend.style.display = visibility.send ? 'inline-flex' : 'none';
  if (mobileAccept) mobileAccept.style.display = visibility.accept ? 'inline-flex' : 'none';
  if (mobileDecline) mobileDecline.style.display = visibility.decline ? 'inline-flex' : 'none';

  if (mobileMoves) mobileMoves.style.display = visibility.movesVisible ? 'grid' : 'none';
  if (mobileMove1) mobileMove1.style.display = visibility.rpsVisible ? 'inline-flex' : 'none';
  if (mobileMove2) mobileMove2.style.display = visibility.rpsVisible ? 'inline-flex' : 'none';
  if (mobileMove3) mobileMove3.style.display = visibility.rpsVisible ? 'inline-flex' : 'none';
  if (mobileMoveH) mobileMoveH.style.display = visibility.coinflipVisible ? 'inline-flex' : 'none';
  if (mobileMoveT) mobileMoveT.style.display = visibility.coinflipVisible ? 'inline-flex' : 'none';
  if (mobileMoveD1) mobileMoveD1.style.display = visibility.diceVisible ? 'inline-flex' : 'none';
  if (mobileMoveD2) mobileMoveD2.style.display = visibility.diceVisible ? 'inline-flex' : 'none';
  if (mobileMoveD3) mobileMoveD3.style.display = visibility.diceVisible ? 'inline-flex' : 'none';
  if (mobileMoveD4) mobileMoveD4.style.display = visibility.diceVisible ? 'inline-flex' : 'none';
  if (mobileMoveD5) mobileMoveD5.style.display = visibility.diceVisible ? 'inline-flex' : 'none';
  if (mobileMoveD6) mobileMoveD6.style.display = visibility.diceVisible ? 'inline-flex' : 'none';

  if (featureMobileV2 && mobileControls) {
    mobileControls.dataset.phase = interactionPhase;
  }

  if (worldMapPanel instanceof HTMLElement) {
    worldMapPanel.classList.toggle('mobile-obscured', visibility.mapShouldHide);
  }
}
