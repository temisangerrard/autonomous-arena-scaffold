#!/usr/bin/env node
import { spawn } from 'node:child_process';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocket } from 'ws';

const SERVER_PORT = Number(process.env.SMOKE_SERVER_PORT ?? 4010);
const RUNTIME_PORT = Number(process.env.SMOKE_RUNTIME_PORT ?? 4110);

function startService(name, cmd, args, env) {
  const child = spawn(cmd, args, {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  child.stdout.on('data', (chunk) => {
    process.stdout.write(`[${name}] ${chunk}`);
  });
  child.stderr.on('data', (chunk) => {
    process.stderr.write(`[${name}] ${chunk}`);
  });

  return child;
}

async function waitForHealth(url, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        return;
      }
    } catch {
      // retry
    }
    await delay(250);
  }
  throw new Error(`Health check timeout for ${url}`);
}

function runWsChallengeFlow(wsUrl, walletA, walletB) {
  return new Promise((resolve, reject) => {
    const a = new WebSocket(`${wsUrl}?name=SmokeA&walletId=${encodeURIComponent(walletA)}`);
    const b = new WebSocket(`${wsUrl}?name=SmokeB&walletId=${encodeURIComponent(walletB)}`);

    let aId = '';
    let bId = '';
    let started = false;
    let challengeId = '';
    let done = false;

    const fail = (message) => {
      if (done) {
        return;
      }
      done = true;
      a.close();
      b.close();
      reject(new Error(message));
    };

    const complete = (payload) => {
      if (done) {
        return;
      }
      done = true;
      a.close();
      b.close();
      resolve(payload);
    };

    const timer = setTimeout(() => {
      fail('Timed out waiting for challenge flow resolution');
    }, 14000);

    const maybeStart = () => {
      if (started || !aId || !bId) {
        return;
      }
      started = true;
      setTimeout(() => {
        a.send(JSON.stringify({
          type: 'challenge_send',
          targetId: bId,
          gameType: 'rps',
          wager: 2
        }));
      }, 700);
    };

    const isOurPair = (challenge) => {
      if (!challenge || !aId || !bId) {
        return false;
      }
      return (
        (challenge.challengerId === aId && challenge.opponentId === bId) ||
        (challenge.challengerId === bId && challenge.opponentId === aId)
      );
    };

    const onMessage = (label, socket, raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (msg.type === 'welcome') {
        if (label === 'A') {
          aId = msg.playerId;
        } else {
          bId = msg.playerId;
        }
        console.log(`ws ${label} welcome ${msg.playerId}`);
        maybeStart();
        return;
      }

      if (msg.type !== 'challenge') {
        return;
      }
      console.log(`ws ${label} challenge ${msg.event}${msg.reason ? ` (${msg.reason})` : ''}`);

      if (msg.event === 'invalid' || msg.event === 'busy') {
        fail(`Challenge rejected: ${msg.reason || msg.event}`);
        return;
      }

      if (msg.event === 'created' && isOurPair(msg.challenge)) {
        challengeId = msg.challenge?.id || challengeId;
        if (label === 'B' && challengeId) {
          socket.send(JSON.stringify({
            type: 'challenge_response',
            challengeId,
            accept: true
          }));
        }
        return;
      }

      if (msg.event === 'accepted' && challengeId && msg.challenge?.id === challengeId) {
        const move = label === 'A' ? 'rock' : 'scissors';
        socket.send(JSON.stringify({
          type: 'challenge_move',
          challengeId,
          move
        }));
        return;
      }

      if ((msg.event === 'declined' || msg.event === 'expired') && challengeId && msg.challenge?.id === challengeId) {
        fail(`Our challenge did not proceed: ${msg.event} (${msg.reason || 'n/a'})`);
        return;
      }

      if (msg.event === 'resolved' && challengeId && msg.challenge?.id === challengeId) {
        clearTimeout(timer);
        complete({
          challengeId,
          winnerId: msg.challenge?.winnerId ?? null,
          reason: msg.reason ?? null
        });
      }
    };

    a.on('message', (raw) => onMessage('A', a, raw));
    b.on('message', (raw) => onMessage('B', b, raw));
    a.on('error', (err) => fail(`Socket A error: ${err.message}`));
    b.on('error', (err) => fail(`Socket B error: ${err.message}`));
  });
}

async function main() {
  const server = startService('server', 'npx', ['tsx', 'apps/server/src/index.ts'], {
    PORT: String(SERVER_PORT),
    AGENT_RUNTIME_URL: `http://localhost:${RUNTIME_PORT}`,
    ESCROW_FEE_BPS: '0',
    PROXIMITY_THRESHOLD: '500'
  });
  const runtime = startService('agent-runtime', 'npx', ['tsx', 'apps/agent-runtime/src/index.ts'], {
    PORT: String(RUNTIME_PORT),
    GAME_WS_URL: `ws://localhost:${SERVER_PORT}/ws`,
    BOT_COUNT: '12',
    WALLET_SKILLS_ENABLED: 'true'
  });

  const shutdown = () => {
    server.kill('SIGTERM');
    runtime.kill('SIGTERM');
  };

  process.on('SIGINT', () => {
    shutdown();
    process.exit(130);
  });

  try {
    await waitForHealth(`http://localhost:${SERVER_PORT}/health`);
    await waitForHealth(`http://localhost:${RUNTIME_PORT}/health`);

    const runtimeStatusRes = await fetch(`http://localhost:${RUNTIME_PORT}/status`);
    if (!runtimeStatusRes.ok) {
      throw new Error('Failed to load runtime status');
    }
    const runtimeStatus = await runtimeStatusRes.json();
    if (!runtimeStatus.backgroundBotCount || runtimeStatus.backgroundBotCount < 8) {
      throw new Error(`Expected >=8 background bots, got ${runtimeStatus.backgroundBotCount ?? 0}`);
    }

    const walletPolicyRes = await fetch(`http://localhost:${RUNTIME_PORT}/capabilities/wallet`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        enabled: true,
        maxBetPercentOfBankroll: 100,
        maxDailyTxCount: 1000,
        requireEscrowForChallenges: true
      })
    });
    if (!walletPolicyRes.ok) {
      throw new Error('Failed to configure wallet policy for smoke');
    }

    const wallets = (runtimeStatus.wallets ?? []).slice(0, 2);
    if (wallets.length < 2 || !wallets[0]?.id || !wallets[1]?.id) {
      throw new Error('Need at least 2 runtime wallets for escrow smoke');
    }

    const fund = async (walletId) => {
      const response = await fetch(`http://localhost:${RUNTIME_PORT}/wallets/${walletId}/fund`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ amount: 200 })
      });
      if (!response.ok) {
        throw new Error(`Failed to fund wallet ${walletId}`);
      }
    };
    await fund(wallets[0].id);
    await fund(wallets[1].id);

    const result = await runWsChallengeFlow(`ws://localhost:${SERVER_PORT}/ws`, wallets[0].id, wallets[1].id);
    console.log('Playable smoke passed', result);
  } finally {
    shutdown();
    await delay(300);
  }
}

main().catch((error) => {
  console.error('Playable smoke failed:', error.message);
  process.exit(1);
});
