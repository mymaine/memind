import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { LogEvent, Persona, PersonaRunContext } from '@hack-fourmeme/shared';
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
 * Structured decision the heartbeat LLM returns at the end of every tick
 * (see SYSTEM_PROMPT — the model is required to emit a
 * `{"action": "post_to_x"|"extend_lore"|"idle", "reason": "..."}` JSON
 * blob). We capture it here so the persona's caller (Brain invoke layer,
 * SSE chat bubble) can explain WHY the agent did what it did without
 * re-parsing the final text themselves.
 */
export interface HeartbeatTickDecision {
  readonly action: 'post' | 'extend_lore' | 'idle';
  readonly reason: string;
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
  /**
   * Most recent parsed decision (null before the first successful tick or
   * when the LLM's final text was unparseable). Consumers should treat a
   * `null` decision as "the tick ran but produced no interpretable
   * action" — we never fabricate a decision, the field stays null.
   */
  readonly lastDecision: HeartbeatTickDecision | null;
}

const DEFAULT_MAX_TURNS_PER_TICK = 5;

/**
 * Extract the `{action, reason}` JSON the heartbeat system prompt
 * contractually requires from the LLM's final message. Tolerant of
 * surrounding whitespace, markdown fences, or trailing prose; maps the
 * prompt's `post_to_x` wire spelling to our UI-facing `post` enum AND
 * collapses the three "do nothing" spellings (`skip`, `idle`, empty) to
 * `idle` so downstream consumers get a clean three-valued enum.
 * Returns `null` when no parseable JSON exists — the caller writes that
 * through verbatim rather than fabricating a decision.
 *
 * Duplicates the behavioural contract of `heartbeat-runner.parseTickDecision`
 * intentionally: that helper collapses `idle` → `skip` for the runner's
 * artifact schema, which is backward-incompatible with the persona /
 * chat-bubble surface. Keeping a dedicated parser here sidesteps a
 * circular import (heartbeat-runner already imports HeartbeatAgent).
 */
// Exported for test corpus coverage only. Renamed from `parseTickDecision`
// to `parseHeartbeatTickDecision` to avoid a naming collision with
// `heartbeat-runner.parseTickDecision` (different behavioural contract —
// see the doc comment above). Production code still imports and calls the
// symbol internally via `parseTickDecision` below.
export function parseHeartbeatTickDecision(finalText: string): HeartbeatTickDecision | null {
  return parseTickDecision(finalText);
}

