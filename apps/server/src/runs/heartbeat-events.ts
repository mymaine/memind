/**
 * HeartbeatEventBus — in-process pub/sub for heartbeat tick events.
 *
 * The `HeartbeatSessionStore` fires a hook after every tick attempt
 * (success / error / overlap-skip / auto-stop). `apps/server/src/index.ts`
 * wires that hook into this bus at boot; the SSE endpoint in `routes.ts`
 * subscribes per token so a connected web client receives the next tick the
 * moment the session store records it.
 *
 * Zero persistence: the bus is ephemeral pub/sub. Cold clients hydrate from
 * `HeartbeatSessionStore.get(...)` via the SSE `initial` event. Using a
 * `Map<string, Set<HeartbeatTickListener>>` keyed by lowercased tokenAddr
 * keeps the fan-out O(subscribers) per tick without threading yet another
 * EventEmitter surface through the stack.
 */
import type { Artifact } from '@hack-fourmeme/shared';
import type {
  HeartbeatSessionState,
  HeartbeatTickDelta,
} from '../state/heartbeat-session-store.js';

export interface HeartbeatTickEvent {
  /** Lowercased EVM address of the token whose session produced the tick. */
  readonly tokenAddr: string;
  /** Snapshot of the session AFTER the delta + any auto-stop transition. */
  readonly snapshot: HeartbeatSessionState;
  /** Delta that was applied (or synthesised for skip / error branches). */
  readonly delta: HeartbeatTickDelta;
  /**
   * Tick-scoped artifacts the persona emitted (tweet-url / lore-cid).
   * Omitted when the tick produced none so the wire shape stays compact for
   * the common snapshot-only case.
   */
  readonly artifacts?: ReadonlyArray<Artifact>;
  /** ISO timestamp stamped by the emitter at fan-out time. */
  readonly emittedAt: string;
}

export type HeartbeatTickListener = (event: HeartbeatTickEvent) => void;

/**
 * In-memory fan-out bus. Safe to share across the process lifetime.
 */
export class HeartbeatEventBus {
  private readonly listeners = new Map<string, Set<HeartbeatTickListener>>();

  /**
   * Register a listener for `tokenAddr`. Returns an unsubscribe function that
   * removes the listener and drops the per-token set once it empties so the
   * bus does not retain ghost keys.
   */
  subscribe(tokenAddr: string, listener: HeartbeatTickListener): () => void {
    const key = tokenAddr.toLowerCase();
    let set = this.listeners.get(key);
    if (set === undefined) {
      set = new Set<HeartbeatTickListener>();
      this.listeners.set(key, set);
    }
    set.add(listener);
    let unsubscribed = false;
    return (): void => {
      if (unsubscribed) return;
      unsubscribed = true;
      const current = this.listeners.get(key);
      if (current === undefined) return;
      current.delete(listener);
      if (current.size === 0) {
        this.listeners.delete(key);
      }
    };
  }

  /**
   * Fan out `event` to every subscriber listening on `tokenAddr`. Listener
   * errors are isolated — one throwing listener must not break delivery to
   * peers nor poison the session store's persist pipeline. We log at warn
   * level so an operator can still notice a regressing listener.
   */
  emit(tokenAddr: string, event: HeartbeatTickEvent): void {
    const key = tokenAddr.toLowerCase();
    const set = this.listeners.get(key);
    if (set === undefined) return;
    // Snapshot to an array so a listener unsubscribing during dispatch does
    // not perturb the live Set while we iterate.
    for (const listener of Array.from(set)) {
      try {
        listener(event);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`[heartbeat-events] listener threw for ${key}: ${message}`);
      }
    }
  }

  /** Count of active subscribers for a token. Test hook. */
  subscriberCount(tokenAddr: string): number {
    return this.listeners.get(tokenAddr.toLowerCase())?.size ?? 0;
  }

  /** Drop every subscriber. Test-only. */
  clear(): void {
    this.listeners.clear();
  }
}
