import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  AgentBot,
  type AgentBehaviorConfig,
  type AgentBotStatus
} from './AgentBot.js';
import { createHealthStatus } from './health.js';
import {
  buildWorkerDirectives,
  createDefaultSuperAgentConfig,
  type LlmPolicy,
  type SuperAgentConfig,
  type WalletPolicy
} from './SuperAgent.js';
import type { Personality } from './PolicyEngine.js';

const port = Number(process.env.PORT ?? 4100);
const wsBaseUrl = process.env.GAME_WS_URL ?? 'ws://localhost:4000/ws';
const personalities: Personality[] = ['aggressive', 'conservative', 'social'];

const superAgentConfig: SuperAgentConfig = createDefaultSuperAgentConfig(
  process.env.GRAND_AGENT_ID ?? 'agent_1'
);

if (process.env.OPENROUTER_API_KEY) {
  superAgentConfig.llmPolicy.enabled = true;
}
superAgentConfig.llmPolicy.enabled = true;

if (process.env.WALLET_SKILLS_ENABLED === 'false') {
  superAgentConfig.walletPolicy.enabled = false;
} else {
  superAgentConfig.walletPolicy.enabled = true;
}

const systemSeedBalance = Math.max(0, Number(process.env.SYSTEM_BOT_START_BALANCE ?? 120));
const userSeedBalance = Math.max(0, Number(process.env.USER_BOT_START_BALANCE ?? 20));

const runtimeSecrets = {
  openRouterApiKey: process.env.OPENROUTER_API_KEY ?? ''
};
const runtimeStateFile = process.env.AGENT_RUNTIME_STATE_FILE
  ? path.resolve(process.cwd(), process.env.AGENT_RUNTIME_STATE_FILE)
  : path.resolve(process.cwd(), 'output', 'agent-runtime-state.json');

const encryptionKey = createHash('sha256')
  .update(process.env.WALLET_ENCRYPTION_KEY ?? 'arena-dev-wallet-key')
  .digest();

type Profile = {
  id: string;
  username: string;
  displayName: string;
  createdAt: number;
  walletId: string;
  ownedBotIds: string[];
};

type WalletRecord = {
  id: string;
  ownerProfileId: string;
  address: string;
  encryptedPrivateKey: string;
  balance: number;
  dailyTxCount: number;
  txDayStamp: string;
  createdAt: number;
  lastTxAt: number | null;
};

type EscrowLockRecord = {
  challengeId: string;
  challengerWalletId: string;
  opponentWalletId: string;
  amount: number;
  createdAt: number;
};

type BotRecord = {
  id: string;
  ownerProfileId: string | null;
  displayName: string;
  createdAt: number;
  managedBySuperAgent: boolean;
  duty: 'super' | 'duelist' | 'scout' | 'sparrer' | 'sentinel' | 'owner';
  patrolSection: number | null;
  walletId: string | null;
};

type WalletMutationResult = {
  ok: true;
  wallet: WalletRecord;
} | {
  ok: false;
  reason: string;
};

type WalletDenied = {
  ok: false;
  reason: string;
};

const bots = new Map<string, AgentBot>();
const botRegistry = new Map<string, BotRecord>();
const profiles = new Map<string, Profile>();
const wallets = new Map<string, WalletRecord>();
const escrowLocks = new Map<string, EscrowLockRecord>();
const backgroundBotIds = new Set<string>();
const subjectToProfileId = new Map<string, string>();

type SuperAgentMemoryEntry = {
  at: number;
  type: 'command' | 'decision' | 'system';
  message: string;
};

type SuperAgentAction =
  | { kind: 'set_mode'; value: SuperAgentConfig['mode'] }
  | { kind: 'set_cooldown'; value: number }
  | { kind: 'set_target'; value: SuperAgentConfig['workerTargetPreference'] }
  | { kind: 'set_challenges'; value: boolean }
  | { kind: 'set_wallet'; value: boolean }
  | { kind: 'reconcile_bots'; value: number }
  | { kind: 'apply_delegation' }
  | { kind: 'status' }
  | { kind: 'help' };

const superAgentMemory: SuperAgentMemoryEntry[] = [];
const superAgentLlmUsage = {
  hourStamp: '',
  requestsThisHour: 0,
  dayStamp: '',
  tokensToday: 0
};

type PersistedRuntimeState = {
  version: 1;
  savedAt: number;
  superAgentConfig: {
    id: string;
    mode: SuperAgentConfig['mode'];
    challengeEnabled: boolean;
    defaultChallengeCooldownMs: number;
    workerTargetPreference: SuperAgentConfig['workerTargetPreference'];
    llmPolicy: LlmPolicy;
    walletPolicy: WalletPolicy;
  };
  superAgentMemory: SuperAgentMemoryEntry[];
  superAgentLlmUsage: {
    hourStamp: string;
    requestsThisHour: number;
    dayStamp: string;
    tokensToday: number;
  };
  subjectLinks: Array<{ subject: string; profileId: string }>;
  profiles: Profile[];
  wallets: WalletRecord[];
  ownerBots: Array<{
    record: BotRecord;
    behavior: AgentBehaviorConfig;
  }>;
  counters: {
    profileCounter: number;
    walletCounter: number;
    backgroundCounter: number;
  };
};

let profileCounter = 1;
let walletCounter = 1;
let backgroundCounter = 1;
let persistTimer: NodeJS.Timeout | null = null;

const namePool = [
  'Luffy', 'Zoro', 'Nami', 'Sanji', 'Robin', 'Ace', 'Shanks', 'Law',
  'Batman', 'Wonder Woman', 'Flash', 'Aquaman', 'Raven', 'Nightwing',
  'Iron Man', 'Spider-Man', 'Captain Marvel', 'Storm', 'Black Panther', 'Wolverine',
  'Ichigo', 'Rukia', 'Renji', 'Byakuya', 'Toshiro', 'Yoruichi', 'Urahara'
];
const usedDisplayNames = new Set<string>();
const PATROL_SECTION_COUNT = 8;

function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function dutyForIndex(index: number): BotRecord['duty'] {
  const duties: BotRecord['duty'][] = ['duelist', 'scout', 'sparrer', 'sentinel'];
  return duties[index % duties.length] ?? 'scout';
}

function makeBehaviorForDuty(duty: BotRecord['duty'], index: number, patrolSection: number | null): AgentBehaviorConfig {
  const patrolRadius =
    duty === 'sentinel' ? 18 :
    duty === 'duelist' ? 26 :
    duty === 'sparrer' ? 32 :
    duty === 'owner' ? 30 :
    34;

  if (duty === 'duelist') {
    return {
      personality: 'aggressive',
      mode: 'active',
      challengeEnabled: true,
      challengeCooldownMs: Math.max(1400, superAgentConfig.defaultChallengeCooldownMs - 2200 + (index % 3) * 180),
      targetPreference: 'any',
      patrolSection: patrolSection ?? 0,
      patrolRadius,
      baseWager: 3,
      maxWager: 6
    };
  }
  if (duty === 'sparrer') {
    return {
      personality: 'social',
      mode: 'active',
      challengeEnabled: true,
      challengeCooldownMs: Math.max(1500, superAgentConfig.defaultChallengeCooldownMs - 1800 + (index % 4) * 120),
      targetPreference: 'any',
      patrolSection: patrolSection ?? 0,
      patrolRadius,
      baseWager: 2,
      maxWager: 4
    };
  }
  if (duty === 'sentinel') {
    return {
      personality: 'conservative',
      mode: 'active',
      challengeEnabled: true,
      challengeCooldownMs: Math.max(1800, superAgentConfig.defaultChallengeCooldownMs - 1200 + (index % 4) * 180),
      targetPreference: 'any',
      patrolSection: patrolSection ?? 0,
      patrolRadius,
      baseWager: 1,
      maxWager: 3
    };
  }
  return {
    personality: personalities[index % personalities.length] ?? 'social',
    mode: 'active',
    challengeEnabled: true,
    challengeCooldownMs: Math.max(1600, superAgentConfig.defaultChallengeCooldownMs - 1600 + (index % 5) * 140),
    targetPreference: 'any',
    patrolSection: patrolSection ?? 0,
    patrolRadius,
    baseWager: 2,
    maxWager: 5
  };
}