function parseTickDecision(finalText: string): HeartbeatTickDecision | null {
  const firstBrace = finalText.indexOf('{');
  const lastBrace = finalText.lastIndexOf('}');
  if (firstBrace < 0 || lastBrace <= firstBrace) return null;
  const candidate = finalText.slice(firstBrace, lastBrace + 1);
  let parsed: { action?: unknown; reason?: unknown };
  try {
    parsed = JSON.parse(candidate) as { action?: unknown; reason?: unknown };
  } catch {
    return null;
  }
  const rawAction = typeof parsed.action === 'string' ? parsed.action : '';
  const reason =
    typeof parsed.reason === 'string' && parsed.reason.trim() !== ''
      ? parsed.reason.trim()
      : 'no reason provided';
  if (rawAction === 'post' || rawAction === 'post_to_x') return { action: 'post', reason };
  if (rawAction === 'extend_lore') return { action: 'extend_lore', reason };
  if (rawAction === 'idle' || rawAction === 'skip' || rawAction === '')
    return { action: 'idle', reason };
  return null;
}

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
  private _lastDecision: HeartbeatTickDecision | null = null;

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
      lastDecision: this._lastDecision,
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
      const loop = await this.runLoop({
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
      // Parse the LLM's final decision JSON so downstream consumers (Brain
      // invoke layer, SSE chat bubble) can show WHY this tick did what it
      // did. We rely on the system prompt's hard contract that the final
      // text is a `{action, reason}` JSON object; anything unparseable
      // leaves _lastDecision at null (honest — do not guess).
      this._lastDecision = parseTickDecision(loop.finalText);
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

// ---------------------------------------------------------------------------
// Persona adapter — Brain positioning (2026-04-19).
// ---------------------------------------------------------------------------
// `heartbeatPersona.run(...)` constructs a one-shot HeartbeatAgent, runs a
// single `tick()`, and returns the resulting state snapshot. The long-lived
// `start()` / `shutdown()` mode remains the preferred entry-point for the
// actual service process (see apps/server/src/runs/heartbeat-runner.ts);
// the persona adapter is the uniform contract surface used by the Brain
// pluggable-persona registry. `intervalMs` is accepted and forwarded so the
// ctor signature stays uniform with the standalone class, but no timer is
// ever started by the adapter — shutdown is implicit.
// ---------------------------------------------------------------------------

export const heartbeatPersonaInputSchema = z.object({
  model: z.string().min(1),
  systemPrompt: z.string().min(1),
  /** See the `z.custom` note on `onLog` below — same reasoning applies. */
  buildUserInput: z.custom<(ctx: { tickId: string; tickAt: string }) => string>(
    (v) => typeof v === 'function',
  ),
  intervalMs: z.number().int().positive().default(60_000),
  maxTurnsPerTick: z.number().int().positive().optional(),
  /**
   * `onLog` / `buildUserInput` / `runAgentLoopImpl` are typed as z.custom
   * rather than z.function(): zod's `function()` helper wraps the callback
   * and re-validates its return value, which would reject our `(e) => void`
   * callbacks whose real implementation returns whatever `Array.push` does.
   * `z.custom` performs a minimal runtime check (callable) and preserves
   * the original function verbatim.
   */
  onLog: z.custom<(event: LogEvent) => void>((v) => typeof v === 'function').optional(),
  runAgentLoopImpl: z.custom<typeof runAgentLoop>((v) => typeof v === 'function').optional(),
});
export type HeartbeatPersonaInput = z.input<typeof heartbeatPersonaInputSchema>;

export const heartbeatPersonaOutputSchema = z.object({
  lastTickAt: z.string().nullable(),
  lastTickId: z.string().nullable(),
  successCount: z.number().int().nonnegative(),
  errorCount: z.number().int().nonnegative(),
  skippedCount: z.number().int().nonnegative(),
  lastError: z.string().nullable(),
  // Parsed LLM decision for the just-finished tick (null if the tick
  // errored or the final text was unparseable). See `HeartbeatTickDecision`.
  lastDecision: z
    .object({
      action: z.enum(['post', 'extend_lore', 'idle']),
      reason: z.string(),
    })
    .nullable(),
});
export type HeartbeatPersonaOutput = z.infer<typeof heartbeatPersonaOutputSchema>;

export const heartbeatPersona: Persona<HeartbeatPersonaInput, HeartbeatPersonaOutput> = {
  id: 'heartbeat',
  description:
    'Heartbeat persona — runs exactly one tick of the HeartbeatAgent loop and returns the state snapshot. Long-lived scheduling stays in HeartbeatAgent itself.',
  inputSchema: heartbeatPersonaInputSchema,
  outputSchema: heartbeatPersonaOutputSchema,
  async run(input, ctx: PersonaRunContext) {
    const parsed = heartbeatPersonaInputSchema.parse(input);
    const agent = new HeartbeatAgent({
      client: ctx.client as Anthropic,
      model: parsed.model,
      registry: ctx.registry as ToolRegistry,
      systemPrompt: parsed.systemPrompt,
      buildUserInput: parsed.buildUserInput as (ctx: { tickId: string; tickAt: string }) => string,
      intervalMs: parsed.intervalMs,
      ...(parsed.maxTurnsPerTick !== undefined ? { maxTurnsPerTick: parsed.maxTurnsPerTick } : {}),
      ...(parsed.onLog !== undefined ? { onLog: parsed.onLog as (e: LogEvent) => void } : {}),
      ...(parsed.runAgentLoopImpl !== undefined
        ? { runAgentLoopImpl: parsed.runAgentLoopImpl as typeof runAgentLoop }
        : {}),
    });
    await agent.tick();
    // Snapshot is a frozen readonly view — clone into a plain object so zod
    // parse does not reject readonly index signatures.
    const snapshot = agent.state;
    return {
      lastTickAt: snapshot.lastTickAt,
      lastTickId: snapshot.lastTickId,
      successCount: snapshot.successCount,
      errorCount: snapshot.errorCount,
      skippedCount: snapshot.skippedCount,
      lastError: snapshot.lastError,
      lastDecision: snapshot.lastDecision,
    };
  },
};
