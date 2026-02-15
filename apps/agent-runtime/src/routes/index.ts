import type { SimpleRouter } from '../lib/http.js';
import { registerBotRoutes } from './bots.js';
import { registerHealthRoutes } from './health.js';
import { registerHouseRoutes } from './house.js';
import { registerProfileRoutes } from './profiles.js';
import { registerSuperAgentRoutes } from './superAgent.js';
import { registerWalletRoutes } from './wallets.js';

export function registerRuntimeRoutes(router: SimpleRouter, deps: {
  health: Parameters<typeof registerHealthRoutes>[1];
  house: Parameters<typeof registerHouseRoutes>[1];
  bots: Parameters<typeof registerBotRoutes>[1];
  profiles: Parameters<typeof registerProfileRoutes>[1];
  wallets: Parameters<typeof registerWalletRoutes>[1];
  superAgent: Parameters<typeof registerSuperAgentRoutes>[1];
}) {
  registerHealthRoutes(router, deps.health);
  registerHouseRoutes(router, deps.house);
  registerBotRoutes(router, deps.bots);
  registerProfileRoutes(router, deps.profiles);
  registerWalletRoutes(router, deps.wallets);
  registerSuperAgentRoutes(router, deps.superAgent);
}

