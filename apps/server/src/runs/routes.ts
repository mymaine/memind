/**
 * Runs REST + SSE handler.
 *
 *   POST   /api/runs             — create a run, fire-and-forget orchestrator
 *   GET    /api/runs/:id         — final (or in-progress) snapshot
 *   GET    /api/runs/:id/events  — SSE stream: log / artifact / status
 */
import type Anthropic from '@anthropic-ai/sdk';
import type { Express, Request, Response } from 'express';
import { z } from 'zod';
import {
  artifactSchema,
  chatMessageSchema,
  createRunRequestSchema,
  runSnapshotSchema,
  type Artifact,
  type ChatMessage,
  type CreateRunRequest,
  type RunSnapshot,
} from '@hack-fourmeme/shared';
import type { AppConfig } from '../config.js';
import type { LoreStore } from '../state/lore-store.js';
import type { AnchorLedger } from '../state/anchor-ledger.js';
import { ShillOrderStore } from '../state/shill-order-store.js';
import { HeartbeatSessionStore } from '../state/heartbeat-session-store.js';
import type { ArtifactLogStore } from '../state/artifact-log-store.js';
import type { RunStore, RunEvent } from './store.js';
import { HeartbeatEventBus, type HeartbeatTickEvent } from './heartbeat-events.js';
import { runA2ADemo, type RunA2ADemoArgs } from './a2a.js';
import { runHeartbeatDemo } from './heartbeat-runner.js';
import {
  runShillMarketDemo,
  type CreatorPaymentPhaseFn,
  type RunShillMarketDemoArgs,
} from './shill-market.js';
import { runBrainChat } from './brain-chat.js';

/**
 * Default Phase 2 validated BSC mainnet demo token — mirrors the CLI
 * (demos/demo-a2a-run.ts) so HTTP and CLI entry points share the same default
 * `args` payload.
 */
export const DEFAULT_DEMO_ARGS: RunA2ADemoArgs = {
  tokenAddr: '0x4E39d254c716D88Ae52D9cA136F0a029c5F74444',
  tokenName: 'HBNB2026-DemoToken',
  tokenSymbol: 'HBNB2026',
};

/**
 * Signature of the function invoked by `POST /api/runs` to actually run the
 * demo. Injectable so tests can swap in a fake that pushes synthetic events
 * without touching LLM / USDC / IPFS infra.
 */
export type RunA2ADemoFn = typeof runA2ADemo;

/**
 * Signature of the V2-P3 dashboard heartbeat runner. Mirrors `RunA2ADemoFn`:
 * injectable so routes.test can feed a fake and a real runHeartbeatDemo is
 * wired in production.
 */
export type RunHeartbeatDemoFn = typeof runHeartbeatDemo;

/**
 * Signature of the P4.6-3 shill-market orchestrator. Injectable so routes.test
 * can feed a fake and the real `runShillMarketDemo` is wired in production.
 */
export type RunShillMarketDemoFn = typeof runShillMarketDemo;

/**
 * Signature of the BRAIN-P3 brain-chat orchestrator. Injectable so routes.test
 * can feed a fake and the real `runBrainChat` is wired in production.
 */
export type RunBrainChatFn = typeof runBrainChat;

