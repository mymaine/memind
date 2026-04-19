/**
 * RunStore — in-memory lifecycle + event-bus for dashboard run executions.
 *
 * Mirrors the `LoreStore` pattern in `../state/lore-store.ts`: single-purpose
 * class, plain in-memory Map, zero persistence, `clear()` for tests. One
 * record per runId; an EventEmitter per record fans out live log / artifact /
 * status events to any subscribers (SSE handlers) while the orchestrator is
 * still producing them.
 *
 * Replay semantics: `subscribe()` immediately flushes every buffered log and
 * artifact — in insertion order — to the listener, followed by the current
 * status, before handing out real-time events. That makes late joiners
 * indistinguishable from early joiners from the client's perspective and
 * removes the need for SSE Last-Event-ID wiring on the hackathon timeline.
 *
 * No persistence is on purpose: single-process demo; restart-drops-runs is
 * acceptable.
 */
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type {
  Artifact,
  AssistantDeltaEventPayload,
  LogEvent,
  RunKind,
  RunStatus,
  StatusEventPayload,
  ToolUseEndEventPayload,
  ToolUseStartEventPayload,
} from '@hack-fourmeme/shared';

export interface RunRecord {
  runId: string;
  kind: RunKind;
  status: RunStatus;
  /** ISO 8601 timestamp assigned at create() time. */
  startedAt: string;
  /** Set when status transitions to `done` or `error`. */
  endedAt?: string;
  logs: LogEvent[];
  artifacts: Artifact[];
  errorMessage?: string;
  /**
   * Lower-cased BSC token address this run targets, when known up front.
   * `tryCreate()` uses this for the per-tokenAddress concurrency mutex
   * (V2-P1 AC-V2-9). The initial Creator step in an a2a run does NOT yet have
   * an address, so this field is left undefined and the mutex is skipped.
   */
  tokenAddress?: string;
}

/** Active statuses that hold the per-tokenAddress concurrency mutex. */
const ACTIVE_STATUSES = new Set<RunStatus>(['pending', 'running']);

export interface TryCreateInput {
  kind: RunKind;
  /**
   * Optional. When supplied, tryCreate enforces a per-tokenAddress mutex:
   * a second call with the same address (case-insensitive) while an earlier
   * run is still active returns `{ ok: false, error: 'run_in_progress' }`.
   * Distinct addresses run concurrently. Omit on the initial Creator step.
   */
  tokenAddress?: string;
}

export type TryCreateResult =
  | { ok: true; record: RunRecord }
  | { ok: false; error: 'run_in_progress'; existingRunId: string };

/**
 * Discriminated-union event shape pushed to a subscriber. `type` matches the
 * SSE `event:` field name the route handler will write on the wire. Using a
 * single union (not three separate listener arities) keeps the `EventEmitter`
 * channel simple and lets the SSE handler do one `switch (type)` for
 * serialisation.
 */
export type RunEvent =
  | { type: 'log'; data: LogEvent }
  | { type: 'artifact'; data: Artifact }
  | { type: 'status'; data: StatusEventPayload }
  // Fine-grained streaming events (V2-P2). These are NOT buffered by the store
  // because they do not need replay — late subscribers get the coarse log
  // summary from the `logs` buffer. We forward them live so the route layer
  // can emit matching SSE events.
  | { type: 'tool_use:start'; data: ToolUseStartEventPayload }
  | { type: 'tool_use:end'; data: ToolUseEndEventPayload }
  | { type: 'assistant:delta'; data: AssistantDeltaEventPayload };

export type RunEventListener = (event: RunEvent) => void;

const CHANNEL = 'event';

export class RunStore {
  private readonly records = new Map<string, RunRecord>();
  private readonly emitters = new Map<string, EventEmitter>();

  /**
   * Create a new run in `pending` state. Generates a UUID-flavoured runId
   * (URL-safe per the decision record). Returns the created record so callers
   * can immediately hand the id back to the HTTP client.
   */
  create(kind: RunKind): RunRecord {
    const runId = `run_${randomUUID()}`;
    const record: RunRecord = {
      runId,
      kind,
      status: 'pending',
      startedAt: new Date().toISOString(),
      logs: [],
      artifacts: [],
    };
    this.records.set(runId, record);
    // EventEmitter is lazy-created here so `subscribe()` can always bind to
    // something even if no event has fired yet.
    this.emitters.set(runId, new EventEmitter());
    return record;
  }

  /**
   * Create a new run with optional per-tokenAddress concurrency mutex
   * (V2-P1 AC-V2-9). When `tokenAddress` is supplied:
   *   - if any active run (status ∈ pending|running) already holds that
   *     address (case-insensitive compare), return a 409-shape result
   *   - otherwise create a fresh record tagged with the lower-cased address
   * When `tokenAddress` is omitted, behaves identically to `create(kind)`.
   *
   * Returning a discriminated result instead of throwing keeps the HTTP
   * route layer's mapping to status codes a one-liner switch.
   */
  tryCreate(input: TryCreateInput): TryCreateResult {
    const normalised = input.tokenAddress?.toLowerCase();
    if (normalised !== undefined) {
      for (const existing of this.records.values()) {
        if (existing.tokenAddress === normalised && ACTIVE_STATUSES.has(existing.status)) {
          return {
            ok: false,
            error: 'run_in_progress',
            existingRunId: existing.runId,
          };
        }
      }
    }
    const record = this.create(input.kind);
    if (normalised !== undefined) {
      record.tokenAddress = normalised;
    }
    return { ok: true, record };
  }

