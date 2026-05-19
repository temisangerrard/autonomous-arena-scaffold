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

  function guideProfileForRole(role) {
    switch (String(role || '')) {
      case 'cashier':
        return {
          displayName: 'Cashier Guide',
          title: 'Cashier Guide',
          inspect: 'Rex is live on the east rail. Fund, withdraw, or move balance there before you walk back into the action.',
          useLabel: 'Open cashier',
          use: 'Opening Rex on the east rail.',
          roleLabel: 'cashier'
        };
      case 'coinflip':
        return {
          displayName: 'Coinflip Runner',
          title: 'Coinflip Runner',
          inspect: 'Jade is taking coinflip rounds right now. Best first stop if you want one clean decision and a fast result.',
          useLabel: 'Open coinflip',
          use: 'Opening Jade at the coinflip table.',
          roleLabel: 'coinflip'
        };
      case 'rps':
        return {
          displayName: 'RPS Runner',
          title: 'RPS Runner',
          inspect: 'Axel is live on Rock Paper Scissors. If you want reads instead of luck, step to his table.',
          useLabel: 'Open RPS',
          use: 'Opening Axel at the RPS table.',
          roleLabel: 'RPS'
        };
      case 'dice':
        return {
          displayName: 'Dice Runner',
          title: 'Dice Runner',
          inspect: 'Zara is still rolling on the south line. Pick a face there if you want the fastest swing in the arena.',
          useLabel: 'Open dice',
          use: 'Opening Zara at the dice table.',
          roleLabel: 'dice'
        };
      case 'prediction':
        return {
          displayName: 'Market Runner',
          title: 'Market Runner',
          inspect: 'Kai is posting live prediction rounds on the north rise. If you have a view, that board is where it pays.',
          useLabel: 'Open markets',
          use: 'Opening Kai at the live market board.',
          roleLabel: 'prediction'
        };
      case 'blackjack':
        return {
          displayName: 'Blackjack Runner',
          title: 'Blackjack Runner',
          inspect: 'Vera is live on blackjack. Step there when you want a longer hand and a real dealer read.',
          useLabel: 'Open blackjack',
          use: 'Opening Vera at the blackjack table.',
          roleLabel: 'blackjack'
        };
      default:
        return {
          displayName: 'Floor Host',
          title: 'Floor Host',
          inspect: 'Live hosts are working this section now. Step to a named table and the panel will open with a real round, not filler.',
          useLabel: 'Find live table',
          use: 'Routing you to the nearest live host.',
          roleLabel: 'live host'
        };
    }
  }

  function createDegradedBakedInteraction(baked, nearestSameRoleHost, nearestHost) {
    // Prefer a host that matches the baked station's game type so players are
    // routed to a coinflip dealer for coinflip kiosks, RPS dealer for RPS kiosks, etc.
    const routeHost = nearestSameRoleHost || nearestHost;
    const sectionRole = String(baked.hostRole || routeHost?.hostRole || 'info');
    const profile = guideProfileForRole(sectionRole);
    const destination = routeHost?.displayName || 'the nearest live host';
    return {
      title: profile.title,
      inspect: `${profile.inspect} ${routeHost ? `${destination} is the live stop for this side of the arena.` : 'No live stop is mapped here yet, so follow the nearest named host.'}`,
      useLabel: profile.useLabel,
      use: routeHost ? profile.use : 'Move to the nearest named host to enter a real round.',
      routeStationId: routeHost?.id || '',
      routeHostName: destination
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
        baked.displayName = baked.localInteraction?.title || guideProfileForRole(baked.hostRole).displayName;
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
