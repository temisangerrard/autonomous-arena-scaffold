export function createWorldStationsController(params) {
  const {
    THREE,
    scene,
    state,
    createWorldNpcHosts,
    extractBakedNpcStations,
    remapLocalStationProxies,
    mergeStations
  } = params;

  let worldRoot = null;
  let npcHosts = null;

  function setupWorldNpcStations() {
    if (!worldRoot) return;
    if (npcHosts) {
      npcHosts.dispose();
      npcHosts = null;
    }
    npcHosts = createWorldNpcHosts({ THREE, scene });
    state.hostStations = new Map(npcHosts.hostStations);
    state.bakedStations = extractBakedNpcStations({ THREE, worldRoot });
    for (const baked of state.bakedStations.values()) {
      let nearestHost = null;
      let nearestDistance = Number.POSITIVE_INFINITY;
      for (const host of state.hostStations.values()) {
        const dist = Math.hypot(Number(host.x || 0) - Number(baked.x || 0), Number(host.z || 0) - Number(baked.z || 0));
        if (dist < nearestDistance) {
          nearestDistance = dist;
          nearestHost = host;
        }
      }
      if (nearestHost) {
        baked.hostRole = baked.hostRole || nearestHost.hostRole || '';
        if (baked.kind === 'world_interactable' && nearestHost.localInteraction) {
          baked.localInteraction = { ...nearestHost.localInteraction };
        }
      }
    }
    remapLocalStationProxies();
    mergeStations();
  }

  function getWorldRoot() {
    return worldRoot;
  }

  function setWorldRoot(nextRoot) {
    worldRoot = nextRoot;
  }

  function updateHosts() {
    npcHosts?.updateHosts?.();
  }

  return {
    setupWorldNpcStations,
    getWorldRoot,
    setWorldRoot,
    updateHosts
  };
}
