import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { SimpleRouter } from '../lib/http.js';
import { registerBotRoutes } from './bots.js';

function makeJsonRequest(body: Record<string, unknown>) {
  const stream = Readable.from([JSON.stringify(body)]);
  return stream as unknown as import('node:http').IncomingMessage;
}

function makeResponse() {
  const response = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: '',
    setHeader(name: string, value: string) {
      this.headers[name] = value;
    },
    end(chunk?: string) {
      this.body = String(chunk || '');
    }
  };
  return response as unknown as import('node:http').ServerResponse & {
    headers: Record<string, string>;
    body: string;
  };
}

describe('registerBotRoutes', () => {
  it('maps autoplay.enabled to owner autoplayEnabled and reapplies delegation', async () => {
    const router = new SimpleRouter();
    const updateBehavior = vi.fn();
    const getStatus = vi.fn(() => ({
      behavior: {
        personality: 'social',
        mode: 'passive',
        targetPreference: 'human_only',
        challengeCooldownMs: 2600,
        maxWager: 2
      }
    }));
    const bot = {
      updateBehavior,
      getStatus,
      resetAutoplaySession: vi.fn(),
      updateDisplayName: vi.fn()
    };
    const record = {
      id: 'agent_profile_3',
      walletId: 'wallet_3',
      ownerProfileId: 'profile_3',
      duty: 'owner',
      displayName: 'Robin',
      managedBySuperAgent: true,
      autoplayEnabled: false
    };
    const applySuperAgentDelegation = vi.fn();
    const schedulePersistState = vi.fn();

    registerBotRoutes(router, {
      bots: new Map([[record.id, bot as never]]),
      botRegistry: new Map([[record.id, record as never]]),
      backgroundBotIds: new Set(),
      usedDisplayNames: new Set(),
      wallets: new Map(),
      walletSummary: () => null,
      reconcileBots: () => {},
      schedulePersistState,
      applySuperAgentDelegation,
      coinbasePaymasterEnabled: false,
      coinbaseEscrowApprovalCapUsdc: undefined,
      chainId: null,
      chainHint: null,
      mainnetGasSponsorEnabled: false
    });

    const matched = router.match('POST', `/agents/${record.id}/config`);
    expect(matched).not.toBeNull();
    const req = makeJsonRequest({
      autoplay: {
        enabled: true,
        games: ['rps', 'coinflip'],
        wagerMode: 'fixed',
        cooldownMs: 3000
      }
    });
    const res = makeResponse();

    await matched?.handler(req, res, matched.params);
    const payload = JSON.parse(res.body);

    expect(payload.ok).toBe(true);
    expect(record.autoplayEnabled).toBe(true);
    expect(updateBehavior).toHaveBeenCalled();
    expect(applySuperAgentDelegation).toHaveBeenCalledTimes(1);
    expect(schedulePersistState).toHaveBeenCalledTimes(1);
  });
});
