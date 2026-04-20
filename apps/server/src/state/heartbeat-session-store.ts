/**
 * HeartbeatSessionStore — registry of live background heartbeat loops keyed
 * by tokenAddr.
 *
 * The timer itself is always process-local (a real `setInterval` handle).
 * Persistence only covers the session metadata and counters so Ch12 /
 * DevTools can show "the previous process got to tick 3/5" after a restart.
 * Timers are NEVER auto-restarted on boot — `ensureSchema` explicitly
 * resets `running=false` on every row at startup so the UI reflects reality
 * (no ghost loops). Users must reissue `/heartbeat <addr> <ms>` to resume.
 *
 * Overlap guard + counter semantics mirror the previous in-memory version:
 * if a prior tick is still running when the interval fires, increment
 * `skippedCount` and skip; `tickCount = successCount + errorCount +
 * skippedCount` between snapshots.
 *
 * Address normalization mirrors LoreStore: EVM addresses lowercase on
 * every read/write so `/heartbeat 0xABC…` and `/heartbeat 0xabc…` hit the
 * same session.
 */
import type { Pool } from 'pg';
import type { Artifact } from '@hack-fourmeme/shared';

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
 * the session once `tickCount >= maxTicks`. `tickCount` counts ONLY ticks
 * that actually executed (success + error); overlap-skipped fires land on
 * `skippedCount` and do NOT advance the cap. This mirrors the K8s CronJob
 * `concurrencyPolicy: Forbid` and Sidekiq unique-job conventions — the user
 * asked for "N ticks", so "N ticks" must mean N real executions, not N
 * scheduler fire attempts. Callers may override per-session via
 * `HeartbeatSessionStartParams.maxTicks`.
 */
export const DEFAULT_HEARTBEAT_MAX_TICKS = 5;

/**
 * Absolute safety rail on scheduler fire attempts. If the persona's per-tick
 * work consistently exceeds the interval (e.g. a 30s LLM call on a 10s
 * cadence), every interval fire that lands mid-tick records as an overlap
 * skip. Without an upper bound on total attempts the loop could fire forever
 * while only producing a handful of real ticks. Once
 * `tickCount + skippedCount >= maxTicks * MAX_FIRE_ATTEMPTS_MULTIPLIER` we
 * force-stop the session and log a warning so operators know the cadence is
 * mismatched to the workload. The multiplier is deliberately generous (5x)
 * so normal "slightly slow LLM" sessions are unaffected.
 */
export const MAX_FIRE_ATTEMPTS_MULTIPLIER = 5;

export interface HeartbeatSessionState {
  readonly tokenAddr: string;
  readonly intervalMs: number;
  readonly startedAt: string;
  readonly running: boolean;
  readonly maxTicks: number;
  readonly tickCount: number;
  readonly successCount: number;
  readonly errorCount: number;
  readonly skippedCount: number;
  readonly lastTickAt: string | null;
  readonly lastTickId: string | null;
  readonly lastAction: HeartbeatSessionAction | null;
  readonly lastError: string | null;
}

export type HeartbeatSessionAction = 'post' | 'extend_lore' | 'idle';

export interface HeartbeatTickDelta {
  readonly tickId: string;
  readonly tickAt: string;
  readonly success: boolean;
  readonly action?: HeartbeatSessionAction;
  /**
   * Human-readable rationale the persona returned for its chosen action.
   * Threaded onto the tick-event bus so heartbeat chat bubbles can show
   * "idle — waiting for marketcap to move" instead of a bare "idle".
   */
  readonly reason?: string;
  readonly error?: string;
  /**
   * Optional tick-scoped artifacts captured by the caller (e.g. the
   * `invoke_heartbeat_tick` tool records `tweet-url` and `lore-cid`
   * artifacts the persona emits during one tick). The session store does
   * not aggregate these into any counter; they ride along on the delta so
   * downstream subscribers (SSE bus) can surface them live.
   */
  readonly artifacts?: ReadonlyArray<Artifact>;
}

export interface HeartbeatSessionStartParams {
  tokenAddr: string;
  intervalMs: number;
  maxTicks?: number;
  runTick: (snapshot: HeartbeatSessionState) => Promise<HeartbeatTickDelta>;
}

export interface HeartbeatSessionStartResult {
  snapshot: HeartbeatSessionState;
  restarted: boolean;
}

