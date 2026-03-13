const CDP_CORE_URL = 'https://esm.sh/@coinbase/cdp-core@0.0.96?bundle';
const VIEM_URL = 'https://esm.sh/viem@2.47.0?bundle';
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
    getFirebaseIdToken
  } = params;
  let sdkPromise = null;
  let viemPromise = null;
  let initializedProjectId = '';

  async function loadSdk() {
    if (!sdkPromise) {
      sdkPromise = import(CDP_CORE_URL);
    }
    return sdkPromise;
  }

  async function loadViem() {
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
    const response = await sdk.sendUserOperation({
      evmSmartAccount: smartAccount,
      network,
      calls: [call],
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
