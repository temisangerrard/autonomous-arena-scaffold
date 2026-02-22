/**
 * Polymarket CLOB client for placing hedge orders on Polygon.
 *
 * When POLYMARKET_HEDGE_ENABLED=true and a player opens a prediction position,
 * the house places a matching FOK market-buy on Polymarket CLOB, offsetting
 * the house's exposure if the player's side wins.
 *
 * Chain: Polygon mainnet (chainId 137)
 * Collateral: USDC.e (6 decimals)
 * Auth: L1 EIP-712 → derive API key once; L2 HMAC per request
 */

import { randomBytes, createHmac } from 'node:crypto';
import { Wallet } from 'ethers';
import { log as rootLog } from '../logger.js';

const log = rootLog.child({ module: 'clob' });

// Polygon mainnet
const CHAIN_ID = 137;

// CTF Exchange contracts on Polygon
const CTF_EXCHANGE = '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E';
const NEG_RISK_CTF_EXCHANGE = '0xC5d563A36AE78145C45a50134d48A1215220f80a';

// ── EIP-712 types ──────────────────────────────────────────────────────────────

/** L1 auth: derive/create API key by signing a typed message */
const AUTH_TYPES = {
  ClobAuth: [
    { name: 'address',   type: 'address' },
    { name: 'timestamp', type: 'string' },
    { name: 'nonce',     type: 'string' },
    { name: 'message',   type: 'string' }
  ]
};

/** CTF Exchange order (same layout for both exchanges) */
const ORDER_TYPES = {
  Order: [
    { name: 'salt',          type: 'uint256' },
    { name: 'maker',         type: 'address' },
    { name: 'signer',        type: 'address' },
    { name: 'taker',         type: 'address' },
    { name: 'tokenId',       type: 'uint256' },
    { name: 'makerAmount',   type: 'uint256' },
    { name: 'takerAmount',   type: 'uint256' },
    { name: 'expiration',    type: 'uint256' },
    { name: 'nonce',         type: 'uint256' },
    { name: 'feeRateBps',    type: 'uint256' },
    { name: 'side',          type: 'uint8' },
    { name: 'signatureType', type: 'uint8' }
  ]
};

// ── Types ──────────────────────────────────────────────────────────────────────

type ClobApiKey = {
  apiKey: string;
  secret: string;
  passphrase: string;
};

type MarketTokens = {
  yesTokenId: string;
  noTokenId: string;
  negRisk: boolean;
};

// ── Client ────────────────────────────────────────────────────────────────────

export class PolymarketClobClient {
  private readonly wallet: Wallet;
  private apiKey: ClobApiKey | null = null;
  /** Cached YES/NO token IDs per oracleMarketId (condition_id) */
  private readonly tokenCache = new Map<string, MarketTokens>();

  constructor(
    private readonly clobBaseUrl: string,
    privateKey: string,
    private readonly hedgeFraction: number
  ) {
    this.wallet = new Wallet(privateKey);
    log.info({ address: this.wallet.address }, '[clob] hedge client initialised');
  }

  // ── L1 Auth ─────────────────────────────────────────────────────────────────

  /**
   * Derive and cache a CLOB API key from the wallet via EIP-712 L1 auth.
   * Idempotent — only calls the network once per process lifetime.
   */
  async ensureApiKey(): Promise<void> {
    if (this.apiKey) return;

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce     = randomBytes(16).toString('hex');
    const message   = 'This message attests that I control the given wallet';

    const sig = await this.wallet.signTypedData(
      { name: 'ClobAuthDomain', version: '1', chainId: CHAIN_ID },
      AUTH_TYPES,
      { address: this.wallet.address, timestamp, nonce, message }
    );

    const res = await fetch(`${this.clobBaseUrl}/auth/derive-api-key`, {
      method: 'GET',
      headers: {
        'POLY_ADDRESS':   this.wallet.address,
        'POLY_SIGNATURE': sig,
        'POLY_TIMESTAMP': timestamp,
        'POLY_NONCE':     nonce
      }
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`[clob] derive-api-key failed ${res.status}: ${body.slice(0, 200)}`);
    }

    const data = await res.json() as { apiKey?: string; secret?: string; passphrase?: string };
    if (!data.apiKey || !data.secret || !data.passphrase) {
      throw new Error('[clob] derive-api-key returned incomplete credentials');
    }

    this.apiKey = { apiKey: data.apiKey, secret: data.secret, passphrase: data.passphrase };
    log.info({ address: this.wallet.address }, '[clob] api key derived');
  }

  // ── L2 Auth headers ─────────────────────────────────────────────────────────

  private l2Headers(method: string, path: string, body = ''): Record<string, string> {
    if (!this.apiKey) throw new Error('[clob] no api key — call ensureApiKey() first');
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const hmacInput = timestamp + method.toUpperCase() + path + body;
    const hmac = createHmac('sha256', this.apiKey.secret)
      .update(hmacInput)
      .digest('base64');
    return {
      'POLY_API_KEY':    this.apiKey.apiKey,
      'POLY_PASSPHRASE': this.apiKey.passphrase,
      'POLY_SIGNATURE':  hmac,
      'POLY_TIMESTAMP':  timestamp
    };
  }

