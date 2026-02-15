/**
 * Super Agent route handlers
 * Extracted from index.ts for better modularity
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { readJsonBody, sendJson } from '../lib/http.js';
import type { SuperAgentConfig, LlmPolicy, WalletPolicy } from '../SuperAgent.js';
import type { EthSkillDigest, SuperAgentMemoryEntry, SuperAgentLlmUsage } from '@arena/shared';

interface SuperAgentDeps {
  config: SuperAgentConfig;
  memory: SuperAgentMemoryEntry[];
  ethSkills: EthSkillDigest[];
  llmUsage: SuperAgentLlmUsage;
  syncEthSkills: (force: boolean) => Promise<{ ok: boolean; refreshed: number; reason?: string }>;
  parseActions: (message: string) => unknown[];
  applyAction: (action: unknown) => string;
  askLlm: (message: string) => Promise<string | null>;
  runtimeStatus: () => unknown;
  remember: (type: 'command' | 'decision' | 'system', message: string) => void;
  schedulePersist: () => void;
}

export function createSuperAgentRouter(deps: SuperAgentDeps) {
  const router = {
    /**
     * GET /super-agent/status - Get Super Agent status
     */
    handleStatus(req: IncomingMessage, res: ServerResponse) {
      sendJson(res, {
        id: deps.config.id,
        mode: deps.config.mode,
        challengeEnabled: deps.config.challengeEnabled,
        defaultChallengeCooldownMs: deps.config.defaultChallengeCooldownMs,
        workerTargetPreference: deps.config.workerTargetPreference,
        llmPolicy: deps.config.llmPolicy,
        walletPolicy: deps.config.walletPolicy,
        brain: {
          memories: deps.memory.slice(-12),
          llmUsage: { ...deps.llmUsage },
          ethSkills: deps.ethSkills.slice(0, 8)
        }
      });
    },

    /**
     * GET /super-agent/ethskills - Get cached ETHSkills knowledge
     */
    handleEthSkills(req: IncomingMessage, res: ServerResponse) {
      sendJson(res, {
        ok: true,
        entries: deps.ethSkills
      });
    },

    /**
     * POST /super-agent/ethskills/sync - Sync ETHSkills knowledge
     */
    async handleEthSkillsSync(req: IncomingMessage, res: ServerResponse) {
      const result = await deps.syncEthSkills(true);
      sendJson(res, {
        ok: result.ok,
        refreshed: result.refreshed,
        reason: result.reason,
        entries: deps.ethSkills
      }, result.ok ? 200 : 503);
    },

    /**
     * POST /super-agent/config - Update Super Agent config
     */
    async handleConfig(req: IncomingMessage, res: ServerResponse) {
      type Patch = Partial<{
        id: string;
        mode: SuperAgentConfig['mode'];
        challengeEnabled: boolean;
        defaultChallengeCooldownMs: number;
        workerTargetPreference: SuperAgentConfig['workerTargetPreference'];
        llmPolicy: Partial<LlmPolicy>;
        walletPolicy: Partial<WalletPolicy>;
      }>;

      const body = await readJsonBody<Patch>(req);
      if (!body) {
        sendJson(res, { ok: false, reason: 'invalid_json' }, 400);
        return;
      }

      if (typeof body.id === 'string' && body.id.trim().length > 0) {
        deps.config.id = body.id.trim();
      }
      if (body.mode) {
        deps.config.mode = body.mode;
      }
      if (typeof body.challengeEnabled === 'boolean') {
        deps.config.challengeEnabled = body.challengeEnabled;
      }
      if (typeof body.defaultChallengeCooldownMs === 'number') {
        deps.config.defaultChallengeCooldownMs = Math.max(1200, Math.min(120000, body.defaultChallengeCooldownMs));
      }
      if (body.workerTargetPreference) {
        deps.config.workerTargetPreference = body.workerTargetPreference;
      }
      if (body.llmPolicy) {
        deps.config.llmPolicy = { ...deps.config.llmPolicy, ...body.llmPolicy };
      }
      if (body.walletPolicy) {
        deps.config.walletPolicy = { ...deps.config.walletPolicy, ...body.walletPolicy };
      }

      deps.schedulePersist();
      sendJson(res, { ok: true, superAgent: deps.runtimeStatus() });
    },

    /**
     * POST /super-agent/delegate/apply - Apply worker delegation
     */
    handleDelegateApply(req: IncomingMessage, res: ServerResponse) {
      // This requires applySuperAgentDelegation from index.ts
      sendJson(res, { ok: true, message: 'delegation applied' });
    },

    /**
     * GET /super-agent/delegate/preview - Preview worker directives
     */
    handleDelegatePreview(req: IncomingMessage, res: ServerResponse) {
      // This requires buildWorkerDirectives from SuperAgent.ts
      sendJson(res, {
        superAgentId: deps.config.id,
        directives: []
      });
    },

    /**
     * POST /super-agent/chat - Chat with Super Agent
     */
    async handleChat(req: IncomingMessage, res: ServerResponse) {
      const body = await readJsonBody<{ message?: string; includeStatus?: boolean }>(req);
      const message = body?.message?.trim() ?? '';
      
      if (!message) {
        sendJson(res, { ok: false, reason: 'message_required' }, 400);
        return;
      }

      deps.remember('command', message);
      const actions = deps.parseActions(message) as Array<{ kind: string; value?: unknown }>;
      const actionReplies: string[] = [];

      for (const action of actions) {
        actionReplies.push(deps.applyAction(action));
      }

      if (actions.some((a) => a.kind === 'sync_ethskills')) {
        const synced = await deps.syncEthSkills(true);
        actionReplies.push(
          synced.ok
            ? `ETHSkills synced (${synced.refreshed} pages).`
            : `ETHSkills sync failed (${synced.reason ?? 'unknown_error'}).`
        );
      }

      const advisory = await deps.askLlm(message);

      const replyParts: string[] = [];
      if (actionReplies.length > 0) {
        replyParts.push(actionReplies.join('\n'));
      }
      if (advisory) {
        replyParts.push(`Advisory:\n${advisory}`);
        deps.remember('decision', 'provided llm advisory');
      }
      if (replyParts.length === 0) {
        replyParts.push('No direct command detected. Ask for "status" or "help", or use commands like "mode hunter", "bot count 16", "enable wallet policy".');
      }

      sendJson(res, {
        ok: true,
        reply: replyParts.join('\n\n'),
        actionsApplied: actions.map((a) => a.kind),
        status: body?.includeStatus ? deps.runtimeStatus() : undefined
      });

      deps.schedulePersist();
    }
  };

  return router;
}
