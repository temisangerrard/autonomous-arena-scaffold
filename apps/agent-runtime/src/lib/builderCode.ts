import type { Contract } from 'ethers';

const DEFAULT_BUILDER_CODE = 'bc_uukadkll';
const DEFAULT_BUILDER_SUFFIX = '0x0b62635f75756b61646b6c6c0080218021802180218021802180218021';

type TxLike = {
  hash?: string;
  wait: () => Promise<unknown>;
};

type TxSender = {
  sendTransaction: (tx: { to?: string; value?: bigint; data?: string }) => Promise<TxLike>;
};

function normalizeHex(input: string): string {
  const raw = String(input || '').trim().toLowerCase();
  if (!raw) {
    return '';
  }
  const prefixed = raw.startsWith('0x') ? raw : `0x${raw}`;
  if (!/^0x[0-9a-f]*$/i.test(prefixed)) {
    return '';
  }
  if ((prefixed.length - 2) % 2 !== 0) {
    return '';
  }
  return prefixed;
}

function builderCodeHexFromCode(code: string): string {
  const normalized = String(code || '').trim();
  if (!normalized) {
    return '';
  }
  const utf8 = Buffer.from(normalized, 'utf8');
  if (utf8.length === 0 || utf8.length > 255) {
    return '';
  }
  const lengthHex = utf8.length.toString(16).padStart(2, '0');
  const codeHex = utf8.toString('hex');
  // ERC-8021 attribution trailer marker used by Base docs/examples.
  const trailer = '0080218021802180218021802180218021';
  return `0x${lengthHex}${codeHex}${trailer}`;
}

export function resolveBuilderCodeContext(env: NodeJS.ProcessEnv): {
  code: string;
  suffixHex: string;
  enabled: boolean;
} {
  const code = String(env.BUILDER_CODE || DEFAULT_BUILDER_CODE).trim();
  const explicitSuffix = normalizeHex(String(env.BUILDER_CODE_SUFFIX || ''));
  const derivedSuffix = builderCodeHexFromCode(code);
  const suffixHex = explicitSuffix || derivedSuffix || DEFAULT_BUILDER_SUFFIX;
  return {
    code,
    suffixHex,
    enabled: Boolean(suffixHex)
  };
}

export function appendBuilderCodeSuffix(data: string | undefined | null, suffixHex: string): string {
  const suffix = normalizeHex(suffixHex);
  if (!suffix) {
    return String(data || '0x');
  }
  const base = normalizeHex(String(data || '0x')) || '0x';
  if (base === '0x') {
    return suffix;
  }
  if (base.endsWith(suffix.slice(2))) {
    return base;
  }
  return `${base}${suffix.slice(2)}`;
}

export async function sendNativeWithBuilderCode(
  signer: TxSender,
  tx: { to?: string; value?: bigint; data?: string },
  suffixHex: string
): Promise<TxLike> {
  return signer.sendTransaction({
    ...tx,
    data: appendBuilderCodeSuffix(tx.data, suffixHex)
  });
}

export async function sendContractCallWithBuilderCode(
  contract: Contract,
  signer: TxSender,
  method: string,
  args: unknown[],
  suffixHex: string
): Promise<TxLike> {
  const to = await contract.getAddress();
  const data = contract.interface.encodeFunctionData(method, args);
  return signer.sendTransaction({
    to,
    data: appendBuilderCodeSuffix(data, suffixHex)
  });
}

