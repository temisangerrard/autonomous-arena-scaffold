export function createFrameLoop(params) {
  const {
    queryParams,
    update,
    render
  } = params;

  function frame(nowMs) {
    const isTest = queryParams.get('test') === '1';
    update(nowMs);
    // Headless smoke tests don't need WebGL draws and can hang on `renderer.render`
    // under SwiftShader. Skip render in `test=1` mode; state still advances.
    if (!isTest) {
      render();
      requestAnimationFrame(frame);
    }
  }

  return {
    frame,
    render
  };
}
