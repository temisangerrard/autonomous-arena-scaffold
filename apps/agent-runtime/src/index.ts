import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Contract, JsonRpcProvider, Wallet, formatEther, formatUnits, parseEther, parseUnits } from 'ethers';
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
const houseBankStartBalance = Math.max(0, Number(process.env.HOUSE_BANK_START_BALANCE ?? 2000));
let npcWalletFloor = Math.max(0, Number(process.env.NPC_WALLET_FLOOR ?? 40));
let npcWalletTopupAmount = Math.max(0, Number(process.env.NPC_WALLET_TOPUP_AMOUNT ?? 20));
const npcBudgetTickMs = Math.max(1000, Number(process.env.NPC_BUDGET_TICK_MS ?? 10000));
let superAgentWalletFloor = Math.max(npcWalletFloor, Number(process.env.SUPER_AGENT_WALLET_FLOOR ?? 120));

const runtimeSecrets = {
  openRouterApiKey: process.env.OPENROUTER_API_KEY ?? ''
};
const runtimeStateFile = process.env.AGENT_RUNTIME_STATE_FILE
  ? path.resolve(process.cwd(), process.env.AGENT_RUNTIME_STATE_FILE)
  : path.resolve(process.cwd(), 'output', 'agent-runtime-state.json');

const encryptionKey = createHash('sha256')
  .update(process.env.WALLET_ENCRYPTION_KEY ?? 'arena-dev-wallet-key')
  .digest();
const internalToken = resolveInternalServiceToken();
if (process.env.NODE_ENV === 'production' && !internalToken) {
  console.error('INTERNAL_SERVICE_TOKEN is required in production. Refusing to start.');
  process.exit(1);
}
const onchainRpcUrl = process.env.CHAIN_RPC_URL ?? '';
const onchainTokenAddress = process.env.ESCROW_TOKEN_ADDRESS ?? '';
const onchainEscrowAddress = process.env.ESCROW_CONTRACT_ADDRESS ?? '';
const onchainTokenDecimals = Math.max(0, Math.min(18, Number(process.env.ESCROW_TOKEN_DECIMALS ?? 6)));
const onchainProvider = onchainRpcUrl ? new JsonRpcProvider(onchainRpcUrl) : null;
const gasFunderPrivateKey = process.env.GAS_FUNDING_PRIVATE_KEY || process.env.ESCROW_RESOLVER_PRIVATE_KEY || '';
const minWalletGasEth = process.env.MIN_WALLET_GAS_ETH ?? '0.0003';
const walletGasTopupEth = process.env.WALLET_GAS_TOPUP_ETH ?? '0.001';

function resolveInternalServiceToken(): string {
  const configured = process.env.INTERNAL_SERVICE_TOKEN?.trim();
  if (configured) {
    return configured;
  }
  const superAgentKey = (process.env.ESCROW_RESOLVER_PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY || '').trim();
  if (!superAgentKey) {
    return '';
  }
  return `sa_${createHash('sha256').update(superAgentKey).digest('hex')}`;
}

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
  lockTxHash: string;
};