  // ── Token ID lookup ──────────────────────────────────────────────────────────

  /**
   * Fetch the ERC-1155 token ID for a market's YES or NO outcome token.
   * Results are cached per conditionId for the lifetime of the process.
   */
  async getTokenId(conditionId: string, side: 'yes' | 'no'): Promise<string> {
    const cached = this.tokenCache.get(conditionId);
    if (cached) {
      return side === 'yes' ? cached.yesTokenId : cached.noTokenId;
    }

    const res = await fetch(`${this.clobBaseUrl}/markets/${conditionId}`, {
      headers: { 'Accept': 'application/json' }
    });

    if (!res.ok) {
      throw new Error(`[clob] GET /markets/${conditionId} failed ${res.status}`);
    }

    const data = await res.json() as {
      tokens?: Array<{ token_id: string; outcome: string }>;
      neg_risk?: boolean;
    };

    const tokens  = data.tokens ?? [];
    const yesToken = tokens.find((t) => t.outcome.toLowerCase() === 'yes');
    const noToken  = tokens.find((t) => t.outcome.toLowerCase() === 'no');

    if (!yesToken?.token_id || !noToken?.token_id) {
      throw new Error(
        `[clob] missing outcome tokens for conditionId=${conditionId}; ` +
        `got ${JSON.stringify(tokens.map((t) => t.outcome))}`
      );
    }

    const entry: MarketTokens = {
      yesTokenId: yesToken.token_id,
      noTokenId:  noToken.token_id,
      negRisk:    Boolean(data.neg_risk)
    };
    this.tokenCache.set(conditionId, entry);

    return side === 'yes' ? entry.yesTokenId : entry.noTokenId;
  }

  // ── Place hedge order ────────────────────────────────────────────────────────

  /**
   * Place a FOK market-buy order on Polymarket CLOB.
   *
   * @param conditionId - Polymarket condition ID (= oracleMarketId from DB)
   * @param side        - 'yes' or 'no' (same side as the player's bet)
   * @param stakeUsdc   - Player's stake in internal units (1:1 with USDC)
   * @returns orderId and status from the CLOB response
   */
  async placeHedge(
    conditionId: string,
    side: 'yes' | 'no',
    stakeUsdc: number
  ): Promise<{ orderId: string; status: string }> {
    await this.ensureApiKey();

    const tokenId = await this.getTokenId(conditionId, side);
    const cached  = this.tokenCache.get(conditionId);
    const verifyingContract = cached?.negRisk ? NEG_RISK_CTF_EXCHANGE : CTF_EXCHANGE;

    const usdcAmt = Math.floor(stakeUsdc * this.hedgeFraction * 1_000_000);
    if (usdcAmt <= 0) {
      throw new Error(
        `[clob] hedge amount too small: stake=${stakeUsdc} fraction=${this.hedgeFraction} → ${usdcAmt} micro-USDC`
      );
    }

    // Build EIP-712 order
    const domain = {
      name:              'Polymarket CTF Exchange',
      version:           '1',
      chainId:           CHAIN_ID,
      verifyingContract
    };

    const salt = BigInt('0x' + randomBytes(16).toString('hex'));
    const orderValue = {
      salt,
      maker:         this.wallet.address,
      signer:        this.wallet.address,
      taker:         '0x0000000000000000000000000000000000000000',
      tokenId:       BigInt(tokenId),
      makerAmount:   BigInt(usdcAmt),
      takerAmount:   0n,
      expiration:    0n,
      nonce:         0n,
      feeRateBps:    0n,
      side:          0,  // BUY
      signatureType: 0   // EOA
    };

    const signature = await this.wallet.signTypedData(domain, ORDER_TYPES, orderValue);

    // Serialize — CLOB expects string representation of uint256 fields
    const orderBody = {
      order: {
        salt:          salt.toString(),
        maker:         orderValue.maker,
        signer:        orderValue.signer,
        taker:         orderValue.taker,
        tokenId,
        makerAmount:   usdcAmt.toString(),
        takerAmount:   '0',
        expiration:    '0',
        nonce:         '0',
        feeRateBps:    '0',
        side:          '0',
        signatureType: '0',
        signature
      },
      owner:     this.wallet.address,
      orderType: 'FOK'
    };

    const bodyStr = JSON.stringify(orderBody);
    const l2      = this.l2Headers('POST', '/order', bodyStr);

    const res = await fetch(`${this.clobBaseUrl}/order`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', ...l2 },
      body:    bodyStr
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`[clob] POST /order failed ${res.status}: ${text.slice(0, 300)}`);
    }

    const result = await res.json() as {
      orderID?:  string;
      status?:   string;
      errorMsg?: string;
    };

    if (result.errorMsg) {
      throw new Error(`[clob] order rejected: ${result.errorMsg}`);
    }

    const orderId = result.orderID ?? 'unknown';
    const status  = result.status  ?? 'submitted';

    log.info({
      conditionId,
      side,
      usdcAmt,
      orderId,
      status
    }, '[clob] hedge placed');

    return { orderId, status };
  }
}
