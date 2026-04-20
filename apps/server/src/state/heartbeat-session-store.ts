/**
 * HeartbeatSessionStore — process-wide registry of live background heartbeat
 * loops keyed by tokenAddr.
 *
 * Why this exists: the Brain's `invoke_heartbeat_tick` tool used to accept
 * `intervalMs` but only run a single tick — the interval was silently
 * dropped, so `/heartbeat <addr> <ms>` never actually ticked in the
 * background. This store is the missing piece: one session per lowercased
 * tokenAddr, each owning a real `setInterval` that drives a caller-supplied
 * `runTick` callback until `stop()` is called.
 *
 * Overlap guard and counter semantics mirror the long-lived `HeartbeatAgent`
 * class in `apps/server/src/agents/heartbeat.ts` — if a prior tick is still
 * running when the interval fires, increment `skippedCount` and skip. This
 * protects the process from stacking 20-second LLM calls behind a 5-second
 * interval.
 *
 * Address normalization mirrors `LoreStore`: EVM addresses are
 * case-insensitive on-chain, so every key is lowercased before indexing to
 * keep `/heartbeat 0xABC…` and `/heartbeat 0xabc…` pointing at the same
 * session.
 *
 * Intentionally NOT persisted — demo rails call for a single-process,
 * stateless-across-restart server. Restarting the server stops every
 * background loop, which is the expected behaviour.
 */

/**
 * Rough cost per heartbeat tick in USD. Used by callers to warn the user
 * about long-running loops. One tick ~= 1 LLM call (~$0.005) plus at most
 * one X post ($0.01 via Twitter API pay-per-usage). We round up to $0.01
 * so the displayed "~$X/hr" figure is conservative. Tuning this is a pure
 * cost-communication decision; the scheduler itself does not consume it.
 */
export const HEARTBEAT_EST_COST_USD_PER_TICK = 0.01;

/**
 * Default upper bound on tick attempts per session. Caps demo / production
 * exposure so an idle user cannot accidentally burn an unbounded LLM budget
 * (or a malicious visitor cannot farm our API keys). The store auto-stops
 * the session once `tickCount >= maxTicks`, whether those ticks succeeded,
 * errored, or were skipped by the overlap guard — every fire attempt counts
 * because every one reserves scheduler capacity. Callers may override
 * per-session via `HeartbeatSessionStartParams.maxTicks`.
 */
export const DEFAULT_HEARTBEAT_MAX_TICKS = 5;

export interface HeartbeatSessionState {
  /** Lowercased 0x-prefixed tokenAddr. */
  readonly tokenAddr: string;
  /** Interval between scheduled fires in milliseconds. */
  readonly intervalMs: number;
  /** ISO timestamp captured at `start(...)` time. Preserved across restarts. */
  readonly startedAt: string;
  /** True while a `setInterval` handle is active for this session. */
  readonly running: boolean;
  /**
   * Hard cap on tick attempts before the session auto-stops. Defaults to
   * `DEFAULT_HEARTBEAT_MAX_TICKS` when the caller does not pass one in. A
   * snapshot where `running === false` AND `tickCount >= maxTicks` means the
   * loop hit the cap (rather than an explicit `stop()` call).
   */
  readonly maxTicks: number;
  /** Total ticks attempted (successful + errored + skipped). */
  readonly tickCount: number;
  /** Ticks whose runTick resolved with `success: true`. */
  readonly successCount: number;
  /** Ticks whose runTick returned `success: false` or threw. */
  readonly errorCount: number;
  /** Ticks skipped because a prior tick was still running when the interval fired. */
  readonly skippedCount: number;
  /** ISO timestamp of the most recent tick attempt, or null if none yet. */
  readonly lastTickAt: string | null;
  /** Stable id assigned by runTick for its most recent attempt. */
  readonly lastTickId: string | null;
  /** Best-effort categorisation of the last action; null when runTick omitted it. */
  readonly lastAction: HeartbeatSessionAction | null;
  /** Most recent error message, or null if the last tick succeeded or none has run. */
  readonly lastError: string | null;
}

export type HeartbeatSessionAction = 'post' | 'extend_lore' | 'idle';

/**
 * Shape returned by `runTick` on each invocation. The store merges it into
 * the session snapshot: `tickCount` always increments, `successCount` /
 * `errorCount` split on the `success` bit, `lastTickAt` / `lastTickId` /
 * `lastAction` / `lastError` track the most recent attempt.
 */
export interface HeartbeatTickDelta {
  readonly tickId: string;
  readonly tickAt: string;
  readonly success: boolean;
  readonly action?: HeartbeatSessionAction;
  readonly error?: string;
}