type EscrowSettlementRecord = {
  challengeId: string;
  outcome: 'resolved' | 'refunded';
  challengerWalletId: string;
  opponentWalletId: string;
  winnerWalletId: string | null;
  amount: number;
  fee: number;
  payout: number;
  txHash: string;
  at: number;
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

type WalletDenied = {
  ok: false;
  reason: string;
};

const bots = new Map<string, AgentBot>();
const botRegistry = new Map<string, BotRecord>();
const profiles = new Map<string, Profile>();
const wallets = new Map<string, WalletRecord>();
const escrowLocks = new Map<string, EscrowLockRecord>();
const escrowSettlements: EscrowSettlementRecord[] = [];
const backgroundBotIds = new Set<string>();
const subjectToProfileId = new Map<string, string>();

type HouseLedgerEntry = {
  at: number;
  toWalletId: string;
  amount: number;
  reason: string;
};

const houseLedger: HouseLedgerEntry[] = [];

type OwnerPresenceRecord = {
  until: number;
  savedByBotId: Map<string, { mode: AgentBehaviorConfig['mode']; challengeEnabled: boolean }>;
};

const ownerPresence = new Map<string, OwnerPresenceRecord>();

type SuperAgentMemoryEntry = {
  at: number;
  type: 'command' | 'decision' | 'system';
  message: string;
};

type EthSkillDigest = {
  url: string;
  title: string;
  summary: string;
  fetchedAt: number;
};

type SuperAgentAction =
  | { kind: 'set_mode'; value: SuperAgentConfig['mode'] }
  | { kind: 'set_cooldown'; value: number }
  | { kind: 'set_target'; value: SuperAgentConfig['workerTargetPreference'] }
  | { kind: 'set_challenges'; value: boolean }
  | { kind: 'set_wallet'; value: boolean }
  | { kind: 'reconcile_bots'; value: number }
  | { kind: 'apply_delegation' }
  | { kind: 'sync_ethskills' }
  | { kind: 'status' }
  | { kind: 'help' };

const superAgentMemory: SuperAgentMemoryEntry[] = [];
const superAgentEthSkills: EthSkillDigest[] = [];
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
  superAgentEthSkills: EthSkillDigest[];
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
const ETHSKILLS_SOURCES = [
  'https://ethskills.com/SKILL.md',
  'https://ethskills.com/why/SKILL.md',
  'https://ethskills.com/gas/SKILL.md',
  'https://ethskills.com/wallets/SKILL.md',
  'https://ethskills.com/standards/SKILL.md',
  'https://ethskills.com/tools/SKILL.md',
  'https://ethskills.com/l2s/SKILL.md'
];

function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function stripHtml(input: string): string {
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function digestEthSkillsPage(url: string, html: string): EthSkillDigest {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const paragraphMatches = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((entry) => stripHtml(entry[1] ?? ''))
    .filter((entry) => entry.length > 20);
  const markdownLines = html
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 18 && !line.startsWith('#') && !line.startsWith('```') && !line.startsWith('- '));
  const summary =
    paragraphMatches.slice(0, 2).join(' ').slice(0, 500) ||
    markdownLines.slice(0, 3).join(' ').slice(0, 500) ||
    'No summary extracted.';
  const markdownTitle = html
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.startsWith('# '));
  return {
    url,
    title: stripHtml(h1Match?.[1] ?? titleMatch?.[1] ?? markdownTitle?.replace(/^#\s+/, '') ?? url).slice(0, 120) || url,
    summary,
    fetchedAt: Date.now()
  };
}

async function syncEthSkillsKnowledge(force = false): Promise<{ ok: boolean; refreshed: number; reason?: string }> {
  if (!force && superAgentEthSkills.length >= ETHSKILLS_SOURCES.length) {
    const stale = superAgentEthSkills.some((entry) => Date.now() - entry.fetchedAt > 1000 * 60 * 60 * 24);
    if (!stale) {
      return { ok: true, refreshed: 0 };
    }
  }

  let refreshed = 0;
  const nextDigests: EthSkillDigest[] = [];
  for (const url of ETHSKILLS_SOURCES) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        rememberSuperAgent('system', `ethskills fetch failed ${response.status} ${url}`);
        continue;
      }
      const html = await response.text();
      nextDigests.push(digestEthSkillsPage(url, html));
      refreshed += 1;
    } catch {
      rememberSuperAgent('system', `ethskills fetch error ${url}`);
    }
  }

  if (nextDigests.length === 0) {
    return { ok: false, refreshed: 0, reason: 'ethskills_unreachable' };
  }

  superAgentEthSkills.splice(0, superAgentEthSkills.length, ...nextDigests);
  rememberSuperAgent('decision', `synced ethskills pages=${nextDigests.length}`);
  schedulePersistState();
  return { ok: true, refreshed };
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

  // Owner presence override must win over delegation (player online => park owner bot).
  for (const profileId of ownerPresence.keys()) {
    applyOwnerPresence(profileId);
  }
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
  const house = houseBankWallet();

  return {
    configuredBotCount: statuses.length,
    connectedBotCount: statuses.filter((bot) => bot.connected).length,
    backgroundBotCount: backgroundBotIds.size,
    profileBotCount: statuses.filter((bot) => bot.meta?.ownerProfileId).length,
    escrowLockCount: escrowLocks.size,
    recentEscrowSettlements: escrowSettlements.slice(-20),
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
        llmUsage: { ...superAgentLlmUsage },
        ethSkills: superAgentEthSkills.slice(0, 8)
      }
    },
    bots: statuses,
    profiles: publicProfiles(),
    wallets: [...wallets.values()].map((wallet) => walletSummary(wallet)),
    house: {
      wallet: walletSummary(house),
      npcWalletFloor,
      npcWalletTopupAmount,
      superAgentWalletFloor,
      recentTransfers: houseLedger.slice(-18)
    }
  };
}

function pushEscrowSettlement(entry: EscrowSettlementRecord): void {
  escrowSettlements.push(entry);
  if (escrowSettlements.length > 400) {
    escrowSettlements.splice(0, escrowSettlements.length - 400);
  }
}

function pseudoTxHash(kind: 'lock' | 'resolve' | 'refund', challengeId: string): string {
  const salt = randomBytes(8).toString('hex');
  const hash = createHash('sha256').update(`${kind}:${challengeId}:${Date.now()}:${salt}`).digest('hex');
  return `0x${hash}`;
}

