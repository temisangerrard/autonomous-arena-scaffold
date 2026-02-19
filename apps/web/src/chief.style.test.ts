import { describe, expect, it } from 'vitest';
import { formatChiefReplyStyle } from './chief/style.js';

describe('chief style formatter', () => {
  it('formats replies in operator voice without robotic key-value prelude', () => {
    const output = formatChiefReplyStyle({
      mode: 'admin',
      intent: 'status_explain',
      runbook: 'ops.state.snapshot',
      reply: 'Collected snapshot.',
      actionsCount: 1,
      safetyClass: 'read_only',
      stopReason: 'completed'
    });
    expect(output).toContain('Operator update');
    expect(output).toContain('I ran 1 action.');
    expect(output).toContain('Track: ops.state.snapshot');
    expect(output).not.toContain('Chief Ops · runbook=');
  });

  it('removes advisory label noise in pass-through mode', () => {
    const output = formatChiefReplyStyle({
      mode: 'player',
      intent: 'unknown',
      reply: 'Advisory:\nUse status first.',
      actionsCount: 0,
      includePrelude: false
    });
    expect(output).toBe('Use status first.');
  });
});
