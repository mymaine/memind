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
 * acceptable per `docs/decisions/2026-04-20-sse-and-runs-api.md`.
 */
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type {
  Artifact,
  LogEvent,
  RunKind,
  RunStatus,
  StatusEventPayload,
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
}

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
  | { type: 'status'; data: StatusEventPayload };

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
