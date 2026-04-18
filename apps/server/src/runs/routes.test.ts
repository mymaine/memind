import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import http from 'node:http';
import type Anthropic from '@anthropic-ai/sdk';
import express from 'express';
import type { AppConfig } from '../config.js';
import { LoreStore } from '../state/lore-store.js';
import { ShillOrderStore } from '../state/shill-order-store.js';
import { RunStore } from './store.js';
import {
  registerRunRoutes,
  type RunA2ADemoFn,
  type RunHeartbeatDemoFn,
  type RunShillMarketDemoFn,
} from './routes.js';
import { runHeartbeatDemo } from './heartbeat-runner.js';
import type { AgentLoopResult, runAgentLoop } from '../agents/runtime.js';

/**
 * Route-level coverage for POST /api/runs + GET /api/runs/:id + GET
 * /api/runs/:id/events.
 *
 * We mock the runA2ADemo implementation with a fake that pushes one log +
 * one artifact into the RunStore and resolves — the HTTP contract is
 * independent of the real LLM / USDC / IPFS infra. `supertest` is not
 * installed and we were told not to add it, so we spin up a real ephemeral
 * HTTP server and hit it with raw `http.request` / `fetch`.
 */

function makeConfigStub(): AppConfig {
  // The routes only forward `config` verbatim into runA2ADemoImpl, so the
  // stub only needs to be assignment-compatible with AppConfig. We fill the
  // required branches with sane defaults.
  return {
    port: 0,
    anthropic: { apiKey: undefined },
    openrouter: { apiKey: 'dummy' },
    pinata: { jwt: 'dummy' },
    wallets: {
      agent: { privateKey: undefined, address: undefined },
      bscDeployer: { privateKey: undefined, address: undefined },
    },
    x402: { facilitatorUrl: 'https://x402.org/facilitator', network: 'eip155:84532' },
    bsc: { rpcUrl: 'https://bsc-dataseed.binance.org' },
    heartbeat: { intervalMs: 60_000 },
    x: {
      apiKey: undefined,
      apiKeySecret: undefined,
      accessToken: undefined,
      accessTokenSecret: undefined,
      bearerToken: undefined,
      handle: undefined,
    },
  };
}

interface Harness {
  app: express.Express;
  server: Server;
  baseUrl: string;
  runStore: RunStore;
  loreStore: LoreStore;
  shillOrderStore?: ShillOrderStore;
  close: () => Promise<void>;
}

interface StartHarnessOptions {
  heartbeatImpl?: RunHeartbeatDemoFn;
  shillMarketImpl?: RunShillMarketDemoFn;
  shillOrderStore?: ShillOrderStore;
}

