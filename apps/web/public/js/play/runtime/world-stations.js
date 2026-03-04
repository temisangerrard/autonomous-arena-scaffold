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

  function createDegradedBakedInteraction(baked, nearestSameRoleHost, nearestHost) {
    // Prefer a host that matches the baked station's game type so players are
    // routed to a coinflip dealer for coinflip kiosks, RPS dealer for RPS kiosks, etc.
    const routeHost = nearestSameRoleHost || nearestHost;
    const sectionRole = String(baked.hostRole || routeHost?.hostRole || 'info');
    const destination = routeHost?.displayName || 'nearest live host';
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
    const OVERLAP_SUPPRESSION_DISTANCE = 10;
    for (const [bakedId, baked] of state.bakedStations.entries()) {
      let overlapsLiveHost = false;
      for (const host of state.hostStations.values()) {
        const sameKind = String(host.kind || '') === String(baked.kind || '');
        if (!sameKind) continue;
        const dist = Math.hypot(Number(host.x || 0) - Number(baked.x || 0), Number(host.z || 0) - Number(baked.z || 0));
        if (dist <= OVERLAP_SUPPRESSION_DISTANCE) {
          overlapsLiveHost = true;
          break;
        }
      }
      if (overlapsLiveHost) {
        state.bakedStations.delete(bakedId);
      }
    }
    for (const baked of state.bakedStations.values()) {
      let nearestHost = null;
      let nearestDistance = Number.POSITIVE_INFINITY;
      let nearestSameRoleHost = null;
      let nearestSameRoleDistance = Number.POSITIVE_INFINITY;
      for (const host of state.hostStations.values()) {
        const dist = Math.hypot(Number(host.x || 0) - Number(baked.x || 0), Number(host.z || 0) - Number(baked.z || 0));
        if (dist < nearestDistance) {
          nearestDistance = dist;
          nearestHost = host;
        }
        // Also track the nearest host that matches this baked station's game type
        const sameRole = String(host.hostRole || '') === String(baked.hostRole || '') && baked.hostRole;
        if (sameRole && dist < nearestSameRoleDistance) {
          nearestSameRoleDistance = dist;
          nearestSameRoleHost = host;
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
        baked.localInteraction = createDegradedBakedInteraction(baked, nearestSameRoleHost, nearestHost);
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