export interface HeartbeatSessionStartParams {
  tokenAddr: string;
  intervalMs: number;
  /**
   * Optional tick cap. Omit to use `DEFAULT_HEARTBEAT_MAX_TICKS`. Must be
   * a positive integer; `Infinity` is deliberately NOT supported — the
   * point of the cap is to avoid unbounded loops entirely.
   */
  maxTicks?: number;
  /**
   * Called every time the scheduled `setInterval` fires (except when the
   * overlap guard skips). Receives the current snapshot for ergonomics —
   * the callback is expected to return its own delta synchronously so the
   * store can merge counters in.
   */
  runTick: (snapshot: HeartbeatSessionState) => Promise<HeartbeatTickDelta>;
}

export interface HeartbeatSessionStartResult {
  snapshot: HeartbeatSessionState;
  /** True if `start(...)` replaced an existing timer with a new intervalMs. */
  restarted: boolean;
}

/**
 * Test seams: vitest fake timers cover `setInterval` naturally, but other
 * callers (e.g. deterministic "drive N ticks" tests) can swap the impls
 * explicitly via the constructor. Production code uses the global timer
 * functions.
 */
export interface HeartbeatSessionStoreOptions {
  setIntervalImpl?: typeof setInterval;
  clearIntervalImpl?: typeof clearInterval;
}

type MutableSession = {
  tokenAddr: string;
  intervalMs: number;
  startedAt: string;
  running: boolean;
  maxTicks: number;
  tickCount: number;
  successCount: number;
  errorCount: number;
  skippedCount: number;
  lastTickAt: string | null;
  lastTickId: string | null;
  lastAction: HeartbeatSessionAction | null;
  lastError: string | null;
  /** In-flight overlap guard — true while the most recent runTick has not resolved. */
  tickInFlight: boolean;
  /** Active timer handle, or null when the session is stopped. */
  timer: ReturnType<typeof setInterval> | null;
  /** Persisted callback for the currently running loop. */
  runTick: (snapshot: HeartbeatSessionState) => Promise<HeartbeatTickDelta>;
};

export class HeartbeatSessionStore {
  private readonly sessions = new Map<string, MutableSession>();
  /**
   * Explicit overrides; `undefined` means "resolve the current global
   * `setInterval` / `clearInterval` lazily at timer install time". Lazy
   * resolution is what lets vitest's `useFakeTimers()` intercept the
   * scheduler even when the store was constructed before fake timers were
   * installed. Tests that want deterministic custom timers pass explicit
   * impls and bypass the global lookup.
   */
  private readonly setIntervalOverride: typeof setInterval | undefined;
  private readonly clearIntervalOverride: typeof clearInterval | undefined;

  constructor(options: HeartbeatSessionStoreOptions = {}) {
    this.setIntervalOverride = options.setIntervalImpl;
    this.clearIntervalOverride = options.clearIntervalImpl;
  }

  private get setIntervalImpl(): typeof setInterval {
    return this.setIntervalOverride ?? setInterval;
  }

  private get clearIntervalImpl(): typeof clearInterval {
    return this.clearIntervalOverride ?? clearInterval;
  }

  /**
   * Start or restart the session for `tokenAddr`:
   *
   *   - No session exists → create one, install a `setInterval`, return
   *     `restarted=false`.
   *   - Session exists, same `intervalMs` → keep the timer, refresh
   *     `runTick`, return `restarted=false` (idempotent).
   *   - Session exists, different `intervalMs` → clear the old timer,
   *     install a new one, preserve counters, return `restarted=true`.
   *
   * Note: this never runs an immediate tick. Callers that want the first
   * tick to fire synchronously are expected to drive it themselves (the
   * `invoke_heartbeat_tick` tool does exactly that). Keeping the store
   * side-effect-free on start makes counter preservation on restart a
   * trivial shallow copy.
   */
  start(params: HeartbeatSessionStartParams): HeartbeatSessionStartResult {
    const key = normaliseAddr(params.tokenAddr);
    const existing = this.sessions.get(key);
    const resolvedMaxTicks = resolveMaxTicks(params.maxTicks);

    if (existing !== undefined) {
      if (existing.running && existing.intervalMs === params.intervalMs) {
        // Idempotent refresh — just update the callback closure so the
        // next fire uses the latest `runTick` (in practice identical).
        existing.runTick = params.runTick;
        // A caller re-issuing the same intervalMs AND a new maxTicks is
        // asking to extend the cap (e.g. they hit the limit and want more).
        // Honour it; otherwise keep the prior cap.
        if (params.maxTicks !== undefined) {
          existing.maxTicks = resolvedMaxTicks;
        }
        return { snapshot: snapshotOf(existing), restarted: false };
      }
      // Interval changed OR session was previously stopped. Tear down any
      // live timer, reuse the counters, install a new interval. If the
      // previous run hit its cap, restarting resets the cap relative to the
      // *current* tickCount (cap is absolute, not relative) so the caller
      // should pass a higher maxTicks to actually unblock progress — we
      // surface this by defaulting to prior+default if omitted.
      if (existing.timer !== null) {
        this.clearIntervalImpl(existing.timer);
        existing.timer = null;
      }
      existing.intervalMs = params.intervalMs;
      existing.running = true;
      existing.runTick = params.runTick;
      existing.maxTicks =
        params.maxTicks !== undefined
          ? resolvedMaxTicks
          : Math.max(existing.maxTicks, existing.tickCount + DEFAULT_HEARTBEAT_MAX_TICKS);
      existing.timer = this.installTimer(key);
      return { snapshot: snapshotOf(existing), restarted: true };
    }

    const now = new Date().toISOString();
    const session: MutableSession = {
      tokenAddr: key,
      intervalMs: params.intervalMs,
      startedAt: now,
      running: true,
      maxTicks: resolvedMaxTicks,
      tickCount: 0,
      successCount: 0,
      errorCount: 0,
      skippedCount: 0,
      lastTickAt: null,
      lastTickId: null,
      lastAction: null,
      lastError: null,
      tickInFlight: false,
      timer: null,
      runTick: params.runTick,
    };
    this.sessions.set(key, session);
    session.timer = this.installTimer(key);
    return { snapshot: snapshotOf(session), restarted: false };
  }

