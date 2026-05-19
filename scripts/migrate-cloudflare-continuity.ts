import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildContinuityImportPlan,
  buildContinuityImportSql,
  parseLegacyAuthStateDocument,
  type ExistingD1Snapshot,
} from '../apps/cloudflare-backend/src/continuityMigration.js';

type CliOptions = {
  sourcePath: string;
  database: string;
  configPath: string;
  remote: boolean;
  apply: boolean;
  includeSessions: boolean;
};

function parseArgs(argv: string[]): CliOptions {
  let sourcePath = '';
  let database = 'arena-runtime-state';
  let configPath = 'apps/cloudflare-backend/wrangler.jsonc';
  let remote = true;
  let apply = false;
  let includeSessions = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--source') {
      sourcePath = String(argv[index + 1] || '').trim();
      index += 1;
      continue;
    }
    if (arg === '--database') {
      database = String(argv[index + 1] || '').trim() || database;
      index += 1;
      continue;
    }
    if (arg === '--config') {
      configPath = String(argv[index + 1] || '').trim() || configPath;
      index += 1;
      continue;
    }
    if (arg === '--local') {
      remote = false;
      continue;
    }
    if (arg === '--apply') {
      apply = true;
      continue;
    }
    if (arg === '--include-sessions') {
      includeSessions = true;
      continue;
    }
  }

  if (!sourcePath) {
    throw new Error('Usage: npm run migrate:cf:users -- --source <legacy-auth-state.json> [--apply] [--include-sessions] [--local] [--database arena-runtime-state] [--config apps/cloudflare-backend/wrangler.jsonc]');
  }

  return { sourcePath, database, configPath, remote, apply, includeSessions };
}

function runWranglerJsonCommand(args: string[], cwd: string): any {
  const raw = execFileSync('./node_modules/.bin/wrangler', args, {
    cwd,
    env: { ...process.env, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME || '/tmp' },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  return JSON.parse(raw);
}

function d1QueryRows(cwd: string, database: string, configPath: string, remote: boolean, query: string): any[] {
  const args = [
    'd1',
    'execute',
    database,
    remote ? '--remote' : '--local',
    '--json',
    '--command',
    query,
    '--config',
    configPath,
  ];
  const payload = runWranglerJsonCommand(args, cwd);
  const first = Array.isArray(payload) ? payload[0] : payload;
  return Array.isArray(first?.results) ? first.results : [];
}

function loadExistingSnapshot(cwd: string, options: Pick<CliOptions, 'database' | 'configPath' | 'remote'>): ExistingD1Snapshot {
  return {
    webIdentities: d1QueryRows(
      cwd,
      options.database,
      options.configPath,
      options.remote,
      'SELECT sub, email, name, picture, role, profile_id AS profileId, wallet_id AS walletId, username, display_name AS displayName, created_at AS createdAt, last_login_at AS lastLoginAt FROM web_identities ORDER BY email, sub;',
    ),
    subjectLinks: d1QueryRows(
      cwd,
      options.database,
      options.configPath,
      options.remote,
      'SELECT subject, profile_id AS profileId, wallet_id AS walletId, linked_at AS linkedAt, updated_at AS updatedAt FROM auth_subject_links ORDER BY subject;',
    ),
    runtimeProfiles: d1QueryRows(
      cwd,
      options.database,
      options.configPath,
      options.remote,
      'SELECT profile_id AS profileId, username, display_name AS displayName, wallet_id AS walletId, created_at AS createdAt FROM runtime_profiles ORDER BY profile_id;',
    ),
    runtimeWallets: d1QueryRows(
      cwd,
      options.database,
      options.configPath,
      options.remote,
      'SELECT wallet_id AS walletId, owner_profile_id AS ownerProfileId, address, encrypted_private_key AS encryptedPrivateKey, wallet_provider AS walletProvider, external_wallet_address AS externalWalletAddress, external_wallet_ref AS externalWalletRef, external_wallet_linked_at AS externalWalletLinkedAt, balance, daily_tx_count AS dailyTxCount, tx_day_stamp AS txDayStamp, created_at AS createdAt, last_tx_at AS lastTxAt FROM runtime_wallets ORDER BY wallet_id;',
    ),
  };
}

function printSummary(summary: Record<string, unknown>, warnings: string[]): void {
  console.log('Continuity migration summary');
  for (const [key, value] of Object.entries(summary)) {
    console.log(`- ${key}: ${value}`);
  }
  if (warnings.length > 0) {
    console.log('Warnings');
    for (const warning of warnings) {
      console.log(`- ${warning}`);
    }
  }
}

function applyPlanSql(cwd: string, options: Pick<CliOptions, 'database' | 'configPath' | 'remote'>, sql: string): void {
  const tempFile = path.join(os.tmpdir(), `arena-continuity-${Date.now()}.sql`);
  writeFileSync(tempFile, sql, 'utf8');
  execFileSync(
    './node_modules/.bin/wrangler',
    [
      'd1',
      'execute',
      options.database,
      options.remote ? '--remote' : '--local',
      '--file',
      tempFile,
      '--config',
      options.configPath,
    ],
    {
      cwd,
      env: { ...process.env, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME || '/tmp' },
      stdio: 'inherit',
    },
  );
}

async function main(): Promise<void> {
  const cwd = process.cwd();
  const options = parseArgs(process.argv.slice(2));
  const sourceRaw = JSON.parse(readFileSync(path.resolve(cwd, options.sourcePath), 'utf8'));
  const source = parseLegacyAuthStateDocument(sourceRaw);
  const existing = loadExistingSnapshot(cwd, options);
  const plan = await buildContinuityImportPlan({
    source,
    existing,
    includeSessions: options.includeSessions,
  });

  printSummary(plan.summary, plan.warnings);
  if (!options.apply) {
    console.log('Dry run only. Re-run with --apply to write Cloudflare D1.');
    return;
  }

  const sql = buildContinuityImportSql(plan);
  applyPlanSql(cwd, options, sql);
  console.log('Cloudflare D1 continuity migration applied.');
}

void main().catch((error) => {
  console.error(String((error as Error)?.stack || error));
  process.exit(1);
});
