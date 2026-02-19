import type { ChiefIntent, ChiefMode } from '../chief.js';

type StyleInput = {
  mode: ChiefMode;
  intent: ChiefIntent;
  runbook?: string;
  reply: string;
  actionsCount: number;
  safetyClass?: 'read_only' | 'mutating' | 'financial';
  includePrelude?: boolean;
  stopReason?: 'completed' | 'blocked' | 'fallback';
};

function intentLabel(intent: ChiefIntent): string {
  switch (intent) {
    case 'status_explain': return 'Status';
    case 'bot_tune': return 'Bot Tuning';
    case 'wallet_action': return 'Wallet Ops';
    case 'user_admin': return 'User Ops';
    case 'runtime_ops': return 'Runtime Ops';
    case 'game_fix': return 'Game Fix';
    default: return 'General';
  }
}

export function formatChiefReplyStyle(input: StyleInput): string {
  const body = String(input.reply || '')
    .replace(/^Advisory:\s*/im, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!body) {
    return '';
  }
  if (input.includePrelude === false) {
    return body;
  }

  const actionCount = Math.max(0, Number(input.actionsCount || 0));
  const headerLabel = input.mode === 'admin' ? 'Operator update' : 'Update';
  let statusText = 'No direct action was needed.';
  if (actionCount > 0 && input.stopReason === 'completed') {
    statusText = `I ran ${actionCount} action${actionCount === 1 ? '' : 's'}.`;
  } else if (actionCount > 0 && input.stopReason === 'fallback') {
    statusText = `I ran ${actionCount} action${actionCount === 1 ? '' : 's'}, with partial fallback.`;
  } else if (actionCount > 0 && input.stopReason === 'blocked') {
    statusText = `I attempted ${actionCount} action${actionCount === 1 ? '' : 's'}, but some steps were blocked.`;
  }

  const contextLine = input.runbook
    ? `Track: ${input.runbook}`
    : `Track: ${intentLabel(input.intent)}`;
  const safetyLine = input.safetyClass ? `Safety: ${input.safetyClass}` : '';

  return [headerLabel, statusText, contextLine, safetyLine, '', body]
    .filter((line) => line.trim().length > 0)
    .join('\n');
}