export interface HeartbeatSessionStoreOptions {
  pool?: Pool | undefined;
  setIntervalImpl?: typeof setInterval;
  clearIntervalImpl?: typeof clearInterval;
  /**
   * Fired AFTER each tick attempt is applied to the session (including the
   * overlap-skipped branch, the error branch, and the post-`maybeAutoStop`
   * state transition). The hook receives a fresh snapshot so listeners see
   * `running: false` when the cap was just reached by this tick. Errors
   * thrown by the hook are swallowed with a warn log so a broken listener
   * cannot poison the store's persist pipeline — the bus layer performs its
   * own fan-out isolation on top of this.
   */
  onAfterTick?: (snapshot: HeartbeatSessionState, delta: HeartbeatTickDelta) => void;
}

interface MutableSession {
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
  tickInFlight: boolean;
  timer: ReturnType<typeof setInterval> | null;
  runTick: (snapshot: HeartbeatSessionState) => Promise<HeartbeatTickDelta>;
}

export class HeartbeatSessionStore {
  private readonly sessions = new Map<string, MutableSession>();
  private readonly pool: Pool | undefined;
  private readonly setIntervalOverride: typeof setInterval | undefined;
  private readonly clearIntervalOverride: typeof clearInterval | undefined;
  private readonly onAfterTick:
    | ((snapshot: HeartbeatSessionState, delta: HeartbeatTickDelta) => void)
    | undefined;

  constructor(options: HeartbeatSessionStoreOptions = {}) {
    this.pool = options.pool;
    this.setIntervalOverride = options.setIntervalImpl;
    this.clearIntervalOverride = options.clearIntervalImpl;
    this.onAfterTick = options.onAfterTick;
  }

  private get setIntervalImpl(): typeof setInterval {
    return this.setIntervalOverride ?? setInterval;
  }

  private get clearIntervalImpl(): typeof clearInterval {
    return this.clearIntervalOverride ?? clearInterval;
  }