function pickDisplayName(fallback: string): string {
  for (let i = 0; i < namePool.length; i += 1) {
    const candidate = namePool[(i + usedDisplayNames.size) % namePool.length];
    if (candidate && !usedDisplayNames.has(candidate)) {
      usedDisplayNames.add(candidate);
      return candidate;
    }
  }

  const suffix = Math.floor(Math.random() * 900 + 100);
  const generated = `${fallback}-${suffix}`;
  usedDisplayNames.add(generated);
  return generated;
}

function normalizeUsernameSeed(input: string): string {
  const cleaned = input.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();
  if (cleaned.length >= 3) {
    return cleaned.slice(0, 20);
  }
  return 'player';
}

function uniqueUsernameFromSeed(seed: string): string {
  let candidate = seed.slice(0, 20);
  if (candidate.length < 3) {
    candidate = 'player';
  }

  const taken = new Set([...profiles.values()].map((profile) => profile.username.toLowerCase()));
  if (!taken.has(candidate.toLowerCase())) {
    return candidate;
  }

  for (let i = 1; i <= 9999; i += 1) {
    const suffix = `_${i}`;
    const base = seed.slice(0, Math.max(3, 20 - suffix.length));
    const attempt = `${base}${suffix}`.slice(0, 20);
    if (!taken.has(attempt.toLowerCase())) {
      return attempt;
    }
  }

  return `player_${Math.floor(Math.random() * 9000 + 1000)}`;
}

function createBot(id: string, displayName: string, behavior: AgentBehaviorConfig, walletId: string | null): AgentBot {
  const bot = new AgentBot({
    id,
    wsBaseUrl,
    displayName,
    walletId,
    behavior
  });
  bot.start();
  return bot;
}

function registerBot(id: string, behavior: AgentBehaviorConfig, record: BotRecord): void {
  if (bots.has(id)) {
    bots.get(id)?.updateBehavior(behavior);
    bots.get(id)?.updateDisplayName(record.displayName);
    const existing = botRegistry.get(id);
    if (existing) {
      existing.displayName = record.displayName;
      existing.ownerProfileId = record.ownerProfileId;
      existing.managedBySuperAgent = record.managedBySuperAgent;
      existing.duty = record.duty;
      existing.patrolSection = record.patrolSection;
      existing.walletId = record.walletId;
    }
    return;
  }

  usedDisplayNames.add(record.displayName);
  bots.set(id, createBot(id, record.displayName, behavior, record.walletId));
  botRegistry.set(id, record);
}

function ensureSuperAgentExists(): void {
  registerBot(
    superAgentConfig.id,
    {
      personality: 'aggressive',
      mode: 'active',
      challengeEnabled: true,
      challengeCooldownMs: Math.max(1400, Math.floor(superAgentConfig.defaultChallengeCooldownMs * 0.5)),
      targetPreference: 'any',
      baseWager: 3,
      maxWager: 8
    },
    {
      id: superAgentConfig.id,
      ownerProfileId: null,
      displayName: 'Grand Strategist',
      createdAt: Date.now(),
      managedBySuperAgent: false,
      duty: 'super',
      patrolSection: 3,
      walletId: getOrCreateWallet('system_super').id
    }
  );
}

function applySuperAgentDelegation(): void {
  const directives = buildWorkerDirectives(superAgentConfig, [...bots.keys()]);
  for (const directive of directives) {
    const record = botRegistry.get(directive.botId);
    if (!record) {
      continue;
    }
    if (!record.managedBySuperAgent) {
      continue;
    }
    const dutyBaseline = makeBehaviorForDuty(record.duty, 0, record.patrolSection);
    bots.get(directive.botId)?.updateBehavior({
      ...dutyBaseline,
      ...directive.patch,
      challengeEnabled: directive.patch.challengeEnabled ?? dutyBaseline.challengeEnabled
    });
  }

  bots.get(superAgentConfig.id)?.updateBehavior({
    personality: 'aggressive',
    mode: 'active',
    challengeEnabled: true,
    challengeCooldownMs: Math.max(1400, Math.floor(superAgentConfig.defaultChallengeCooldownMs * 0.5)),
    targetPreference: 'any',
    baseWager: 3,
    maxWager: 8
  });
}

function reconcileBots(targetCount: number): void {
  const bounded = Math.max(0, Math.min(60, targetCount));

  while (backgroundBotIds.size < bounded) {
    const id = `agent_bg_${backgroundCounter++}`;
    const idx = backgroundBotIds.size;
    const duty = dutyForIndex(idx);
    const patrolSection = idx % PATROL_SECTION_COUNT;
    const behavior = makeBehaviorForDuty(duty, idx, patrolSection);
    const dutyTitle =
      duty === 'duelist' ? 'Duelist' :
      duty === 'sparrer' ? 'Sparrer' :
      duty === 'sentinel' ? 'Sentinel' :
      'Scout';
    registerBot(id, behavior, {
      id,
      ownerProfileId: null,
      displayName: `${pickDisplayName(`Agent${idx + 1}`)} ${dutyTitle}`,
      createdAt: Date.now(),
      managedBySuperAgent: true,
      duty,
      patrolSection,
      walletId: getOrCreateWallet(`system_${id}`).id
    });
    backgroundBotIds.add(id);
  }

  while (backgroundBotIds.size > bounded) {
    const id = [...backgroundBotIds][backgroundBotIds.size - 1];
    if (!id) {
      break;
    }
    const bot = bots.get(id);
    bot?.stop();
    bots.delete(id);
    botRegistry.delete(id);
    backgroundBotIds.delete(id);
  }

  ensureSuperAgentExists();
  applySuperAgentDelegation();
}

function setCorsHeaders(res: import('node:http').ServerResponse): void {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type');
}

async function readJsonBody<T>(req: import('node:http').IncomingMessage): Promise<T | null> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }

  if (chunks.length === 0) {
    return null;
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T;
  } catch {
    return null;
  }
}

function sendJson(res: import('node:http').ServerResponse, payload: unknown, statusCode = 200): void {
  res.statusCode = statusCode;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(payload));
}

function redactSecrets(input: string): string {
  return input
    .replace(/sk-[A-Za-z0-9_-]{10,}/g, 'sk-***')
    .replace(/sk-or-v1-[A-Za-z0-9_-]{10,}/g, 'sk-or-v1-***')
    .replace(/0x[a-fA-F0-9]{64}/g, '0x***')
    .replace(/(authorization\s*:\s*bearer\s+)[A-Za-z0-9._-]+/gi, '$1***');
}

function rememberSuperAgent(type: SuperAgentMemoryEntry['type'], message: string): void {
  superAgentMemory.push({
    at: Date.now(),
    type,
    message: redactSecrets(message).slice(0, 600)
  });
  if (superAgentMemory.length > 80) {
    superAgentMemory.splice(0, superAgentMemory.length - 80);
  }
  schedulePersistState();
}

function botStatuses(): Array<AgentBotStatus & { meta?: BotRecord }> {
  return [...bots.values()].map((bot) => {
    const status = bot.getStatus();
    return {
      ...status,
      meta: botRegistry.get(status.id)
    };
  });
}

function publicProfiles() {
  return [...profiles.values()].map((profile) => ({
    ...profile,
    wallet: walletSummary(wallets.get(profile.walletId) ?? null)
  }));
}

