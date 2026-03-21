import { describe, expect, test } from 'vitest';
import {
  canonicalRequestFor,
  persistWorldResponse,
  normalizeWorldKey,
  worldKeyFromUrl
} from '../public/sw-world-cache.js';

describe('world cache service worker helpers', () => {
  test('tracks shell and zone bundles independently', () => {
    expect(normalizeWorldKey('mega-shell.glb')).toBe('mega-shell.glb');
    expect(normalizeWorldKey('mega-zone-plaza.glb')).toBe('mega-zone-plaza.glb');
    expect(normalizeWorldKey('mega-decor-skyline.glb')).toBe('mega-decor-skyline.glb');
  });

  test('builds canonical cache requests by stripping version query only', () => {
    const url = new URL('https://arena.example/assets/world/mega-zone-plaza.glb?v=zone-v2');
    const request = new Request(url.toString());
    const canonical = canonicalRequestFor(url, request);

    expect(canonical.url).toBe('https://arena.example/assets/world/mega-zone-plaza.glb');
    expect(worldKeyFromUrl(new URL(canonical.url))).toBe('mega-zone-plaza.glb');
  });

  test('does not fail world loads when cache persistence throws', async () => {
    const response = new Response('world-binary', { status: 200 });
    const result = await persistWorldResponse({
      cache: {
        put: async () => {
          throw new Error('cache write failed');
        }
      },
      canonicalRequest: new Request('https://arena.example/assets/world/mega-world.glb'),
      network: response,
      key: 'mega-world.glb',
      touch: async () => {},
      enforce: async () => {}
    });

    expect(result).toBe(false);
  });
});
