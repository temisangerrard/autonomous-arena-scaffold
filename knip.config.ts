import type { KnipConfig } from 'knip';

const config: KnipConfig = {
  workspaces: {
    '.': {
      entry: ['scripts/*.ts', 'scripts/*.mjs', 'scripts/*.js'],
      ignore: ['scripts/*.sh', 'scripts/e2e/**'],
      // Scripts use packages hoisted from workspace members
      ignoreDependencies: ['pg', 'playwright', 'ws'],
    },
    'apps/agent-runtime': {
      entry: ['src/index.ts'],
    },
    'apps/server': {
      entry: ['src/index.ts'],
      // ESLint tools are used at root level; pino-pretty is a dynamic pino transport
      ignoreDependencies: ['@eslint/js', 'typescript-eslint', 'pino-pretty'],
    },
    'apps/web': {
      entry: ['src/server.ts', 'public/js/**/*.js', 'public/runtime-config.js', 'public/sw-world-cache.js'],
      // three is loaded via CDN globals; pino-pretty is a dynamic pino transport
      ignoreDependencies: ['three', 'pino-pretty'],
    },
    'packages/shared': {
      entry: ['src/index.ts'],
    },
    'packages/sdk': {
      entry: ['src/index.ts'],
    },
  },
  ignore: [
    'apps/contracts/**',
    '**/*.test.ts',
    '**/*.test.js',
    '**/*.spec.ts',
    '**/*.spec.js',
  ],
  ignoreDependencies: ['hardhat'],
};

export default config;
