import { describe, expect, it } from 'vitest';
import {
  appendBuilderCodeSuffix,
  resolveBuilderCodeContext
} from './builderCode.js';

describe('builderCode', () => {
  it('resolves default builder code context', () => {
    const ctx = resolveBuilderCodeContext({});
    expect(ctx.code).toBe('bc_uukadkll');
    expect(ctx.suffixHex.startsWith('0x')).toBe(true);
    expect(ctx.enabled).toBe(true);
  });

  it('appends suffix to calldata', () => {
    const suffix = '0xdeadbeef';
    const out = appendBuilderCodeSuffix('0xabcdef', suffix);
    expect(out).toBe('0xabcdefdeadbeef');
  });

  it('uses suffix as payload for empty calldata', () => {
    const suffix = '0xdeadbeef';
    const out = appendBuilderCodeSuffix('0x', suffix);
    expect(out).toBe(suffix);
  });

  it('does not double-append the suffix', () => {
    const suffix = '0xdeadbeef';
    const once = appendBuilderCodeSuffix('0xabcdef', suffix);
    const twice = appendBuilderCodeSuffix(once, suffix);
    expect(twice).toBe(once);
  });
});

