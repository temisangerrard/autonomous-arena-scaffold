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

  function createDegradedBakedInteraction(baked, nearestHost) {
    const sectionRole = String(nearestHost?.hostRole || baked.hostRole || 'info');
    const destination = nearestHost?.displayName || 'nearest live host';
    return {
      title: `${baked.displayName || 'Section Kiosk'} Terminal`,
      inspect: `This kiosk provides guidance only in this section. Live ${sectionRole} gameplay is available at ${destination}.`,
      useLabel: 'Show Route',
      use: `Walk to ${destination} to open the live station panel and place your wager.`
    };
  }

  function setupWorldNpcStations() {
    if (!worldRoot) return;
    if (npcHosts) {
      npcHosts.dispose();
      npcHosts = null;
    }
    npcHosts = createWorldNpcHosts({ THREE, scene });
    state.hostStations = new Map(npcHosts.hostStations);
    state.bakedStations = extractBakedNpcStations({ THREE, worldRoot });
    remapLocalStationProxies();
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
      const hasLiveProxy = Boolean(String(baked.proxyStationId || '').trim());
      const degradableKind = baked.kind !== 'world_interactable';
      if (degradableKind && !hasLiveProxy) {
        baked.originalKind = baked.kind;
        baked.kind = 'world_interactable';
        baked.degradedToLocal = true;
        baked.radius = 8;
        baked.actions = ['interact_open', 'interact_use'];
        baked.interactionTag = `baked_info_${String(baked.hostRole || 'info')}`;
        baked.localInteraction = createDegradedBakedInteraction(baked, nearestHost);
      } else {
        baked.degradedToLocal = false;
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