function walletSummary(wallet: WalletRecord | null) {
  if (!wallet) {
    return null;
  }

  return {
    id: wallet.id,
    ownerProfileId: wallet.ownerProfileId,
    address: wallet.address,
    balance: wallet.balance,
    dailyTxCount: wallet.dailyTxCount,
    txDayStamp: wallet.txDayStamp,
    lastTxAt: wallet.lastTxAt,
    createdAt: wallet.createdAt
  };
}

function runtimeStatus() {
  const statuses = botStatuses();

  return {
    configuredBotCount: statuses.length,
    connectedBotCount: statuses.filter((bot) => bot.connected).length,
    backgroundBotCount: backgroundBotIds.size,
    profileBotCount: statuses.filter((bot) => bot.meta?.ownerProfileId).length,
    escrowLockCount: escrowLocks.size,
    wsBaseUrl,
    openRouterConfigured: Boolean(runtimeSecrets.openRouterApiKey),
    superAgent: {
      id: superAgentConfig.id,
      mode: superAgentConfig.mode,
      challengeEnabled: superAgentConfig.challengeEnabled,
      defaultChallengeCooldownMs: superAgentConfig.defaultChallengeCooldownMs,
      workerTargetPreference: superAgentConfig.workerTargetPreference,
      llmPolicy: superAgentConfig.llmPolicy,
      walletPolicy: superAgentConfig.walletPolicy,
      brain: {
        memories: superAgentMemory.slice(-12),
        llmUsage: { ...superAgentLlmUsage }
      }
    },
    bots: statuses,
    profiles: publicProfiles(),
    wallets: [...wallets.values()].map((wallet) => walletSummary(wallet))
  };
}

function runtimeSnapshotText(): string {
  const status = runtimeStatus();
  const totalBalance = status.wallets.reduce((sum, wallet) => sum + Number(wallet?.balance || 0), 0);
  return [
    `bots configured=${status.configuredBotCount} connected=${status.connectedBotCount} background=${status.backgroundBotCount} profile=${status.profileBotCount}`,
    `profiles=${status.profiles.length} wallets=${status.wallets.length} escrowLocks=${status.escrowLockCount}`,
    `walletTotalBalance=${totalBalance.toFixed(2)}`,
    `mode=${status.superAgent.mode} target=${status.superAgent.workerTargetPreference} cooldown=${status.superAgent.defaultChallengeCooldownMs} challengeEnabled=${status.superAgent.challengeEnabled}`,
    `walletPolicy enabled=${status.superAgent.walletPolicy.enabled} maxBetPct=${status.superAgent.walletPolicy.maxBetPercentOfBankroll} maxDailyTx=${status.superAgent.walletPolicy.maxDailyTxCount}`
  ].join('\n');
}

