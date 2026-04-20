/**
 * Schema bootstrap — one `ensureSchema(pool)` call runs every
 * `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS` statement the
 * five stores rely on, plus a "running = false" reset on the heartbeat
 * sessions table. Fully idempotent, so first deploy = "migration complete"
 * and subsequent deploys no-op.
 *
 * Single-replica constraint: none of the statements below are wrapped in a
 * `pg_advisory_lock`, so two servers booting against the same database can
 * race on DDL. `docs/runbooks/railway-deploy.md` locks replicas to 1 until
 * we add the lock.
 */
import type { Pool } from 'pg';

const SCHEMA_SQL = [
  // ─── lore_chapters (LoreStore) ──────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS lore_chapters (
    token_addr TEXT NOT NULL,
    chapter_number INT NOT NULL CHECK (chapter_number > 0),
    payload JSONB NOT NULL,
    published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (token_addr, chapter_number)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_lore_chapters_latest
    ON lore_chapters (token_addr, chapter_number DESC)`,

  // ─── anchor_ledger (AnchorLedger) ───────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS anchor_ledger (
    anchor_id TEXT PRIMARY KEY,
    token_addr TEXT NOT NULL,
    chapter_number INT NOT NULL,
    payload JSONB NOT NULL,
    inserted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_anchor_ledger_token
    ON anchor_ledger (token_addr, inserted_at ASC)`,

  // ─── shill_orders (ShillOrderStore) ────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS shill_orders (
    order_id TEXT PRIMARY KEY,
    target_token_addr TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('queued','processing','done','failed')),
    payload JSONB NOT NULL,
    ts TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_shill_orders_status_ts
    ON shill_orders (status, ts ASC)`,
  `CREATE INDEX IF NOT EXISTS idx_shill_orders_token
    ON shill_orders (target_token_addr, ts ASC)`,

  // ─── heartbeat_sessions (HeartbeatSessionStore) ────────────────────────
  `CREATE TABLE IF NOT EXISTS heartbeat_sessions (
    token_addr TEXT PRIMARY KEY,
    payload JSONB NOT NULL,
    running BOOLEAN NOT NULL,
    started_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,

  // ─── artifacts (ArtifactLogStore — new) ─────────────────────────────────
  `CREATE TABLE IF NOT EXISTS artifacts (
    id BIGSERIAL PRIMARY KEY,
    kind TEXT NOT NULL,
    run_id TEXT,
    natural_key TEXT,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_artifacts_created_at
    ON artifacts (created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_artifacts_kind ON artifacts (kind)`,
  `CREATE INDEX IF NOT EXISTS idx_artifacts_run_id ON artifacts (run_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_artifacts_natural_key
    ON artifacts (natural_key) WHERE natural_key IS NOT NULL`,
];

/**
 * Run every `CREATE TABLE IF NOT EXISTS` + index in order, then reset any
 * lingering `heartbeat_sessions.running=true` rows so the UI never shows
 * a "running" loop whose timer died with the previous process.
 *
 * Designed to be called exactly once at server boot, before `app.listen`.
 * Idempotent — safe to call again after a crash-and-restart.
 */
export async function ensureSchema(pool: Pool): Promise<void> {
  for (const stmt of SCHEMA_SQL) {
    await pool.query(stmt);
  }
  // Heartbeat restart semantics (see spec): redeploy never auto-resumes a
  // timer, so any row where `running=true` is a ghost from the previous
  // process. Flip it back to false both in the mirror column and inside
  // the jsonb snapshot so `get()` / `list()` reads reflect reality.
  await pool.query(
    `UPDATE heartbeat_sessions
       SET running = false,
           payload = jsonb_set(payload, '{running}', 'false'::jsonb),
           updated_at = now()
     WHERE running = true`,
  );
}
