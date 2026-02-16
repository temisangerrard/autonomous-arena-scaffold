import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { formatCodebaseContext, getTroubleshootingGuide } from './codebaseContext.js';
import { Contract, JsonRpcProvider, Wallet, formatEther, formatUnits, parseEther, parseUnits } from 'ethers';
import {
  addressFromPrivateKey as addressFromPrivateKeyRaw,
  createEncryptionKey,
  createInternalTokenFromKey,
  decryptSecret as decryptSecretRaw,
  encryptSecret as encryptSecretRaw,
  hashString,
  newPrivateKey,
  pseudoTxHash,
  redactSecrets
} from './lib/crypto.js';
import { sendJson, setCorsHeaders, SimpleRouter } from './lib/http.js';
import type {
  BotRecord,
  EscrowLockRecord,
  EscrowSettlementRecord,
  EthSkillDigest,
  Profile,
  SuperAgentLlmUsage,
  SuperAgentMemoryEntry,
  WalletDenied,
  WalletRecord
} from '@arena/shared';
import { registerRuntimeRoutes } from './routes/index.js';
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

const encryptionKey = createEncryptionKey(process.env.WALLET_ENCRYPTION_KEY ?? 'arena-dev-wallet-key');
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
  return createInternalTokenFromKey(superAgentKey);
}

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
const superAgentLlmUsage: SuperAgentLlmUsage = {
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

function dutyForIndex(_index: number): BotRecord['duty'] {
  void _index;
  // Background bots are now static NPCs (one per patrol section).
  return 'npc';
}

function makeBehaviorForDuty(duty: BotRecord['duty'], index: number, patrolSection: number | null): AgentBehaviorConfig {
  const patrolRadius =
    duty === 'sentinel' ? 18 :
    duty === 'duelist' ? 26 :
    duty === 'sparrer' ? 32 :
    duty === 'owner' ? 30 :
    34;

  if (duty === 'npc') {
    // Static world NPCs: no movement, do not initiate challenges.
    // Players can walk up and request a game; NPCs will accept.
    return {
      personality: 'social',
      mode: 'passive',
      challengeEnabled: true,
      challengeCooldownMs: 10_000,
      targetPreference: 'any',
      patrolSection: patrolSection ?? 0,
      patrolRadius: 0,
      baseWager: 1,
      maxWager: 1
    };
  }

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
  // Super agent is a control plane construct; it doesn't need to appear as an in-world bot.
  // Keep its wallet around for budgeting/policy systems.
  getOrCreateWallet('system_super');
}

function applySuperAgentDelegation(): void {
  const directives = buildWorkerDirectives(superAgentConfig, [...bots.keys()]);
  for (const directive of directives) {
    const record = botRegistry.get(directive.botId);
    if (!record) {
      continue;
    }
    if (record.duty === 'npc') {
      // Keep section NPCs static; do not override via delegation.
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

  // superAgentConfig is still used for delegation/policy, but the super agent does not spawn in-world.

  // Owner presence override must win over delegation (player online => park owner bot).
  for (const profileId of ownerPresence.keys()) {
    applyOwnerPresence(profileId);
  }
}

function reconcileBots(targetCount: number): void {
  const bounded = Math.max(0, Math.min(60, targetCount));

  const npcTitles = [
    'Harbor Host',
    'Village Jogger',
    'Carnival Barker',
    'Park Robot',
    'Workshop Vendor',
    'Castle Guard',
    'Farm Traveler',
    'Grove Mystic'
  ];

  while (backgroundBotIds.size < bounded) {
    const id = `agent_bg_${backgroundCounter++}`;
    const idx = backgroundBotIds.size;
    const duty = dutyForIndex(idx);
    const patrolSection = idx % PATROL_SECTION_COUNT;
    const behavior = makeBehaviorForDuty(duty, idx, patrolSection);
    const dutyTitle = duty === 'npc' ? 'NPC' :
      duty === 'duelist' ? 'Duelist' :
      duty === 'sparrer' ? 'Sparrer' :
      duty === 'sentinel' ? 'Sentinel' :
      'Scout';
    registerBot(id, behavior, {
      id,
      ownerProfileId: null,
      displayName: duty === 'npc'
        ? `S${patrolSection + 1} ${npcTitles[patrolSection] ?? 'NPC'}`
        : `${pickDisplayName(`Agent${idx + 1}`)} ${dutyTitle}`,
      createdAt: Date.now(),
      managedBySuperAgent: true,
      duty,
      patrolSection,
      walletId: getOrCreateWallet(`system_${id}`).id
    });
    backgroundBotIds.add(id);
  }

  // Enforce static NPC behavior for any pre-existing background bots loaded from disk.
  for (const id of backgroundBotIds) {
    const record = botRegistry.get(id);
    const bot = bots.get(id);
    if (!record || !bot) {
      continue;
    }
    if (record.duty !== 'npc') {
      record.duty = 'npc';
      record.patrolSection = typeof record.patrolSection === 'number' ? record.patrolSection : (Number(String(id).split('_').pop()) % PATROL_SECTION_COUNT);
      record.displayName = `S${(record.patrolSection ?? 0) + 1} ${npcTitles[record.patrolSection ?? 0] ?? 'NPC'}`;
      record.managedBySuperAgent = true;
      bot.updateDisplayName(record.displayName);
    }
    bot.updateBehavior(makeBehaviorForDuty('npc', 0, record.patrolSection));
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
  
  // Check if this is a troubleshooting request
  const troubleshooting = getTroubleshootingGuide(message);
  const codebaseContext = formatCodebaseContext();
  
  const prompt = `You are the Super Agent managing an autonomous betting arena. Answer concisely, operationally, and safely.

Runtime snapshot:
${context}

ETHSkills knowledge:
${ethSkillsContext || '- none cached'}

Codebase context:
${codebaseContext.slice(0, 3000)}

${troubleshooting ? `Relevant troubleshooting:\n${troubleshooting}\n` : ''}

Operator message:
${message}`;
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

async function askOpenRouterHouse(params: {
  message: string;
  player?: { profileId?: string | null; displayName?: string | null; walletId?: string | null };
}): Promise<string | null> {
  const message = String(params.message || '').trim();
  if (!superAgentConfig.llmPolicy.enabled || !runtimeSecrets.openRouterApiKey || !message) {
    return null;
  }

  const house = houseBankWallet();
  const playerWalletId = String(params.player?.walletId ?? '').trim();
  const playerWallet = playerWalletId ? wallets.get(playerWalletId) ?? null : null;

  const prompt = `You are "The House" for an open-world gambling game. You are helpful, calm, and fun.

Rules:
- Do NOT ask for private keys, seed phrases, or sensitive info.
- Do NOT claim you executed onchain transactions yourself; describe what the system does.
- Keep replies short and actionable.

Context:
- House wallet id=${house.id} balance=${house.balance.toFixed(2)}
- Player=${String(params.player?.displayName ?? 'Player').slice(0, 40)} walletId=${playerWalletId || '-'} balance=${playerWallet ? playerWallet.balance.toFixed(2) : 'unknown'}

Player message:
${message}`;

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${runtimeSecrets.openRouterApiKey}`
    },
    body: JSON.stringify({
      model: superAgentConfig.llmPolicy.model,
      messages: [
        { role: 'system', content: 'You are The House. Reply in 3-8 sentences. Be concrete.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.3,
      max_tokens: 220
    })
  });
  if (!response.ok) {
    rememberSuperAgent('system', `openrouter house error ${response.status}`);
    return null;
  }
  const payload = await response.json().catch(() => null) as { choices?: Array<{ message?: { content?: string } }> } | null;
  const content = payload?.choices?.[0]?.message?.content?.trim() ?? '';
  return content.length > 0 ? content : null;
}

function dayStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

function encryptSecret(raw: string): string {
  return encryptSecretRaw(raw, encryptionKey);
}

function decryptSecret(encrypted: string): string {
  return decryptSecretRaw(encrypted, encryptionKey);
}

function getHouseConfig(): { npcWalletFloor: number; npcWalletTopupAmount: number; superAgentWalletFloor: number } {
  return { npcWalletFloor, npcWalletTopupAmount, superAgentWalletFloor };
}

function setHouseConfig(patch: { npcWalletFloor?: number; npcWalletTopupAmount?: number; superAgentWalletFloor?: number }): void {
  if (typeof patch.npcWalletFloor === 'number' && Number.isFinite(patch.npcWalletFloor)) {
    npcWalletFloor = Math.max(0, Math.min(10_000, patch.npcWalletFloor));
    // Keep super agent floor at least npc floor.
    superAgentWalletFloor = Math.max(npcWalletFloor, superAgentWalletFloor);
  }
  if (typeof patch.npcWalletTopupAmount === 'number' && Number.isFinite(patch.npcWalletTopupAmount)) {
    npcWalletTopupAmount = Math.max(0, Math.min(10_000, patch.npcWalletTopupAmount));
  }
  if (typeof patch.superAgentWalletFloor === 'number' && Number.isFinite(patch.superAgentWalletFloor)) {
    superAgentWalletFloor = Math.max(npcWalletFloor, Math.min(10_000, patch.superAgentWalletFloor));
  }
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

function addressFromPrivateKey(privateKey: string): string {
  return addressFromPrivateKeyRaw(privateKey, Wallet);
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

function createOwnerBotForProfile(profile: Profile, body: {
  displayName?: string;
  personality?: Personality;
  targetPreference?: AgentBehaviorConfig['targetPreference'];
  mode?: AgentBehaviorConfig['mode'];
  baseWager?: number;
  maxWager?: number;
  managedBySuperAgent?: boolean;
}): { ok: true; botId: string } | { ok: false; reason: string; botId?: string; profileId?: string } {
  // Product constraint: one owner bot per player profile (the "character" + offline agent).
  if (profile.ownedBotIds.length >= 1) {
    return { ok: false as const, reason: 'bot_already_exists', botId: profile.ownedBotIds[0], profileId: profile.id };
  }

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
      displayName: body?.displayName?.trim() || pickDisplayName(`${profile.displayName} Bot ${profile.ownedBotIds.length + 1}`),
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

  return { ok: true as const, botId };
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

const router = new SimpleRouter();

registerRuntimeRoutes(router, {
  health: {
    createHealthStatus,
    runtimeStatus
  },
  house: {
    isInternalAuthorized,
    runtimeStatus,
    askOpenRouterHouse,
    ensureSeedBalances,
    schedulePersistState,
    transferFromHouse,
    refillHouse,
    setOwnerOnline,
    setOwnerOffline,
    ownerPresence,
    getHouseConfig,
    setHouseConfig
  },
  bots: {
    bots,
    botRegistry,
    backgroundBotIds,
    usedDisplayNames,
    wallets,
    walletSummary,
    reconcileBots,
    schedulePersistState
  },
  profiles: {
    profiles,
    wallets,
    bots,
    botRegistry,
    walletSummary,
    publicProfiles,
    createProfileWithBot,
    provisionProfileForSubject,
    createOwnerBotForProfile,
    schedulePersistState
  },
  wallets: {
    isInternalAuthorized,
    wallets,
    escrowLocks,
    escrowSettlements,
    pushEscrowSettlement,
    pseudoTxHash,
    walletSummary,
    canUseWallet,
    canLockStake,
    transferFromHouse,
    schedulePersistState,
    onchainProvider,
    onchainTokenAddress,
    onchainEscrowAddress,
    onchainTokenDecimals,
    ERC20_ABI,
    ensureWalletGas,
    gasFunderSigner,
    signerForWallet,
    decryptSecret,
    onchainWalletSummary,
    prepareWalletForEscrowOnchain
  },
  superAgent: {
    bots,
    superAgentConfig,
    getOpenRouterApiKey: () => runtimeSecrets.openRouterApiKey,
    setOpenRouterApiKey: (apiKey) => {
      runtimeSecrets.openRouterApiKey = apiKey;
    },
    runtimeStatus,
    ETHSKILLS_SOURCES,
    superAgentEthSkills,
    syncEthSkillsKnowledge,
    ensureSuperAgentExists,
    applySuperAgentDelegation,
    schedulePersistState,
    rememberSuperAgent,
    parseSuperAgentActions,
    applySuperAgentAction: (action) => applySuperAgentAction(action as SuperAgentAction),
    askOpenRouterSuperAgent
  }
});

const server = createServer(async (req, res) => {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  const url = new URL(req.url ?? '/', 'http://localhost');
  const match = router.match(req.method ?? 'GET', url.pathname);
  if (!match) {
    sendJson(res, { error: 'not_found' }, 404);
    return;
  }

  try {
    await match.handler(req, res, match.params);
  } catch (error) {
    sendJson(res, { ok: false, reason: String((error as Error).message || 'internal_error').slice(0, 160) }, 500);
  }
});

server.listen(port, () => {
  console.log(`agent-runtime listening on :${port}`);
});
