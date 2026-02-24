/**
 * Proximity detection utilities
 */

/**
 * Create a consistent pair key for two player IDs
 */
export function makePairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Check if two players are near each other based on proximity pairs
 */
export function arePlayersNear(activeProximityPairs: Set<string>, a: string, b: string): boolean {
  return activeProximityPairs.has(makePairKey(a, b));
}

/**
 * Player position for proximity calculations
 */
export type ProximityPlayer = { id: string; x: number; z: number };

/**
 * Proximity event data
 */
export type ProximityEvent = {
  type: 'proximity';
  event: 'enter' | 'exit';
  otherId: string;
  otherName: string;
  distance?: number;
};

/**
 * Emit proximity events based on player positions
 * Returns events to send and updates the activeProximityPairs set
 */
export function emitProximityEvents(
  players: ProximityPlayer[],
  activeProximityPairs: Set<string>,
  proximityThreshold: number,
  displayNameFor: (playerId: string) => string,
  sendToDistributed: (playerId: string, payload: ProximityEvent) => void
): void {
  const nowNear = new Set<string>();

  for (let i = 0; i < players.length; i += 1) {
    for (let j = i + 1; j < players.length; j += 1) {
      const a = players[i];
      const b = players[j];
      if (!a || !b) {
        continue;
      }

      const distance = Math.hypot(a.x - b.x, a.z - b.z);
      if (distance <= proximityThreshold) {
        const key = makePairKey(a.id, b.id);
        nowNear.add(key);

        if (!activeProximityPairs.has(key)) {
          sendToDistributed(a.id, { 
            type: 'proximity', 
            event: 'enter', 
            otherId: b.id, 
            otherName: displayNameFor(b.id), 
            distance 
          });
          sendToDistributed(b.id, { 
            type: 'proximity', 
            event: 'enter', 
            otherId: a.id, 
            otherName: displayNameFor(a.id), 
            distance 
          });
        }
      }
    }
  }

  for (const key of activeProximityPairs) {
    if (nowNear.has(key)) {
      continue;
    }

    const [a, b] = key.split('|');
    if (a && b) {
      sendToDistributed(a, { type: 'proximity', event: 'exit', otherId: b, otherName: displayNameFor(b) });
      sendToDistributed(b, { type: 'proximity', event: 'exit', otherId: a, otherName: displayNameFor(a) });
    }
  }

  activeProximityPairs.clear();
  for (const key of nowNear) {
    activeProximityPairs.add(key);
  }
}

/**
 * Remove proximity pairs for a disconnected player
 */
export function clearPlayerProximityPairs(
  activeProximityPairs: Set<string>,
  playerId: string
): void {
  for (const key of [...activeProximityPairs]) {
    const [a, b] = key.split('|');
    if (a === playerId || b === playerId) {
      activeProximityPairs.delete(key);
    }
  }
}