  /** Return the record for `runId`, or undefined if unknown. */
  get(runId: string): RunRecord | undefined {
    return this.records.get(runId);
  }

  /**
   * Transition run status. Records `endedAt` on terminal status (`done` /
   * `error`) and captures `errorMessage` when provided. Emits a `status`
   * event so any subscribers see the transition in real time.
   *
   * Calling this on an unknown runId is a silent no-op: the orchestrator may
   * race a cleared store in tests; failing loud there would swallow the
   * actual task error.
   */
  setStatus(runId: string, status: RunStatus, errorMessage?: string): void {
    const record = this.records.get(runId);
    if (!record) return;
    record.status = status;
    if (status === 'done' || status === 'error') {
      record.endedAt = new Date().toISOString();
    }
    if (errorMessage !== undefined) {
      record.errorMessage = errorMessage;
    }
    const payload: StatusEventPayload = {
      runId,
      status,
      ...(record.errorMessage !== undefined ? { errorMessage: record.errorMessage } : {}),
    };
    this.emit(runId, { type: 'status', data: payload });
  }

  /** Append a log event and fan it out to live subscribers. */
  addLog(runId: string, event: LogEvent): void {
    const record = this.records.get(runId);
    if (!record) return;
    record.logs.push(event);
    this.emit(runId, { type: 'log', data: event });
  }

  /** Append an artifact and fan it out to live subscribers. */
  addArtifact(runId: string, artifact: Artifact): void {
    const record = this.records.get(runId);
    if (!record) return;
    record.artifacts.push(artifact);
    this.emit(runId, { type: 'artifact', data: artifact });
  }

  // ─── Fine-grained streaming events (V2-P2) ───────────────────────────────
  // No per-record buffering: replay is handled by the coarse `logs` layer
  // (one LogEvent per tool invocation). These methods exist so callers never
  // have to reach into the emitter directly.

  /** Fire a tool_use:start event for live subscribers. */
  addToolUseStart(runId: string, payload: ToolUseStartEventPayload): void {
    if (!this.records.has(runId)) return;
    this.emit(runId, { type: 'tool_use:start', data: payload });
  }

  /** Fire a tool_use:end event for live subscribers. */
  addToolUseEnd(runId: string, payload: ToolUseEndEventPayload): void {
    if (!this.records.has(runId)) return;
    this.emit(runId, { type: 'tool_use:end', data: payload });
  }

  /** Fire an assistant:delta event for live subscribers. */
  addAssistantDelta(runId: string, payload: AssistantDeltaEventPayload): void {
    if (!this.records.has(runId)) return;
    this.emit(runId, { type: 'assistant:delta', data: payload });
  }

  /**
   * Subscribe to the run's event stream.
   *
   * Semantics:
   *   1. Synchronously replay every buffered log (in order), then every
   *      buffered artifact (in order), to the listener.
   *   2. Emit one `status` event reflecting the CURRENT status (which may
   *      already be terminal if the run completed before subscribe()).
   *   3. From here on, forward live events until the unsubscribe function
   *      returned by this call is invoked.
   *
   * Listeners that arrive after a run has already finished therefore see the
   * full history PLUS the terminal status in one synchronous burst; the SSE
   * handler can detect the terminal status and end the response accordingly.
   *
   * Returns a no-op-on-second-call `unsubscribe()` function.
   */
  subscribe(runId: string, listener: RunEventListener): () => void {
    const record = this.records.get(runId);
    if (!record) {
      // Unknown runId — hand back a no-op unsubscribe so callers don't branch
      // on subscribe() return type. The route layer 404s before reaching here
      // in practice.
      return (): void => {};
    }

    // 1. Replay buffered logs in insertion order.
    for (const log of record.logs) {
      listener({ type: 'log', data: log });
    }
    // 2. Replay buffered artifacts in insertion order.
    for (const artifact of record.artifacts) {
      listener({ type: 'artifact', data: artifact });
    }
    // 3. Replay current status. For a live run this is `pending` or
    //    `running`; for a completed run this is the terminal status and the
    //    SSE handler will close the response after delivering it.
    const statusPayload: StatusEventPayload = {
      runId,
      status: record.status,
      ...(record.errorMessage !== undefined ? { errorMessage: record.errorMessage } : {}),
    };
    listener({ type: 'status', data: statusPayload });

    // 4. Hook live updates.
    const emitter = this.getOrCreateEmitter(runId);
    const handler = (event: RunEvent): void => listener(event);
    emitter.on(CHANNEL, handler);

    let unsubscribed = false;
    return (): void => {
      if (unsubscribed) return;
      unsubscribed = true;
      emitter.off(CHANNEL, handler);
    };
  }

  /** Drop every run and emitter. Intended for test isolation only. */
  clear(): void {
    for (const emitter of this.emitters.values()) {
      emitter.removeAllListeners();
    }
    this.records.clear();
    this.emitters.clear();
  }

  private emit(runId: string, event: RunEvent): void {
    const emitter = this.emitters.get(runId);
    if (!emitter) return;
    emitter.emit(CHANNEL, event);
  }

  private getOrCreateEmitter(runId: string): EventEmitter {
    let emitter = this.emitters.get(runId);
    if (!emitter) {
      emitter = new EventEmitter();
      this.emitters.set(runId, emitter);
    }
    return emitter;
  }
}
