#!/usr/bin/env npx tsx
/**
 * Database Migration CLI
 * 
 * Usage:
 *   npm run migrate                 # Run pending migrations
 *   npm run migrate:status          # Show migration status
 *   npm run migrate:rollback [n]    # Rollback last n migrations (default: 1)
 *   npm run migrate:reset           # Rollback all migrations
 */

import { createPool, type Pool } from 'pg';
import { MIGRATIONS, runMigrations, rollbackMigrations, getMigrationStatus, type PgPool } from '../apps/server/src/migrations/index.js';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error('ERROR: DATABASE_URL environment variable is required');
  process.exit(1);
}

async function createDbPool(): Promise<Pool> {
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000
  });

  // Test connection
  try {
    await pool.query('SELECT 1');
    console.log('✓ Connected to database');
  } catch (error) {
    console.error('✗ Failed to connect to database:', error);
    throw error;
  }

  return pool;
}

function poolToPgPool(pool: Pool): PgPool {
  return {
    query: async (text: string, values?: unknown[]) => {
      const result = await pool.query(text, values);
      return { rows: result.rows as Record<string, unknown>[] };
    },
    end: async () => {
      await pool.end();
    }
  };
}

async function main(): Promise<void> {
  const command = process.argv[2] || 'up';
  const pool = await createDbPool();
  const pgPool = poolToPgPool(pool);

  try {
    switch (command) {
      case 'up':
      case 'migrate':
        console.log('\n📋 Running pending migrations...\n');
        const upResult = await runMigrations(pgPool);
        
        if (upResult.applied > 0) {
          console.log(`\n✓ Applied ${upResult.applied} migration(s):`);
          for (const version of upResult.versions) {
            const migration = MIGRATIONS.find(m => m.version === version);
            console.log(`  - v${version}: ${migration?.name || 'unknown'}`);
          }
        } else {
          console.log('\n✓ No pending migrations');
        }
        
        if (upResult.errors.length > 0) {
          console.log('\n✗ Errors occurred:');
          for (const error of upResult.errors) {
            console.log(`  - v${error.version}: ${error.error}`);
          }
          process.exit(1);
        }
        break;

      case 'status':
        console.log('\n📊 Migration Status\n');
        const status = await getMigrationStatus(pgPool);
        
        console.log(`Current version: ${status.currentVersion}`);
        console.log(`Total migrations defined: ${MIGRATIONS.length}`);
        
        if (status.appliedMigrations.length > 0) {
          console.log('\nApplied migrations:');
          for (const m of status.appliedMigrations) {
            console.log(`  ✓ v${m.version}: ${m.name} (${m.appliedAt || 'unknown date'})`);
          }
        }
        
        if (status.pendingMigrations.length > 0) {
          console.log('\nPending migrations:');
          for (const m of status.pendingMigrations) {
            console.log(`  ○ v${m.version}: ${m.name}`);
          }
        } else {
          console.log('\n✓ No pending migrations');
        }
        break;

      case 'rollback':
        const steps = parseInt(process.argv[3] || '1', 10);
        console.log(`\n⏪ Rolling back ${steps} migration(s)...\n`);
        
        const rollbackResult = await rollbackMigrations(pgPool, steps);
        
        if (rollbackResult.rolledBack > 0) {
          console.log(`\n✓ Rolled back ${rollbackResult.rolledBack} migration(s):`);
          for (const version of rollbackResult.versions) {
            const migration = MIGRATIONS.find(m => m.version === version);
            console.log(`  - v${version}: ${migration?.name || 'unknown'}`);
          }
        } else {
          console.log('\n✓ No migrations to rollback');
        }
        
        if (rollbackResult.errors.length > 0) {
          console.log('\n✗ Errors occurred:');
          for (const error of rollbackResult.errors) {
            console.log(`  - v${error.version}: ${error.error}`);
          }
          process.exit(1);
        }
        break;

      case 'reset':
        console.log('\n⏪ Rolling back all migrations...\n');
        
        const resetResult = await rollbackMigrations(pgPool, MIGRATIONS.length);
        
        if (resetResult.rolledBack > 0) {
          console.log(`\n✓ Rolled back ${resetResult.rolledBack} migration(s)`);
        } else {
          console.log('\n✓ No migrations to rollback');
        }
        
        if (resetResult.errors.length > 0) {
          console.log('\n✗ Errors occurred:');
          for (const error of resetResult.errors) {
            console.log(`  - v${error.version}: ${error.error}`);
          }
          process.exit(1);
        }
        break;

      case 'help':
      case '--help':
      case '-h':
        console.log(`
Database Migration CLI

Usage:
  npm run migrate                 Run pending migrations
  npm run migrate:status          Show migration status
  npm run migrate:rollback [n]    Rollback last n migrations (default: 1)
  npm run migrate:reset           Rollback all migrations

Environment:
  DATABASE_URL                    PostgreSQL connection string (required)

Examples:
  DATABASE_URL=postgres://... npm run migrate
  DATABASE_URL=postgres://... npm run migrate:status
  DATABASE_URL=postgres://... npm run migrate:rollback 2
        `);
        break;

      default:
        console.error(`Unknown command: ${command}`);
        console.log('Run "npm run migrate help" for usage information');
        process.exit(1);
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Migration failed:', error);
  process.exit(1);
});