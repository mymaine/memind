/**
 * ShillOrderStore — shill-order queue and state machine, backed by Postgres
 * with an in-memory fallback for `STATE_BACKEND=memory`.
 *
 * Sits between the x402 `/shill/:tokenAddr` endpoint (producer) and the
 * Shiller agent tick (consumer). States flow:
 *
 *   queued ─ pullPending() / pullById() ─► processing ─ markDone / markFailed ─► done | failed
 *
 * `pullPending()` and `pullById()` flip state atomically so a single queued
 * order cannot be handed to two consecutive ticks — duplicate tweets for
 * one paid order would be worse than a lost one. Both implementations use
 * a single SQL `UPDATE ... WHERE status = 'queued' RETURNING payload` so
 * the race between two tick scanners is resolved by the database itself.
 *
 * Address normalization mirrors LoreStore: every write lowercases
 * `targetTokenAddr`, every query lowercases its input.
 *
 * Single responsibility: state transitions + lookups only. x402 settlement,
 * X API posting, and persistence of the tweet belong elsewhere.
 */
import type { Pool } from 'pg';

/**
 * Sentinel tx hash written at enqueue time, replaced by `recordSettlement`
 * once the x402 middleware finalises the response and the real on-chain
 * settlement hash becomes available. Exported so the x402 handler and the
 * store's settlement-update SQL both reference the same literal and can
 * never drift.
 */
export const PENDING_PAID_TX_HASH = `0x${'0'.repeat(64)}`;

/** 0x-prefixed 32-byte EVM tx hash. */
const TX_HASH_PATTERN = /^0x[a-fA-F0-9]{64}$/;

export type ShillOrderStatus = 'queued' | 'processing' | 'done' | 'failed';

export interface ShillOrderEntry {
  /** Unique identifier, supplied by the producing x402 handler. */
  orderId: string;
  /** 0x-prefixed lowercase EVM address of the token being shilled. */
  targetTokenAddr: string;
  /** Optional creator-supplied free-text brief. */
  creatorBrief?: string;
  /** Base Sepolia tx hash that paid for this order. */
  paidTxHash: string;
  /** Decimal-encoded USDC amount (string to avoid float drift). */
  paidAmountUsdc: string;
  /** Current position in the state machine. */
  status: ShillOrderStatus;
  /** ISO 8601 timestamp assigned at enqueue time. */
  ts: string;
  /** Numeric tweet id returned by X API, populated once markDone runs. */
  tweetId?: string;
  /** Public tweet URL, populated once markDone runs. */
  tweetUrl?: string;
  /** Human-readable failure reason, populated once markFailed runs. */
  errorMessage?: string;
}

export interface EnqueueInput {
  orderId: string;
  targetTokenAddr: string;
  creatorBrief?: string;
  paidTxHash: string;
  paidAmountUsdc: string;
  ts: string;
}

export interface ShillOrderStoreOptions {
  pool?: Pool | undefined;
}

export class ShillOrderStore {
  private readonly pool: Pool | undefined;
  private readonly orders = new Map<string, ShillOrderEntry>();

  constructor(options: ShillOrderStoreOptions = {}) {
    this.pool = options.pool;
  }

  /**
   * Create a new queued order. Throws on orderId collision so a retrying
   * producer cannot silently overwrite an in-flight order.
   */
  async enqueue(input: EnqueueInput): Promise<ShillOrderEntry> {
    const entry: ShillOrderEntry = {
      orderId: input.orderId,
      targetTokenAddr: normaliseAddr(input.targetTokenAddr),
      ...(input.creatorBrief !== undefined ? { creatorBrief: input.creatorBrief } : {}),
      paidTxHash: input.paidTxHash,
      paidAmountUsdc: input.paidAmountUsdc,
      status: 'queued',
      ts: input.ts,
    };
    if (this.pool !== undefined) {
      const { rowCount } = await this.pool.query(
        `INSERT INTO shill_orders (order_id, target_token_addr, status, payload, ts)
         VALUES ($1, $2, 'queued', $3::jsonb, $4)
         ON CONFLICT (order_id) DO NOTHING`,
        [entry.orderId, entry.targetTokenAddr, JSON.stringify(entry), entry.ts],
      );
      if (rowCount === 0) {
        throw new Error(`orderId conflict: ${entry.orderId}`);
      }
      return { ...entry };
    }
    if (this.orders.has(input.orderId)) {
      throw new Error(`orderId conflict: ${input.orderId}`);
    }
    this.orders.set(entry.orderId, entry);
    return { ...entry };
  }

