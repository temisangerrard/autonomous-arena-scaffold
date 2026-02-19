import type { Chief2Incident, Chief2TurnRecord } from '../contracts.js';

export class Chief2MemoryStore {
  private readonly turns: Chief2TurnRecord[] = [];
  private readonly incidents: Chief2Incident[] = [];

  recordTurn(turn: Chief2TurnRecord): void {
    this.turns.push(turn);
    if (this.turns.length > 500) {
      this.turns.splice(0, this.turns.length - 500);
    }
  }

  recentTurns(limit = 20): Chief2TurnRecord[] {
    const n = Math.max(1, Math.min(200, Number(limit || 20)));
    return this.turns.slice(-n).reverse();
  }

  upsertIncident(incident: Chief2Incident): void {
    const idx = this.incidents.findIndex((entry) => entry.id === incident.id);
    if (idx >= 0) {
      this.incidents[idx] = incident;
      return;
    }
    this.incidents.unshift(incident);
    if (this.incidents.length > 300) {
      this.incidents.length = 300;
    }
  }

  listIncidents(limit = 60): Chief2Incident[] {
    const n = Math.max(1, Math.min(200, Number(limit || 60)));
    return this.incidents.slice(0, n);
  }
}
