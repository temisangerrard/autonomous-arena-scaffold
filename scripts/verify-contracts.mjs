/**
 * verify-contracts.mjs
 *
 * Verifies deployed contracts on Base mainnet using raw JSON-RPC calls.
 * No build step needed — run directly with Node ≥18.
 *
 * Usage:
 *   node scripts/verify-contracts.mjs
 *
 * Environment (from .env or shell):
 *   CHAIN_RPC_URL          (default: https://mainnet.base.org)
 *   ESCROW_CONTRACT_ADDRESS (default: 0xc071a2a0da5901a8c036cc5d2d2d4ffc7b09787d)
 *   ESCROW_TOKEN_ADDRESS    (default: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913)
 *   CHAINLINK_BTC_USD_FEED  (default: 0x64c911996D3c6aC71f9b455B1E8E7266BcbD848F)
 *   ESCROW_FEE_BPS          (default: 500) — expected fee in basis points
 *   ESCROW_RESOLVER_ADDRESS — if set, used to check RESOLVER_ROLE assignment
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Load .env if present (best-effort)
// ---------------------------------------------------------------------------
const __dir = dirname(fileURLToPath(import.meta.url));
try {
  const envPath = resolve(__dir, '..', '.env');
  const raw = readFileSync(envPath, 'utf8');
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx < 1) continue;
    const key = trimmed.slice(0, idx).trim();
    const val = trimmed.slice(idx + 1).trim();
    if (key && !(key in process.env)) {
      process.env[key] = val;
    }
  }
} catch {
  // no .env — rely on shell environment
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const RPC_URL = (process.env.CHAIN_RPC_URL || process.env.BASE_RPC_URL || 'https://mainnet.base.org').trim();
const POOL_ADDRESS = (process.env.ESCROW_CONTRACT_ADDRESS || '0xc071a2a0da5901a8c036cc5d2d2d4ffc7b09787d').trim();
const USDC_ADDRESS = (process.env.ESCROW_TOKEN_ADDRESS || '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913').trim();
const CHAINLINK_FEED = (process.env.CHAINLINK_BTC_USD_FEED || '0x64c911996D3c6aC71f9b455B1E8E7266BcbD848F').trim();
const EXPECTED_FEE_BPS = Number(process.env.ESCROW_FEE_BPS ?? 500);
const RESOLVER_ADDRESS = (process.env.ESCROW_RESOLVER_ADDRESS || '').trim().toLowerCase();

const BASE_MAINNET_CHAIN_ID = 8453;
const CHAINLINK_STALE_SECONDS = 3600; // >1h without update is stale
const USDC_DECIMALS = 6;

// ---------------------------------------------------------------------------
// Status reporter
// ---------------------------------------------------------------------------
let failures = 0;

function ok(label, detail = '') {
  const suffix = detail ? ` | ${detail}` : '';
  console.log(`  [PASS] ${label}${suffix}`);
}

function warn(label, detail = '') {
  const suffix = detail ? ` | ${detail}` : '';
  console.warn(`  [WARN] ${label}${suffix}`);
}

function fail(label, detail = '') {
  const suffix = detail ? ` | ${detail}` : '';
  console.error(`  [FAIL] ${label}${suffix}`);
  failures += 1;
}

function section(title) {
  console.log(`\n── ${title} ──`);
}

// ---------------------------------------------------------------------------
// JSON-RPC helpers
// ---------------------------------------------------------------------------
let rpcId = 1;

async function rpcCall(method, params = []) {
  const body = JSON.stringify({ jsonrpc: '2.0', id: rpcId++, method, params });
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
    signal: AbortSignal.timeout(15_000)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from RPC`);
  const payload = await res.json();
  if (payload.error) throw new Error(`RPC error ${payload.error.code}: ${payload.error.message}`);
  return payload.result;
}

// Encode a plain eth_call
async function ethCall(to, data) {
  return rpcCall('eth_call', [{ to, data }, 'latest']);
}

// ---------------------------------------------------------------------------
// ABI encoding helpers (minimal, no ethers dependency)
// ---------------------------------------------------------------------------

// Pad a hex value to 32 bytes (64 hex chars)
function pad32(hex) {
  return hex.replace(/^0x/, '').padStart(64, '0');
}

// Encode a call with selector + single address argument
function encodeWithAddress(selector, address) {
  return selector + pad32(address.replace(/^0x/, '').toLowerCase());
}

// Decode uint256 from 32-byte return value
function decodeUint256(hex) {
  return BigInt(hex);
}

// Decode bool from 32-byte return value
function decodeBool(hex) {
  return hex.replace(/^0x/, '').slice(-1) === '1';
}

// Decode int256 (signed) from 32-byte return value — used for Chainlink price
function decodeInt256(hex) {
  const n = BigInt(hex);
  const max = 2n ** 255n;
  return n >= max ? n - 2n ** 256n : n;
}

// Decode a short ASCII string from a padded return value (symbol/name)
function decodeString(hex) {
  const raw = hex.replace(/^0x/, '');
  // ABI-encoded string: offset (32 bytes) + length (32 bytes) + data
  if (raw.length < 128) return '';
  const len = Number(BigInt('0x' + raw.slice(64, 128)));
  const bytes = raw.slice(128, 128 + len * 2);
  return Buffer.from(bytes, 'hex').toString('utf8');
}

// Format a USDC amount (6 decimals)
function formatUsdc(raw) {
  const n = Number(raw) / 1e6;
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Format an ETH amount (18 decimals)
function formatEth(raw) {
  const n = Number(raw) / 1e18;
  return n.toFixed(6);
}

// keccak256 of a string — used to compute role hashes.
// We compute it via the RPC using sha3 (eth_call to a mock, or just use known precomputed values).
// RESOLVER_ROLE = keccak256("RESOLVER_ROLE") — precomputed:
const RESOLVER_ROLE = '0x5f58e3a2316349923ce3780f8d587db2d72378aed66a8261c916544fa6846ca5';
// FEE_MANAGER_ROLE = keccak256("FEE_MANAGER_ROLE") — precomputed:
// (If the contract doesn't expose feeBps directly we skip this check)

// Function selectors
const SEL = {
  // ERC20
  balanceOf:       '0x70a08231', // balanceOf(address)
  decimals:        '0x313ce567', // decimals()
  symbol:          '0x95d89b41', // symbol()
  totalSupply:     '0x18160ddd', // totalSupply()
  // AccessControl
  hasRole:         '0x91d14854', // hasRole(bytes32,address)
  // Chainlink AggregatorV3
  latestRoundData: '0xfeaf968c', // latestRoundData()
  // Pool-specific (may or may not exist)
  feeBps:          '0x43e05753', // feeBps() — check if present
  token:           '0xfc0c546a', // token()
};

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

async function checkNetwork() {
  section('Network — Base Mainnet');
  const chainIdHex = await rpcCall('eth_chainId');
  const chainId = Number(BigInt(chainIdHex));
  if (chainId === BASE_MAINNET_CHAIN_ID) {
    ok('Chain ID', `${chainId} (Base Mainnet)`);
  } else {
    fail('Chain ID', `expected ${BASE_MAINNET_CHAIN_ID} (Base Mainnet), got ${chainId}`);
  }
  const blockHex = await rpcCall('eth_blockNumber');
  const block = Number(BigInt(blockHex));
  ok('Latest block', `#${block.toLocaleString()}`);
  return chainId;
}

async function checkContractCode(label, address) {
  const code = await rpcCall('eth_getCode', [address, 'latest']);
  if (!code || code === '0x' || code === '0x0') {
    fail(`${label} — code at ${address}`, 'NO CONTRACT CODE (wrong address or self-destructed)');
    return false;
  }
  const byteLen = (code.length - 2) / 2;
  ok(`${label} — code at ${address}`, `${byteLen} bytes`);
  return true;
}

async function checkPariMutuelPool() {
  section(`PariMutuelPool — ${POOL_ADDRESS}`);

  const exists = await checkContractCode('PariMutuelPool', POOL_ADDRESS);
  if (!exists) return;

  // ETH balance of pool
  const balHex = await rpcCall('eth_getBalance', [POOL_ADDRESS, 'latest']);
  const balEth = formatEth(BigInt(balHex));
  ok('ETH balance', `${balEth} ETH`);

  // Try reading the token() view — may not exist on all versions
  try {
    const tokenResult = await ethCall(POOL_ADDRESS, SEL.token);
    if (tokenResult && tokenResult !== '0x') {
      const tokenAddr = '0x' + tokenResult.replace(/^0x/, '').slice(24);
      if (tokenAddr.toLowerCase() === USDC_ADDRESS.toLowerCase()) {
        ok('token() == USDC', tokenAddr);
      } else {
        fail('token() != USDC', `got ${tokenAddr}, expected ${USDC_ADDRESS}`);
      }
    }
  } catch {
    // token() not exposed as view — skip
    warn('token() view', 'not exposed or reverted — skipping');
  }

  // Try reading feeBps()
  try {
    const feeBpsResult = await ethCall(POOL_ADDRESS, SEL.feeBps);
    if (feeBpsResult && feeBpsResult !== '0x') {
      const bps = Number(decodeUint256(feeBpsResult));
      if (bps === EXPECTED_FEE_BPS) {
        ok(`feeBps() == ${EXPECTED_FEE_BPS}`, `${bps} bps`);
      } else {
        warn(`feeBps() mismatch`, `got ${bps}, env says ${EXPECTED_FEE_BPS} — check ESCROW_FEE_BPS`);
      }
    }
  } catch {
    warn('feeBps() view', 'not exposed or reverted — skipping');
  }

  // Check RESOLVER_ROLE if we have a resolver address
  if (RESOLVER_ADDRESS && RESOLVER_ADDRESS.length === 42) {
    try {
      const roleCallData = SEL.hasRole
        + RESOLVER_ROLE.replace(/^0x/, '').padStart(64, '0')
        + RESOLVER_ADDRESS.replace(/^0x/, '').padStart(64, '0');
      const roleResult = await ethCall(POOL_ADDRESS, roleCallData);
      if (roleResult && roleResult !== '0x') {
        const hasRole = decodeBool(roleResult);
        if (hasRole) {
          ok('RESOLVER_ROLE assigned', RESOLVER_ADDRESS);
        } else {
          fail('RESOLVER_ROLE NOT assigned', `${RESOLVER_ADDRESS} does not hold RESOLVER_ROLE`);
        }
      }
    } catch {
      warn('RESOLVER_ROLE check', 'hasRole() reverted — contract may not use AccessControl');
    }
  } else {
    warn('RESOLVER_ROLE check', 'ESCROW_RESOLVER_ADDRESS not set — skipping');
  }
}

async function checkUsdc() {
  section(`USDC (ERC-20) — ${USDC_ADDRESS}`);

  const exists = await checkContractCode('USDC', USDC_ADDRESS);
  if (!exists) return;

  // symbol()
  try {
    const symbolResult = await ethCall(USDC_ADDRESS, SEL.symbol);
    const symbol = decodeString(symbolResult);
    if (symbol.toLowerCase().includes('usd')) {
      ok('symbol()', symbol);
    } else {
      warn('symbol()', `unexpected: "${symbol}"`);
    }
  } catch {
    warn('symbol()', 'call reverted');
  }

  // decimals()
  try {
    const decResult = await ethCall(USDC_ADDRESS, SEL.decimals);
    const dec = Number(decodeUint256(decResult));
    if (dec === USDC_DECIMALS) {
      ok('decimals()', String(dec));
    } else {
      fail('decimals()', `expected ${USDC_DECIMALS}, got ${dec}`);
    }
  } catch {
    fail('decimals()', 'call reverted');
  }

  // totalSupply()
  try {
    const supplyResult = await ethCall(USDC_ADDRESS, SEL.totalSupply);
    const supply = decodeUint256(supplyResult);
    ok('totalSupply()', `${formatUsdc(supply)} USDC`);
  } catch {
    warn('totalSupply()', 'call reverted');
  }

  // Pool's USDC balance
  try {
    const balCallData = encodeWithAddress(SEL.balanceOf, POOL_ADDRESS);
    const balResult = await ethCall(USDC_ADDRESS, balCallData);
    const bal = decodeUint256(balResult);
    const balFmt = formatUsdc(bal);
    ok('Pool USDC balance', `${balFmt} USDC`);
  } catch {
    warn('Pool USDC balance', 'balanceOf() reverted');
  }
}

async function checkChainlink() {
  section(`Chainlink BTC/USD Feed — ${CHAINLINK_FEED}`);

  const exists = await checkContractCode('Chainlink feed', CHAINLINK_FEED);
  if (!exists) return;

  // latestRoundData() → (roundId, answer, startedAt, updatedAt, answeredInRound)
  // ABI: returns (uint80,int256,uint256,uint256,uint80)
  // Encoded return: 5 × 32 bytes = 320 hex chars
  try {
    const result = await ethCall(CHAINLINK_FEED, SEL.latestRoundData);
    const raw = result.replace(/^0x/, '');
    if (raw.length < 320) {
      fail('latestRoundData()', `unexpected return length: ${raw.length}`);
      return;
    }
    // Parse fields (each 32 bytes / 64 hex chars)
    const _roundId      = BigInt('0x' + raw.slice(0, 64));
    const answer        = decodeInt256('0x' + raw.slice(64, 128));
    const _startedAt    = BigInt('0x' + raw.slice(128, 192));
    const updatedAt     = BigInt('0x' + raw.slice(192, 256));
    const _answeredRound = BigInt('0x' + raw.slice(256, 320));

    // Chainlink BTC/USD has 8 decimals
    const price = Number(answer) / 1e8;
    const priceFmt = price.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });

    const nowSec = BigInt(Math.floor(Date.now() / 1000));
    const ageSec = Number(nowSec - updatedAt);
    const ageFmt = ageSec < 60 ? `${ageSec}s` : ageSec < 3600 ? `${Math.floor(ageSec / 60)}m` : `${(ageSec / 3600).toFixed(1)}h`;

    ok('BTC/USD price', priceFmt);

    if (ageSec <= CHAINLINK_STALE_SECONDS) {
      ok('Feed freshness', `updated ${ageFmt} ago`);
    } else {
      fail('Feed stale', `last update ${ageFmt} ago (>${CHAINLINK_STALE_SECONDS}s threshold)`);
    }

    if (answer <= 0n) {
      fail('Answer sanity', `price is zero or negative: ${answer}`);
    }
  } catch (err) {
    fail('latestRoundData()', String(err.message || err));
  }

  // decimals()
  try {
    const decResult = await ethCall(CHAINLINK_FEED, SEL.decimals);
    const dec = Number(decodeUint256(decResult));
    ok('decimals()', String(dec));
  } catch {
    warn('decimals()', 'call reverted');
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`\nContract verification — Base Mainnet`);
  console.log(`RPC: ${RPC_URL}`);
  console.log(`Pool: ${POOL_ADDRESS}`);
  console.log(`USDC: ${USDC_ADDRESS}`);
  console.log(`Chainlink BTC/USD: ${CHAINLINK_FEED}`);

  await checkNetwork();
  await checkPariMutuelPool();
  await checkUsdc();
  await checkChainlink();

  console.log('');
  if (failures === 0) {
    console.log(`All checks passed.`);
    process.exit(0);
  } else {
    console.error(`${failures} check(s) failed.`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`\n[FATAL] ${String(err?.message || err)}`);
  process.exit(1);
});
