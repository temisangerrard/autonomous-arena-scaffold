import { describe, expect, it } from 'vitest';
import { buildWorkerDirectives, createDefaultSuperAgentConfig } from './SuperAgent.js';

describe('SuperAgent delegation', () => {
  it('creates deterministic directives for workers and excludes super agent id', () => {
    const config = createDefaultSuperAgentConfig('agent_1');
    config.mode = 'hunter';

    const directives = buildWorkerDirectives(config, ['agent_1', 'agent_2', 'agent_3']);

    expect(directives.map((d) => d.botId)).toEqual(['agent_2', 'agent_3']);
    expect(directives[0]?.patch.personality).toBe('aggressive');
    expect(directives[1]?.patch.personality).toBe('social');
  });
});