function parseSuperAgentActions(message: string): SuperAgentAction[] {
  const normalized = message.toLowerCase().trim();
  const actions: SuperAgentAction[] = [];

  if (normalized.includes('help')) {
    actions.push({ kind: 'help' });
    return actions;
  }

  if (/\bstatus\b|\bsummary\b|\bwhat('?s| is)\s+happening\b|\bhealth\b/.test(normalized)) {
    actions.push({ kind: 'status' });
  }

  const modeMatch = normalized.match(/\bmode\s+(balanced|hunter|defensive)\b/);
  if (modeMatch?.[1]) {
    actions.push({ kind: 'set_mode', value: modeMatch[1] as SuperAgentConfig['mode'] });
  }

  const targetMatch = normalized.match(/\btarget\s+(human_only|human_first|any)\b/);
  if (targetMatch?.[1]) {
    actions.push({ kind: 'set_target', value: targetMatch[1] as SuperAgentConfig['workerTargetPreference'] });
  }

  const cooldownMatch = normalized.match(/\b(cooldown|cd)\s+(\d{3,6})\b/);
  if (cooldownMatch?.[2]) {
    actions.push({ kind: 'set_cooldown', value: Number(cooldownMatch[2]) });
  }

  const countMatch = normalized.match(/\b(bot|bots|reconcile)\s*(count)?\s*(to)?\s*(\d{1,3})\b/);
  if (countMatch?.[4]) {
    actions.push({ kind: 'reconcile_bots', value: Number(countMatch[4]) });
  }

  if (/\b(enable|turn on)\s+challenges?\b/.test(normalized)) {
    actions.push({ kind: 'set_challenges', value: true });
  }
  if (/\b(disable|turn off)\s+challenges?\b/.test(normalized)) {
    actions.push({ kind: 'set_challenges', value: false });
  }

  if (/\b(enable|turn on)\s+wallet(s| policy)?\b/.test(normalized)) {
    actions.push({ kind: 'set_wallet', value: true });
  }
  if (/\b(disable|turn off)\s+wallet(s| policy)?\b/.test(normalized)) {
    actions.push({ kind: 'set_wallet', value: false });
  }

  if (/\b(delegate|apply delegation|apply directives?|re-?run delegation)\b/.test(normalized)) {
    actions.push({ kind: 'apply_delegation' });
  }

  return actions;
}

function applySuperAgentAction(action: SuperAgentAction): string {
  switch (action.kind) {
    case 'set_mode':
      superAgentConfig.mode = action.value;
      rememberSuperAgent('decision', `mode set to ${action.value}`);
      return `Set mode to ${action.value}.`;
    case 'set_cooldown':
      superAgentConfig.defaultChallengeCooldownMs = Math.max(1200, Math.min(120000, action.value));
      rememberSuperAgent('decision', `cooldown set to ${superAgentConfig.defaultChallengeCooldownMs}`);
      return `Set worker cooldown to ${superAgentConfig.defaultChallengeCooldownMs}ms.`;
    case 'set_target':
      superAgentConfig.workerTargetPreference = action.value;
      rememberSuperAgent('decision', `target preference set to ${action.value}`);
      return `Set worker target preference to ${action.value}.`;
    case 'set_challenges':
      superAgentConfig.challengeEnabled = action.value;
      rememberSuperAgent('decision', `challenge enabled set to ${action.value}`);
      return action.value ? 'Enabled challenges.' : 'Disabled challenges.';
    case 'set_wallet':
      superAgentConfig.walletPolicy.enabled = action.value;
      rememberSuperAgent('decision', `wallet policy enabled set to ${action.value}`);
      return action.value ? 'Enabled wallet policy.' : 'Disabled wallet policy.';
    case 'reconcile_bots': {
      const count = Math.max(0, Math.min(60, action.value));
      reconcileBots(count);
      rememberSuperAgent('decision', `reconciled background bot count to ${count}`);
      return `Reconciled background bot count to ${count}.`;
    }
    case 'apply_delegation':
      ensureSuperAgentExists();
      applySuperAgentDelegation();
      rememberSuperAgent('decision', 'applied worker delegation');
      return 'Re-applied worker delegation policy.';
    case 'status':
      return `Current status:\n${runtimeSnapshotText()}`;
    case 'help':
      return 'Supported commands: status, mode <balanced|hunter|defensive>, target <human_only|human_first|any>, cooldown <ms>, enable/disable challenges, enable/disable wallet policy, bot count <n>, apply delegation.';
    default:
      return 'No action applied.';
  }
}

function refreshLlmUsageBuckets(): void {
  const hourStamp = `${new Date().toISOString().slice(0, 13)}:00`;
  const today = dayStamp();

  if (superAgentLlmUsage.hourStamp !== hourStamp) {
    superAgentLlmUsage.hourStamp = hourStamp;
    superAgentLlmUsage.requestsThisHour = 0;
  }
  if (superAgentLlmUsage.dayStamp !== today) {
    superAgentLlmUsage.dayStamp = today;
    superAgentLlmUsage.tokensToday = 0;
  }
}

async function askOpenRouterSuperAgent(message: string): Promise<string | null> {
  if (!superAgentConfig.llmPolicy.enabled || !runtimeSecrets.openRouterApiKey) {
    return null;
  }
  const context = runtimeSnapshotText();
  const prompt = `You are the Super Agent managing an autonomous betting arena. Answer concisely, operationally, and safely.\n\nRuntime snapshot:\n${context}\n\nOperator message:\n${message}`;
  const tokenEstimate = Math.ceil(prompt.length / 4);
  refreshLlmUsageBuckets();

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${runtimeSecrets.openRouterApiKey}`
    },
    body: JSON.stringify({
      model: superAgentConfig.llmPolicy.model,
      messages: [
        { role: 'system', content: 'You are a game operations super-agent. Be precise and concise.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.2,
      max_tokens: 240
    })
  });
  if (!response.ok) {
    rememberSuperAgent('system', `openrouter error ${response.status}`);
    return null;
  }
  const payload = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { total_tokens?: number };
  };

  superAgentLlmUsage.requestsThisHour += 1;
  superAgentLlmUsage.tokensToday += Math.max(tokenEstimate, Number(payload.usage?.total_tokens || 0));
  const content = payload.choices?.[0]?.message?.content?.trim() ?? '';
  return content.length > 0 ? content : null;
}

type SuperAgentPatch = Partial<{
  id: string;
  mode: SuperAgentConfig['mode'];
  challengeEnabled: boolean;
  defaultChallengeCooldownMs: number;
  workerTargetPreference: SuperAgentConfig['workerTargetPreference'];
  llmPolicy: Partial<LlmPolicy>;
  walletPolicy: Partial<WalletPolicy>;
}>;

function dayStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

function encryptSecret(raw: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv);
  const encrypted = Buffer.concat([cipher.update(raw, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

function decryptSecret(encrypted: string): string {
  const [ivHex, tagHex, payloadHex] = encrypted.split(':');
  if (!ivHex || !tagHex || !payloadHex) {
    return '';
  }

  const decipher = createDecipheriv('aes-256-gcm', encryptionKey, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(payloadHex, 'hex')),
    decipher.final()
  ]);

  return plaintext.toString('utf8');
}

function newWalletAddress(): string {
  return `0x${randomBytes(20).toString('hex')}`;
}

function newPrivateKey(): string {
  return `0x${randomBytes(32).toString('hex')}`;
}

function createWallet(ownerProfileId: string, initialBalance = 0): WalletRecord {
  const wallet: WalletRecord = {
    id: `wallet_${walletCounter++}`,
    ownerProfileId,
    address: newWalletAddress(),
    encryptedPrivateKey: encryptSecret(newPrivateKey()),
    balance: initialBalance,
    dailyTxCount: 0,
    txDayStamp: dayStamp(),
    createdAt: Date.now(),
    lastTxAt: null
  };
  wallets.set(wallet.id, wallet);
  return wallet;
}

function getOrCreateWallet(ownerProfileId: string): WalletRecord {
  const existing = [...wallets.values()].find((wallet) => wallet.ownerProfileId === ownerProfileId);
  if (existing) {
    return existing;
  }
  const seeded = ownerProfileId.startsWith('system_') ? systemSeedBalance : userSeedBalance;
  return createWallet(ownerProfileId, seeded);
}

function normalizeWalletTx(wallet: WalletRecord): void {
  const today = dayStamp();
  if (wallet.txDayStamp !== today) {
    wallet.txDayStamp = today;
    wallet.dailyTxCount = 0;
  }
}

function canUseWallet(wallet: WalletRecord): WalletDenied | null {
  normalizeWalletTx(wallet);

  if (!superAgentConfig.walletPolicy.enabled) {
    return {
      ok: false,
      reason: 'wallet_policy_disabled'
    };
  }

  if (wallet.dailyTxCount >= superAgentConfig.walletPolicy.maxDailyTxCount) {
    return {
      ok: false,
      reason: 'daily_tx_limit_reached'
    };
  }

  return null;
}

function canLockStake(wallet: WalletRecord, amount: number): WalletDenied | null {
  const policy = canUseWallet(wallet);
  if (policy) {
    return policy;
  }

  if (amount <= 0) {
    return { ok: false, reason: 'invalid_amount' };
  }

  if (wallet.balance < amount) {
    return { ok: false, reason: 'insufficient_balance' };
  }

  const maxStake = wallet.balance * (superAgentConfig.walletPolicy.maxBetPercentOfBankroll / 100);
  if (amount > maxStake) {
    return { ok: false, reason: 'max_bet_percent_exceeded' };
  }

  return null;
}

function createProfileWithBot(params: {
  username: string;
  displayName?: string;
  personality?: Personality;
  targetPreference?: AgentBehaviorConfig['targetPreference'];
}) {
  const username = params.username.trim();
  const normalized = username.toLowerCase();
  if (normalized.length < 2) {
    return { ok: false as const, reason: 'username_too_short' };
  }

  const exists = [...profiles.values()].some((entry) => entry.username.toLowerCase() === normalized);
  if (exists) {
    return { ok: false as const, reason: 'username_taken' };
  }

  const profileId = `profile_${profileCounter++}`;
  const botId = `agent_${profileId}`;
  const patrolSection = hashString(profileId) % PATROL_SECTION_COUNT;

  const wallet = createWallet(profileId, userSeedBalance);

  const profile: Profile = {
    id: profileId,
    username,
    displayName: params.displayName?.trim() || pickDisplayName(username),
    createdAt: Date.now(),
    walletId: wallet.id,
    ownedBotIds: [botId]
  };

  profiles.set(profileId, profile);

  registerBot(
    botId,
    {
      ...makeBehaviorForDuty('owner', patrolSection, patrolSection),
      personality: params.personality ?? 'social',
      targetPreference: params.targetPreference ?? 'human_first'
    },
    {
      id: botId,
      ownerProfileId: profileId,
      displayName: pickDisplayName(`${profile.displayName} Bot`),
      createdAt: Date.now(),
      managedBySuperAgent: true,
      duty: 'owner',
      patrolSection,
      walletId: wallet.id
    }
  );

  ensureSuperAgentExists();
  applySuperAgentDelegation();
  schedulePersistState();

  return {
    ok: true as const,
    profile,
    wallet: walletSummary(wallet),
    botId
  };
}

function provisionProfileForSubject(params: {
  externalSubject: string;
  email?: string;
  displayName?: string;
  personality?: Personality;
  targetPreference?: AgentBehaviorConfig['targetPreference'];
}) {
  const subject = params.externalSubject.trim();
  if (!subject) {
    return { ok: false as const, reason: 'external_subject_required' };
  }

  const linkedProfileId = subjectToProfileId.get(subject);
  if (linkedProfileId) {
    const linked = profiles.get(linkedProfileId);
    if (linked) {
      return {
        ok: true as const,
        created: false as const,
        profile: linked,
        wallet: walletSummary(wallets.get(linked.walletId) ?? null),
        botId: linked.ownedBotIds[0] ?? null
      };
    }
  }

  const emailLocal = (params.email?.split('@')[0] ?? '').trim();
  const seed = normalizeUsernameSeed(emailLocal || params.displayName || subject.slice(0, 12));
  const username = uniqueUsernameFromSeed(seed);

  const created = createProfileWithBot({
    username,
    displayName: params.displayName,
    personality: params.personality,
    targetPreference: params.targetPreference
  });

  if (!created.ok) {
    return created;
  }

  subjectToProfileId.set(subject, created.profile.id);
  schedulePersistState();
  return {
    ...created,
    created: true as const
  };
}

function ensureSeedBalances(): void {
  for (const record of botRegistry.values()) {
    if (!record.walletId) {
      continue;
    }
    const wallet = wallets.get(record.walletId);
    if (!wallet) {
      continue;
    }
    const floor = record.ownerProfileId ? userSeedBalance : systemSeedBalance;
    if (wallet.balance < floor) {
      wallet.balance = floor;
    }
  }
}

function buildPersistedState(): PersistedRuntimeState {
  const ownerBots = [...botRegistry.values()]
    .filter((record) => record.ownerProfileId)
    .map((record) => ({
      record,
      behavior: bots.get(record.id)?.getStatus().behavior ?? makeBehaviorForDuty(record.duty, 0, record.patrolSection)
    }));

  return {
    version: 1,
    savedAt: Date.now(),
    superAgentConfig: {
      id: superAgentConfig.id,
      mode: superAgentConfig.mode,
      challengeEnabled: superAgentConfig.challengeEnabled,
      defaultChallengeCooldownMs: superAgentConfig.defaultChallengeCooldownMs,
      workerTargetPreference: superAgentConfig.workerTargetPreference,
      llmPolicy: superAgentConfig.llmPolicy,
      walletPolicy: superAgentConfig.walletPolicy
    },
    superAgentMemory: superAgentMemory.slice(-80),
    superAgentLlmUsage: { ...superAgentLlmUsage },
    subjectLinks: [...subjectToProfileId.entries()].map(([subject, profileId]) => ({ subject, profileId })),
    profiles: [...profiles.values()],
    wallets: [...wallets.values()],
    ownerBots,
    counters: {
      profileCounter,
      walletCounter,
      backgroundCounter
    }
  };
}

async function persistRuntimeState(): Promise<void> {
  const dir = path.dirname(runtimeStateFile);
  await mkdir(dir, { recursive: true });
  await writeFile(runtimeStateFile, JSON.stringify(buildPersistedState(), null, 2), 'utf8');
}

function schedulePersistState(): void {
  if (persistTimer) {
    return;
  }
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void persistRuntimeState().catch(() => undefined);
  }, 250);
}

async function loadPersistedState(): Promise<void> {
  if (!existsSync(runtimeStateFile)) {
    return;
  }
  try {
    const raw = await readFile(runtimeStateFile, 'utf8');
    const data = JSON.parse(raw) as PersistedRuntimeState;
    if (!data || data.version !== 1) {
      return;
    }

    if (data.superAgentConfig) {
      superAgentConfig.id = data.superAgentConfig.id || superAgentConfig.id;
      superAgentConfig.mode = data.superAgentConfig.mode || superAgentConfig.mode;
      superAgentConfig.challengeEnabled = Boolean(data.superAgentConfig.challengeEnabled);
      superAgentConfig.defaultChallengeCooldownMs = Math.max(1200, Number(data.superAgentConfig.defaultChallengeCooldownMs || superAgentConfig.defaultChallengeCooldownMs));
      superAgentConfig.workerTargetPreference = data.superAgentConfig.workerTargetPreference || superAgentConfig.workerTargetPreference;
      if (data.superAgentConfig.llmPolicy) {
        superAgentConfig.llmPolicy = { ...superAgentConfig.llmPolicy, ...data.superAgentConfig.llmPolicy, enabled: true };
      }
      if (data.superAgentConfig.walletPolicy) {
        superAgentConfig.walletPolicy = { ...superAgentConfig.walletPolicy, ...data.superAgentConfig.walletPolicy };
      }
    }

    superAgentMemory.splice(0, superAgentMemory.length, ...(data.superAgentMemory || []).slice(-80));
    if (data.superAgentLlmUsage) {
      superAgentLlmUsage.hourStamp = data.superAgentLlmUsage.hourStamp || '';
      superAgentLlmUsage.requestsThisHour = Number(data.superAgentLlmUsage.requestsThisHour || 0);
      superAgentLlmUsage.dayStamp = data.superAgentLlmUsage.dayStamp || '';
      superAgentLlmUsage.tokensToday = Number(data.superAgentLlmUsage.tokensToday || 0);
    }

    subjectToProfileId.clear();
    for (const link of data.subjectLinks || []) {
      if (link?.subject && link?.profileId) {
        subjectToProfileId.set(link.subject, link.profileId);
      }
    }

    profiles.clear();
    for (const profile of data.profiles || []) {
      profiles.set(profile.id, profile);
      if (profile.displayName) {
        usedDisplayNames.add(profile.displayName);
      }
    }

    wallets.clear();
    for (const wallet of data.wallets || []) {
      wallets.set(wallet.id, wallet);
    }

    for (const entry of data.ownerBots || []) {
      if (!entry?.record?.id || !entry?.behavior) {
        continue;
      }
      if (entry.record.displayName) {
        usedDisplayNames.add(entry.record.displayName);
      }
      registerBot(entry.record.id, entry.behavior, entry.record);
    }

    profileCounter = Math.max(1, Number(data.counters?.profileCounter || profileCounter));
    walletCounter = Math.max(1, Number(data.counters?.walletCounter || walletCounter));
    backgroundCounter = Math.max(1, Number(data.counters?.backgroundCounter || backgroundCounter));
  } catch {
    // ignore invalid persisted state files
  }
}
await loadPersistedState();
const initialBotCount = Math.max(8, Number(process.env.BOT_COUNT ?? 8));
reconcileBots(initialBotCount);
ensureSeedBalances();
void persistRuntimeState().catch(() => undefined);
const autosave = setInterval(() => {
  void persistRuntimeState().catch(() => undefined);
}, 10000);
autosave.unref();
process.on('SIGINT', () => {
  void persistRuntimeState().finally(() => process.exit(0));
});
process.on('SIGTERM', () => {
  void persistRuntimeState().finally(() => process.exit(0));
});

const server = createServer(async (req, res) => {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  const url = new URL(req.url ?? '/', 'http://localhost');

  if (url.pathname === '/health') {
    sendJson(res, createHealthStatus());
    return;
  }

  if (url.pathname === '/status') {
    sendJson(res, runtimeStatus());
    return;
  }

  if (url.pathname === '/super-agent/status') {
    sendJson(res, runtimeStatus().superAgent);
    return;
  }

  if (url.pathname === '/super-agent/config' && req.method === 'POST') {
    const body = await readJsonBody<SuperAgentPatch>(req);
    if (!body) {
      sendJson(res, { ok: false, reason: 'invalid_json' }, 400);
      return;
    }

    if (typeof body.id === 'string' && body.id.trim().length > 0) {
      superAgentConfig.id = body.id.trim();
    }
    if (body.mode) {
      superAgentConfig.mode = body.mode;
    }
    if (typeof body.challengeEnabled === 'boolean') {
      superAgentConfig.challengeEnabled = body.challengeEnabled;
    }
    if (typeof body.defaultChallengeCooldownMs === 'number') {
      superAgentConfig.defaultChallengeCooldownMs = Math.max(1200, Math.min(120000, body.defaultChallengeCooldownMs));
    }
    if (body.workerTargetPreference) {
      superAgentConfig.workerTargetPreference = body.workerTargetPreference;
    }
    if (body.llmPolicy) {
      superAgentConfig.llmPolicy = { ...superAgentConfig.llmPolicy, ...body.llmPolicy };
    }
    if (body.walletPolicy) {
      superAgentConfig.walletPolicy = { ...superAgentConfig.walletPolicy, ...body.walletPolicy };
    }

    ensureSuperAgentExists();
    applySuperAgentDelegation();
    schedulePersistState();
    sendJson(res, { ok: true, superAgent: runtimeStatus().superAgent });
    return;
  }

  if (url.pathname === '/super-agent/delegate/apply' && req.method === 'POST') {
    ensureSuperAgentExists();
    applySuperAgentDelegation();
    schedulePersistState();
    sendJson(res, {
      ok: true,
      directivesApplied: buildWorkerDirectives(superAgentConfig, [...bots.keys()]).length,
      superAgent: runtimeStatus().superAgent
    });
    return;
  }

  if (url.pathname === '/super-agent/delegate/preview') {
    sendJson(res, {
      superAgentId: superAgentConfig.id,
      directives: buildWorkerDirectives(superAgentConfig, [...bots.keys()])
    });
    return;
  }

  if (url.pathname === '/super-agent/chat' && req.method === 'POST') {
    const body = await readJsonBody<{ message?: string; includeStatus?: boolean }>(req);
    const message = body?.message?.trim() ?? '';
    if (!message) {
      sendJson(res, { ok: false, reason: 'message_required' }, 400);
      return;
    }

    rememberSuperAgent('command', message);
    const actions = parseSuperAgentActions(message);
    const actionReplies: string[] = [];

    for (const action of actions) {
      actionReplies.push(applySuperAgentAction(action));
    }

    if (actions.some((entry) => entry.kind !== 'status' && entry.kind !== 'help')) {
      ensureSuperAgentExists();
      applySuperAgentDelegation();
    }

    const advisory = (await askOpenRouterSuperAgent(message)) ?? '';

    const replyParts: string[] = [];
    if (actionReplies.length > 0) {
      replyParts.push(actionReplies.join('\n'));
    }
    if (advisory) {
      replyParts.push(`Advisory:\n${advisory}`);
      rememberSuperAgent('decision', 'provided llm advisory');
    }
    if (replyParts.length === 0) {
      replyParts.push('No direct command detected. Ask for "status" or "help", or use commands like "mode hunter", "bot count 16", "enable wallet policy".');
    }

    sendJson(res, {
      ok: true,
      reply: replyParts.join('\n\n'),
      actionsApplied: actions.map((entry) => entry.kind),
      status: body?.includeStatus ? runtimeStatus() : undefined
    });
    schedulePersistState();
    return;
  }

  if (url.pathname === '/profiles') {
    sendJson(res, { profiles: publicProfiles() });
    return;
  }

  if (url.pathname === '/profiles/create' && req.method === 'POST') {
    const body = await readJsonBody<{
      username?: string;
      displayName?: string;
      personality?: Personality;
      targetPreference?: AgentBehaviorConfig['targetPreference'];
    }>(req);

    if (!body?.username || typeof body.username !== 'string') {
      sendJson(res, { ok: false, reason: 'username_required' }, 400);
      return;
    }

    const created = createProfileWithBot({
      username: body.username,
      displayName: body.displayName,
      personality: body.personality,
      targetPreference: body.targetPreference
    });

    if (!created.ok) {
      sendJson(res, created, 400);
      return;
    }

    sendJson(res, created);
    schedulePersistState();
    return;
  }

  if (url.pathname === '/profiles/provision' && req.method === 'POST') {
    const body = await readJsonBody<{
      externalSubject?: string;
      email?: string;
      displayName?: string;
      personality?: Personality;
      targetPreference?: AgentBehaviorConfig['targetPreference'];
    }>(req);

    if (!body?.externalSubject || typeof body.externalSubject !== 'string') {
      sendJson(res, { ok: false, reason: 'external_subject_required' }, 400);
      return;
    }

    const provisioned = provisionProfileForSubject({
      externalSubject: body.externalSubject,
      email: body.email,
      displayName: body.displayName,
      personality: body.personality,
      targetPreference: body.targetPreference
    });

    if (!provisioned.ok) {
      sendJson(res, provisioned, 400);
      return;
    }

    sendJson(res, provisioned);
    schedulePersistState();
    return;
  }

  if (url.pathname.startsWith('/profiles/') && url.pathname.endsWith('/update') && req.method === 'POST') {
    const profileId = url.pathname.split('/')[2];
    const profile = profileId ? profiles.get(profileId) : null;
    if (!profile) {
      sendJson(res, { ok: false, reason: 'profile_not_found' }, 404);
      return;
    }

    const body = await readJsonBody<{ displayName?: string; username?: string }>(req);
    if (!body) {
      sendJson(res, { ok: false, reason: 'invalid_json' }, 400);
      return;
    }

    if (typeof body.displayName === 'string' && body.displayName.trim().length > 0) {
      profile.displayName = body.displayName.trim();
    }

    if (typeof body.username === 'string' && body.username.trim().length > 1) {
      const normalized = body.username.toLowerCase();
      const taken = [...profiles.values()].some(
        (item) => item.id !== profile.id && item.username.toLowerCase() === normalized
      );

      if (taken) {
        sendJson(res, { ok: false, reason: 'username_taken' }, 400);
        return;
      }

      profile.username = body.username.trim();
    }

    sendJson(res, { ok: true, profile: { ...profile, wallet: walletSummary(wallets.get(profile.walletId) ?? null) } });
    schedulePersistState();
    return;
  }

  if (url.pathname.startsWith('/profiles/') && url.pathname.endsWith('/bots/create') && req.method === 'POST') {
    const profileId = url.pathname.split('/')[2];
    const profile = profileId ? profiles.get(profileId) : null;
    if (!profile) {
      sendJson(res, { ok: false, reason: 'profile_not_found' }, 404);
      return;
    }

    const body = await readJsonBody<{
      displayName?: string;
      personality?: Personality;
      targetPreference?: AgentBehaviorConfig['targetPreference'];
      mode?: AgentBehaviorConfig['mode'];
      baseWager?: number;
      maxWager?: number;
      managedBySuperAgent?: boolean;
    }>(req);

    const botId = `agent_${profile.id}_${profile.ownedBotIds.length + 1}`;
    const patrolSection = hashString(botId) % PATROL_SECTION_COUNT;
    const baseWager = Math.max(1, Number(body?.baseWager ?? 1));
    const maxWager = Math.max(baseWager, Number(body?.maxWager ?? baseWager));
    registerBot(
      botId,
      {
        ...makeBehaviorForDuty('owner', patrolSection, patrolSection),
        personality: body?.personality ?? 'social',
        targetPreference: body?.targetPreference ?? 'human_first',
        mode: body?.mode ?? 'active',
        baseWager,
        maxWager
      },
      {
        id: botId,
        ownerProfileId: profile.id,
        displayName:
          body?.displayName?.trim() || pickDisplayName(`${profile.displayName} Bot ${profile.ownedBotIds.length + 1}`),
        createdAt: Date.now(),
        managedBySuperAgent: body?.managedBySuperAgent ?? true,
        duty: 'owner',
        patrolSection,
        walletId: profile.walletId
      }
    );

    profile.ownedBotIds.push(botId);
    applySuperAgentDelegation();
    schedulePersistState();

    sendJson(res, { ok: true, botId, profileId: profile.id });
    return;
  }

  if (url.pathname === '/wallets') {
    sendJson(res, { wallets: [...wallets.values()].map((entry) => walletSummary(entry)) });
    return;
  }

  if (url.pathname.startsWith('/wallets/') && url.pathname.endsWith('/fund') && req.method === 'POST') {
    const walletId = url.pathname.split('/')[2];
    const wallet = walletId ? wallets.get(walletId) : null;
    if (!wallet) {
      sendJson(res, { ok: false, reason: 'wallet_not_found' }, 404);
      return;
    }

    const body = await readJsonBody<{ amount?: number }>(req);
    const amount = Math.max(0, Number(body?.amount ?? 0));
    if (amount <= 0) {
      sendJson(res, { ok: false, reason: 'invalid_amount' }, 400);
      return;
    }

    const denied = canUseWallet(wallet);
    if (denied) {
      sendJson(res, denied, 403);
      return;
    }

    wallet.balance += amount;
    wallet.dailyTxCount += 1;
    wallet.lastTxAt = Date.now();
    sendJson(res, { ok: true, wallet: walletSummary(wallet) });
    schedulePersistState();
    return;
  }

  if (url.pathname.startsWith('/wallets/') && url.pathname.endsWith('/withdraw') && req.method === 'POST') {
    const walletId = url.pathname.split('/')[2];
    const wallet = walletId ? wallets.get(walletId) : null;
    if (!wallet) {
      sendJson(res, { ok: false, reason: 'wallet_not_found' }, 404);
      return;
    }

    const body = await readJsonBody<{ amount?: number }>(req);
    const amount = Math.max(0, Number(body?.amount ?? 0));
    if (amount <= 0) {
      sendJson(res, { ok: false, reason: 'invalid_amount' }, 400);
      return;
    }

    const denied = canUseWallet(wallet);
    if (denied) {
      sendJson(res, denied, 403);
      return;
    }

    if (wallet.balance < amount) {
      sendJson(res, { ok: false, reason: 'insufficient_balance' }, 400);
      return;
    }

    wallet.balance -= amount;
    wallet.dailyTxCount += 1;
    wallet.lastTxAt = Date.now();
    sendJson(res, { ok: true, wallet: walletSummary(wallet) });
    schedulePersistState();
    return;
  }

  if (url.pathname.startsWith('/wallets/') && url.pathname.endsWith('/transfer') && req.method === 'POST') {
    const walletId = url.pathname.split('/')[2];
    const source = walletId ? wallets.get(walletId) : null;
    if (!source) {
      sendJson(res, { ok: false, reason: 'wallet_not_found' }, 404);
      return;
    }

    const body = await readJsonBody<{ toWalletId?: string; amount?: number }>(req);
    const target = body?.toWalletId ? wallets.get(body.toWalletId) : null;
    const amount = Math.max(0, Number(body?.amount ?? 0));

    if (!target) {
      sendJson(res, { ok: false, reason: 'target_wallet_not_found' }, 404);
      return;
    }
    if (target.id === source.id) {
      sendJson(res, { ok: false, reason: 'same_wallet' }, 400);
      return;
    }
    if (amount <= 0) {
      sendJson(res, { ok: false, reason: 'invalid_amount' }, 400);
      return;
    }

    const sourceDenied = canUseWallet(source);
    if (sourceDenied) {
      sendJson(res, sourceDenied, 403);
      return;
    }

    const targetDenied = canUseWallet(target);
    if (targetDenied) {
      sendJson(res, { ok: false, reason: 'target_wallet_tx_limited' }, 403);
      return;
    }

    if (source.balance < amount) {
      sendJson(res, { ok: false, reason: 'insufficient_balance' }, 400);
      return;
    }

    source.balance -= amount;
    target.balance += amount;
    source.dailyTxCount += 1;
    target.dailyTxCount += 1;
    source.lastTxAt = Date.now();
    target.lastTxAt = Date.now();

    sendJson(res, {
      ok: true,
      source: walletSummary(source),
      target: walletSummary(target)
    });
    schedulePersistState();
    return;
  }

  if (url.pathname === '/wallets/escrow/lock' && req.method === 'POST') {
    const body = await readJsonBody<{
      challengeId?: string;
      challengerWalletId?: string;
      opponentWalletId?: string;
      amount?: number;
    }>(req);

    const challengeId = body?.challengeId?.trim() ?? '';
    const challengerWalletId = body?.challengerWalletId?.trim() ?? '';
    const opponentWalletId = body?.opponentWalletId?.trim() ?? '';
    const amount = Number(body?.amount ?? 0);

    if (!challengeId || !challengerWalletId || !opponentWalletId || !Number.isFinite(amount) || amount <= 0) {
      sendJson(res, { ok: false, reason: 'invalid_escrow_payload' }, 400);
      return;
    }

    if (challengerWalletId === opponentWalletId) {
      sendJson(res, { ok: false, reason: 'same_wallet' }, 400);
      return;
    }

    const existingLock = escrowLocks.get(challengeId);
    if (existingLock) {
      sendJson(res, {
        ok: true,
        challengeId,
        escrow: existingLock,
        idempotent: true
      });
      return;
    }

    const challenger = wallets.get(challengerWalletId);
    const opponent = wallets.get(opponentWalletId);
    if (!challenger || !opponent) {
      sendJson(res, { ok: false, reason: 'wallet_not_found' }, 404);
      return;
    }

    const challengerDenied = canLockStake(challenger, amount);
    if (challengerDenied) {
      sendJson(res, { ok: false, reason: `challenger_${challengerDenied.reason}` }, 403);
      return;
    }
    const opponentDenied = canLockStake(opponent, amount);
    if (opponentDenied) {
      sendJson(res, { ok: false, reason: `opponent_${opponentDenied.reason}` }, 403);
      return;
    }

    challenger.balance -= amount;
    opponent.balance -= amount;
    challenger.dailyTxCount += 1;
    opponent.dailyTxCount += 1;
    challenger.lastTxAt = Date.now();
    opponent.lastTxAt = Date.now();

    const lock: EscrowLockRecord = {
      challengeId,
      challengerWalletId,
      opponentWalletId,
      amount,
      createdAt: Date.now()
    };
    escrowLocks.set(challengeId, lock);

    sendJson(res, {
      ok: true,
      challengeId,
      escrow: lock,
      challenger: walletSummary(challenger),
      opponent: walletSummary(opponent)
    });
    schedulePersistState();
    return;
  }

  if (url.pathname === '/wallets/escrow/resolve' && req.method === 'POST') {
    const body = await readJsonBody<{
      challengeId?: string;
      winnerWalletId?: string | null;
      feeBps?: number;
    }>(req);

    const challengeId = body?.challengeId?.trim() ?? '';
    const winnerWalletId = body?.winnerWalletId?.trim() ?? '';
    const feeBps = Math.max(0, Math.min(10000, Number(body?.feeBps ?? 0)));
    if (!challengeId) {
      sendJson(res, { ok: false, reason: 'challenge_id_required' }, 400);
      return;
    }

    const lock = escrowLocks.get(challengeId);
    if (!lock) {
      sendJson(res, { ok: false, reason: 'escrow_not_found' }, 404);
      return;
    }

    if (!winnerWalletId) {
      sendJson(res, { ok: false, reason: 'winner_wallet_required' }, 400);
      return;
    }

    if (winnerWalletId !== lock.challengerWalletId && winnerWalletId !== lock.opponentWalletId) {
      sendJson(res, { ok: false, reason: 'winner_wallet_not_participant' }, 400);
      return;
    }

    const winner = wallets.get(winnerWalletId);
    if (!winner) {
      sendJson(res, { ok: false, reason: 'wallet_not_found' }, 404);
      return;
    }

    const pot = lock.amount * 2;
    const fee = (pot * feeBps) / 10000;
    const payout = pot - fee;
    winner.balance += payout;
    winner.dailyTxCount += 1;
    winner.lastTxAt = Date.now();
    escrowLocks.delete(challengeId);

    sendJson(res, {
      ok: true,
      challengeId,
      payout,
      fee,
      winner: walletSummary(winner)
    });
    schedulePersistState();
    return;
  }

  if (url.pathname === '/wallets/escrow/refund' && req.method === 'POST') {
    const body = await readJsonBody<{ challengeId?: string }>(req);
    const challengeId = body?.challengeId?.trim() ?? '';
    if (!challengeId) {
      sendJson(res, { ok: false, reason: 'challenge_id_required' }, 400);
      return;
    }

    const lock = escrowLocks.get(challengeId);
    if (!lock) {
      sendJson(res, { ok: false, reason: 'escrow_not_found' }, 404);
      return;
    }

    const challenger = wallets.get(lock.challengerWalletId);
    const opponent = wallets.get(lock.opponentWalletId);
    if (!challenger || !opponent) {
      sendJson(res, { ok: false, reason: 'wallet_not_found' }, 404);
      return;
    }

    challenger.balance += lock.amount;
    opponent.balance += lock.amount;
    challenger.lastTxAt = Date.now();
    opponent.lastTxAt = Date.now();
    escrowLocks.delete(challengeId);

    sendJson(res, {
      ok: true,
      challengeId,
      challenger: walletSummary(challenger),
      opponent: walletSummary(opponent)
    });
    schedulePersistState();
    return;
  }

  if (url.pathname.startsWith('/bots/') && url.pathname.endsWith('/wallet')) {
    const botId = url.pathname.split('/')[2];
    const record = botId ? botRegistry.get(botId) : null;
    if (!record || !record.walletId) {
      sendJson(res, { ok: false, reason: 'bot_wallet_not_found' }, 404);
      return;
    }
    const wallet = wallets.get(record.walletId);
    sendJson(res, {
      ok: true,
      botId,
      wallet: walletSummary(wallet ?? null)
    });
    return;
  }

  if (url.pathname.startsWith('/wallets/') && url.pathname.endsWith('/export-key') && req.method === 'POST') {
    const walletId = url.pathname.split('/')[2];
    const wallet = walletId ? wallets.get(walletId) : null;
    if (!wallet) {
      sendJson(res, { ok: false, reason: 'wallet_not_found' }, 404);
      return;
    }

    const body = await readJsonBody<{ profileId?: string }>(req);
    if (!body?.profileId || body.profileId !== wallet.ownerProfileId) {
      sendJson(res, { ok: false, reason: 'owner_mismatch' }, 403);
      return;
    }

    const privateKey = decryptSecret(wallet.encryptedPrivateKey);
    sendJson(res, {
      ok: true,
      walletId,
      address: wallet.address,
      privateKey,
      warning: 'Treat this private key as highly sensitive. Move to a vault before production.'
    });
    return;
  }

  if (url.pathname === '/agents/reconcile' && req.method === 'POST') {
    const body = await readJsonBody<{ count?: number }>(req);
    const count = Math.max(0, Math.min(60, Number(body?.count ?? backgroundBotIds.size)));
    reconcileBots(count);
    schedulePersistState();
    sendJson(res, { ok: true, configuredBackgroundBotCount: backgroundBotIds.size, configuredBotCount: bots.size });
    return;
  }

  if (url.pathname.startsWith('/agents/') && url.pathname.endsWith('/config') && req.method === 'POST') {
    const id = url.pathname.split('/')[2];
    if (!id) {
      sendJson(res, { ok: false, reason: 'bot_not_found' }, 404);
      return;
    }
    const bot = bots.get(id);
    if (!bot) {
      sendJson(res, { ok: false, reason: 'bot_not_found' }, 404);
      return;
    }

    const body = await readJsonBody<Partial<AgentBehaviorConfig> & { displayName?: string; managedBySuperAgent?: boolean }>(req);
    if (!body) {
      sendJson(res, { ok: false, reason: 'invalid_json' }, 400);
      return;
    }
    const patch: Partial<AgentBehaviorConfig> = {};
    if (body.personality === 'aggressive' || body.personality === 'social' || body.personality === 'conservative') {
      patch.personality = body.personality;
    }
    if (body.mode === 'active' || body.mode === 'passive') {
      patch.mode = body.mode;
    }
    if (typeof body.challengeEnabled === 'boolean') {
      patch.challengeEnabled = body.challengeEnabled;
    }
    if (body.targetPreference === 'any' || body.targetPreference === 'human_only' || body.targetPreference === 'human_first') {
      patch.targetPreference = body.targetPreference;
    }
    if (typeof body.challengeCooldownMs === 'number') {
      patch.challengeCooldownMs = Math.max(1200, Math.min(120000, body.challengeCooldownMs));
    }
    if (typeof body.baseWager === 'number') {
      patch.baseWager = Math.max(1, Math.min(50, Math.floor(body.baseWager)));
    }
    if (typeof body.maxWager === 'number') {
      patch.maxWager = Math.max(1, Math.min(100, Math.floor(body.maxWager)));
    }
    if (typeof patch.baseWager === 'number' && typeof patch.maxWager === 'number' && patch.maxWager < patch.baseWager) {
      patch.maxWager = patch.baseWager;
    } else if (typeof patch.baseWager === 'number' && typeof patch.maxWager !== 'number') {
      const currentMax = bot.getStatus().behavior.maxWager;
      if (currentMax < patch.baseWager) {
        patch.maxWager = patch.baseWager;
      }
    }

    bot.updateBehavior(patch);

    const record = botRegistry.get(id);
    if (record) {
      if (typeof body.displayName === 'string' && body.displayName.trim().length > 0) {
        record.displayName = body.displayName.trim();
        usedDisplayNames.add(record.displayName);
        bot.updateDisplayName(record.displayName);
      }
      if (typeof body.managedBySuperAgent === 'boolean') {
        record.managedBySuperAgent = body.managedBySuperAgent;
      }
    }

    sendJson(res, { ok: true, bot: bot.getStatus(), meta: record });
    schedulePersistState();
    return;
  }

  if (url.pathname === '/secrets/openrouter' && req.method === 'POST') {
    const body = await readJsonBody<{ apiKey?: string }>(req);
    runtimeSecrets.openRouterApiKey = body?.apiKey?.trim() ?? '';
    superAgentConfig.llmPolicy.enabled = true;
    schedulePersistState();
    sendJson(res, {
      ok: true,
      openRouterConfigured: Boolean(runtimeSecrets.openRouterApiKey),
      masked: runtimeSecrets.openRouterApiKey
        ? `${runtimeSecrets.openRouterApiKey.slice(0, 7)}...${runtimeSecrets.openRouterApiKey.slice(-4)}`
        : null
    });
    return;
  }

  if (url.pathname === '/capabilities/wallet' && req.method === 'POST') {
    const body = await readJsonBody<{
      enabled?: boolean;
      grandAgentId?: string;
      skills?: string[];
      maxBetPercentOfBankroll?: number;
      maxDailyTxCount?: number;
      requireEscrowForChallenges?: boolean;
    }>(req);

    if (typeof body?.enabled === 'boolean') {
      superAgentConfig.walletPolicy.enabled = body.enabled;
    }
    if (body?.grandAgentId) {
      superAgentConfig.id = body.grandAgentId;
    }
    if (Array.isArray(body?.skills)) {
      superAgentConfig.walletPolicy.allowedSkills = body.skills.filter((item) => typeof item === 'string' && item.trim().length > 0);
    }
    if (typeof body?.maxBetPercentOfBankroll === 'number') {
      superAgentConfig.walletPolicy.maxBetPercentOfBankroll = Math.max(0.1, Math.min(100, body.maxBetPercentOfBankroll));
    }
    if (typeof body?.maxDailyTxCount === 'number') {
      superAgentConfig.walletPolicy.maxDailyTxCount = Math.max(1, Math.min(10000, body.maxDailyTxCount));
    }
    if (typeof body?.requireEscrowForChallenges === 'boolean') {
      superAgentConfig.walletPolicy.requireEscrowForChallenges = body.requireEscrowForChallenges;
    }

    ensureSuperAgentExists();
    applySuperAgentDelegation();
    schedulePersistState();

    sendJson(res, {
      ok: true,
      superAgentId: superAgentConfig.id,
      walletPolicy: superAgentConfig.walletPolicy
    });
    return;
  }

  sendJson(res, { error: 'not_found' }, 404);
});

server.listen(port, () => {
  console.log(`agent-runtime listening on :${port}`);
});
