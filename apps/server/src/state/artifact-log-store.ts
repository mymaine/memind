/**
 * ArtifactLogStore — append-only log of every artifact emitted through the
 * SSE bus. Ch12 evidence hydration reads the latest N rows to seed the UI
 * before any live run has happened, which is what makes the Memind demo
 * restart-resilient.
 *
 * Two backends, one interface:
 *   - pg-backed (production / local docker) — writes through a partial
 *     unique index on `natural_key` so immutable kinds dedupe and mutable
 *     kinds (`shill-order`, `lore-anchor`, `meme-image`) upsert.
 *   - memory fallback (STATE_BACKEND=memory) — bounded ring buffer of 200
 *     entries, mirrors the same natural-key semantics so rollback to memory
 *     does not change observable behaviour apart from persistence.
 *
 * Writes are fire-and-forget from the SSE hot path (see
 * `runs/store.ts#pushArtifact`). Failures only warn-log; we never fail a
 * live Creator / Shiller / Heartbeat run because a DB round-trip drops.
 */
import type { Pool } from 'pg';
import type { Artifact } from '@hack-fourmeme/shared';
import { artifactConflictStrategy, artifactSchema, deriveNaturalKey } from '@hack-fourmeme/shared';

export interface ArtifactLogStoreOptions {
  /**
   * Optional pg pool. When omitted the store runs on the memory ring
   * buffer — used when `STATE_BACKEND=memory` is set or when callers
   * (unit tests) want an isolated in-memory instance.
   */
  pool?: Pool | undefined;
  /** Override the ring-buffer cap. Defaults to 200. */
  memoryBufferSize?: number;
}

const DEFAULT_MEMORY_BUFFER_SIZE = 200;

export class ArtifactLogStore {
  private readonly pool: Pool | undefined;
  private readonly memoryBuffer: Artifact[] = [];
  private readonly memoryKeyIndex = new Map<string, number>();
  private readonly memoryBufferSize: number;

  constructor(options: ArtifactLogStoreOptions = {}) {
    this.pool = options.pool;
    this.memoryBufferSize = options.memoryBufferSize ?? DEFAULT_MEMORY_BUFFER_SIZE;
  }

  /**
   * Persist an artifact. `runId` is optional and only serves as a breadcrumb
   * for later forensic queries. When `natural_key` resolves to null the row
   * is always inserted; when it is non-null, the conflict strategy
   * derived from `artifactConflictStrategy` decides DO UPDATE vs DO NOTHING.
   */
  async append(artifact: Artifact, runId?: string): Promise<void> {
    const naturalKey = deriveNaturalKey(artifact);
    const strategy = artifactConflictStrategy(artifact);

    if (this.pool !== undefined) {
      await this.appendPg(artifact, naturalKey, strategy, runId);
      return;
    }
    this.appendMemory(artifact, naturalKey, strategy);
  }

  /**
   * Return the most recent `limit` artifacts in `created_at DESC` order.
   * The limit is clamped at 100 because the Ch12 UI only renders 5 per tab;
   * larger values just cost context window in the JSON payload.
   */
  async listRecent(limit: number): Promise<Artifact[]> {
    const clamped = Math.min(Math.max(Math.floor(limit), 1), 100);
    if (this.pool !== undefined) {
      const { rows } = await this.pool.query<{ payload: unknown }>(
        `SELECT payload FROM artifacts ORDER BY created_at DESC LIMIT $1`,
        [clamped],
      );
      const out: Artifact[] = [];
      for (const row of rows) {
        const parsed = artifactSchema.safeParse(row.payload);
        if (parsed.success) {
          out.push(parsed.data);
        } else {
          console.warn('[artifacts] listRecent dropped invalid row', parsed.error.issues);
        }
      }
      return out;
    }
    // Memory backend: newest-last insertion → reverse for DESC.
    return [...this.memoryBuffer].reverse().slice(0, clamped);
  }

  /**
   * Test-only wipe. pg backend truncates `artifacts`; memory backend drops
   * the ring buffer. Production code should never call this — `resetDb` in
   * `db/reset.ts` already handles integration-test cleanup.
   */
  async clear(): Promise<void> {
    if (this.pool !== undefined) {
      await this.pool.query(`TRUNCATE artifacts RESTART IDENTITY`);
      return;
    }
    this.memoryBuffer.length = 0;
    this.memoryKeyIndex.clear();
  }

  private async appendPg(
    artifact: Artifact,
    naturalKey: string | null,
    strategy: ReturnType<typeof artifactConflictStrategy>,
    runId?: string,
  ): Promise<void> {
    const kind = artifact.kind;
    const payload = artifact as unknown; // jsonb column accepts any shape
    if (strategy === 'no-key' || naturalKey === null) {
      await this.pool!.query(
        `INSERT INTO artifacts (kind, run_id, natural_key, payload)
         VALUES ($1, $2, NULL, $3::jsonb)`,
        [kind, runId ?? null, JSON.stringify(payload)],
      );
      return;
    }
    if (strategy === 'do-update') {
      // `ON CONFLICT (col) WHERE predicate` targets the partial unique index
      // `idx_artifacts_natural_key` (which is declared `WHERE natural_key IS
      // NOT NULL`). pg requires the predicate to match the index definition
      // exactly, otherwise the planner rejects with "no unique or exclusion
      // constraint matching the ON CONFLICT specification".
      await this.pool!.query(
        `INSERT INTO artifacts (kind, run_id, natural_key, payload)
         VALUES ($1, $2, $3, $4::jsonb)
         ON CONFLICT (natural_key) WHERE natural_key IS NOT NULL
         DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()`,
        [kind, runId ?? null, naturalKey, JSON.stringify(payload)],
      );
      return;
    }
    // do-nothing — immutable kinds. Duplicate inserts are silently swallowed.
    await this.pool!.query(
      `INSERT INTO artifacts (kind, run_id, natural_key, payload)
       VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (natural_key) WHERE natural_key IS NOT NULL DO NOTHING`,
      [kind, runId ?? null, naturalKey, JSON.stringify(payload)],
    );
  }

  private appendMemory(
    artifact: Artifact,
    naturalKey: string | null,
    strategy: ReturnType<typeof artifactConflictStrategy>,
  ): void {
    if (strategy !== 'no-key' && naturalKey !== null) {
      const existing = this.memoryKeyIndex.get(naturalKey);
      if (existing !== undefined) {
        if (strategy === 'do-update') {
          this.memoryBuffer[existing] = artifact;
        }
        // do-nothing: leave the original row intact; no-op on repeat.
        return;
      }
    }
    this.memoryBuffer.push(artifact);
    if (naturalKey !== null) {
      this.memoryKeyIndex.set(naturalKey, this.memoryBuffer.length - 1);
    }
    // Enforce ring-buffer size: drop the oldest row + rebuild the index.
    while (this.memoryBuffer.length > this.memoryBufferSize) {
      this.memoryBuffer.shift();
      this.memoryKeyIndex.clear();
      for (let i = 0; i < this.memoryBuffer.length; i += 1) {
        const entry = this.memoryBuffer[i];
        if (entry === undefined) continue;
        const key = deriveNaturalKey(entry);
        if (key !== null) this.memoryKeyIndex.set(key, i);
      }
    }
  }
}
