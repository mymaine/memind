import type Anthropic from '@anthropic-ai/sdk';
import type { LogEvent } from '@hack-fourmeme/shared';
import type { ToolRegistry } from '../tools/registry.js';
import { runAgentLoop } from './runtime.js';

/**
 * Configuration for a HeartbeatAgent. `runAgentLoopImpl` is a test seam that
 * defaults to the real runtime; production callers never set it.
 */
export interface HeartbeatAgentConfig {
  client: Anthropic;
  model: string;
  registry: ToolRegistry;
  systemPrompt: string;
  buildUserInput: (ctx: { tickId: string; tickAt: string }) => string;
  intervalMs: number;
  /** Hard ceiling on tool-use rounds per tick. Default: 5. */
  maxTurnsPerTick?: number;
  onLog?: (event: LogEvent) => void;
  /** Override the underlying loop (tests only). */
  runAgentLoopImpl?: typeof runAgentLoop;
}

/**
 * Observable snapshot of heartbeat state. All fields are read-only copies so
 * consumers (e.g. dashboard SSE feed) cannot mutate internal counters.
 */
export interface HeartbeatState {
  readonly lastTickAt: string | null;
  readonly lastTickId: string | null;
  readonly successCount: number;
  readonly errorCount: number;
  readonly skippedCount: number;
  readonly lastError: string | null;
}

const DEFAULT_MAX_TURNS_PER_TICK = 5;

/**
 * Periodic tick driver that wraps `runAgentLoop`. One HeartbeatAgent owns one
 * setInterval handle; the scheduler callback guards against overlapping ticks
 * while the explicit `tick()` method bypasses that guard so tests (and ad-hoc
 * operators) can always force a run.
 *
 * Error isolation: a failing tick never propagates out of the agent — the loop
 * keeps ticking until `shutdown()` is called. This matches the Phase 3 spec
 * risk mitigation: "setInterval + error isolation + graceful shutdown hook".
 */
export class HeartbeatAgent {
  private readonly config: HeartbeatAgentConfig;
  private readonly runLoop: typeof runAgentLoop;
  private timer: ReturnType<typeof setInterval> | null = null;
  private isTickRunning = false;
  private _running = false;

  // Mutable internal counters. `state` returns a frozen snapshot.
  private _lastTickAt: string | null = null;
  private _lastTickId: string | null = null;
  private _successCount = 0;
  private _errorCount = 0;
  private _skippedCount = 0;
  private _lastError: string | null = null;

  constructor(config: HeartbeatAgentConfig) {
    this.config = config;
    this.runLoop = config.runAgentLoopImpl ?? runAgentLoop;
  }

  get state(): HeartbeatState {
    return {
      lastTickAt: this._lastTickAt,
      lastTickId: this._lastTickId,
      successCount: this._successCount,
      errorCount: this._errorCount,
      skippedCount: this._skippedCount,
      lastError: this._lastError,
    };
  }

  get running(): boolean {
    return this._running;
  }

  /**
   * Start the tick loop. Idempotent — repeated calls while already running
   * return immediately. Fires one tick right away (fire-and-forget) so demos
   * don't have to wait a full interval for the first output.
   *
   * Ordering contract (fixes start/shutdown race): install `setInterval`
   * synchronously BEFORE firing the first tick, and make the scheduler
   * callback re-check `_running` at the top. Without this, a
   * `start() → shutdown()` sequence in the same microtask (or a timer fire
   * that was queued a few ms before shutdown) could still trigger a tick
   * after clearInterval ran.
   */
  start(): void {
    if (this._running) return;
    this._running = true;

    this.timer = setInterval(() => {
      // Defensive re-check: a timer callback already dispatched before
      // shutdown() ran can still hit this closure once. Early-return so we
      // never call runOneTick after the agent has been asked to stop.
      if (!this._running) return;
      if (this.isTickRunning) {
        this._skippedCount += 1;
        this.emitLog('warn', 'skipping overlapping tick', {
          skippedCount: this._skippedCount,
        });
        return;
      }
      this.runOneTick().catch((err) => {
        this.emitLog('error', `tick scheduler crash: ${this.toMessage(err)}`);
      });
    }, this.config.intervalMs);

    // Fire-and-forget first tick AFTER the scheduler is installed. This
    // ordering keeps start() atomic — there is no window where the timer
    // is missing while the first tick is in flight.
    this.runOneTick().catch((err) => {
      this.emitLog('error', `tick bootstrap crash: ${this.toMessage(err)}`);
    });
    this.emitLog('info', 'heartbeat started');
  }

  /**
   * Run exactly one tick. Intended for tests and manual triggers; bypasses the
   * overlap guard so a caller can always force a run, but still flips the
   * `isTickRunning` flag so any concurrent scheduler callback observes it.
   */
  async tick(): Promise<void> {
    await this.runOneTick();
  }

  /**
   * Stop the scheduler. Idempotent. Does NOT await an in-flight tick; the
   * tick's own try/catch absorbs errors and updates state once it finishes.
   *
   * Ordering mirrors start(): flip `_running` first so any in-flight timer
   * callback that squeezed past the interval boundary bails at the
   * top-of-callback `!this._running` guard.
   */
  async shutdown(): Promise<void> {
    if (!this._running && this.timer === null) return;
    this._running = false;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.emitLog('info', 'heartbeat stopped');
  }

  private async runOneTick(): Promise<void> {
    this.isTickRunning = true;
    const tickAt = new Date().toISOString();
    const tickId = this.generateTickId();
    this._lastTickAt = tickAt;
    this._lastTickId = tickId;

    this.emitLog('info', 'tick start', { tickId, tickAt });

    try {
      await this.runLoop({
        client: this.config.client,
        model: this.config.model,
        registry: this.config.registry,
        systemPrompt: this.config.systemPrompt,
        userInput: this.config.buildUserInput({ tickId, tickAt }),
        maxTurns: this.config.maxTurnsPerTick ?? DEFAULT_MAX_TURNS_PER_TICK,
        onLog: this.config.onLog,
        agentId: 'heartbeat',
      });
      this._successCount += 1;
      this.emitLog('info', 'tick complete', { tickId });
    } catch (err) {
      const message = this.toMessage(err);
      this._errorCount += 1;
      this._lastError = message;
      this.emitLog('error', `tick failed: ${message}`, { tickId });
    } finally {
      this.isTickRunning = false;
    }
  }

  private emitLog(level: LogEvent['level'], message: string, meta?: Record<string, unknown>): void {
    if (!this.config.onLog) return;
    const event: LogEvent = {
      ts: new Date().toISOString(),
      agent: 'heartbeat',
      tool: 'runtime',
      level,
      message,
      ...(meta ? { meta } : {}),
    };
    this.config.onLog(event);
  }

  private generateTickId(): string {
    // Short, human-scannable id: tick_<timestamp>_<random>. No external deps.
    const ts = Date.now().toString(36);
    const rand = Math.random().toString(36).slice(2, 8);
    return `tick_${ts}_${rand}`;
  }

  private toMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