  /**
   * Stop the timer for `tokenAddr`. Idempotent: returns undefined when no
   * session exists; otherwise flips `running=false`, clears the timer, and
   * returns the frozen final snapshot with counters preserved.
   */
  stop(tokenAddr: string): HeartbeatSessionState | undefined {
    const key = normaliseAddr(tokenAddr);
    const session = this.sessions.get(key);
    if (session === undefined) return undefined;
    if (session.timer !== null) {
      this.clearIntervalImpl(session.timer);
      session.timer = null;
    }
    session.running = false;
    return snapshotOf(session);
  }

  /**
   * Merge a tick delta into a session. Exposed to the timer callback the
   * store installs, and reused by external one-shot tick callers (e.g. the
   * `invoke_heartbeat_tick` tool's immediate-tick path) that want the
   * synchronously executed tick to update the same snapshot the background
   * loop writes to.
   */
  recordTick(tokenAddr: string, delta: HeartbeatTickDelta): HeartbeatSessionState | undefined {
    const key = normaliseAddr(tokenAddr);
    const session = this.sessions.get(key);
    if (session === undefined) return undefined;
    this.applyDelta(session, delta);
    return snapshotOf(session);
  }

  /** Read a single session's snapshot, or undefined if the token is unknown. */
  get(tokenAddr: string): HeartbeatSessionState | undefined {
    const session = this.sessions.get(normaliseAddr(tokenAddr));
    if (session === undefined) return undefined;
    return snapshotOf(session);
  }

  /**
   * Return every session snapshot — including stopped ones. Order is
   * insertion order (Map iteration semantics), which lines up with the
   * "most recently started first" expectation only coincidentally; callers
   * that need a specific ordering should sort the result themselves.
   */
  list(): HeartbeatSessionState[] {
    return Array.from(this.sessions.values(), snapshotOf);
  }

  /** Number of known sessions (running + stopped). */
  size(): number {
    return this.sessions.size;
  }

  /**
   * Stop every timer and forget every session. Test-only — production code
   * never has a reason to wipe the registry. Mirrors `LoreStore.clear()`.
   */
  clear(): void {
    for (const session of this.sessions.values()) {
      if (session.timer !== null) {
        this.clearIntervalImpl(session.timer);
        session.timer = null;
      }
      session.running = false;
    }
    this.sessions.clear();
  }

  private installTimer(key: string): ReturnType<typeof setInterval> {
    const session = this.sessions.get(key);
    if (session === undefined) {
      // Defensive: installTimer is always called right after `this.sessions.set`
      // or with a refreshed `existing`, so this branch is unreachable.
      throw new Error(`HeartbeatSessionStore: session disappeared for ${key}`);
    }
    const timer = this.setIntervalImpl(() => {
      void this.fire(key);
    }, session.intervalMs);
    // Prevent the timer from keeping the Node event loop alive on its own.
    // Production servers never want the heartbeat to block graceful shutdown,
    // and tests with fake timers treat `unref` as a no-op.
    if (typeof (timer as { unref?: () => void }).unref === 'function') {
      (timer as { unref: () => void }).unref();
    }
    return timer;
  }