  /**
   * Return every currently-queued order, sorted by enqueue timestamp
   * ascending, and atomically transition each to `processing` so the next
   * tick sees an empty queue.
   */
  async pullPending(): Promise<ShillOrderEntry[]> {
    if (this.pool !== undefined) {
      const { rows } = await this.pool.query<{ payload: ShillOrderEntry }>(
        `UPDATE shill_orders
           SET status = 'processing',
               payload = jsonb_set(payload, '{status}', '"processing"'::jsonb),
               updated_at = now()
         WHERE status = 'queued'
         RETURNING payload`,
      );
      const pulled = rows
        .map((r) => r.payload)
        .sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0))
        .map((e) => ({ ...e, status: 'processing' as const }));
      return pulled;
    }
    const pending: ShillOrderEntry[] = [];
    for (const entry of this.orders.values()) {
      if (entry.status === 'queued') pending.push(entry);
    }
    pending.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
    for (const entry of pending) {
      entry.status = 'processing';
    }
    return pending.map((e) => ({ ...e }));
  }

  /**
   * Single-order variant of `pullPending`. Atomically flip one queued
   * order to `processing` and return it. Returns undefined when the order
   * does not exist or is not currently queued.
   */
  async pullById(orderId: string): Promise<ShillOrderEntry | undefined> {
    if (this.pool !== undefined) {
      const { rows } = await this.pool.query<{ payload: ShillOrderEntry }>(
        `UPDATE shill_orders
           SET status = 'processing',
               payload = jsonb_set(payload, '{status}', '"processing"'::jsonb),
               updated_at = now()
         WHERE order_id = $1 AND status = 'queued'
         RETURNING payload`,
        [orderId],
      );
      const payload = rows[0]?.payload;
      if (payload === undefined) return undefined;
      return { ...payload, status: 'processing' };
    }
    const entry = this.orders.get(orderId);
    if (!entry || entry.status !== 'queued') return undefined;
    entry.status = 'processing';
    return { ...entry };
  }

  /**
   * Transition a processing order to `done` and record its tweet metadata.
   * Throws if the order does not exist or is in an unexpected state.
   */
  async markDone(
    orderId: string,
    meta: { tweetId: string; tweetUrl: string },
  ): Promise<ShillOrderEntry> {
    if (this.pool !== undefined) {
      const { rows } = await this.pool.query<{ payload: ShillOrderEntry }>(
        `UPDATE shill_orders
           SET status = 'done',
               payload = jsonb_set(
                  jsonb_set(
                    jsonb_set(payload, '{status}', '"done"'::jsonb),
                    '{tweetId}', to_jsonb($2::text)
                  ),
                  '{tweetUrl}', to_jsonb($3::text)
                ),
               updated_at = now()
         WHERE order_id = $1 AND status = 'processing'
         RETURNING payload`,
        [orderId, meta.tweetId, meta.tweetUrl],
      );
      if (rows.length === 0) {
        // Mirror the old require-processing error so callers get a
        // consistent message regardless of backend. A nicer "current
        // status" annotation would need a second query; the hackathon
        // cost budget prefers one round-trip.
        const existing = await this.getById(orderId);
        const current = existing?.status ?? 'not found';
        throw new Error(`cannot markDone: order ${orderId} is ${current}, expected processing`);
      }
      const updated = rows[0]!.payload;
      return { ...updated, status: 'done', tweetId: meta.tweetId, tweetUrl: meta.tweetUrl };
    }
    const entry = this.requireProcessing(orderId, 'markDone');
    entry.status = 'done';
    entry.tweetId = meta.tweetId;
    entry.tweetUrl = meta.tweetUrl;
    return { ...entry };
  }

  /**
   * Transition a processing order to `failed` and record the error reason.
   * Throws if the order does not exist or is in an unexpected state.
   */
  async markFailed(orderId: string, errorMessage: string): Promise<ShillOrderEntry> {
    if (this.pool !== undefined) {
      const { rows } = await this.pool.query<{ payload: ShillOrderEntry }>(
        `UPDATE shill_orders
           SET status = 'failed',
               payload = jsonb_set(
                  jsonb_set(payload, '{status}', '"failed"'::jsonb),
                  '{errorMessage}', to_jsonb($2::text)
                ),
               updated_at = now()
         WHERE order_id = $1 AND status = 'processing'
         RETURNING payload`,
        [orderId, errorMessage],
      );
      if (rows.length === 0) {
        const existing = await this.getById(orderId);
        const current = existing?.status ?? 'not found';
        throw new Error(`cannot markFailed: order ${orderId} is ${current}, expected processing`);
      }
      const updated = rows[0]!.payload;
      return { ...updated, status: 'failed', errorMessage };
    }
    const entry = this.requireProcessing(orderId, 'markFailed');
    entry.status = 'failed';
    entry.errorMessage = errorMessage;
    return { ...entry };
  }

  /**
   * Replace the enqueue-time sentinel `paidTxHash` with the real on-chain
   * settlement hash once the x402 middleware has finalised the response and
   * emitted the `PAYMENT-RESPONSE` header. Called from
   * `createShillHandler`'s `res.on('finish')` hook — see the PENDING_PAID_TX_HASH
   * doc-comment in `x402/index.ts` for the full story.
   *
   * Idempotent by construction: the SQL `WHERE paid_tx_hash = <sentinel>`
   * guard means a second call after the real hash has been written is a
   * silent no-op, so a duplicated `finish` fire (or a process retry) can
   * never overwrite the settled value. Rows that never carried the sentinel
   * (legacy entries or tests that pre-populate a real hash) are likewise
   * untouched. An unknown `orderId` is also a no-op.
   *
   * Throws synchronously on a malformed `paidTxHash` so the caller surfaces
   * a loud error in logs instead of persisting garbage.
   */
  async recordSettlement(orderId: string, paidTxHash: string): Promise<void> {
    if (!TX_HASH_PATTERN.test(paidTxHash)) {
      throw new Error(
        `recordSettlement: invalid paidTxHash ${JSON.stringify(paidTxHash)} — expected 0x-prefixed 32-byte hex`,
      );
    }
    if (this.pool !== undefined) {
      // Mirror the pattern used by markDone / markFailed: the real source of
      // truth is the JSONB `payload`. The WHERE clause binds the sentinel
      // literal so a row that already carries a real hash is left alone.
      await this.pool.query(
        `UPDATE shill_orders
           SET payload = jsonb_set(payload, '{paidTxHash}', to_jsonb($1::text)),
               updated_at = now()
         WHERE order_id = $2
           AND payload->>'paidTxHash' = $3`,
        [paidTxHash, orderId, PENDING_PAID_TX_HASH],
      );
      return;
    }
    const entry = this.orders.get(orderId);
    if (!entry) return;
    if (entry.paidTxHash !== PENDING_PAID_TX_HASH) return;
    entry.paidTxHash = paidTxHash;
  }

  /** Single-order lookup. Returns a copy so callers can't mutate the store. */
  async getById(orderId: string): Promise<ShillOrderEntry | undefined> {
    if (this.pool !== undefined) {
      const { rows } = await this.pool.query<{ payload: ShillOrderEntry }>(
        `SELECT payload FROM shill_orders WHERE order_id = $1`,
        [orderId],
      );
      return rows[0]?.payload;
    }
    const entry = this.orders.get(orderId);
    return entry ? { ...entry } : undefined;
  }

  /**
   * Return every order for a given token, across all statuses, sorted by
   * enqueue timestamp ascending. Address lookup is case-insensitive.
   */
  async findByTokenAddr(targetTokenAddr: string): Promise<ShillOrderEntry[]> {
    const key = normaliseAddr(targetTokenAddr);
    if (this.pool !== undefined) {
      const { rows } = await this.pool.query<{ payload: ShillOrderEntry }>(
        `SELECT payload FROM shill_orders
         WHERE target_token_addr = $1
         ORDER BY ts ASC`,
        [key],
      );
      return rows.map((r) => r.payload);
    }
    const matches: ShillOrderEntry[] = [];
    for (const entry of this.orders.values()) {
      if (entry.targetTokenAddr === key) matches.push({ ...entry });
    }
    matches.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
    return matches;
  }

  /** Total order count across all statuses. */
  async size(): Promise<number> {
    if (this.pool !== undefined) {
      const { rows } = await this.pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM shill_orders`,
      );
      return Number.parseInt(rows[0]?.count ?? '0', 10);
    }
    return this.orders.size;
  }

  /** Remove every entry. Used by tests and demo resets. */
  async clear(): Promise<void> {
    if (this.pool !== undefined) {
      await this.pool.query(`TRUNCATE shill_orders`);
      return;
    }
    this.orders.clear();
  }

  private requireProcessing(orderId: string, op: string): ShillOrderEntry {
    const entry = this.orders.get(orderId);
    if (!entry) {
      throw new Error(`cannot ${op}: order ${orderId} not found`);
    }
    if (entry.status !== 'processing') {
      throw new Error(`cannot ${op}: order ${orderId} is ${entry.status}, expected processing`);
    }
    return entry;
  }
}

function normaliseAddr(addr: string): string {
  return addr.toLowerCase();
}
