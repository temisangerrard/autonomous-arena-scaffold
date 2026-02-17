/**
 * @typedef {Object} StationPlugin
 * @property {string} kind
 * @property {(ctx: any) => string} renderInteractionCard
 * @property {(ctx: any, payload: any) => void} onStationUiMessage
 * @property {(ctx: any) => string[]} getMobileActions
 * @property {(ctx: any) => { title: string, subtitle: string } | null} getDirectioningHints
 */

/**
 * @typedef {Object} GamePlugin
 * @property {string} gameType
 * @property {{ moves: string[] }} moveSchema
 * @property {(ctx: any) => string} renderMoveControls
 * @property {(move: string) => boolean} validateMove
 * @property {(ctx: any) => string} describeStatus
 */

/**
 * @typedef {Object} NpcOperatorPlugin
 * @property {string} npcRole
 * @property {string[]} stationKinds
 * @property {(ctx: any) => string} decidePrompt
 * @property {(ctx: any) => { type: string, action: string } | null} decideAutoAction
 */

export function createPluginRegistry() {
  /** @type {Map<string, StationPlugin>} */
  const stations = new Map();
  /** @type {Map<string, GamePlugin>} */
  const games = new Map();
  /** @type {Map<string, NpcOperatorPlugin>} */
  const npcs = new Map();

  return {
    registerStation(plugin) {
      stations.set(plugin.kind, plugin);
    },
    registerGame(plugin) {
      games.set(plugin.gameType, plugin);
    },
    registerNpc(plugin) {
      npcs.set(plugin.npcRole, plugin);
    },
    station(kind) {
      return stations.get(kind) || null;
    },
    game(gameType) {
      return games.get(gameType) || null;
    },
    npc(role) {
      return npcs.get(role) || null;
    }
  };
}