  /**
   * Scheduler callback body. Re-reads the session each fire because a
   * concurrent `stop()` might have removed the timer a few ms ago and the
   * queued callback can still land once.
   *
   * Counter semantics: `tickCount` increments the instant we observe a
   * fire attempt — whether it runs or gets skipped. `successCount` /
   * `errorCount` / `skippedCount` partition the same total so the running
   * invariant `tickCount === successCount + errorCount + skippedCount`
   * holds at every snapshot boundary (an in-flight tick is accounted for
   * via `tickCount` but not yet counted as success/error — a transient
   * window where the invariant holds only after the tick resolves).
   */
  private async fire(key: string): Promise<void> {
    const session = this.sessions.get(key);
    if (session === undefined || !session.running) return;
    // Always count the fire attempt so external observers see the tick in
    // `tickCount` as soon as it dispatches, not only after it resolves.
    session.tickCount += 1;
    if (session.tickInFlight) {
      session.skippedCount += 1;
      this.maybeAutoStop(session);
      return;
    }
    session.tickInFlight = true;
    try {
      const snap = snapshotOf(session);
      const delta = await session.runTick(snap);
      // Guard against the session being stopped mid-tick — we still want to
      // count the tick that actually ran, just not write into a removed
      // record. The fire callback is the only place we need this guard;
      // recordTick is a public method and already handles the unknown case.
      const current = this.sessions.get(key);
      if (current === undefined) return;
      this.applyDeltaSkipTickCount(current, delta);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Synthetic delta so the single-source-of-truth applyDelta updates
      // every counter consistently even when runTick throws before it could
      // hand back a tickId. Reusing tickId preserves the "last attempted"
      // identity for the operator.
      const current = this.sessions.get(key);
      if (current === undefined) return;
      this.applyDeltaSkipTickCount(current, {
        tickId: current.lastTickId ?? `tick_err_${Date.now().toString(36)}`,
        tickAt: new Date().toISOString(),
        success: false,
        error: message,
      });
    } finally {
      const current = this.sessions.get(key);
      if (current !== undefined) {
        current.tickInFlight = false;
        this.maybeAutoStop(current);
      }
    }
  }

  /**
   * External-caller variant: `recordTick` / one-shot immediate tick paths
   * need `tickCount` incremented alongside the success/error split because
   * they do not go through the `fire()` scheduler preamble.
   */
  private applyDelta(session: MutableSession, delta: HeartbeatTickDelta): void {
    session.tickCount += 1;
    this.applyDeltaSkipTickCount(session, delta);
    this.maybeAutoStop(session);
  }

  /**
   * Auto-stop the session once `tickCount >= maxTicks`. Idempotent — safe to
   * call after every counter mutation. The session record is preserved so a
   * later `get()` / `list()` / `stop()` call still returns a frozen snapshot
   * with `running: false` and the final counters; callers can tell the cap
   * was hit via `tickCount >= maxTicks`.
   */
  private maybeAutoStop(session: MutableSession): void {
    if (!session.running) return;
    if (session.tickCount < session.maxTicks) return;
    if (session.timer !== null) {
      this.clearIntervalImpl(session.timer);
      session.timer = null;
    }
    session.running = false;
  }

  /**
   * Scheduler-path variant: `fire()` has already incremented `tickCount`,
   * so applying the delta must only update the success/error fork plus
   * the "last tick" trail.
   */
  private applyDeltaSkipTickCount(session: MutableSession, delta: HeartbeatTickDelta): void {
    session.lastTickAt = delta.tickAt;
    session.lastTickId = delta.tickId;
    if (delta.success) {
      session.successCount += 1;
      session.lastError = null;
    } else {
      session.errorCount += 1;
      session.lastError = delta.error ?? 'unknown error';
    }
    session.lastAction = delta.action ?? null;
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function normaliseAddr(addr: string): string {
  return addr.toLowerCase();
}

/**
 * Build a frozen, immutable snapshot of a session. Callers must never see
 * the mutable internal record — freezing here guarantees downstream code
 * cannot accidentally mutate counters through the reference we hand back.
 */
function snapshotOf(session: MutableSession): HeartbeatSessionState {
  return Object.freeze({
    tokenAddr: session.tokenAddr,
    intervalMs: session.intervalMs,
    startedAt: session.startedAt,
    running: session.running,
    maxTicks: session.maxTicks,
    tickCount: session.tickCount,
    successCount: session.successCount,
    errorCount: session.errorCount,
    skippedCount: session.skippedCount,
    lastTickAt: session.lastTickAt,
    lastTickId: session.lastTickId,
    lastAction: session.lastAction,
    lastError: session.lastError,
  });
}

/**
 * Validate and normalise an optional `maxTicks` input. Non-positive integers
 * and non-integers fall back to the default rather than throwing — the cap is
 * a safety rail, so silent correction is more useful here than a hard error.
 */
function resolveMaxTicks(max: number | undefined): number {
  if (max === undefined) return DEFAULT_HEARTBEAT_MAX_TICKS;
  if (!Number.isInteger(max) || max <= 0) return DEFAULT_HEARTBEAT_MAX_TICKS;
  return max;
}
