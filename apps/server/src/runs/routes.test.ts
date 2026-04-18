import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import http from 'node:http';
import type Anthropic from '@anthropic-ai/sdk';
import express from 'express';
import type { AppConfig } from '../config.js';
import { LoreStore } from '../state/lore-store.js';
import { RunStore } from './store.js';
import { registerRunRoutes, type RunA2ADemoFn } from './routes.js';

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
  close: () => Promise<void>;
}

function startHarness(runImpl: RunA2ADemoFn): Promise<Harness> {
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
  });
});
