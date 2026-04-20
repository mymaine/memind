/**
 * Postgres connection pool singleton.
 *
 * Every store (`LoreStore`, `AnchorLedger`, `ShillOrderStore`,
 * `HeartbeatSessionStore`, `ArtifactLogStore`) goes through this pool — one
 * process, one pool, so Railway's single-replica Postgres plan does not run
 * out of connections. Native `pg` only; we deliberately avoid ORMs or
 * migration frameworks (`CREATE TABLE IF NOT EXISTS` at boot is enough for
 * the hackathon demo envelope).
 *
 * Environment contract:
 *   - `DATABASE_URL` (required; `postgres://...`)
 *   - `TEST_DATABASE_URL` (optional override when `NODE_ENV=test`)
 *   - `PG_POOL_MAX` (optional, defaults to `5`)
 *
 * SSL auto-sensing: Railway's DATABASE_URL carries `sslmode=require`. When
 * that parameter is present we enable `ssl: { rejectUnauthorized: false }`
 * so the pool negotiates TLS. Local dev against docker-compose has plain
 * TCP and the flag is absent.
 */
import { Pool } from 'pg';
import type { PoolConfig } from 'pg';

/** Default pool size when `PG_POOL_MAX` is unset. Conservative for Railway Hobby. */
export const DEFAULT_PG_POOL_MAX = 5;

/**
 * Resolve the `DATABASE_URL` for the current environment. Tests prefer
 * `TEST_DATABASE_URL` when set so CI can point at a disposable database
 * without disturbing local dev's pinned container. Production only ever
 * reads `DATABASE_URL`.
 */
export function resolveDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (env.NODE_ENV === 'test') {
    const testUrl = env.TEST_DATABASE_URL?.trim();
    if (testUrl !== undefined && testUrl !== '') return testUrl;
  }
  const url = env.DATABASE_URL?.trim();
  if (url === undefined || url === '') return undefined;
  return url;
}

function resolvePoolMax(env: NodeJS.ProcessEnv): number {
  const raw = env.PG_POOL_MAX?.trim();
  if (raw === undefined || raw === '') return DEFAULT_PG_POOL_MAX;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_PG_POOL_MAX;
  return parsed;
}

function shouldUseSsl(connectionString: string): boolean {
  // `URL` tolerates postgres:// schemes even though the WHATWG URL spec does
  // not formally recognise them; the query parameters still parse correctly.
  try {
    const url = new URL(connectionString);
    const sslmode = url.searchParams.get('sslmode');
    return sslmode !== null && sslmode !== 'disable' && sslmode !== 'allow';
  } catch {
    return false;
  }
}

/**
 * Create a new pg `Pool`. Exported for testability — `createPool()` is the
 * constructor that `ensureSchema` tests inject their own `Pool` with.
 * Production code uses `getPool()` below.
 */
export function createPool(env: NodeJS.ProcessEnv = process.env): Pool {
  const url = resolveDatabaseUrl(env);
  if (url === undefined) {
    throw new Error(
      '[db] DATABASE_URL missing. Set it to the Postgres connection string (e.g. postgres://memind:memind@localhost:5432/memind). Runtime requires a live database — there is no memory fallback.',
    );
  }
  const max = resolvePoolMax(env);
  const config: PoolConfig = {
    connectionString: url,
    max,
  };
  if (shouldUseSsl(url)) {
    // Railway's managed Postgres issues a self-signed cert behind their
    // ingress; `rejectUnauthorized: false` is the project-wide convention
    // for x402 + facilitator + here. Hobby-plan workload, not security-
    // critical egress.
    config.ssl = { rejectUnauthorized: false };
  }
  return new Pool(config);
}

let cached: Pool | undefined;

/**
 * Process-wide singleton. The first call constructs the pool; subsequent
 * calls return the same instance so every store shares one connection
 * budget. Tests that need isolation call `createPool()` directly and pass
 * the result to each store constructor.
 */
export function getPool(env: NodeJS.ProcessEnv = process.env): Pool {
  if (cached === undefined) {
    cached = createPool(env);
  }
  return cached;
}

/**
 * Reset the cached singleton. Test-only; production never hot-swaps the pool.
 */
export function resetPoolForTests(): void {
  cached = undefined;
}

/**
 * Emit the startup log line documented in the spec:
 *   `[db] pool max=<N>, server max_connections=<SHOW max_connections>`
 * Runs one `SHOW max_connections` round-trip; failures downgrade to a warn
 * log so a slow Railway boot never blocks `app.listen`.
 */
export async function logPoolSummary(pool: Pool): Promise<void> {
  const max = (pool.options as { max?: number } | undefined)?.max ?? DEFAULT_PG_POOL_MAX;
  try {
    const { rows } = await pool.query<{ max_connections: string }>('SHOW max_connections');
    const serverMax = rows[0]?.max_connections ?? '?';
    console.info(`[db] pool max=${String(max)}, server max_connections=${serverMax}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[db] pool max=${String(max)}, SHOW max_connections failed: ${message}`);
  }
}
