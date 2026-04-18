/**
 * AC-V2-3 verification harness.
 *
 * Criterion: within a single run, the gap between any two consecutive SSE
 * events (log / artifact / status / tool_use:* / assistant:delta) must have
 * max ≤ 8000 ms and median ≤ 3000 ms.
 *
 * We cannot run the real LLM stack in unit tests (cost + determinism), so the
 * harness swaps in a fake `runA2ADemoImpl` that pushes a realistic dense
 * sequence of events through the RunStore while the test listens via an
 * HTTP SSE subscriber. Timing is produced by `performance.now()` as each
 * event hits the client — this verifies the wire path (store → emitter →
 * SSE route → `EventSource`-compatible newline-framing) does not accidentally
 * coalesce or buffer.
 *
 * The fake orchestrator emits roughly the same volume of events a real run
 * produces (3 phases × ~8 events each ≈ 24 events) and paces them with
 * `setImmediate` so the delays are non-zero but bounded. The spec's stated
 * thresholds are still checked so regressions that introduce a 10s+ stall
 * would trip this test.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express, { type Express } from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type Anthropic from '@anthropic-ai/sdk';
import { LoreStore } from '../state/lore-store.js';
import { RunStore } from './store.js';
import { registerRunRoutes } from './routes.js';
import type { RunA2ADemoDeps, RunA2ADemoFn } from './a2a.js';
import type { AppConfig } from '../config.js';

const MAX_LATENCY_MS = 8_000;
const MEDIAN_LATENCY_MS = 3_000;

function makeConfig(): AppConfig {
  return {
    port: 0,
    anthropic: { apiKey: undefined },
    openrouter: { apiKey: 'dummy' },
    pinata: { jwt: 'dummy' },
    wallets: {
      agent: { privateKey: '0xa'.padEnd(66, 'a') as `0x${string}`, address: undefined },
      bscDeployer: {
        privateKey: '0xb'.padEnd(66, 'b') as `0x${string}`,
        address: undefined,
      },
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

/**
 * Fake orchestrator that mimics the event density of a real a2a run without
 * touching the LLM / USDC / IPFS stacks. It fires assistant deltas and
 * tool_use events interleaved with status transitions so the test sees the
 * full SSE event taxonomy on the wire.
 */
const fakeOrchestrator: RunA2ADemoFn = async (deps: RunA2ADemoDeps) => {
  const { store, runId } = deps;
  store.setStatus(runId, 'running');

  const phases: Array<['creator' | 'narrator' | 'market-maker', number]> = [
    ['creator', 6],
    ['narrator', 6],
    ['market-maker', 6],
  ];

  for (const [agent, count] of phases) {
    for (let i = 0; i < count; i += 1) {
      const ts = new Date().toISOString();
      if (i === 0) {
        store.addToolUseStart(runId, {
          agent,
          toolName: `${agent}_tool`,
          toolUseId: `tu_${agent}_${i.toString()}`,
          input: { step: i },
          ts,
        });
      } else if (i === 1) {
        store.addAssistantDelta(runId, { agent, delta: 'thinking...', ts });
      } else if (i === 2) {
        store.addToolUseEnd(runId, {
          agent,
          toolName: `${agent}_tool`,
          toolUseId: `tu_${agent}_0`,
          output: { ok: true },
          isError: false,
          ts,
        });
      } else {
        store.addLog(runId, {
          ts,
          agent,
          tool: `${agent}_tool`,
          level: 'info',
          message: `step ${i.toString()}`,
        });
      }
      // Yield to the event loop — real OpenRouter chunks land ~50-200ms apart
      // for a warm model; we simulate with setImmediate to keep tests fast
      // while still exercising the non-synchronous delivery path.
      await new Promise<void>((r) => setImmediate(r));
    }
  }
};

describe('AC-V2-3 streaming latency', () => {
  let server: Server;
  let baseUrl: string;
  let runStore: RunStore;

  beforeAll(async () => {
    const app: Express = express();
    app.use(express.json());
    runStore = new RunStore();
    registerRunRoutes(app, {
      config: makeConfig(),
      anthropic: {} as Anthropic,
      runStore,
      loreStore: new LoreStore(),
      runA2ADemoImpl: fakeOrchestrator,
    });
    server = app.listen(0);
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port.toString()}`;
  });

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  it('keeps max gap ≤ 8s and median ≤ 3s across one run', async () => {
    // Kick off the run.
    const createRes = await fetch(`${baseUrl}/api/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'a2a' }),
    });
    expect(createRes.status).toBe(201);
    const { runId } = (await createRes.json()) as { runId: string };

    // Subscribe to the SSE stream. Node's native `fetch` returns a ReadableStream
    // for text/event-stream — we read chunks and note the arrival time of each
    // `event:` line.
    const eventRes = await fetch(`${baseUrl}/api/runs/${runId}/events`);
    expect(eventRes.status).toBe(200);
    expect(eventRes.headers.get('content-type')).toMatch(/text\/event-stream/);

    const reader = eventRes.body?.getReader();
    if (!reader) throw new Error('missing SSE body reader');
    const decoder = new TextDecoder();
    const arrivals: number[] = [];
    let terminated = false;
    let buffered = '';

    while (!terminated) {
      const { done, value } = await reader.read();
      if (done) break;
      buffered += decoder.decode(value, { stream: true });
      // SSE events are separated by `\n\n`. Track arrivals per event-start.
      // We count each block that contains an `event:` line.
      let idx: number;
      while ((idx = buffered.indexOf('\n\n')) !== -1) {
        const block = buffered.slice(0, idx);
        buffered = buffered.slice(idx + 2);
        if (block.includes('event: ')) {
          arrivals.push(performance.now());
        }
        if (block.includes('event: status')) {
          // Check whether this is the terminal status — the server closes
          // the socket after emitting `done` or `error`, but catching it here
          // guarantees we stop reading promptly.
          if (block.includes('"done"') || block.includes('"error"')) {
            terminated = true;
          }
        }
      }
    }

    // We should have seen the 18 synthetic events plus at least one status.
    // The exact count depends on event-loop timing (the `subscribe` replay
    // may capture the `running` status already fired by setStatus, turning
    // what would have been two separate deliveries into one), so we assert
    // a safe lower bound rather than an exact count.
    expect(arrivals.length).toBeGreaterThanOrEqual(15);

    const gaps: number[] = [];
    for (let i = 1; i < arrivals.length; i += 1) {
      const prev = arrivals[i - 1];
      const cur = arrivals[i];
      if (prev === undefined || cur === undefined) continue;
      gaps.push(cur - prev);
    }
    const sorted = [...gaps].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
    const max = sorted[sorted.length - 1] ?? 0;

    // Document the observed distribution in the test output for debugging.
    // These numbers are load-bearing for AC-V2-3; if they ever creep up, the
    // stall is somewhere in the store → SSE path.
    expect(max).toBeLessThanOrEqual(MAX_LATENCY_MS);
    expect(median).toBeLessThanOrEqual(MEDIAN_LATENCY_MS);
  }, 20_000);
});
