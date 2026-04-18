/**
 * Runs REST + SSE handler. Protocol lives in
 * `docs/decisions/2026-04-20-sse-and-runs-api.md` — any deviation from the
 * three endpoint shapes or the three SSE event names should update that
 * document first.
 *
 *   POST   /api/runs             — create a run, fire-and-forget orchestrator
 *   GET    /api/runs/:id         — final (or in-progress) snapshot
 *   GET    /api/runs/:id/events  — SSE stream: log / artifact / status
 */
import type Anthropic from '@anthropic-ai/sdk';
import type { Express, Request, Response } from 'express';
import {
  createRunRequestSchema,
  runSnapshotSchema,
  type CreateRunRequest,
  type RunSnapshot,
} from '@hack-fourmeme/shared';
import type { AppConfig } from '../config.js';
import type { LoreStore } from '../state/lore-store.js';
import type { AnchorLedger } from '../state/anchor-ledger.js';
import type { RunStore, RunEvent } from './store.js';
import { runA2ADemo, type RunA2ADemoArgs } from './a2a.js';
import { runHeartbeatDemo } from './heartbeat-runner.js';

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
   * Test hook — overrides the real `runA2ADemo` pure function. Production
   * callers leave this undefined.
   */
  runA2ADemoImpl?: RunA2ADemoFn;
  /** Test hook — overrides the real `runHeartbeatDemo`. */
  runHeartbeatDemoImpl?: RunHeartbeatDemoFn;
}

const SSE_KEEPALIVE_MS = 20_000;

// Minimal EVM address shape — used to validate the heartbeat mode payload.
// Kept local so the route layer doesn't drag the tool-status schema in for a
// one-liner check.
const EVM_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

export function registerRunRoutes(app: Express, deps: RegisterRunRoutesDeps): void {
  const { config, anthropic, runStore, loreStore } = deps;
  const runImpl = deps.runA2ADemoImpl ?? runA2ADemo;
  const heartbeatImpl = deps.runHeartbeatDemoImpl ?? runHeartbeatDemo;

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

  // ─── GET /api/runs/:id/events ────────────────────────────────────────────
  app.get('/api/runs/:id/events', (req: Request, res: Response) => {
    const runId = req.params.id;
    if (typeof runId !== 'string' || !runStore.get(runId)) {
      res.status(404).json({ error: 'run not found', runId });
      return;
    }

    // SSE headers — see docs/decisions/2026-04-20-sse-and-runs-api.md.
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
}
