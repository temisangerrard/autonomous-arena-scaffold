import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

export type SkillDefinition = {
  name: string;
  description: string;
  userInvocable: boolean;
  disableModelInvocation: boolean;
  allowedTools: string[];
  sourcePath: string;
};

type Frontmatter = {
  name?: string;
  description?: string;
  ['user-invocable']?: boolean | string;
  ['disable-model-invocation']?: boolean | string;
  ['allowed-tools']?: string[] | string;
};

function toBool(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return fallback;
}

function parseFrontmatter(raw: string): Frontmatter {
  const lines = raw.split('\n');
  const out: Frontmatter = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const idx = trimmed.indexOf(':');
    if (idx <= 0) {
      continue;
    }
    const key = trimmed.slice(0, idx).trim();
    const valueRaw = trimmed.slice(idx + 1).trim();
    if (!key) {
      continue;
    }

    if (key === 'allowed-tools') {
      try {
        const parsed = JSON.parse(valueRaw) as unknown;
        if (Array.isArray(parsed)) {
          out['allowed-tools'] = parsed.map((entry) => String(entry));
          continue;
        }
      } catch {
        // fallthrough
      }
      out['allowed-tools'] = valueRaw;
      continue;
    }

    if ((valueRaw.startsWith('"') && valueRaw.endsWith('"')) || (valueRaw.startsWith("'") && valueRaw.endsWith("'"))) {
      (out as Record<string, unknown>)[key] = valueRaw.slice(1, -1);
    } else {
      (out as Record<string, unknown>)[key] = valueRaw;
    }
  }
  return out;
}

function parseSkillDoc(content: string, sourcePath: string): SkillDefinition | null {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match?.[1]) {
    return null;
  }

  const frontmatter = parseFrontmatter(match[1]);
  const name = String(frontmatter.name || '').trim();
  const description = String(frontmatter.description || '').trim();
  if (!name || !description) {
    return null;
  }

  const allowedToolsRaw = frontmatter['allowed-tools'];
  const allowedTools = Array.isArray(allowedToolsRaw)
    ? allowedToolsRaw.map((entry) => String(entry).trim()).filter(Boolean)
    : String(allowedToolsRaw || '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);

  return {
    name,
    description,
    userInvocable: toBool(frontmatter['user-invocable'], true),
    disableModelInvocation: toBool(frontmatter['disable-model-invocation'], false),
    allowedTools,
    sourcePath
  };
}

export async function loadSkillCatalog(roots: string[]): Promise<SkillDefinition[]> {
  const entries: SkillDefinition[] = [];
  for (const root of roots) {
    const resolvedRoot = path.resolve(root);
    let skillDirs: string[] = [];
    try {
      const dirEntries = await readdir(resolvedRoot, { withFileTypes: true });
      skillDirs = dirEntries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    } catch {
      continue;
    }

    for (const dirName of skillDirs) {
      const skillPath = path.join(resolvedRoot, dirName, 'SKILL.md');
      try {
        const content = await readFile(skillPath, 'utf8');
        const parsed = parseSkillDoc(content, skillPath);
        if (parsed) {
          entries.push(parsed);
        }
      } catch {
        // ignore unreadable/missing skill docs
      }
    }
  }

  return entries.sort((a, b) => a.name.localeCompare(b.name));
}
