import { execFile } from 'node:child_process';

export type ToolExecutionResult = {
  ok: boolean;
  stdout: string;
  stderr: string;
  code: number;
  durationMs: number;
  reason?: string;
  selectionRationale?: string;
};

function extractAllowedPrefixes(allowedTools: string[]): string[] {
  return allowedTools
    .map((entry) => entry.match(/Bash\(([^*\)]+)[*\)]/)?.[1]?.trim() || '')
    .filter(Boolean);
}

function redactOutput(text: string): string {
  return String(text || '')
    .replace(/sk-[A-Za-z0-9_-]{10,}/g, '[redacted_key]')
    .replace(/0x[a-fA-F0-9]{64}/g, '[redacted_hex_secret]')
    .slice(0, 2400);
}

export async function executeAllowedTool(command: string, allowedTools: string[], timeoutMs = 30_000): Promise<ToolExecutionResult> {
  const normalized = String(command || '').trim();
  const prefixes = extractAllowedPrefixes(allowedTools);
  const allowed = prefixes.some((prefix) => normalized.startsWith(prefix));
  const selectionRationale = allowed
    ? `Command accepted by allowlist prefixes: ${prefixes.join(', ') || 'none'}`
    : `Command blocked. No allowlist prefix matched: ${prefixes.join(', ') || 'none'}`;
  if (!allowed) {
    return {
      ok: false,
      stdout: '',
      stderr: '',
      code: 126,
      durationMs: 0,
      reason: 'command_not_allowed',
      selectionRationale
    };
  }

  const startedAt = Date.now();
  return new Promise<ToolExecutionResult>((resolve) => {
    execFile('bash', ['-lc', normalized], { timeout: timeoutMs }, (error, stdout, stderr) => {
      const durationMs = Date.now() - startedAt;
      if (error) {
        const code = typeof (error as { code?: number }).code === 'number' ? Number((error as { code?: number }).code) : 1;
        resolve({
          ok: false,
          stdout: redactOutput(stdout),
          stderr: redactOutput(stderr || String(error.message || 'execution_failed')),
          code,
          durationMs,
          reason: 'execution_failed',
          selectionRationale
        });
        return;
      }
      resolve({
        ok: true,
        stdout: redactOutput(stdout),
        stderr: redactOutput(stderr),
        code: 0,
        durationMs,
        selectionRationale
      });
    });
  });
}
