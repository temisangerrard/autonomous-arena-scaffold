export function handleFullscreenKey(event) {
  if (event.code === 'KeyF') {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => undefined);
    } else {
      document.exitFullscreen().catch(() => undefined);
    }
    return true;
  }
  return false;
}
