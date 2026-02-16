import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export function loadEnvFromFile(): void {
  const candidates = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '../.env'),
    path.resolve(process.cwd(), '../../.env')
  ];

  const envPath = candidates.find((candidate) => existsSync(candidate));
  if (!envPath) {
    return;
  }

  try {
    const raw = readFileSync(envPath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }
      const idx = trimmed.indexOf('=');
      if (idx < 1) {
        continue;
      }
      const key = trimmed.slice(0, idx).trim();
      if (!key || process.env[key] !== undefined) {
        continue;
      }
      let value = trimmed.slice(idx + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  } catch {
    // Ignore env parse failures in local scaffold mode.
  }
}