function startHarness(
  runImpl: RunA2ADemoFn,
  optsOrHeartbeat?: RunHeartbeatDemoFn | StartHarnessOptions,
): Promise<Harness> {
  // Backwards-compat: older tests pass a heartbeat impl as the 2nd positional
  // arg. New shill-market tests pass an options object. Normalise here so the
  // existing call sites need no edits.
  const opts: StartHarnessOptions =
    typeof optsOrHeartbeat === 'function'
      ? { heartbeatImpl: optsOrHeartbeat }
      : (optsOrHeartbeat ?? {});

  const app = express();
  app.use(express.json({ limit: '1mb' }));
  const runStore = new RunStore();
  const loreStore = new LoreStore();
  const anthropic = {} as Anthropic; // never invoked — fake runA2ADemo ignores it.
  registerRunRoutes(app, {
    config: makeConfigStub(),
    anthropic,
    runStore,
    loreStore,
    runA2ADemoImpl: runImpl,
    ...(opts.heartbeatImpl !== undefined ? { runHeartbeatDemoImpl: opts.heartbeatImpl } : {}),
    ...(opts.shillMarketImpl !== undefined ? { runShillMarketDemoImpl: opts.shillMarketImpl } : {}),
    ...(opts.shillOrderStore !== undefined ? { shillOrderStore: opts.shillOrderStore } : {}),
  });

  const server = app.listen(0);
  return new Promise<Harness>((resolveFn) => {
    server.once('listening', () => {
      const address = server.address() as AddressInfo;
      const baseUrl = `http://127.0.0.1:${address.port.toString()}`;
      resolveFn({
        app,
        server,
        baseUrl,
        runStore,
        loreStore,
        ...(opts.shillOrderStore !== undefined ? { shillOrderStore: opts.shillOrderStore } : {}),
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

describe('registerRunRoutes', () => {
  let harness: Harness;

  afterEach(async () => {
    if (harness) await harness.close();
  });

  describe('POST /api/runs', () => {
    beforeEach(async () => {
      const fakeRun: RunA2ADemoFn = async (deps) => {
        // Push one log and one artifact so the route test also doubles as a
        // smoke test for the store → SSE wiring.
        deps.store.addLog(deps.runId, {
          ts: new Date().toISOString(),
          agent: 'narrator',
          tool: 'orchestrator',
          level: 'info',
          message: 'fake run: hello',
        });
        deps.store.addArtifact(deps.runId, {
          kind: 'lore-cid',
          cid: 'bafkreifake',
          gatewayUrl: 'https://gateway.pinata.cloud/ipfs/bafkreifake',
          author: 'narrator',
          chapterNumber: 1,
        });
      };
      harness = await startHarness(fakeRun);
    });

    it('returns 201 and a runId for kind=a2a', async () => {
      const response = await fetch(`${harness.baseUrl}/api/runs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'a2a' }),
      });
      expect(response.status).toBe(201);
      const body = (await response.json()) as { runId?: string };
      expect(typeof body.runId).toBe('string');
      expect(body.runId).toMatch(/^run_/);
    });

    // V2-P5 Task 1: params.theme surfaces through to runA2ADemo args.
    it('forwards params.theme to runA2ADemo args', async () => {
      let observedTheme: string | undefined;
      const fakeRun: RunA2ADemoFn = async (deps) => {
        observedTheme = deps.args.theme;
      };
      // Restart the harness with a theme-observing fake (previous harness uses
      // the default beforeEach fake).
      await harness.close();
      harness = await startHarness(fakeRun);

      const response = await fetch(`${harness.baseUrl}/api/runs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'a2a',
          params: { theme: 'Cyberpunk Neko detective in Neo-Tokyo 2099' },
        }),
      });
      expect(response.status).toBe(201);
      await new Promise((r) => setTimeout(r, 20));
      expect(observedTheme).toBe('Cyberpunk Neko detective in Neo-Tokyo 2099');
    });

    it('returns 400 for kind=creator (not yet implemented)', async () => {
      const response = await fetch(`${harness.baseUrl}/api/runs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'creator' }),
      });
      expect(response.status).toBe(400);
      const body = (await response.json()) as { error?: string; kind?: string };
      expect(body.error).toMatch(/not yet implemented/);
      expect(body.kind).toBe('creator');
    });

    // ─── V2-P3 Task 3: heartbeat dispatch ──────────────────────────────────
    it('returns 400 for kind=heartbeat without tokenAddress', async () => {
      const response = await fetch(`${harness.baseUrl}/api/runs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'heartbeat' }),
      });
      expect(response.status).toBe(400);
      const body = (await response.json()) as { error?: string };
      expect(body.error).toMatch(/tokenAddress/);
    });

    it('returns 400 for kind=heartbeat with malformed tokenAddress', async () => {
      const response = await fetch(`${harness.baseUrl}/api/runs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'heartbeat',
          params: { tokenAddress: 'not-an-address' },
        }),
      });
      expect(response.status).toBe(400);
    });
  });

  describe('POST /api/runs (heartbeat dispatch)', () => {
    const tokenAddress = '0x4E39d254c716D88Ae52D9cA136F0a029c5F74444';

    it('returns 201 + runId and invokes the heartbeat runner with the tokenAddress', async () => {
      let observedToken: string | undefined;
      let observedRunId: string | undefined;
      const fakeHeartbeat: RunHeartbeatDemoFn = async (deps) => {
        observedToken = deps.tokenAddress;
        observedRunId = deps.runId;
        deps.store.addArtifact(deps.runId, {
          kind: 'heartbeat-tick',
          tickNumber: 1,
          totalTicks: 3,
          decisions: [],
        });
      };
      const fakeA2A: RunA2ADemoFn = async () => {};
      harness = await startHarness(fakeA2A, fakeHeartbeat);

      const response = await fetch(`${harness.baseUrl}/api/runs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'heartbeat', params: { tokenAddress } }),
      });
      expect(response.status).toBe(201);
      const body = (await response.json()) as { runId?: string };
      expect(typeof body.runId).toBe('string');

      // Give the fire-and-forget dispatch a tick to land.
      await new Promise((r) => setTimeout(r, 20));
      expect(observedToken).toBe(tokenAddress);
      expect(observedRunId).toBe(body.runId);
    });

    it('returns 409 when a second heartbeat run targets the same tokenAddress', async () => {
      const longRunningFake: RunHeartbeatDemoFn = () => new Promise(() => {});
      const fakeA2A: RunA2ADemoFn = async () => {};
      harness = await startHarness(fakeA2A, longRunningFake);

      const first = await fetch(`${harness.baseUrl}/api/runs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'heartbeat', params: { tokenAddress } }),
      });
      expect(first.status).toBe(201);
      const firstBody = (await first.json()) as { runId?: string };

      const second = await fetch(`${harness.baseUrl}/api/runs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'heartbeat', params: { tokenAddress } }),
      });
      expect(second.status).toBe(409);
      const secondBody = (await second.json()) as { error?: string; existingRunId?: string };
      expect(secondBody.error).toBe('run_in_progress');
      expect(secondBody.existingRunId).toBe(firstBody.runId);
    });

    it('returns 409 when a heartbeat run collides with an active a2a run on the same tokenAddress', async () => {
      const longRunningA2A: RunA2ADemoFn = () => new Promise(() => {});
      const fakeHeartbeat: RunHeartbeatDemoFn = async () => {};
      harness = await startHarness(longRunningA2A, fakeHeartbeat);

      const first = await fetch(`${harness.baseUrl}/api/runs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'a2a', params: { tokenAddr: tokenAddress } }),
      });
      expect(first.status).toBe(201);

      const second = await fetch(`${harness.baseUrl}/api/runs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'heartbeat', params: { tokenAddress } }),
      });
      expect(second.status).toBe(409);
    });
  });

  // ─── V2-P3 Task 6: heartbeat SSE round-trip end-to-end ────────────────────
  // Drive the REAL runHeartbeatDemo through POST /api/runs + GET /events and
  // assert the wire carries exactly 3 heartbeat-tick artifacts + at least 1
  // heartbeat-decision + 1 tweet-url. We inject a fake runAgentLoop so the
  // test never talks to Anthropic / X / viem.
  describe('heartbeat SSE round-trip (V2-P3 Task 6 · AC-V2-4)', () => {
    it('streams 3 heartbeat-tick + heartbeat-decision + tweet-url over SSE', async () => {
      const tokenAddress = '0x4E39d254c716D88Ae52D9cA136F0a029c5F74444';

      const fakeLoop = (async (): Promise<AgentLoopResult> => ({
        finalText: '{"action":"post","reason":"demo tick"}',
        toolCalls: [
          {
            name: 'post_to_x',
            input: { text: 'hello $HBNB' },
            output: {
              tweetId: '1830000000000000777',
              text: 'hello $HBNB',
              postedAt: '2026-04-20T10:00:00.000Z',
              url: 'https://x.com/agent/status/1830000000000000777',
            },
            isError: false,
          },
        ],
        trace: [],
        stopReason: 'end_turn',
      })) as unknown as typeof runAgentLoop;

      const heartbeatBridge: RunHeartbeatDemoFn = (deps) =>
        runHeartbeatDemo({
          ...deps,
          tickCount: 3,
          intervalMs: 10,
          sleepImpl: async () => {},
          runAgentLoopImpl: fakeLoop,
        });

      const fakeA2A: RunA2ADemoFn = async () => {};
      harness = await startHarness(fakeA2A, heartbeatBridge);

      const create = await fetch(`${harness.baseUrl}/api/runs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'heartbeat', params: { tokenAddress } }),
      });
      expect(create.status).toBe(201);
      const { runId } = (await create.json()) as { runId: string };

      const received = await new Promise<string>((resolveFn, rejectFn) => {
        const url = new URL(`${harness.baseUrl}/api/runs/${runId}/events`);
        const req = http.request(
          {
            hostname: url.hostname,
            port: Number(url.port),
            path: url.pathname,
            method: 'GET',
            headers: { accept: 'text/event-stream' },
          },
          (res) => {
            expect(res.statusCode).toBe(200);
            let buf = '';
            res.setEncoding('utf8');
            res.on('data', (chunk: string) => {
              buf += chunk;
            });
            res.on('end', () => resolveFn(buf));
            res.on('error', rejectFn);
          },
        );
        req.on('error', rejectFn);
        req.end();
      });

      // Exactly 3 heartbeat-tick events.
      const tickMatches = received.match(/"kind":"heartbeat-tick"/g) ?? [];
      expect(tickMatches).toHaveLength(3);

      // At least 1 heartbeat-decision + 1 tweet-url.
      expect(received).toMatch(/"kind":"heartbeat-decision"/);
      expect(received).toMatch(/"action":"post"/);
      expect(received).toMatch(/"kind":"tweet-url"/);
      expect(received).toMatch(/"tweetId":"1830000000000000777"/);

      // Stream must close with a `done` status so the client EventSource
      // does not keep the connection open.
      expect(received).toMatch(/"status":"done"/);
    }, 10_000);
  });

  // Restore these `POST /api/runs` error cases that got pulled into the
  // heartbeat describe block above; they need the a2a-flavoured beforeEach
  // harness (no special heartbeat fake required).
  describe('POST /api/runs (body validation)', () => {
    beforeEach(async () => {
      const fakeRun: RunA2ADemoFn = async () => {};
      harness = await startHarness(fakeRun);
    });

    it('returns 400 for a body missing kind', async () => {
      const response = await fetch(`${harness.baseUrl}/api/runs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ foo: 'bar' }),
      });
      expect(response.status).toBe(400);
      const body = (await response.json()) as { error?: string };
      expect(body.error).toBe('invalid request');
    });

    it('returns 400 for a body with an unknown kind value', async () => {
      const response = await fetch(`${harness.baseUrl}/api/runs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'nope' }),
      });
      expect(response.status).toBe(400);
    });
  });

  // ─── P4.6-3: shill-market mode dispatch ─────────────────────────────────
  describe('POST /api/runs (shill-market dispatch)', () => {
    const tokenAddr = '0x4E39d254c716D88Ae52D9cA136F0a029c5F74444';

    it('returns 201 + runId and invokes runShillMarketDemoImpl with the tokenAddr', async () => {
      let observedTokenAddr: string | undefined;
      let observedTokenSymbol: string | undefined;
      let observedCreatorBrief: string | undefined;
      let observedRunId: string | undefined;
      const shillOrderStore = new ShillOrderStore();
      const fakeShillMarket: RunShillMarketDemoFn = async (deps) => {
        observedTokenAddr = deps.args.tokenAddr;
        observedTokenSymbol = deps.args.tokenSymbol;
        observedCreatorBrief = deps.args.creatorBrief;
        observedRunId = deps.runId;
      };
      const fakeA2A: RunA2ADemoFn = async () => {};
      harness = await startHarness(fakeA2A, {
        shillMarketImpl: fakeShillMarket,
        shillOrderStore,
      });

      const response = await fetch(`${harness.baseUrl}/api/runs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'shill-market',
          params: {
            tokenAddr,
            tokenSymbol: 'HBNB2026-BAT',
            creatorBrief: 'make it weird',
          },
        }),
      });
      expect(response.status).toBe(201);
      const body = (await response.json()) as { runId?: string };
      expect(typeof body.runId).toBe('string');

      await new Promise((r) => setTimeout(r, 20));
      expect(observedTokenAddr).toBe(tokenAddr);
      expect(observedTokenSymbol).toBe('HBNB2026-BAT');
      expect(observedCreatorBrief).toBe('make it weird');
      expect(observedRunId).toBe(body.runId);
    });

    it('returns 400 for kind=shill-market with invalid tokenAddr', async () => {
      const shillOrderStore = new ShillOrderStore();
      const fakeShillMarket: RunShillMarketDemoFn = async () => {};
      const fakeA2A: RunA2ADemoFn = async () => {};
      harness = await startHarness(fakeA2A, {
        shillMarketImpl: fakeShillMarket,
        shillOrderStore,
      });

      const response = await fetch(`${harness.baseUrl}/api/runs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'shill-market',
          params: { tokenAddr: 'not-an-address' },
        }),
      });
      expect(response.status).toBe(400);
      const body = (await response.json()) as { error?: string };
      expect(body.error).toMatch(/tokenAddr/);
    });

    it('returns 500 for kind=shill-market when shillOrderStore is not wired', async () => {
      const fakeShillMarket: RunShillMarketDemoFn = async () => {};
      const fakeA2A: RunA2ADemoFn = async () => {};
      // No `shillOrderStore` passed — the route layer must refuse with 500.
      harness = await startHarness(fakeA2A, {
        shillMarketImpl: fakeShillMarket,
      });

      const response = await fetch(`${harness.baseUrl}/api/runs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'shill-market',
          params: { tokenAddr },
        }),
      });
      expect(response.status).toBe(500);
      const body = (await response.json()) as { error?: string };
      expect(body.error).toMatch(/shillOrderStore/);
    });
  });

  describe('POST /api/runs concurrency mutex (V2-P1 AC-V2-9)', () => {
    beforeEach(async () => {
      // Long-running fake so the first run stays active while the second
      // POST attempts to start. The harness stays open for the test life.
      const longRunningFake: RunA2ADemoFn = () => new Promise(() => {});
      harness = await startHarness(longRunningFake);
    });

    it('returns 409 when a second a2a run targets the same tokenAddr', async () => {
      const tokenAddr = '0x4E39d254c716D88Ae52D9cA136F0a029c5F74444';
      const first = await fetch(`${harness.baseUrl}/api/runs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'a2a', params: { tokenAddr } }),
      });
      expect(first.status).toBe(201);
      const firstBody = (await first.json()) as { runId?: string };

      const second = await fetch(`${harness.baseUrl}/api/runs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'a2a', params: { tokenAddr } }),
      });
      expect(second.status).toBe(409);
      const secondBody = (await second.json()) as { error?: string; existingRunId?: string };
      expect(secondBody.error).toBe('run_in_progress');
      expect(secondBody.existingRunId).toBe(firstBody.runId);
    });

    it('allows concurrent a2a runs when tokenAddr differs', async () => {
      const first = await fetch(`${harness.baseUrl}/api/runs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'a2a',
          params: { tokenAddr: '0x4E39d254c716D88Ae52D9cA136F0a029c5F74444' },
        }),
      });
      expect(first.status).toBe(201);

      const second = await fetch(`${harness.baseUrl}/api/runs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'a2a',
          params: { tokenAddr: '0x1111111111111111111111111111111111111111' },
        }),
      });
      expect(second.status).toBe(201);
    });
  });

  // ─── V2-P1 Task 6: end-to-end SSE delivery of the meme-image artifact ────
  // Playwright would be the natural fit but the project ban on new deps
  // takes priority — instead we drive the dashboard contract (POST + SSE
  // with the new artifact kind) through real HTTP so any wire-format
  // regression on meme-image still trips a CI gate.
  describe('end-to-end SSE wire format for meme-image artifact', () => {
    beforeEach(async () => {
      const fakeRun: RunA2ADemoFn = async (deps) => {
        // Synthetic Creator emission so we can assert the meme-image artifact
        // round-trips end-to-end. The real Creator phase emits the same shape
        // via runs/creator-phase.ts.
        deps.store.addArtifact(deps.runId, {
          kind: 'meme-image',
          status: 'ok',
          cid: 'bafybeiTESTMEME',
          gatewayUrl: 'https://gateway.pinata.cloud/ipfs/bafybeiTESTMEME',
          prompt: 'a cyberpunk neko detective',
        });
        deps.store.addArtifact(deps.runId, {
          kind: 'meme-image',
          status: 'upload-failed',
          cid: null,
          gatewayUrl: null,
          prompt: 'a different theme',
          errorMessage: 'pinata timed out',
        });
      };
      harness = await startHarness(fakeRun);
    });

    it('streams both meme-image variants verbatim through SSE', async () => {
      const create = await fetch(`${harness.baseUrl}/api/runs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'a2a' }),
      });
      expect(create.status).toBe(201);
      const { runId } = (await create.json()) as { runId: string };

      // Drive the SSE end-to-end by collecting up to ~1.5s of events.
      const received = await new Promise<string>((resolveFn, rejectFn) => {
        const url = new URL(`${harness.baseUrl}/api/runs/${runId}/events`);
        const req = http.request(
          {
            hostname: url.hostname,
            port: Number(url.port),
            path: url.pathname,
            method: 'GET',
            headers: { accept: 'text/event-stream' },
          },
          (res) => {
            expect(res.statusCode).toBe(200);
            let buf = '';
            res.setEncoding('utf8');
            res.on('data', (chunk: string) => {
              buf += chunk;
            });
            res.on('end', () => resolveFn(buf));
            res.on('error', rejectFn);
          },
        );
        req.on('error', rejectFn);
        req.end();
        // Mark the run done after a short delay so the SSE handler closes
        // the connection and resolves the buffer.
        setTimeout(() => harness.runStore.setStatus(runId, 'done'), 120);
      });

      expect(received).toMatch(/"kind":"meme-image"/);
      expect(received).toMatch(/"status":"ok"/);
      expect(received).toMatch(/"cid":"bafybeiTESTMEME"/);
      expect(received).toMatch(/"status":"upload-failed"/);
      expect(received).toMatch(/"errorMessage":"pinata timed out"/);
    }, 5_000);
  });

  describe('GET /api/runs/:id', () => {
    beforeEach(async () => {
      const fakeRun: RunA2ADemoFn = async () => {
        // no-op — we create runs manually below when we need one to exist.
      };
      harness = await startHarness(fakeRun);
    });

    it('returns 404 for an unknown runId', async () => {
      const response = await fetch(`${harness.baseUrl}/api/runs/run_missing`);
      expect(response.status).toBe(404);
    });

    it('returns a snapshot for an existing run', async () => {
      const record = harness.runStore.create('a2a');
      harness.runStore.setStatus(record.runId, 'done');

      const response = await fetch(`${harness.baseUrl}/api/runs/${record.runId}`);
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        runId?: string;
        kind?: string;
        status?: string;
      };
      expect(body.runId).toBe(record.runId);
      expect(body.kind).toBe('a2a');
      expect(body.status).toBe('done');
    });
  });

  describe('GET /api/runs/:id/events (SSE)', () => {
    beforeEach(async () => {
      // Manual fake: the test drives events into the store itself so we can
      // assert exact wire ordering without racing the background run.
      const fakeRun: RunA2ADemoFn = () => new Promise(() => {}); // never resolves
      harness = await startHarness(fakeRun);
    });

    it('returns 404 for an unknown runId', async () => {
      const response = await fetch(`${harness.baseUrl}/api/runs/run_missing/events`);
      expect(response.status).toBe(404);
    });

    it('streams log + artifact + terminal status events and closes', async () => {
      const record = harness.runStore.create('a2a');

      const received = await new Promise<string>((resolveFn, rejectFn) => {
        const url = new URL(`${harness.baseUrl}/api/runs/${record.runId}/events`);
        const req = http.request(
          {
            hostname: url.hostname,
            port: Number(url.port),
            path: url.pathname,
            method: 'GET',
            headers: { accept: 'text/event-stream' },
          },
          (res) => {
            expect(res.statusCode).toBe(200);
            expect(res.headers['content-type']).toMatch(/text\/event-stream/);
            let buf = '';
            res.setEncoding('utf8');
            res.on('data', (chunk: string) => {
              buf += chunk;
            });
            res.on('end', () => resolveFn(buf));
            res.on('error', rejectFn);
          },
        );
        req.on('error', rejectFn);
        req.end();

        // Give the server a tick to set up the subscription (which synchronously
        // replays the initial pending-status event) before we push more.
        setTimeout(() => {
          harness.runStore.addLog(record.runId, {
            ts: '2026-04-20T10:00:00.000Z',
            agent: 'narrator',
            tool: 'orchestrator',
            level: 'info',
            message: 'hello',
          });
          harness.runStore.addArtifact(record.runId, {
            kind: 'lore-cid',
            cid: 'bafkreifake',
            gatewayUrl: 'https://gateway.pinata.cloud/ipfs/bafkreifake',
            author: 'narrator',
            chapterNumber: 1,
          });
          harness.runStore.setStatus(record.runId, 'done');
        }, 50);
      });

      expect(received).toMatch(/event: status\ndata: \{"runId":"run_[^"]+","status":"pending"\}/);
      expect(received).toMatch(/event: log\ndata: \{[^\n]*"message":"hello"/);
      expect(received).toMatch(/event: artifact\ndata: \{[^\n]*"kind":"lore-cid"/);
      expect(received).toMatch(/event: status\ndata: \{[^\n]*"status":"done"/);

      // Ordering sanity: log appears before artifact, artifact before terminal
      // status.
      const logIdx = received.indexOf('event: log');
      const artifactIdx = received.indexOf('event: artifact');
      const doneIdx = received.indexOf('"status":"done"');
      expect(logIdx).toBeGreaterThan(-1);
      expect(artifactIdx).toBeGreaterThan(logIdx);
      expect(doneIdx).toBeGreaterThan(artifactIdx);
    }, 10_000);

    // AC3: lore-anchor artifacts must round-trip through the same SSE event
    // surface. The dashboard's AnchorLedgerPanel subscribes to the standard
    // `artifact` event and filters client-side — no dedicated SSE event name
    // is needed.
    it('streams a lore-anchor artifact verbatim through the artifact event', async () => {
      const record = harness.runStore.create('a2a');
      const TOKEN = '0x4e39d254c716d88ae52d9ca136f0a029c5f74444';
      const CONTENT_HASH = `0x${'a'.repeat(64)}` as const;
      const TX_HASH = `0x${'c'.repeat(64)}` as const;

      const received = await new Promise<string>((resolveFn, rejectFn) => {
        const url = new URL(`${harness.baseUrl}/api/runs/${record.runId}/events`);
        const req = http.request(
          {
            hostname: url.hostname,
            port: Number(url.port),
            path: url.pathname,
            method: 'GET',
            headers: { accept: 'text/event-stream' },
          },
          (res) => {
            expect(res.statusCode).toBe(200);
            let buf = '';
            res.setEncoding('utf8');
            res.on('data', (chunk: string) => {
              buf += chunk;
            });
            res.on('end', () => resolveFn(buf));
            res.on('error', rejectFn);
          },
        );
        req.on('error', rejectFn);
        req.end();

        setTimeout(() => {
          // Layer-1 anchor emission.
          harness.runStore.addArtifact(record.runId, {
            kind: 'lore-anchor',
            anchorId: `${TOKEN}-1`,
            tokenAddr: TOKEN,
            chapterNumber: 1,
            loreCid: 'bafkreibxxxxx',
            contentHash: CONTENT_HASH,
            ts: '2026-04-20T10:00:00.000Z',
          });
          // Layer-2 upgrade emission (same anchorId, now with tx details).
          harness.runStore.addArtifact(record.runId, {
            kind: 'lore-anchor',
            anchorId: `${TOKEN}-1`,
            tokenAddr: TOKEN,
            chapterNumber: 1,
            loreCid: 'bafkreibxxxxx',
            contentHash: CONTENT_HASH,
            onChainTxHash: TX_HASH,
            chain: 'bsc-mainnet',
            explorerUrl: `https://bscscan.com/tx/${TX_HASH}`,
            ts: '2026-04-20T10:00:10.000Z',
          });
          harness.runStore.setStatus(record.runId, 'done');
        }, 50);
      });

      // Both anchor emissions flow through the `artifact` SSE event.
      const anchorFrameMatches = received.match(
        /event: artifact\ndata: \{[^\n]*"kind":"lore-anchor"/g,
      );
      expect(anchorFrameMatches?.length ?? 0).toBe(2);
      // Layer-2 emission carries the on-chain trio.
      expect(received).toMatch(/"onChainTxHash":"0xcccccccc/);
      expect(received).toMatch(/"explorerUrl":"https:\/\/bscscan.com\/tx\/0xcccccccc/);
    }, 10_000);
  });
});