  /**
   * Start or restart the session for `tokenAddr`. Semantics unchanged from
   * the in-memory version: idempotent refresh when the intervalMs matches,
   * restart + counter preservation when it differs. Counters loaded from pg
   * on first access when the session is not yet cached in memory.
   */
  async start(params: HeartbeatSessionStartParams): Promise<HeartbeatSessionStartResult> {
    const key = normaliseAddr(params.tokenAddr);
    const resolvedMaxTicks = resolveMaxTicks(params.maxTicks);

    // Load from pg if we don't already have an in-memory mirror (restart
    // path: counters survive across processes even though timers do not).
    let existing = this.sessions.get(key);
    if (existing === undefined && this.pool !== undefined) {
      const dbRow = await this.loadFromDb(key);
      if (dbRow !== undefined) {
        existing = this.hydrateFromSnapshot(key, dbRow, params.runTick);
      }
    }

    if (existing !== undefined) {
      if (existing.running && existing.intervalMs === params.intervalMs) {
        existing.runTick = params.runTick;
        if (params.maxTicks !== undefined) {
          existing.maxTicks = resolvedMaxTicks;
        }
        await this.persist(existing);
        return { snapshot: snapshotOf(existing), restarted: false };
      }
      // Restart path. Two sub-cases with different counter semantics:
      //   1. Session still running, interval changed → user is tweaking the
      //      cadence of the SAME run, so counters + startedAt are preserved.
      //   2. Session was previously stopped (explicit stop OR hit its cap) →
      //      user is starting a NEW run, so counters reset to 0 and
      //      startedAt is refreshed. Without this, re-issuing
      //      `/heartbeat <addr> <ms> <n>` after hitting the cap immediately
      //      auto-stops (tickCount is already `n` from the prior run), which
      //      is exactly the bug the user reported.
      const wasStopped = !existing.running;
      if (existing.timer !== null) {
        this.clearIntervalImpl(existing.timer);
        existing.timer = null;
      }
      existing.intervalMs = params.intervalMs;
      existing.running = true;
      existing.runTick = params.runTick;
      // Preserve the existing cap when the caller omits `maxTicks`. Without
      // this, a user tweaking the cadence mid-run (e.g. /heartbeat 0x... 5000
      // on a session they originally started with `maxTicks=20`) would
      // silently drop the cap back to DEFAULT_HEARTBEAT_MAX_TICKS. Explicit
      // `params.maxTicks` still overrides.
      existing.maxTicks = params.maxTicks !== undefined ? resolvedMaxTicks : existing.maxTicks;
      if (wasStopped) {
        existing.startedAt = new Date().toISOString();
        existing.tickCount = 0;
        existing.successCount = 0;
        existing.errorCount = 0;
        existing.skippedCount = 0;
        existing.lastTickAt = null;
        existing.lastTickId = null;
        existing.lastAction = null;
        existing.lastError = null;
      }
      existing.timer = this.installTimer(key);
      await this.persist(existing);
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
    await this.persist(session);
    return { snapshot: snapshotOf(session), restarted: false };
  }

  /**
   * Stop the timer for `tokenAddr`. Idempotent: returns undefined when no
   * session exists; otherwise flips `running=false`, clears the timer, and
   * returns the frozen final snapshot with counters preserved.
   */
  async stop(tokenAddr: string): Promise<HeartbeatSessionState | undefined> {
    const key = normaliseAddr(tokenAddr);
    let session = this.sessions.get(key);
    if (session === undefined && this.pool !== undefined) {
      // Stop on a cold process: load whatever we can from the DB, flip
      // running=false, persist. No timer to clear.
      const dbRow = await this.loadFromDb(key);
      if (dbRow === undefined) return undefined;
      session = this.hydrateFromSnapshot(key, dbRow, async () => ({
        tickId: '',
        tickAt: new Date().toISOString(),
        success: true,
      }));
    }
    if (session === undefined) return undefined;
    if (session.timer !== null) {
      this.clearIntervalImpl(session.timer);
      session.timer = null;
    }
    session.running = false;
    await this.persist(session);
    return snapshotOf(session);
  }

  /**
   * Merge a tick delta into a session. Exposed to the timer callback the
   * store installs, and reused by external one-shot tick callers that want
   * the synchronously executed tick to update the same snapshot the
   * background loop writes to.
   */
  async recordTick(
    tokenAddr: string,
    delta: HeartbeatTickDelta,
  ): Promise<HeartbeatSessionState | undefined> {
    const key = normaliseAddr(tokenAddr);
    const session = this.sessions.get(key);
    if (session === undefined) return undefined;
    this.applyDelta(session, delta);
    this.maybeAutoStop(session);
    await this.persist(session);
    const snap = snapshotOf(session);
    this.fireAfterTick(snap, delta);
    return snap;
  }

  /** Read a single session's snapshot, or undefined if the token is unknown. */
  async get(tokenAddr: string): Promise<HeartbeatSessionState | undefined> {
    const key = normaliseAddr(tokenAddr);
    const session = this.sessions.get(key);
    if (session !== undefined) return snapshotOf(session);
    if (this.pool !== undefined) {
      const dbRow = await this.loadFromDb(key);
      if (dbRow !== undefined) {
        // Return the DB snapshot without hydrating the in-memory mutable
        // record — we don't have a runTick callback to install here, and
        // reads must not accidentally resurrect a stopped session.
        return Object.freeze({
          ...dbRow,
          // Force running=false defensively even if the DB somehow still
          // shows true (ensureSchema should have reset it).
          running: false,
        });
      }
    }
    return undefined;
  }

  /**
   * Return every session snapshot — including stopped ones, including
   * those surfaced only from the DB. In-memory sessions win when both are
   * present (they have a live timer handle).
   */
  async list(): Promise<HeartbeatSessionState[]> {
    const memSnaps = Array.from(this.sessions.values(), snapshotOf);
    if (this.pool === undefined) return memSnaps;
    const { rows } = await this.pool.query<{ payload: HeartbeatSessionState }>(
      `SELECT payload FROM heartbeat_sessions ORDER BY updated_at ASC`,
    );
    const memKeys = new Set(memSnaps.map((s) => s.tokenAddr));
    const dbOnly = rows
      .map((r) => Object.freeze({ ...r.payload, running: false }))
      .filter((s) => !memKeys.has(s.tokenAddr));
    return [...memSnaps, ...dbOnly];
  }

  /** Synchronous in-memory snapshot count. Useful for tests only. */
  size(): number {
    return this.sessions.size;
  }

  /**
   * Stop every timer and forget every session. Test-only.
   */
  async clear(): Promise<void> {
    for (const session of this.sessions.values()) {
      if (session.timer !== null) {
        this.clearIntervalImpl(session.timer);
        session.timer = null;
      }
      session.running = false;
    }
    this.sessions.clear();
    if (this.pool !== undefined) {
      await this.pool.query(`TRUNCATE heartbeat_sessions`);
    }
  }

  private installTimer(key: string): ReturnType<typeof setInterval> {
    const session = this.sessions.get(key);
    if (session === undefined) {
      throw new Error(`HeartbeatSessionStore: session disappeared for ${key}`);
    }
    const timer = this.setIntervalImpl(() => {
      void this.fire(key);
    }, session.intervalMs);
    if (typeof (timer as { unref?: () => void }).unref === 'function') {
      (timer as { unref: () => void }).unref();
    }
    return timer;
  }

  /**
   * Atomically run ONE tick under the session's overlap guard + counter +
   * auto-stop discipline. Unified path shared by:
   *   - the private `fire()` scheduler callback (background interval fires)
   *   - the public `/heartbeat <addr> <intervalMs>` "immediate tick" the
   *     `invoke_heartbeat_tick` tool runs synchronously before returning
   *
   * Prior to this method the immediate tick lived in `invoke-persona.ts` and
   * mutated the session only via `recordTick` AFTER the LLM loop resolved.
   * That left `tickInFlight` stuck at false for the entire ~20-30 second
   * LLM call, so every `setInterval` fire that landed during the immediate
   * tick saw no in-flight marker and spun up a PARALLEL LLM loop. Users
   * observed "continuous tool calls with no 10s spacing" because two ticks
   * were racing on the same SSE stream. Routing both entry points through
   * this method closes that race: whichever tick grabs the lock first wins,
   * any concurrent tick gets recorded as a skip.
   *
   * Returns the post-tick snapshot (including skipped-by-overlap outcomes),
   * or `undefined` when the session is unknown or already stopped.
   */
  async runExclusiveTick(
    tokenAddr: string,
    runTick: (snapshot: HeartbeatSessionState) => Promise<HeartbeatTickDelta>,
  ): Promise<HeartbeatSessionState | undefined> {
    const key = normaliseAddr(tokenAddr);
    const session = this.sessions.get(key);
    if (session === undefined || !session.running) return undefined;
    if (session.tickInFlight) {
      // Overlap branch: a prior tick is still executing. Record the miss on
      // `skippedCount` only — it MUST NOT advance `tickCount` because the
      // user asked for "N ticks" in the CronJob sense (N real executions),
      // not "N scheduler fire attempts". If a slow persona meant every fire
      // landed mid-tick, the old behaviour auto-stopped the loop after
      // `maxTicks` ghost skips with only a single real tick completed.
      session.skippedCount += 1;
      this.maybeAutoStopOnFireAttempts(session);
      await this.persist(session);
      const skipDelta: HeartbeatTickDelta = {
        tickId: `overlap_${Date.now().toString(36)}`,
        tickAt: new Date().toISOString(),
        success: false,
        error: 'overlap-skipped',
      };
      this.fireAfterTick(snapshotOf(session), skipDelta);
      return snapshotOf(session);
    }
    session.tickInFlight = true;
    let appliedDelta: HeartbeatTickDelta | undefined;
    try {
      const snap = snapshotOf(session);
      const delta = await runTick(snap);
      const current = this.sessions.get(key);
      if (current === undefined) return undefined;
      this.applyDelta(current, delta);
      appliedDelta = delta;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const current = this.sessions.get(key);
      if (current === undefined) return undefined;
      const errorDelta: HeartbeatTickDelta = {
        tickId: current.lastTickId ?? `tick_err_${Date.now().toString(36)}`,
        tickAt: new Date().toISOString(),
        success: false,
        error: message,
      };
      this.applyDelta(current, errorDelta);
      appliedDelta = errorDelta;
    } finally {
      const current = this.sessions.get(key);
      if (current !== undefined) {
        current.tickInFlight = false;
        this.maybeAutoStop(current);
        await this.persist(current);
        if (appliedDelta !== undefined) {
          this.fireAfterTick(snapshotOf(current), appliedDelta);
        }
      }
    }
    const after = this.sessions.get(key);
    return after !== undefined ? snapshotOf(after) : undefined;
  }

  /**
   * Scheduler callback body. Delegates to `runExclusiveTick` with the
   * session's own `runTick` callback so the scheduler and the immediate-tick
   * path share the same overlap guard + counter + auto-stop transitions.
   */
  private async fire(key: string): Promise<void> {
    const session = this.sessions.get(key);
    if (session === undefined || !session.running) return;
    await this.runExclusiveTick(session.tokenAddr, session.runTick);
  }

  /**
   * Invoke the optional `onAfterTick` hook. Listener errors are caught so a
   * broken downstream subscriber (e.g. the SSE event bus) cannot disrupt the
   * scheduler or the persistence pipeline.
   */
  private fireAfterTick(snapshot: HeartbeatSessionState, delta: HeartbeatTickDelta): void {
    if (this.onAfterTick === undefined) return;
    try {
      this.onAfterTick(snapshot, delta);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[heartbeat] onAfterTick threw (non-fatal): ${message}`);
    }
  }

  /**
   * Fold a delta into the session. Advances `tickCount` by one — ONLY called
   * for ticks that actually executed (success or error branches). Overlap
   * skips do not go through here; they bump `skippedCount` directly. Callers
   * are responsible for invoking `maybeAutoStop` afterwards (the scheduler
   * does so in its `finally` block; `recordTick` does so inline).
   */
  private applyDelta(session: MutableSession, delta: HeartbeatTickDelta): void {
    session.tickCount += 1;
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

  /**
   * Stop the session once real executions hit the cap. Overlap skips do NOT
   * trigger this path — see `maybeAutoStopOnFireAttempts` for the safety
   * rail that guards against pathologically slow personas.
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
   * Safety rail invoked from the overlap branch. If scheduler fire attempts
   * (`tickCount + skippedCount`) exceed `maxTicks * MAX_FIRE_ATTEMPTS_MULTIPLIER`
   * the persona is consistently slower than the interval and would otherwise
   * burn scheduler capacity indefinitely. Force-stop with a warn log so the
   * operator sees the mismatch.
   */
  private maybeAutoStopOnFireAttempts(session: MutableSession): void {
    if (!session.running) return;
    const fireAttempts = session.tickCount + session.skippedCount;
    const limit = session.maxTicks * MAX_FIRE_ATTEMPTS_MULTIPLIER;
    if (fireAttempts < limit) return;
    if (session.timer !== null) {
      this.clearIntervalImpl(session.timer);
      session.timer = null;
    }
    session.running = false;
    console.warn(
      `[heartbeat] safety rail tripped for ${session.tokenAddr}: ` +
        `${fireAttempts.toString()} fire attempts (${session.tickCount.toString()} real + ` +
        `${session.skippedCount.toString()} skipped) reached the ${limit.toString()}x cap of ` +
        `maxTicks=${session.maxTicks.toString()}. The persona is consistently slower than ` +
        `intervalMs=${session.intervalMs.toString()}ms; raise the interval or lower persona work.`,
    );
  }

  private async persist(session: MutableSession): Promise<void> {
    if (this.pool === undefined) return;
    const snap = snapshotOf(session);
    try {
      await this.pool.query(
        `INSERT INTO heartbeat_sessions (token_addr, payload, running, started_at, updated_at)
         VALUES ($1, $2::jsonb, $3, $4, now())
         ON CONFLICT (token_addr)
         DO UPDATE SET
           payload = EXCLUDED.payload,
           running = EXCLUDED.running,
           updated_at = now()`,
        [snap.tokenAddr, JSON.stringify(snap), snap.running, snap.startedAt],
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[heartbeat] persist failed (non-fatal): ${message}`);
    }
  }

