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
 * errored, or were skipped by the overlap guard — every fire attempt
 * counts because every one reserves scheduler capacity. Callers may
 * override per-session via `HeartbeatSessionStartParams.maxTicks`.
 */
export const DEFAULT_HEARTBEAT_MAX_TICKS = 5;

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
  readonly error?: string;
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

  constructor(options: HeartbeatSessionStoreOptions = {}) {
    this.pool = options.pool;
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
      existing.maxTicks = resolvedMaxTicks;
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
    await this.persist(session);
    return snapshotOf(session);
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

  private async fire(key: string): Promise<void> {
    const session = this.sessions.get(key);
    if (session === undefined || !session.running) return;
    session.tickCount += 1;
    if (session.tickInFlight) {
      session.skippedCount += 1;
      this.maybeAutoStop(session);
      await this.persist(session);
      return;
    }
    session.tickInFlight = true;
    try {
      const snap = snapshotOf(session);
      const delta = await session.runTick(snap);
      const current = this.sessions.get(key);
      if (current === undefined) return;
      this.applyDeltaSkipTickCount(current, delta);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
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
        await this.persist(current);
      }
    }
  }

  private applyDelta(session: MutableSession, delta: HeartbeatTickDelta): void {
    session.tickCount += 1;
    this.applyDeltaSkipTickCount(session, delta);
    this.maybeAutoStop(session);
  }

  private maybeAutoStop(session: MutableSession): void {
    if (!session.running) return;
    if (session.tickCount < session.maxTicks) return;
    if (session.timer !== null) {
      this.clearIntervalImpl(session.timer);
      session.timer = null;
    }
    session.running = false;
  }

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