function runtimeSnapshotText(): string {
  const status = runtimeStatus();
  const totalBalance = status.wallets.reduce((sum, wallet) => sum + Number(wallet?.balance || 0), 0);
  return [
    `bots configured=${status.configuredBotCount} connected=${status.connectedBotCount} background=${status.backgroundBotCount} profile=${status.profileBotCount}`,
    `profiles=${status.profiles.length} wallets=${status.wallets.length} escrowLocks=${status.escrowLockCount}`,
    `walletTotalBalance=${totalBalance.toFixed(2)}`,
    `ethskillsCached=${superAgentEthSkills.length}`,
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

  if (/\b(sync|refresh|update)\s+(ethskills|solidity skills?|evm skills?)\b/.test(normalized)) {
    actions.push({ kind: 'sync_ethskills' });
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
    case 'sync_ethskills':
      return 'ETHSkills sync requested.';
    case 'status':
      return `Current status:\n${runtimeSnapshotText()}`;
    case 'help':
      return 'Supported commands: status, mode <balanced|hunter|defensive>, target <human_only|human_first|any>, cooldown <ms>, enable/disable challenges, enable/disable wallet policy, bot count <n>, apply delegation, sync ethskills.';
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
  const ethSkillsContext = superAgentEthSkills
    .slice(0, 5)
    .map((entry) => `- ${entry.title} (${entry.url}): ${entry.summary}`)
    .join('\n');
  const prompt = `You are the Super Agent managing an autonomous betting arena. Answer concisely, operationally, and safely.\n\nRuntime snapshot:\n${context}\n\nETHSkills knowledge:\n${ethSkillsContext || '- none cached'}\n\nOperator message:\n${message}`;
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

const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function mint(address to, uint256 amount)',
  'function symbol() view returns (string)'
];

type Erc20Api = Contract & {
  balanceOf: (owner: string) => Promise<bigint>;
  allowance: (owner: string, spender: string) => Promise<bigint>;
  approve: (spender: string, amount: bigint) => Promise<{ wait: () => Promise<unknown> }>;
  transfer: (to: string, amount: bigint) => Promise<{ hash?: string; wait: () => Promise<unknown> }>;
  mint: (to: string, amount: bigint) => Promise<{ hash?: string; wait: () => Promise<unknown> }>;
  symbol: () => Promise<string>;
};

function gasFunderSigner(): Wallet | null {
  if (!onchainProvider || !gasFunderPrivateKey) {
    return null;
  }
  return new Wallet(gasFunderPrivateKey, onchainProvider);
}

async function ensureWalletGas(address: string): Promise<string | null> {
  if (!onchainProvider) {
    return null;
  }
  const currentNative = await onchainProvider.getBalance(address);
  const minNative = parseEther(minWalletGasEth);
  if (currentNative >= minNative) {
    return null;
  }
  const funder = gasFunderSigner();
  if (!funder) {
    return null;
  }
  const topup = parseEther(walletGasTopupEth);
  const topupTx = await funder.sendTransaction({ to: address, value: topup });
  await topupTx.wait();
  return topupTx.hash;
}

async function onchainWalletSummary(wallet: WalletRecord): Promise<{
  mode: 'runtime' | 'onchain';
  chainId: number | null;
  tokenAddress: string | null;
  tokenSymbol: string | null;
  tokenDecimals: number;
  address: string;
  nativeBalanceEth: string | null;
  tokenBalance: string | null;
  synced: boolean;
}> {
  if (!onchainProvider || !onchainTokenAddress) {
    return {
      mode: 'runtime',
      chainId: null,
      tokenAddress: null,
      tokenSymbol: null,
      tokenDecimals: onchainTokenDecimals,
      address: wallet.address,
      nativeBalanceEth: null,
      tokenBalance: null,
      synced: false
    };
  }
  const chainId = await onchainProvider.getNetwork().then((net) => Number(net.chainId)).catch(() => null);
  const token = new Contract(onchainTokenAddress, ERC20_ABI, onchainProvider) as Erc20Api;
  const [native, tokenBalanceRaw, symbol] = await Promise.all([
    onchainProvider.getBalance(wallet.address),
    token.balanceOf(wallet.address),
    token.symbol().catch(() => 'TOKEN')
  ]);
  const tokenBalance = formatUnits(tokenBalanceRaw, onchainTokenDecimals);
  wallet.balance = Number.parseFloat(tokenBalance) || 0;
  return {
    mode: 'onchain',
    chainId,
    tokenAddress: onchainTokenAddress,
    tokenSymbol: symbol || 'TOKEN',
    tokenDecimals: onchainTokenDecimals,
    address: wallet.address,
    nativeBalanceEth: formatEther(native),
    tokenBalance,
    synced: true
  };
}

function isInternalAuthorized(req: import('node:http').IncomingMessage): boolean {
  if (!internalToken) {
    return true;
  }
  const header = req.headers['x-internal-token'];
  const token = Array.isArray(header) ? header[0] : header;
  return token === internalToken;
}

function walletById(walletId: string): WalletRecord | null {
  if (!walletId) {
    return null;
  }
  return wallets.get(walletId) ?? null;
}

function signerForWallet(wallet: WalletRecord): Wallet | null {
  if (!onchainProvider) {
    return null;
  }
  const key = decryptSecret(wallet.encryptedPrivateKey);
  if (!key) {
    return null;
  }
  return new Wallet(key, onchainProvider);
}

async function prepareWalletForEscrowOnchain(walletId: string, amount: number): Promise<{
  ok: boolean;
  reason?: string;
  walletId: string;
  address?: string;
  approved?: boolean;
  minted?: boolean;
  allowance?: string;
  balance?: string;
  nativeBalanceEth?: string;
}> {
  const wallet = walletById(walletId);
  if (!wallet) {
    return { ok: false, reason: 'wallet_not_found', walletId };
  }
  if (!onchainProvider || !onchainTokenAddress || !onchainEscrowAddress) {
    return { ok: false, reason: 'onchain_config_missing', walletId };
  }
  const signer = signerForWallet(wallet);
  if (!signer) {
    return { ok: false, reason: 'wallet_signer_unavailable', walletId };
  }
  const owner = signer.address;
  const token = new Contract(onchainTokenAddress, ERC20_ABI, signer) as Erc20Api;
  const required = parseUnits(String(amount), onchainTokenDecimals);

  try {
    let currentNative = 0n;
    if (onchainProvider) {
      currentNative = await onchainProvider.getBalance(owner);
    }
    if (onchainProvider && gasFunderPrivateKey) {
      const minNative = parseEther(minWalletGasEth);
      if (currentNative < minNative) {
        const gasFunder = new Wallet(gasFunderPrivateKey, onchainProvider);
        const topup = parseEther(walletGasTopupEth);
        const topupTx = await gasFunder.sendTransaction({ to: owner, value: topup });
        await topupTx.wait();
        currentNative = await onchainProvider.getBalance(owner);
      }
    }

    let balance = await token.balanceOf(owner) as bigint;
    let minted = false;
    if (balance < required) {
      try {
        const mintTx = await token.mint(owner, required - balance);
        await mintTx.wait();
        balance = await token.balanceOf(owner) as bigint;
        minted = true;
      } catch {
        // likely real USDC (no mint); leave as-is
      }
    }

    let allowance = await token.allowance(owner, onchainEscrowAddress) as bigint;
    let approved = false;
    if (allowance < required) {
      const approveTx = await token.approve(onchainEscrowAddress, required);
      await approveTx.wait();
      allowance = await token.allowance(owner, onchainEscrowAddress) as bigint;
      approved = true;
    }

    if (allowance < required) {
      return {
        ok: false,
        reason: 'allowance_too_low',
        walletId,
        address: owner,
        allowance: formatUnits(allowance, onchainTokenDecimals),
        balance: formatUnits(balance, onchainTokenDecimals),
        nativeBalanceEth: formatEther(currentNative)
      };
    }

    if (balance < required) {
      return {
        ok: false,
        reason: 'insufficient_token_balance',
        walletId,
        address: owner,
        allowance: formatUnits(allowance, onchainTokenDecimals),
        balance: formatUnits(balance, onchainTokenDecimals),
        nativeBalanceEth: formatEther(currentNative)
      };
    }

    return {
      ok: true,
      walletId,
      address: owner,
      approved,
      minted,
      allowance: formatUnits(allowance, onchainTokenDecimals),
      balance: formatUnits(balance, onchainTokenDecimals),
      nativeBalanceEth: formatEther(currentNative)
    };
  } catch (error) {
    return {
      ok: false,
      reason: String((error as { shortMessage?: string; message?: string }).shortMessage || (error as { message?: string }).message || 'onchain_prepare_failed').slice(0, 180),
      walletId,
      address: owner
    };
  }
}

function newPrivateKey(): string {
  return `0x${randomBytes(32).toString('hex')}`;
}

function addressFromPrivateKey(privateKey: string): string {
  try {
    return new Wallet(privateKey).address;
  } catch {
    return `0x${randomBytes(20).toString('hex')}`;
  }
}

function createWallet(ownerProfileId: string, initialBalance = 0): WalletRecord {
  const privateKey = newPrivateKey();
  const wallet: WalletRecord = {
    id: `wallet_${walletCounter++}`,
    ownerProfileId,
    address: addressFromPrivateKey(privateKey),
    encryptedPrivateKey: encryptSecret(privateKey),
    balance: initialBalance,
    dailyTxCount: 0,
    txDayStamp: dayStamp(),
    createdAt: Date.now(),
    lastTxAt: null
  };
  wallets.set(wallet.id, wallet);
  return wallet;
}

function reconcileWalletAddressesFromKeys(): void {
  let updated = 0;
  for (const wallet of wallets.values()) {
    const key = decryptSecret(wallet.encryptedPrivateKey);
    if (!key) {
      continue;
    }
    const derived = addressFromPrivateKey(key);
    if (derived.toLowerCase() !== wallet.address.toLowerCase()) {
      wallet.address = derived;
      updated += 1;
    }
  }
  if (updated > 0) {
    rememberSuperAgent('system', `reconciled wallet addresses from keys count=${updated}`);
    schedulePersistState();
  }
}

function getOrCreateWallet(ownerProfileId: string): WalletRecord {
  const existing = [...wallets.values()].find((wallet) => wallet.ownerProfileId === ownerProfileId);
  if (existing) {
    return existing;
  }
  if (ownerProfileId === 'system_house') {
    return createWallet(ownerProfileId, houseBankStartBalance);
  }
  const seeded = ownerProfileId.startsWith('system_') ? systemSeedBalance : userSeedBalance;
  return createWallet(ownerProfileId, seeded);
}

function houseBankWallet(): WalletRecord {
  return getOrCreateWallet('system_house');
}

function recordHouseTransfer(toWalletId: string, amount: number, reason: string): void {
  houseLedger.push({ at: Date.now(), toWalletId, amount, reason: reason.slice(0, 120) });
  if (houseLedger.length > 80) {
    houseLedger.splice(0, houseLedger.length - 80);
  }
}

function transferFromHouse(toWalletId: string, amount: number, reason: string): { ok: true; amount: number } | { ok: false; reason: string } {
  const target = wallets.get(toWalletId);
  if (!target) {
    return { ok: false, reason: 'wallet_not_found' };
  }
  const house = houseBankWallet();
  const value = Math.max(0, Number(amount || 0));
  if (value <= 0) {
    return { ok: false, reason: 'invalid_amount' };
  }
  if (house.balance < value) {
    return { ok: false, reason: 'house_insufficient_balance' };
  }
  house.balance -= value;
  house.lastTxAt = Date.now();
  target.balance += value;
  target.lastTxAt = Date.now();
  recordHouseTransfer(toWalletId, value, reason);
  schedulePersistState();
  return { ok: true, amount: value };
}

function refillHouse(amount: number, reason: string): { ok: true; amount: number } | { ok: false; reason: string } {
  const house = houseBankWallet();
  const value = Math.max(0, Number(amount || 0));
  if (value <= 0) {
    return { ok: false, reason: 'invalid_amount' };
  }
  house.balance += value;
  house.lastTxAt = Date.now();
  recordHouseTransfer(house.id, value, `refill:${reason}`);
  schedulePersistState();
  return { ok: true, amount: value };
}

function applyOwnerPresence(profileId: string): void {
  const record = ownerPresence.get(profileId);
  if (!record) {
    return;
  }
  for (const botRecord of botRegistry.values()) {
    if (botRecord.ownerProfileId !== profileId) {
      continue;
    }
    const bot = bots.get(botRecord.id);
    if (!bot) {
      continue;
    }
    if (!record.savedByBotId.has(botRecord.id)) {
      const behavior = bot.getStatus().behavior;
      record.savedByBotId.set(botRecord.id, {
        mode: behavior.mode,
        challengeEnabled: behavior.challengeEnabled
      });
    }
    bot.updateBehavior({ mode: 'passive', challengeEnabled: false });
  }
}

function restoreOwnerPresence(profileId: string): void {
  const record = ownerPresence.get(profileId);
  if (!record) {
    return;
  }
  for (const [botId, saved] of record.savedByBotId.entries()) {
    const bot = bots.get(botId);
    if (!bot) {
      continue;
    }
    bot.updateBehavior({ mode: saved.mode, challengeEnabled: saved.challengeEnabled });
  }
  ownerPresence.delete(profileId);
}

function setOwnerOnline(profileId: string, ttlMs: number): void {
  const boundedTtl = Math.max(10_000, Math.min(5 * 60_000, Number(ttlMs || 90_000)));
  const until = Date.now() + boundedTtl;
  const existing = ownerPresence.get(profileId);
  if (existing) {
    existing.until = until;
    applyOwnerPresence(profileId);
    return;
  }
  ownerPresence.set(profileId, { until, savedByBotId: new Map() });
  applyOwnerPresence(profileId);
}

function setOwnerOffline(profileId: string): void {
  restoreOwnerPresence(profileId);
}

function reconcileOwnerPresence(): void {
  const now = Date.now();
  for (const [profileId, record] of ownerPresence.entries()) {
    if (record.until > now) {
      continue;
    }
    restoreOwnerPresence(profileId);
  }
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
    if (record.ownerProfileId) {
      const floor = userSeedBalance;
      if (wallet.balance < floor) {
        wallet.balance = floor;
      }
      continue;
    }

    // System NPCs are funded by the house bank rather than magic refills.
    const floor = record.duty === 'super' ? superAgentWalletFloor : npcWalletFloor;
    if (wallet.balance >= floor) {
      continue;
    }
    const needed = floor - wallet.balance;
    const topup = Math.min(needed, npcWalletTopupAmount || needed);
    if (topup > 0) {
      transferFromHouse(wallet.id, topup, `auto_topup:${record.id}`);
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
    superAgentEthSkills: superAgentEthSkills.slice(0, 40),
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
    superAgentEthSkills.splice(0, superAgentEthSkills.length, ...(data.superAgentEthSkills || []).slice(0, 40));
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
houseBankWallet();
reconcileWalletAddressesFromKeys();
void syncEthSkillsKnowledge(false).catch(() => undefined);
const initialBotCount = Math.max(8, Number(process.env.BOT_COUNT ?? 8));
reconcileBots(initialBotCount);
ensureSeedBalances();
const npcBudgetTimer = setInterval(() => {
  ensureSeedBalances();
  reconcileOwnerPresence();
}, Math.min(10_000, npcBudgetTickMs));
npcBudgetTimer.unref();
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

  if (url.pathname === '/house/status') {
    sendJson(res, { ok: true, house: runtimeStatus().house });
    return;
  }

  if (url.pathname === '/house/config' && req.method === 'POST') {
    if (!isInternalAuthorized(req)) {
      sendJson(res, { ok: false, reason: 'unauthorized_internal' }, 401);
      return;
    }
    const body = await readJsonBody<{ npcWalletFloor?: number; npcWalletTopupAmount?: number; superAgentWalletFloor?: number }>(req);
    if (!body) {
      sendJson(res, { ok: false, reason: 'invalid_json' }, 400);
      return;
    }
    if (typeof body.npcWalletFloor === 'number' && Number.isFinite(body.npcWalletFloor)) {
      npcWalletFloor = Math.max(0, Math.min(10_000, body.npcWalletFloor));
      // Keep super agent floor at least npc floor.
      superAgentWalletFloor = Math.max(npcWalletFloor, superAgentWalletFloor);
    }
    if (typeof body.npcWalletTopupAmount === 'number' && Number.isFinite(body.npcWalletTopupAmount)) {
      npcWalletTopupAmount = Math.max(0, Math.min(10_000, body.npcWalletTopupAmount));
    }
    if (typeof body.superAgentWalletFloor === 'number' && Number.isFinite(body.superAgentWalletFloor)) {
      superAgentWalletFloor = Math.max(npcWalletFloor, Math.min(10_000, body.superAgentWalletFloor));
    }
    ensureSeedBalances();
    schedulePersistState();
    sendJson(res, { ok: true, house: runtimeStatus().house });
    return;
  }

  if (url.pathname === '/house/transfer' && req.method === 'POST') {
    if (!isInternalAuthorized(req)) {
      sendJson(res, { ok: false, reason: 'unauthorized_internal' }, 401);
      return;
    }
    const body = await readJsonBody<{ toWalletId?: string; amount?: number; reason?: string }>(req);
    const toWalletId = String(body?.toWalletId ?? '').trim();
    const amount = Math.max(0, Number(body?.amount ?? 0));
    const reason = String(body?.reason ?? 'admin_transfer').trim() || 'admin_transfer';
    if (!toWalletId || amount <= 0) {
      sendJson(res, { ok: false, reason: 'invalid_transfer_payload' }, 400);
      return;
    }
    const result = transferFromHouse(toWalletId, amount, reason);
    if (!result.ok) {
      sendJson(res, result, 400);
      return;
    }
    sendJson(res, { ok: true, transferred: result.amount, house: runtimeStatus().house });
    return;
  }

  if (url.pathname === '/house/refill' && req.method === 'POST') {
    if (!isInternalAuthorized(req)) {
      sendJson(res, { ok: false, reason: 'unauthorized_internal' }, 401);
      return;
    }
    const body = await readJsonBody<{ amount?: number; reason?: string }>(req);
    const amount = Math.max(0, Number(body?.amount ?? 0));
    const reason = String(body?.reason ?? 'admin_refill').trim() || 'admin_refill';
    if (amount <= 0) {
      sendJson(res, { ok: false, reason: 'invalid_amount' }, 400);
      return;
    }
    const result = refillHouse(amount, reason);
    if (!result.ok) {
      sendJson(res, result, 400);
      return;
    }
    sendJson(res, { ok: true, refilled: result.amount, house: runtimeStatus().house });
    return;
  }

  const ownerPresenceMatch = url.pathname.match(/^\/owners\/([^/]+)\/presence$/);
  if (ownerPresenceMatch && req.method === 'POST') {
    if (!isInternalAuthorized(req)) {
      sendJson(res, { ok: false, reason: 'unauthorized_internal' }, 401);
      return;
    }
    const profileId = String(ownerPresenceMatch[1] || '').trim();
    if (!profileId) {
      sendJson(res, { ok: false, reason: 'profile_required' }, 400);
      return;
    }
    const body = await readJsonBody<{ state?: 'online' | 'offline'; ttlMs?: number }>(req);
    const state = body?.state === 'offline' ? 'offline' : 'online';
    if (state === 'online') {
      setOwnerOnline(profileId, Number(body?.ttlMs ?? 90_000));
      schedulePersistState();
      sendJson(res, { ok: true, state: 'online', until: ownerPresence.get(profileId)?.until ?? null });
      return;
    }
    setOwnerOffline(profileId);
    schedulePersistState();
    sendJson(res, { ok: true, state: 'offline' });
    return;
  }

  if (url.pathname === '/super-agent/status') {
    sendJson(res, runtimeStatus().superAgent);
    return;
  }

  if (url.pathname === '/super-agent/ethskills') {
    sendJson(res, {
      ok: true,
      sources: ETHSKILLS_SOURCES,
      entries: superAgentEthSkills
    });
    return;
  }

  if (url.pathname === '/super-agent/ethskills/sync' && req.method === 'POST') {
    const result = await syncEthSkillsKnowledge(true);
    sendJson(res, {
      ok: result.ok,
      refreshed: result.refreshed,
      reason: result.reason,
      entries: superAgentEthSkills
    }, result.ok ? 200 : 503);
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

    if (actions.some((entry) => entry.kind === 'sync_ethskills')) {
      const synced = await syncEthSkillsKnowledge(true);
      actionReplies.push(
        synced.ok
          ? `ETHSkills synced (${synced.refreshed} pages).`
          : `ETHSkills sync failed (${synced.reason ?? 'unknown_error'}).`
      );
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

    // Product constraint: one owner bot per player profile (the "character" + offline agent).
    // Additional bots can exist as game-defined NPCs, but players don't mint more characters.
    if (profile.ownedBotIds.length >= 1) {
      sendJson(res, { ok: false, reason: 'bot_already_exists', botId: profile.ownedBotIds[0], profileId: profile.id }, 409);
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

  if (url.pathname === '/wallets/onchain/prepare-escrow' && req.method === 'POST') {
    if (!isInternalAuthorized(req)) {
      sendJson(res, { ok: false, reason: 'unauthorized_internal' }, 401);
      return;
    }

    const body = await readJsonBody<{
      walletIds?: string[];
      amount?: number;
    }>(req);

    const walletIds = Array.isArray(body?.walletIds)
      ? body.walletIds.map((entry) => String(entry || '').trim()).filter(Boolean)
      : [];
    const amount = Math.max(0, Number(body?.amount ?? 0));
    if (walletIds.length === 0 || amount <= 0) {
      sendJson(res, { ok: false, reason: 'invalid_prepare_payload' }, 400);
      return;
    }

    const results = [] as Array<Awaited<ReturnType<typeof prepareWalletForEscrowOnchain>>>;
    for (const walletId of walletIds) {
      results.push(await prepareWalletForEscrowOnchain(walletId, amount));
    }

    const failed = results.filter((entry) => !entry.ok);
    const failureReason = failed
      .map((entry) => entry.reason)
      .find((entry): entry is string => typeof entry === 'string' && entry.length > 0)
      ?? null;
    sendJson(res, {
      ok: failed.length === 0,
      reason: failureReason,
      chain: onchainProvider ? await onchainProvider.getNetwork().then((net) => ({ id: Number(net.chainId) })).catch(() => null) : null,
      tokenAddress: onchainTokenAddress || null,
      escrowAddress: onchainEscrowAddress || null,
      tokenDecimals: onchainTokenDecimals,
      results
    }, failed.length === 0 ? 200 : 400);
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

    if (onchainProvider && onchainTokenAddress) {
      const funder = gasFunderSigner();
      if (!funder) {
        sendJson(res, { ok: false, reason: 'gas_funder_unavailable' }, 400);
        return;
      }
      const token = new Contract(onchainTokenAddress, ERC20_ABI, funder) as Erc20Api;
      const value = parseUnits(String(amount), onchainTokenDecimals);
      try {
        await ensureWalletGas(wallet.address);
        const mintTx = await token.mint(wallet.address, value);
        await mintTx.wait();
        const summary = await onchainWalletSummary(wallet);
        wallet.dailyTxCount += 1;
        wallet.lastTxAt = Date.now();
        sendJson(res, {
          ok: true,
          mode: 'onchain',
          txHash: mintTx.hash ?? null,
          wallet: walletSummary(wallet),
          onchain: summary
        });
        schedulePersistState();
        return;
      } catch (error) {
        sendJson(res, { ok: false, reason: String((error as Error).message || 'onchain_fund_failed').slice(0, 160) }, 400);
        return;
      }
    }

    wallet.balance += amount;
    wallet.dailyTxCount += 1;
    wallet.lastTxAt = Date.now();
    sendJson(res, { ok: true, mode: 'runtime', wallet: walletSummary(wallet) });
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

    if (onchainProvider && onchainTokenAddress) {
      const signer = signerForWallet(wallet);
      const treasury = process.env.WITHDRAW_TREASURY_ADDRESS?.trim() || gasFunderSigner()?.address || '';
      if (!signer || !treasury) {
        sendJson(res, { ok: false, reason: 'withdraw_destination_unavailable' }, 400);
        return;
      }
      const token = new Contract(onchainTokenAddress, ERC20_ABI, signer) as Erc20Api;
      const value = parseUnits(String(amount), onchainTokenDecimals);
      try {
        await ensureWalletGas(wallet.address);
        const tx = await token.transfer(treasury, value);
        await tx.wait();
        const summary = await onchainWalletSummary(wallet);
        wallet.dailyTxCount += 1;
        wallet.lastTxAt = Date.now();
        sendJson(res, {
          ok: true,
          mode: 'onchain',
          txHash: tx.hash ?? null,
          to: treasury,
          wallet: walletSummary(wallet),
          onchain: summary
        });
        schedulePersistState();
        return;
      } catch (error) {
        sendJson(res, { ok: false, reason: String((error as Error).message || 'onchain_withdraw_failed').slice(0, 160) }, 400);
        return;
      }
    }

    if (wallet.balance < amount) {
      sendJson(res, { ok: false, reason: 'insufficient_balance' }, 400);
      return;
    }

    wallet.balance -= amount;
    wallet.dailyTxCount += 1;
    wallet.lastTxAt = Date.now();
    sendJson(res, { ok: true, mode: 'runtime', wallet: walletSummary(wallet) });
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

    if (onchainProvider && onchainTokenAddress) {
      const signer = signerForWallet(source);
      if (!signer) {
        sendJson(res, { ok: false, reason: 'wallet_signer_unavailable' }, 400);
        return;
      }
      const token = new Contract(onchainTokenAddress, ERC20_ABI, signer) as Erc20Api;
      const value = parseUnits(String(amount), onchainTokenDecimals);
      try {
        await ensureWalletGas(source.address);
        const tx = await token.transfer(target.address, value);
        await tx.wait();
        const [sourceOnchain, targetOnchain] = await Promise.all([
          onchainWalletSummary(source),
          onchainWalletSummary(target)
        ]);
        source.dailyTxCount += 1;
        target.dailyTxCount += 1;
        source.lastTxAt = Date.now();
        target.lastTxAt = Date.now();
        sendJson(res, {
          ok: true,
          mode: 'onchain',
          txHash: tx.hash ?? null,
          source: walletSummary(source),
          target: walletSummary(target),
          sourceOnchain,
          targetOnchain
        });
        schedulePersistState();
        return;
      } catch (error) {
        sendJson(res, { ok: false, reason: String((error as Error).message || 'onchain_transfer_failed').slice(0, 160) }, 400);
        return;
      }
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
      mode: 'runtime',
      source: walletSummary(source),
      target: walletSummary(target)
    });
    schedulePersistState();
    return;
  }

  if (url.pathname.startsWith('/wallets/') && url.pathname.endsWith('/summary') && req.method === 'GET') {
    const walletId = url.pathname.split('/')[2];
    const wallet = walletId ? wallets.get(walletId) : null;
    if (!wallet) {
      sendJson(res, { ok: false, reason: 'wallet_not_found' }, 404);
      return;
    }
    try {
      const onchain = await onchainWalletSummary(wallet);
      sendJson(res, {
        ok: true,
        wallet: walletSummary(wallet),
        onchain
      });
      schedulePersistState();
    } catch (error) {
      sendJson(res, {
        ok: true,
        wallet: walletSummary(wallet),
        onchain: {
          mode: 'runtime',
          chainId: null,
          tokenAddress: onchainTokenAddress || null,
          tokenSymbol: null,
          tokenDecimals: onchainTokenDecimals,
          address: wallet.address,
          nativeBalanceEth: null,
          tokenBalance: null,
          synced: false,
          reason: String((error as Error).message || 'onchain_summary_failed').slice(0, 160)
        }
      });
    }
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
        txHash: existingLock.lockTxHash,
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
      createdAt: Date.now(),
      lockTxHash: pseudoTxHash('lock', challengeId)
    };
    escrowLocks.set(challengeId, lock);

    sendJson(res, {
      ok: true,
      challengeId,
      escrow: lock,
      txHash: lock.lockTxHash,
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
    const txHash = pseudoTxHash('resolve', challengeId);
    winner.balance += payout;
    winner.dailyTxCount += 1;
    winner.lastTxAt = Date.now();
    escrowLocks.delete(challengeId);
    pushEscrowSettlement({
      challengeId,
      outcome: 'resolved',
      challengerWalletId: lock.challengerWalletId,
      opponentWalletId: lock.opponentWalletId,
      winnerWalletId,
      amount: lock.amount,
      fee,
      payout,
      txHash,
      at: Date.now()
    });

    sendJson(res, {
      ok: true,
      challengeId,
      payout,
      fee,
      txHash,
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
    const txHash = pseudoTxHash('refund', challengeId);
    escrowLocks.delete(challengeId);
    pushEscrowSettlement({
      challengeId,
      outcome: 'refunded',
      challengerWalletId: lock.challengerWalletId,
      opponentWalletId: lock.opponentWalletId,
      winnerWalletId: null,
      amount: lock.amount,
      fee: 0,
      payout: lock.amount * 2,
      txHash,
      at: Date.now()
    });

    sendJson(res, {
      ok: true,
      challengeId,
      txHash,
      challenger: walletSummary(challenger),
      opponent: walletSummary(opponent)
    });
    schedulePersistState();
    return;
  }

  if (url.pathname === '/wallets/escrow/history') {
    const limit = Math.max(1, Math.min(200, Number(url.searchParams.get('limit') ?? 60)));
    sendJson(res, { ok: true, recent: escrowSettlements.slice(-limit).reverse() });
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
