/**
 * Cryptography utilities for the agent runtime
 * Extracted from index.ts to improve modularity
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { Wallet } from 'ethers';

/**
 * Create an encryption key from a passphrase
 */
export function createEncryptionKey(passphrase: string): Buffer {
  return createHash('sha256')
    .update(passphrase)
    .digest();
}

/**
 * Encrypt a secret using AES-256-GCM
 * Format: iv:tag:ciphertext (all hex-encoded)
 */
export function encryptSecret(raw: string, encryptionKey: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv);
  const encrypted = Buffer.concat([cipher.update(raw, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypt a secret using AES-256-GCM
 */
export function decryptSecret(encrypted: string, encryptionKey: Buffer): string {
  const [ivHex, tagHex, payloadHex] = encrypted.split(':');
  if (!ivHex || !tagHex || !payloadHex) {
    return '';
  }

  const decipher = createDecipheriv('aes-256-gcm', encryptionKey, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(payloadHex, 'hex')),
    decipher.final()
  ]);

  return plaintext.toString('utf8');
}

/**
 * Simple string hash function (djb2-style)
 */
export function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash;
}

/**
 * SHA-256 hash of input string
 */
export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Generate a new random private key
 */
export function newPrivateKey(): string {
  return `0x${randomBytes(32).toString('hex')}`;
}

/**
 * Derive address from private key
 */
export function addressFromPrivateKey(privateKey: string, WalletClass?: typeof Wallet): string {
  try {
    // Dynamic import to avoid circular dependencies
    if (!WalletClass) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { Wallet: W } = require('ethers');
      WalletClass = W;
    }
    if (!WalletClass) {
      return `0x${randomBytes(20).toString('hex')}`;
    }
    return new WalletClass(privateKey).address;
  } catch {
    return `0x${randomBytes(20).toString('hex')}`;
  }
}

/**
 * Redact sensitive values from strings (API keys, private keys, etc.)
 */
export function redactSecrets(input: string): string {
  return input
    .replace(/sk-[A-Za-z0-9_-]{10,}/g, 'sk-***')
    .replace(/sk-or-v1-[A-Za-z0-9_-]{10,}/g, 'sk-or-v1-***')
    .replace(/0x[a-fA-F0-9]{64}/g, '0x***')
    .replace(/(authorization\s*:\s*bearer\s+)[A-Za-z0-9._-]+/gi, '$1***');
}

/**
 * Generate a pseudo transaction hash for runtime escrow operations
 */
export function pseudoTxHash(kind: 'lock' | 'resolve' | 'refund', challengeId: string): string {
  const salt = randomBytes(8).toString('hex');
  const hash = createHash('sha256').update(`${kind}:${challengeId}:${Date.now()}:${salt}`).digest('hex');
  return `0x${hash}`;
}

/**
 * Create internal service token from a private key
 */
export function createInternalTokenFromKey(privateKey: string): string {
  const trimmed = privateKey.trim();
  if (!trimmed) {
    return '';
  }
  return `sa_${createHash('sha256').update(trimmed).digest('hex')}`;
}
