import type { Chief2Action, Chief2Event, Chief2ExecutionGraph } from '../contracts.js';
import type { Chief2Plan } from './toolRegistry.js';

export async function runChief2Loop(params: {
  objective: string;
  plans: Chief2Plan[];
}): Promise<{
  actions: Chief2Action[];
  events: Chief2Event[];
  executionGraph: Chief2ExecutionGraph;
  replyParts: string[];
  stateSnapshot?: Record<string, unknown>;
}> {
  const now = Date.now();
  const actions: Chief2Action[] = [];
  const events: Chief2Event[] = [];
  const steps: Chief2ExecutionGraph['steps'] = [];
  const replyParts: string[] = [];
  let mergedSnapshot: Record<string, unknown> | undefined;

  for (const plan of params.plans) {
    events.push({ type: 'plan', at: now, tool: plan.tool, message: plan.summary });
    steps.push({ tool: plan.tool, status: 'planned', summary: plan.summary });
  }

  for (const plan of params.plans) {
    events.push({ type: 'tool_call', at: Date.now(), tool: plan.tool, message: `Executing ${plan.tool}` });
    try {
      const result = await plan.execute();
      actions.push({ tool: plan.tool, status: 'executed', summary: result.summary });
      steps.push({ tool: plan.tool, status: 'executed', summary: result.summary });
      events.push({ type: 'tool_result', at: Date.now(), tool: plan.tool, message: result.summary });
      replyParts.push(result.summary);
      if (result.stateSnapshot) {
        mergedSnapshot = { ...(mergedSnapshot || {}), ...result.stateSnapshot };
      }
    } catch (error) {
      const message = String((error as Error)?.message || 'tool_failed');
      actions.push({ tool: plan.tool, status: 'blocked', summary: message });
      steps.push({ tool: plan.tool, status: 'blocked', summary: message });
      events.push({ type: 'blocked', at: Date.now(), tool: plan.tool, message });
      replyParts.push(`${plan.tool} blocked: ${message}`);
    }
  }

  let stopReason: Chief2ExecutionGraph['stopReason'] = 'completed';
  if (actions.every((entry) => entry.status !== 'executed')) {
    stopReason = 'blocked';
  } else if (actions.some((entry) => entry.status === 'blocked')) {
    stopReason = 'fallback';
  }

  events.push({ type: 'done', at: Date.now(), message: `Loop finished (${stopReason}).` });

  return {
    actions,
    events,
    executionGraph: {
      objective: params.objective,
      steps,
      stopReason
    },
    replyParts,
    stateSnapshot: mergedSnapshot
  };
}
