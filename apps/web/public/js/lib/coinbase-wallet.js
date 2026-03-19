const CDP_CORE_URL = 'https://esm.sh/@coinbase/cdp-core@0.0.96?bundle';
const VIEM_URL = 'https://esm.sh/viem@2.47.0?bundle';
const DEFAULT_BUILDER_CODE = 'bc_uukadkll';
const DEFAULT_BUILDER_SUFFIX = '0x0b62635f75756b61646b6c6c0080218021802180218021802180218021';
const ERC20_APPROVE_ABI = [
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' }
    ],
    outputs: [{ name: '', type: 'bool' }]
  }
];

function normalizeHex(input) {
  const raw = String(input || '').trim().toLowerCase();
  if (!raw) return '';
  const prefixed = raw.startsWith('0x') ? raw : `0x${raw}`;
  if (!/^0x[0-9a-f]*$/i.test(prefixed)) return '';
  if ((prefixed.length - 2) % 2 !== 0) return '';
  return prefixed;
}

function builderCodeHexFromCode(code) {
  const normalized = String(code || '').trim();
  if (!normalized) return '';
  const utf8 = new TextEncoder().encode(normalized);
  if (utf8.length === 0 || utf8.length > 255) return '';
  const lengthHex = utf8.length.toString(16).padStart(2, '0');
  const codeHex = Array.from(utf8, (byte) => byte.toString(16).padStart(2, '0')).join('');
  const trailer = '0080218021802180218021802180218021';
  return `0x${lengthHex}${codeHex}${trailer}`;
}

export function resolveBuilderCodeContext(env = {}) {
  const code = String(env.BUILDER_CODE || DEFAULT_BUILDER_CODE).trim();
  const explicitSuffix = normalizeHex(String(env.BUILDER_CODE_SUFFIX || ''));
  const derivedSuffix = builderCodeHexFromCode(code);
  const suffixHex = explicitSuffix || derivedSuffix || DEFAULT_BUILDER_SUFFIX;
  return { code, suffixHex, enabled: Boolean(suffixHex) };
}

export function appendBuilderCodeSuffix(data, suffixHex) {
  const suffix = normalizeHex(suffixHex);
  if (!suffix) return String(data || '0x');
  const base = normalizeHex(String(data || '0x')) || '0x';
  if (base === '0x') return suffix;
  if (base.endsWith(suffix.slice(2))) return base;
  return `${base}${suffix.slice(2)}`;
}

export function resolveSmartAccountAddress(user, expectedAddress = '') {
  const smartAccounts = Array.isArray(user?.evmSmartAccounts)
    ? user.evmSmartAccounts.map((entry) => String(entry || ''))
    : [];
  const normalizedExpected = String(expectedAddress || '').trim().toLowerCase();
  if (normalizedExpected) {
    const matched = smartAccounts.find((entry) => entry.toLowerCase() === normalizedExpected);
    if (matched) {
      return matched;
    }
  }
  if (smartAccounts.length === 1) {
    return smartAccounts[0];
  }
  throw new Error('coinbase_smart_account_not_found');
}

export function approvalCapAtomic(capUsdc) {
  const normalized = Number(capUsdc);
  if (!Number.isFinite(normalized) || normalized <= 0) {
    throw new Error('invalid_approval_cap');
  }
  return BigInt(Math.round(normalized * 1_000_000));
}

export function buildApproveEscrowCall(params) {
  const {
    tokenAddress,
    spenderAddress,
    capUsdc,
    encodeFunctionData
  } = params;
  if (!tokenAddress || !spenderAddress) {
    throw new Error('approval_target_missing');
  }
  return {
    to: String(tokenAddress),
    data: encodeFunctionData({
      abi: ERC20_APPROVE_ABI,
      functionName: 'approve',
      args: [String(spenderAddress), approvalCapAtomic(capUsdc)]
    })
  };
}

export async function waitForUserOperationReceipt(params) {
  const {
    getUserOperation,
    userOperationHash,
    evmSmartAccount,
    network,
    maxAttempts = 12,
    pollIntervalMs = 1500
  } = params;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const operation = await getUserOperation({
      userOperationHash,
      evmSmartAccount,
      network
    });
    const status = String(operation?.status || '').toLowerCase();
    if (status === 'complete') {
      return {
        status,
        transactionHash: operation?.transactionHash || operation?.receipts?.[0]?.transactionHash || null
      };
    }
    if (status === 'failed' || status === 'dropped') {
      throw new Error(`coinbase_user_operation_${status}`);
    }
    if (attempt < maxAttempts - 1 && pollIntervalMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
  }
  throw new Error('coinbase_user_operation_timeout');
}

export function createCoinbaseWalletApprovalClient(params = {}) {
  const {
    windowRef = window,
    getFirebaseIdToken,
    loadSdk: providedLoadSdk,
    loadViem: providedLoadViem
  } = params;
  let sdkPromise = null;
  let viemPromise = null;
  let initializedProjectId = '';

  async function loadSdk() {
    if (providedLoadSdk) {
      return providedLoadSdk();
    }
    if (!sdkPromise) {
      sdkPromise = import(CDP_CORE_URL);
    }
    return sdkPromise;
  }

  async function loadViem() {
    if (providedLoadViem) {
      return providedLoadViem();
    }
    if (!viemPromise) {
      viemPromise = import(VIEM_URL);
    }
    return viemPromise;
  }

  function resolveNetwork(input) {
    const chainId = Number(input);
    if (chainId === 84532) return 'base-sepolia';
    if (chainId === 8453) return 'base';
    return 'base';
  }

  async function approveEscrowCap(options) {
    const projectId = String(windowRef.ARENA_CONFIG?.cdpProjectId || '').trim();
    if (!projectId) {
      throw new Error('cdp_project_id_missing');
    }
    const network = String(options?.network || resolveNetwork(options?.chainId));
    const sdk = await loadSdk();
    const { encodeFunctionData } = await loadViem();

    if (initializedProjectId !== projectId) {
      sdk.initialize({
        projectId,
        customAuth: {
          getJwt: async () => await getFirebaseIdToken()
        },
        ethereum: {
          createOnLogin: 'smart'
        }
      });
      initializedProjectId = projectId;
    }

    await sdk.authenticateWithJWT();
    const user = await sdk.getCurrentUser();
    const smartAccount = resolveSmartAccountAddress(user, options?.smartAccount);
    const call = buildApproveEscrowCall({
      tokenAddress: options?.tokenAddress,
      spenderAddress: options?.spenderAddress,
      capUsdc: options?.capUsdc,
      encodeFunctionData
    });
    const builderCodeContext = resolveBuilderCodeContext(windowRef.ARENA_CONFIG || {});
    const response = await sdk.sendUserOperation({
      evmSmartAccount: smartAccount,
      network,
      calls: [
        {
          ...call,
          data: appendBuilderCodeSuffix(call.data, builderCodeContext.suffixHex)
        }
      ],
      useCdpPaymaster: true
    });
    const receipt = await waitForUserOperationReceipt({
      getUserOperation: sdk.getUserOperation,
      userOperationHash: response.userOperationHash,
      evmSmartAccount: smartAccount,
      network
    });
    return {
      smartAccount,
      userOperationHash: response.userOperationHash,
      transactionHash: receipt.transactionHash || null
    };
  }

  return {
    approveEscrowCap
  };
}