  private async loadFromDb(key: string): Promise<HeartbeatSessionState | undefined> {
    if (this.pool === undefined) return undefined;
    const { rows } = await this.pool.query<{ payload: HeartbeatSessionState }>(
      `SELECT payload FROM heartbeat_sessions WHERE token_addr = $1`,
      [key],
    );
    return rows[0]?.payload;
  }

  private hydrateFromSnapshot(
    key: string,
    snap: HeartbeatSessionState,
    runTick: (s: HeartbeatSessionState) => Promise<HeartbeatTickDelta>,
  ): MutableSession {
    // DB restore: restart-stops-timers. running is always restored as false
    // so the user explicitly reissues /heartbeat to spin up the timer.
    const session: MutableSession = {
      tokenAddr: snap.tokenAddr,
      intervalMs: snap.intervalMs,
      startedAt: snap.startedAt,
      running: false,
      maxTicks: snap.maxTicks,
      tickCount: snap.tickCount,
      successCount: snap.successCount,
      errorCount: snap.errorCount,
      skippedCount: snap.skippedCount,
      lastTickAt: snap.lastTickAt,
      lastTickId: snap.lastTickId,
      lastAction: snap.lastAction,
      lastError: snap.lastError,
      tickInFlight: false,
      timer: null,
      runTick,
    };
    this.sessions.set(key, session);
    return session;
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function normaliseAddr(addr: string): string {
  return addr.toLowerCase();
}

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

function resolveMaxTicks(max: number | undefined): number {
  if (max === undefined) return DEFAULT_HEARTBEAT_MAX_TICKS;
  if (!Number.isInteger(max) || max <= 0) return DEFAULT_HEARTBEAT_MAX_TICKS;
  return max;
}
