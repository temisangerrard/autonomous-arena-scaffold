import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = process.cwd();
const ENTRY = path.join(ROOT, 'apps', 'web', 'public', 'js', 'play', 'runtime', 'app.js');

function extractRelativeImports(source) {
  const imports = [];
  const pattern = /import\s+(?:[^'"]+?\s+from\s+)?['"](\.[^'"]+)['"]/g;
  let match;
  while ((match = pattern.exec(source)) != null) {
    const spec = String(match[1] || '');
    if (spec.startsWith('.')) {
      imports.push(spec);
    }
  }
  return [...new Set(imports)];
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const source = await readFile(ENTRY, 'utf8');
  const specs = extractRelativeImports(source);
  const missing = [];
  const untracked = [];
  const trackedFiles = new Set(
    execSync('git ls-files', { encoding: 'utf8' })
      .split('\n')
      .map((entry) => entry.trim())
      .filter(Boolean)
  );

  for (const spec of specs) {
    const target = path.resolve(path.dirname(ENTRY), spec);
    if (!await exists(target)) {
      missing.push({
        spec,
        expectedPath: path.relative(ROOT, target)
      });
      continue;
    }
    const rel = path.relative(ROOT, target);
    if (!trackedFiles.has(rel)) {
      untracked.push({
        spec,
        expectedPath: rel
      });
    }
  }

  if (missing.length > 0) {
    console.error('[validate-play-runtime-imports] missing files referenced by app.js:');
    for (const item of missing) {
      console.error(`- ${item.spec} -> ${item.expectedPath}`);
    }
    process.exit(1);
  }

  if (untracked.length > 0) {
    console.error('[validate-play-runtime-imports] imported files are not tracked in git:');
    for (const item of untracked) {
      console.error(`- ${item.spec} -> ${item.expectedPath}`);
    }
    process.exit(1);
  }

  console.log(`[validate-play-runtime-imports] ok (${specs.length} imports resolved)`);
}

main().catch((error) => {
  console.error('[validate-play-runtime-imports] failed', error?.message || error);
  process.exit(1);
});
