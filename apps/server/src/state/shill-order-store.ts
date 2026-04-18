/**
 * ShillOrderStore — in-memory shill-order queue and state machine.
 *
 * Sits between the x402 `/shill/:tokenAddr` endpoint (producer) and the
 * Shiller agent tick (consumer). States flow:
 *
 *   queued ─ pullPending() / pullById() ─► processing ─ markDone / markFailed ─► done | failed
 *
 * `pullPending()` and `pullById()` flip state atomically so a single queued
 * order cannot be handed to two consecutive ticks — duplicate tweets for one
 * paid order would be worse than a lost one. Use `pullById` when you already
 * know the target orderId (the orchestrator's default) to avoid stranding
 * orphan queued orders; use `pullPending` for bulk dequeue when you genuinely
 * want every queued entry at once.
 *
 * Address normalization mirrors LoreStore: every write lowercases
 * `targetTokenAddr`, every query lowercases its input. Producers (x402 handler
 * reading user input) and consumers (Shiller agent reading from its own
 * artifacts) may emit mixed-case strings; the store is the single place where
 * that variance is collapsed.
 *
 * Single responsibility: state transitions + lookups only. x402 settlement,
 * X API posting, and persistence belong elsewhere.
 */
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

export class ShillOrderStore {
  private readonly orders = new Map<string, ShillOrderEntry>();

  /**
   * Create a new queued order. Throws on orderId collision so a retrying
   * producer cannot silently overwrite an in-flight order.
   */
  enqueue(input: EnqueueInput): ShillOrderEntry {
    if (this.orders.has(input.orderId)) {
      throw new Error(`orderId conflict: ${input.orderId}`);
    }
    const entry: ShillOrderEntry = {
      orderId: input.orderId,
      targetTokenAddr: normaliseAddr(input.targetTokenAddr),
      creatorBrief: input.creatorBrief,
      paidTxHash: input.paidTxHash,
      paidAmountUsdc: input.paidAmountUsdc,
      status: 'queued',
      ts: input.ts,
    };
    this.orders.set(entry.orderId, entry);
    return { ...entry };
  }

  /**
   * Return every currently-queued order, sorted by enqueue timestamp ascending,
   * and atomically transition each of them to `processing` so the next tick
   * sees an empty queue.
   */
  pullPending(): ShillOrderEntry[] {
    const pending: ShillOrderEntry[] = [];
    for (const entry of this.orders.values()) {
      if (entry.status === 'queued') {
        pending.push(entry);
      }
    }
    pending.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
    // Atomic flip: caller must never see the same queued order twice.
    for (const entry of pending) {
      entry.status = 'processing';
    }
    return pending.map((entry) => ({ ...entry }));
  }

  /**
   * Single-order variant of `pullPending`: atomically flip one queued order
   * to `processing` and return it. Returns `undefined` when the order does
   * not exist, or when it exists but is not currently `queued` (e.g. already
   * processing / done / failed). Returning `undefined` rather than throwing
   * on a wrong-status order lets the orchestrator treat "nothing to claim"
   * uniformly — the caller only cares whether it got a claim, not why.
   *
   * Why this exists alongside `pullPending`: the orchestrator processes a
   * single known orderId per run; `pullPending` would also flip every other
   * queued order to `processing`, stranding them when no one else is
   * consuming the queue. `pullById` gives the orchestrator targeted dequeue
   * without starving orphan orders.
   */
  pullById(orderId: string): ShillOrderEntry | undefined {
    const entry = this.orders.get(orderId);
    if (!entry || entry.status !== 'queued') return undefined;
    entry.status = 'processing';
    return { ...entry };
  }

  /**
   * Transition a processing order to `done` and record its tweet metadata.
   * Throws if the order does not exist or is in an unexpected state.
   */
  markDone(orderId: string, meta: { tweetId: string; tweetUrl: string }): ShillOrderEntry {
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
  markFailed(orderId: string, errorMessage: string): ShillOrderEntry {
    const entry = this.requireProcessing(orderId, 'markFailed');
    entry.status = 'failed';
    entry.errorMessage = errorMessage;
    return { ...entry };
  }

  /** Single-order lookup. Returns a copy so callers can't mutate the store. */
  getById(orderId: string): ShillOrderEntry | undefined {
    const entry = this.orders.get(orderId);
    return entry ? { ...entry } : undefined;
  }

  /**
   * Return every order for a given token, across all statuses, sorted by
   * enqueue timestamp ascending. Address lookup is case-insensitive.
   */
  findByTokenAddr(targetTokenAddr: string): ShillOrderEntry[] {
    const key = normaliseAddr(targetTokenAddr);
    const matches: ShillOrderEntry[] = [];
    for (const entry of this.orders.values()) {
      if (entry.targetTokenAddr === key) {
        matches.push({ ...entry });
      }
    }
    matches.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
    return matches;
  }

  /** Total order count across all statuses. */
  size(): number {
    return this.orders.size;
  }

  /** Remove every entry. Used by tests and demo resets. */
  clear(): void {
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