export interface RegisterRunRoutesDeps {
  config: AppConfig;
  anthropic: Anthropic;
  runStore: RunStore;
  loreStore: LoreStore;
  /**
   * Shared AnchorLedger instance. The a2a run narrator phase appends one row
   * per chapter upsert; an optional Anchor Evidence panel endpoint may read
   * from the same ledger to surface commitments between runs. Optional so
   * legacy boot paths still work, but production entry points should pass it.
   */
  anchorLedger?: AnchorLedger;
  /**
   * Shared ShillOrderStore instance (Phase 4.6). Required when the caller
   * wants `kind: 'shill-market'` runs to work — the orchestrator hands it to
   * every phase so the x402 producer and the Shiller consumer hit the same
   * queue. Optional so legacy boot paths (CLI demos) that only use `a2a` /
   * `heartbeat` modes keep compiling without wiring a queue they don't need.
   */
  shillOrderStore?: ShillOrderStore;
  /**
   * Shared HeartbeatSessionStore (BRAIN-P9). Required when the caller wants
   * `/heartbeat <addr> <intervalMs>` via brain-chat to start a real
   * long-lived background loop — without it the route falls back to a fresh
   * store per run and `/heartbeat-stop` on a later run cannot find the
   * session started earlier. Optional so legacy CLI boot paths still work.
   */
  heartbeatSessionStore?: HeartbeatSessionStore;
  /**
   * Shared `HeartbeatEventBus` that receives every tick the shared
   * `heartbeatSessionStore` records. The `/api/heartbeats/:tokenAddr/events`
   * SSE endpoint subscribes to this bus so web clients see every tick in
   * real time. Optional: the route falls back to a fresh per-request bus
   * when omitted so CLI-only boot paths still compile, but production MUST
   * wire the same bus instance that the session store's `onAfterTick` hook
   * emits into — otherwise the SSE stream will never fire.
   */
  heartbeatEventBus?: HeartbeatEventBus;
  /**
   * Shared `ArtifactLogStore` (Postgres migration). When wired, `GET
   * /api/artifacts` reads from here; otherwise the endpoint 503s with a
   * clear message so CLI-only boot paths don't silently return empty.
   */
  artifactLogStore?: ArtifactLogStore;
  /**
   * Test hook — overrides the real `runA2ADemo` pure function. Production
   * callers leave this undefined.
   */
  runA2ADemoImpl?: RunA2ADemoFn;
  /** Test hook — overrides the real `runHeartbeatDemo`. */
  runHeartbeatDemoImpl?: RunHeartbeatDemoFn;
  /** Test hook — overrides the real `runShillMarketDemo`. */
  runShillMarketDemoImpl?: RunShillMarketDemoFn;
  /** Test hook — overrides the real `runBrainChat`. */
  runBrainChatImpl?: RunBrainChatFn;
  /**
   * Optional real creator-payment phase for dashboard shill-market runs.
   * When provided, the orchestrator drives `@x402/fetch` against the server's
   * own `/shill/:tokenAddr` endpoint so the settlement artifact carries a
   * genuine Base Sepolia USDC tx hash instead of the zero-sentinel stub.
   * CLI demos leave this undefined (stub mode keeps `pnpm test` USDC-free).
   */
  shillCreatorPaymentImpl?: CreatorPaymentPhaseFn;
}

const SSE_KEEPALIVE_MS = 20_000;

// Minimal EVM address shape — used to validate the heartbeat mode payload.
// Kept local so the route layer doesn't drag the tool-status schema in for a
// one-liner check.
const EVM_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

// BRAIN-P3: messages payload schema for `kind: 'brain-chat'`. Array of
// OpenAI-style `{role, content}` entries with at least one turn so the LLM
// has something to respond to. Kept at the route boundary so HTTP callers
// get a 400 for empty / malformed payloads before the orchestrator boots.
const brainChatMessagesSchema = z.array(chatMessageSchema).min(1);

/**
 * `GET /api/artifacts?limit=N` parser. Defaults to 20, caps at 100. Zod
 * rejects negatives / non-integers / non-numeric strings with a 400.
 */
const limitSchema = z
  .string()
  .optional()
  .transform((v) => (v ?? '20').trim())
  .pipe(z.string().regex(/^\d+$/, 'limit must be a positive integer'))
  .transform((v) => Number.parseInt(v, 10))
  .pipe(z.number().int().min(1).max(100));

