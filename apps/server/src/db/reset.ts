/**
 * Test-only helper: `TRUNCATE` every Memind-owned table with
 * `RESTART IDENTITY CASCADE`. Called from `beforeEach` in store integration
 * tests so each case starts with an empty database without having to drop
 * the container.
 *
 * Guards against accidental production use: refuses to run unless
 * `NODE_ENV=test` OR `ALLOW_DB_RESET=true`. A misfired `TRUNCATE` on
 * Railway would wipe Ch12 evidence mid-demo.
 */
import type { Pool } from 'pg';

const MEMIND_TABLES = [
  'lore_chapters',
  'anchor_ledger',
  'shill_orders',
  'heartbeat_sessions',
  'artifacts',
] as const;

/**
 * Wipe every Memind table and restart identity sequences. Single SQL
 * statement so the whole reset is atomic.
 */
export async function resetDb(pool: Pool, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  if (env.NODE_ENV !== 'test' && env.ALLOW_DB_RESET !== 'true') {
    throw new Error(
      '[db] resetDb refused: NODE_ENV must be "test" (or set ALLOW_DB_RESET=true) to run TRUNCATE',
    );
  }
  const tableList = MEMIND_TABLES.join(', ');
  await pool.query(`TRUNCATE ${tableList} RESTART IDENTITY CASCADE`);
}
