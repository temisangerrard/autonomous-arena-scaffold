import type { Chief2Runbook } from '../contracts.js';

const RUNBOOKS: Chief2Runbook[] = [
  {
    id: 'runtime.stability.check',
    title: 'Runtime Stability Check',
    description: 'Inspect runtime health, bot connectivity, and websocket auth drift.',
    safety: 'read_only'
  },
  {
    id: 'runtime.bots.reconcile',
    title: 'Reconcile Bot Fleet',
    description: 'Re-apply bot count and delegation controls to stabilize active agents.',
    safety: 'mutating'
  },
  {
    id: 'runtime.gas.sponsor',
    title: 'Sponsor Gas Recovery',
    description: 'Inspect sponsor gas and apply treasury refill when configured.',
    safety: 'financial'
  },
  {
    id: 'users.moderation',
    title: 'User Moderation Actions',
    description: 'Teleport, wallet adjust, and force logout for incident mitigation.',
    safety: 'financial'
  },
  {
    id: 'markets.sync',
    title: 'Prediction Markets Sync',
    description: 'Sync and update market activation states from oracle feed.',
    safety: 'mutating'
  }
];

export function listChief2Runbooks(): Chief2Runbook[] {
  return RUNBOOKS.slice();
}