export function registerRunRoutes(app: Express, deps: RegisterRunRoutesDeps): void {
  const { config, anthropic, runStore, loreStore } = deps;
  const runImpl = deps.runA2ADemoImpl ?? runA2ADemo;
  const heartbeatImpl = deps.runHeartbeatDemoImpl ?? runHeartbeatDemo;
  const shillMarketImpl = deps.runShillMarketDemoImpl ?? runShillMarketDemo;
  const brainChatImpl = deps.runBrainChatImpl ?? runBrainChat;
  // Fresh per-request bus if none was wired — matches the other store
  // fallbacks. Note: without a shared instance, ticks produced elsewhere in
  // the process will never reach this subscription (the onAfterTick hook on
  // the session store only knows about the bus wired into `index.ts`).
  const heartbeatEventBus = deps.heartbeatEventBus ?? new HeartbeatEventBus();

  // ─── POST /api/runs ──────────────────────────────────────────────────────
  app.post('/api/runs', (req: Request, res: Response) => {
    const parsed = createRunRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid request', details: parsed.error.issues });
      return;
    }
    const body: CreateRunRequest = parsed.data;

    // ─── V2-P3: heartbeat dispatch ─────────────────────────────────────────
    if (body.kind === 'heartbeat') {
      const paramsRecord = body.params;
      const rawTokenAddress =
        paramsRecord && typeof paramsRecord.tokenAddress === 'string'
          ? paramsRecord.tokenAddress.trim()
          : '';
      if (rawTokenAddress === '') {
        res
          .status(400)
          .json({ error: 'heartbeat mode requires params.tokenAddress (BSC mainnet address)' });
        return;
      }
      if (!EVM_ADDRESS_REGEX.test(rawTokenAddress)) {
        res.status(400).json({
          error: 'heartbeat mode tokenAddress must match /^0x[a-fA-F0-9]{40}$/',
          tokenAddress: rawTokenAddress,
        });
        return;
      }

      const tryResult = runStore.tryCreate({
        kind: 'heartbeat',
        tokenAddress: rawTokenAddress,
      });
      if (!tryResult.ok) {
        res.status(409).json({
          error: tryResult.error,
          existingRunId: tryResult.existingRunId,
        });
        return;
      }
      const record = tryResult.record;
      res.status(201).json({ runId: record.runId });

      void heartbeatImpl({
        anthropic,
        store: runStore,
        runId: record.runId,
        tokenAddress: rawTokenAddress,
        config,
      })
        .then(() => {
          runStore.setStatus(record.runId, 'done');
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          runStore.setStatus(record.runId, 'error', message);
        });
      return;
    }

    // ─── P4.6-3: shill-market dispatch ─────────────────────────────────────
    if (body.kind === 'shill-market') {
      const paramsRecord = body.params ?? {};
      const rawTokenAddr =
        typeof paramsRecord.tokenAddr === 'string' ? paramsRecord.tokenAddr.trim() : '';
      if (!EVM_ADDRESS_REGEX.test(rawTokenAddr)) {
        res.status(400).json({
          error: 'shill-market mode requires params.tokenAddr (EVM address)',
          tokenAddr: rawTokenAddr,
        });
        return;
      }

      // ShillOrderStore is the queue the orchestrator + x402 handler both
      // touch. Without it the run cannot produce any useful work, so we
      // refuse loudly instead of silently creating a broken RunRecord.
      if (deps.shillOrderStore === undefined) {
        res.status(500).json({
          error: 'shill-market mode requires shillOrderStore to be wired into the server',
        });
        return;
      }
      const shillOrderStore = deps.shillOrderStore;

      // Length caps mirror postShillForInputSchema so oversized payloads are
      // rejected at the HTTP boundary before reaching the LLM context window.
      const SHILL_SYMBOL_MAX = 32;
      const SHILL_BRIEF_MAX = 500;
      const rawSymbol =
        typeof paramsRecord.tokenSymbol === 'string' ? paramsRecord.tokenSymbol.trim() : '';
      if (rawSymbol.length > SHILL_SYMBOL_MAX) {
        res.status(400).json({
          error: `shill-market tokenSymbol must be <= ${String(SHILL_SYMBOL_MAX)} chars`,
        });
        return;
      }
      const rawBrief =
        typeof paramsRecord.creatorBrief === 'string' ? paramsRecord.creatorBrief.trim() : '';
      if (rawBrief.length > SHILL_BRIEF_MAX) {
        res
          .status(400)
          .json({ error: `shill-market creatorBrief must be <= ${String(SHILL_BRIEF_MAX)} chars` });
        return;
      }
      const tokenSymbol = rawSymbol !== '' ? rawSymbol : undefined;
      const creatorBrief = rawBrief !== '' ? rawBrief : undefined;
      // Tweet-mode toggle (2026-04-19). Dashboard OrderPanel sends a boolean;
      // absence defaults to safe mode (URL-free tweet) per the 7-day X OAuth
      // cooldown rail. We collapse absence + non-boolean garbage to `false`
      // at this boundary so downstream code never sees `undefined` sneaking
      // through. Orchestrator still threads the explicit bool to every deps
      // layer so logs / artifacts can distinguish mode later if needed.
      const includeFourMemeUrl =
        typeof paramsRecord.includeFourMemeUrl === 'boolean'
          ? paramsRecord.includeFourMemeUrl
          : false;

      const tryResult = runStore.tryCreate({
        kind: 'shill-market',
        tokenAddress: rawTokenAddr,
      });
      if (!tryResult.ok) {
        res.status(409).json({
          error: tryResult.error,
          existingRunId: tryResult.existingRunId,
        });
        return;
      }
      const record = tryResult.record;
      res.status(201).json({ runId: record.runId });

      const args: RunShillMarketDemoArgs = {
        tokenAddr: rawTokenAddr,
        ...(tokenSymbol !== undefined ? { tokenSymbol } : {}),
        ...(creatorBrief !== undefined ? { creatorBrief } : {}),
        includeFourMemeUrl,
      };
      void shillMarketImpl({
        config,
        anthropic,
        store: runStore,
        runId: record.runId,
        args,
        shillOrderStore,
        loreStore,
        ...(deps.shillCreatorPaymentImpl !== undefined
          ? { creatorPaymentImpl: deps.shillCreatorPaymentImpl }
          : {}),
      })
        .then(() => {
          runStore.setStatus(record.runId, 'done');
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          runStore.setStatus(record.runId, 'error', message);
        });
      return;
    }

    // ─── BRAIN-P3: brain-chat dispatch ─────────────────────────────────────
    if (body.kind === 'brain-chat') {
      const paramsRecord = body.params ?? {};
      const rawMessages = paramsRecord.messages;
      const parsedMessages = brainChatMessagesSchema.safeParse(rawMessages);
      if (!parsedMessages.success) {
        res.status(400).json({
          error: 'brain-chat mode requires params.messages (non-empty ChatMessage[])',
          details: parsedMessages.error.issues,
        });
        return;
      }
      const messages: ChatMessage[] = parsedMessages.data;

      // No per-token concurrency mutex for brain-chat: the meta-agent may
      // target different tokens on different turns, and the spec describes
      // the session as stateless (client ships full message history each
      // POST). tryCreate without tokenAddress skips the mutex by design.
      const record = runStore.tryCreate({ kind: 'brain-chat' });
      if (!record.ok) {
        // Reachable only if the shared tryCreate contract changes. Kept for
        // symmetry with the other dispatch branches.
        res.status(409).json({
          error: record.error,
          existingRunId: record.existingRunId,
        });
        return;
      }
      const created = record.record;
      res.status(201).json({ runId: created.runId });

      // shillOrderStore is optional at the server-boot level but the Brain
      // orchestrator always needs one (the `invoke_shiller` tool's resolver
      // inspects it). Fall back to a fresh empty instance when the caller
      // did not wire a shared store — matches the spec's "single server
      // instance demo" rail without coupling the route to a real queue.
      const brainShillOrderStore = deps.shillOrderStore ?? new ShillOrderStore();
      // heartbeatSessionStore is also optional at boot but required by the
      // Brain orchestrator. Fall back to a fresh per-request store so the
      // tool factory has something to write to; this means `/heartbeat-stop`
      // on a later run only works when the server boot wired a shared
      // instance (production does — see apps/server/src/index.ts).
      const brainHeartbeatSessionStore = deps.heartbeatSessionStore ?? new HeartbeatSessionStore();

      void brainChatImpl({
        config,
        anthropic,
        store: runStore,
        runId: created.runId,
        messages,
        loreStore,
        shillOrderStore: brainShillOrderStore,
        heartbeatSessionStore: brainHeartbeatSessionStore,
        // Thread the same creator-payment impl shill-market runs use so
        // brain-chat's `/order` slash fires a real x402 settlement when
        // AGENT_WALLET_PRIVATE_KEY is configured; tests leave it undefined
        // and fall back to stubCreatorPaymentPhase.
        ...(deps.shillCreatorPaymentImpl !== undefined
          ? { creatorPaymentImpl: deps.shillCreatorPaymentImpl }
          : {}),
      })
        .then(() => {
          runStore.setStatus(created.runId, 'done');
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          runStore.setStatus(created.runId, 'error', message);
        });
      return;
    }

    if (body.kind !== 'a2a') {
      res.status(400).json({ error: 'kind not yet implemented', kind: body.kind });
      return;
    }

    // Allow the client to override `tokenAddr` via `params.tokenAddr` (the
    // schema already permits arbitrary params). Name / symbol stay on the
    // CLI defaults — the demo uses a fixed pre-deployed token.
    const args: RunA2ADemoArgs = { ...DEFAULT_DEMO_ARGS };
    const paramsRecord = body.params;
    if (
      paramsRecord &&
      typeof paramsRecord.tokenAddr === 'string' &&
      paramsRecord.tokenAddr.trim() !== ''
    ) {
      args.tokenAddr = paramsRecord.tokenAddr;
    }
    // V2-P5 Task 1: surface the user's theme from ThemeInput → Creator agent.
    if (
      paramsRecord &&
      typeof paramsRecord.theme === 'string' &&
      paramsRecord.theme.trim() !== ''
    ) {
      args.theme = paramsRecord.theme.trim();
    }

    // Per-tokenAddress concurrency mutex (V2-P1 AC-V2-9). When the client
    // supplies a tokenAddr we forward it to RunStore.tryCreate; a second
    // call with the same address while the first run is still active gets a
    // 409 + existingRunId so the dashboard can toast "already running".
    const tryResult = runStore.tryCreate({ kind: 'a2a', tokenAddress: args.tokenAddr });
    if (!tryResult.ok) {
      res.status(409).json({
        error: tryResult.error,
        existingRunId: tryResult.existingRunId,
      });
      return;
    }
    const record = tryResult.record;
    // Respond 201 BEFORE the run kicks off: the client must have the runId
    // in hand so it can open the SSE stream before the first event fires.
    res.status(201).json({ runId: record.runId });

    // Fire-and-forget: the caller drives progress via the SSE stream.
    void runImpl({
      config,
      anthropic,
      store: runStore,
      runId: record.runId,
      args,
      loreStore,
      // Thread the shared AnchorLedger into the orchestrator so the default
      // narrator phase captures an anchor per chapter upsert. Absent: demo
      // boot paths that don't care about anchor evidence still work.
      ...(deps.anchorLedger ? { anchorLedger: deps.anchorLedger } : {}),
    })
      .then(() => {
        runStore.setStatus(record.runId, 'done');
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        runStore.setStatus(record.runId, 'error', message);
      });
  });

  // ─── GET /api/runs/:id ───────────────────────────────────────────────────
  app.get('/api/runs/:id', (req: Request, res: Response) => {
    const runId = req.params.id;
    if (typeof runId !== 'string') {
      res.status(400).json({ error: 'invalid run id' });
      return;
    }
    const record = runStore.get(runId);
    if (!record) {
      res.status(404).json({ error: 'run not found', runId });
      return;
    }
    const snapshot: RunSnapshot = {
      runId: record.runId,
      kind: record.kind,
      status: record.status,
      startedAt: record.startedAt,
      ...(record.endedAt !== undefined ? { endedAt: record.endedAt } : {}),
      artifacts: record.artifacts,
      logs: record.logs,
      ...(record.errorMessage !== undefined ? { errorMessage: record.errorMessage } : {}),
    };
    // Parse through the zod schema as a defensive contract check — if the
    // in-memory record ever drifts from the wire shape we want to see a 500
    // in testing, not silent wire corruption.
    const validated = runSnapshotSchema.parse(snapshot);
    res.json(validated);
  });

  // ─── GET /api/artifacts ──────────────────────────────────────────────────
  // Ch12 evidence hydration. Returns the most recent artifacts in
  // `created_at DESC` order so the reviewer sees real on-chain proof even
  // before kicking off a live run. Every row is revalidated through the
  // shared `artifactSchema` before leaving the server; invalid legacy rows
  // are dropped with a warn log so one bad row never 500s the whole page.
  app.get('/api/artifacts', (req: Request, res: Response) => {
    void (async () => {
      const limitParam = typeof req.query.limit === 'string' ? req.query.limit : '20';
      const parsed = limitSchema.safeParse(limitParam);
      if (!parsed.success) {
        res.status(400).json({ error: 'invalid limit', details: parsed.error.issues });
        return;
      }
      const store = deps.artifactLogStore;
      if (store === undefined) {
        res.status(503).json({
          error: 'artifactLogStore not wired — server is running without persistence',
        });
        return;
      }
      try {
        const rows = await store.listRecent(parsed.data);
        // Defensive parse: the store itself already filters, but this keeps
        // the wire contract honest if a caller subclasses / stubs the store.
        const artifacts: Artifact[] = [];
        for (const row of rows) {
          const check = artifactSchema.safeParse(row);
          if (check.success) {
            artifacts.push(check.data);
          } else {
            console.warn('[artifacts] /api/artifacts dropped invalid row', check.error.issues);
          }
        }
        res.json({ artifacts });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: `artifactLogStore failed: ${message}` });
      }
    })();
  });

  // ─── GET /api/runs/:id/events ────────────────────────────────────────────
  app.get('/api/runs/:id/events', (req: Request, res: Response) => {
    const runId = req.params.id;
    if (typeof runId !== 'string' || !runStore.get(runId)) {
      res.status(404).json({ error: 'run not found', runId });
      return;
    }

    // SSE headers.
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    let terminated = false;
    let unsubscribe: (() => void) | null = null;

    // Keepalive: a bare SSE comment line (starts with `:`) resets idle proxy
    // timers without producing any client-visible event. We schedule before
    // subscribing so a long-running run with no events still keeps the TCP
    // connection warm.
    const keepalive = setInterval(() => {
      if (terminated) return;
      res.write(': ping\n\n');
    }, SSE_KEEPALIVE_MS);
    // Do not let the keepalive timer keep the Node event loop alive on its
    // own — shutdown should not block on it.
    keepalive.unref();

    function teardown(endResponse: boolean): void {
      if (terminated) return;
      terminated = true;
      clearInterval(keepalive);
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
      if (endResponse) {
        res.end();
      }
    }

    unsubscribe = runStore.subscribe(runId, (event: RunEvent) => {
      if (terminated) return;
      // Write the event in SSE framing: `event: <name>` + `data: <json>` +
      // blank line separator.
      res.write(`event: ${event.type}\n`);
      res.write(`data: ${JSON.stringify(event.data)}\n\n`);

      // Close the stream on terminal status — the client's EventSource will
      // attempt to reconnect otherwise.
      if (event.type === 'status') {
        const { status } = event.data;
        if (status === 'done' || status === 'error') {
          teardown(true);
        }
      }
    });

    req.on('close', () => {
      // Client hung up — release the subscription and timer but do NOT call
      // res.end(): the socket is already gone.
      teardown(false);
    });
  });

  // ─── GET /api/heartbeats/:tokenAddr/events ───────────────────────────────
  // Live SSE feed for a single heartbeat session. On subscribe we emit one
  // `initial` event carrying the current session snapshot (or `null` when
  // no session exists) so reconnecting clients can render "tick 3/5 running"
  // without waiting for the next scheduler fire. Each subsequent
  // `HeartbeatTickEvent` lands as a `tick` event. When a tick transitions
  // the session into `running=false` we also emit a terminal `session-ended`
  // event and close the stream — the client can wrap its UI state cleanly
  // without polling.
  app.get('/api/heartbeats/:tokenAddr/events', (req: Request, res: Response) => {
    const rawAddr = req.params.tokenAddr;
    if (typeof rawAddr !== 'string' || !EVM_ADDRESS_REGEX.test(rawAddr)) {
      res.status(400).json({ error: 'invalid tokenAddr', tokenAddr: rawAddr });
      return;
    }
    const tokenAddr = rawAddr.toLowerCase();

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    let terminated = false;
    let unsubscribe: (() => void) | null = null;

    const keepalive = setInterval(() => {
      if (terminated) return;
      res.write(': ping\n\n');
    }, SSE_KEEPALIVE_MS);
    keepalive.unref();

    function teardown(endResponse: boolean): void {
      if (terminated) return;
      terminated = true;
      clearInterval(keepalive);
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
      if (endResponse) {
        res.end();
      }
    }

    // Send the initial snapshot BEFORE subscribing so the client always sees
    // the replay frame first. If the session store read fails we still
    // advertise an explicit `null` snapshot so the client's state machine
    // can flip to "no session" without timing out.
    void (async () => {
      let snapshot = null;
      if (deps.heartbeatSessionStore !== undefined) {
        try {
          const result = await deps.heartbeatSessionStore.get(tokenAddr);
          snapshot = result ?? null;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.warn(`[heartbeat-events] initial snapshot read failed: ${message}`);
        }
      }
      if (terminated) return;
      res.write(`event: initial\n`);
      res.write(`data: ${JSON.stringify({ tokenAddr, snapshot })}\n\n`);

      unsubscribe = heartbeatEventBus.subscribe(tokenAddr, (event: HeartbeatTickEvent) => {
        if (terminated) return;
        res.write(`event: tick\n`);
        res.write(`data: ${JSON.stringify(event)}\n\n`);
        // Auto-close once the session transitions to stopped (explicit stop,
        // hit the cap, etc.). Emit an explicit `session-ended` sentinel so
        // the client can branch on it instead of inferring from snapshot.
        if (event.snapshot.running === false) {
          res.write(`event: session-ended\n`);
          res.write(`data: ${JSON.stringify({ tokenAddr, snapshot: event.snapshot })}\n\n`);
          teardown(true);
        }
      });
    })();

    req.on('close', () => {
      teardown(false);
    });
  });
}
