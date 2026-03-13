import { copyFile, mkdtemp, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

export const canonicalWorldAssetBaseUrl = 'https://arena-world-assets.netlify.app';
export const defaultWorldAssetSourcePath = path.resolve(process.cwd(), 'train_station_mega_world.glb');

export function resolveWorldAssetDeployTarget(env = process.env) {
  const siteId = String(env.NETLIFY_WORLD_ASSETS_SITE_ID || '').trim();
  const siteName = String(env.NETLIFY_WORLD_ASSETS_SITE_NAME || '').trim();

  if (siteId) return { flag: '--site', value: siteId };
  if (siteName) return { flag: '--site', value: siteName };

  throw new Error('NETLIFY_WORLD_ASSETS_SITE_ID or NETLIFY_WORLD_ASSETS_SITE_NAME is required');
}

export async function stageWorldAssetPublishDir({
  sourcePath = defaultWorldAssetSourcePath,
  stagingDir
} = {}) {
  const root = stagingDir || await mkdtemp(path.join(os.tmpdir(), 'arena-world-assets-'));
  const worldDir = path.join(root, 'assets', 'world');
  await mkdir(worldDir, { recursive: true });
  await copyFile(sourcePath, path.join(worldDir, 'mega.glb'));
  return root;
}

export async function deployWorldAssets({
  sourcePath = defaultWorldAssetSourcePath,
  env = process.env,
  dryRun = false,
  stagingDir
} = {}) {
  const target = resolveWorldAssetDeployTarget(env);
  const publishDir = await stageWorldAssetPublishDir({ sourcePath, stagingDir });

  if (dryRun) {
    return { publishDir, target };
  }

  const args = ['deploy', '--prod', target.flag, target.value, '--dir', publishDir, '--message', 'world asset publish'];
  if (env.NETLIFY_AUTH_TOKEN) {
    args.push('--auth', env.NETLIFY_AUTH_TOKEN);
  }

  await new Promise((resolve, reject) => {
    const child = spawn('netlify', args, {
      stdio: 'inherit',
      env
    });
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`netlify deploy failed with exit code ${code ?? 'unknown'}`));
    });
    child.on('error', reject);
  });

  return { publishDir, target };
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const dryRun = args.has('--dry-run');
  const cleanup = !args.has('--keep-staging');
  const sourcePath = process.env.WORLD_ASSET_SOURCE_PATH
    ? path.resolve(process.cwd(), process.env.WORLD_ASSET_SOURCE_PATH)
    : defaultWorldAssetSourcePath;

  const result = await deployWorldAssets({ sourcePath, dryRun });
  console.log(`[world-assets] canonical host: ${canonicalWorldAssetBaseUrl}`);
  console.log(`[world-assets] staged publish dir: ${result.publishDir}`);
  console.log(`[world-assets] deploy target: ${result.target.value}`);

  if (cleanup && !dryRun) {
    await rm(result.publishDir, { recursive: true, force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`[world-assets] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
