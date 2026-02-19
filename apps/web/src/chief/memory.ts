import type { ChiefIntent, ChiefMode } from '../chief.js';

type MemoryOutcome = 'executed' | 'planned' | 'fallback' | 'blocked';

export type ChiefMemoryTurn = {
  at: number;
  mode: ChiefMode;
  intent: ChiefIntent;
  message: string;
  runbook?: string;
  selectedSkills: string[];
  summary: string;
  outcome: MemoryOutcome;
};

function short(text: string, n = 220): string {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  return value.length <= n ? value : `${value.slice(0, n - 3)}...`;
}

export class ChiefMemoryStore {
  private turns: ChiefMemoryTurn[] = [];
  constructor(private readonly maxTurns = 200) {}

  recordTurn(turn: ChiefMemoryTurn): void {
    this.turns.push({ ...turn, message: short(turn.message, 300), summary: short(turn.summary, 420) });
    if (this.turns.length > this.maxTurns) {
      this.turns.splice(0, this.turns.length - this.maxTurns);
    }
  }

  recentTurns(limit = 8): ChiefMemoryTurn[] {
    const safe = Math.max(1, Math.min(40, Number(limit || 8)));
    return this.turns.slice(-safe);
  }

  memoryContextFor(intent: ChiefIntent, mode: ChiefMode, limit = 4): string {
    const relevant = this.turns
      .filter((turn) => turn.intent === intent && turn.mode === mode)
      .slice(-Math.max(1, Math.min(20, Number(limit || 4))));
    if (relevant.length === 0) {
      return '';
    }
    return relevant
      .map((turn) => `- ${new Date(turn.at).toISOString()}: ${turn.outcome} ${turn.runbook || turn.intent} -> ${turn.summary}`)
      .join('\n');
  }

  whatChangedSummary(mode: ChiefMode): string {
    const recent = this.turns.filter((turn) => turn.mode === mode).slice(-6);
    if (recent.length === 0) {
      return 'No prior operations recorded yet.';
    }
    const executed = recent.filter((turn) => turn.outcome === 'executed').length;
    const planned = recent.filter((turn) => turn.outcome === 'planned').length;
    const blocked = recent.filter((turn) => turn.outcome === 'blocked').length;
    const fallback = recent.filter((turn) => turn.outcome === 'fallback').length;
    return `Recent changes: executed=${executed}, planned=${planned}, blocked=${blocked}, fallback=${fallback}.`;
  }
}
