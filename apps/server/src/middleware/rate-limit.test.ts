/**
 * Unit coverage for the rate-limit middleware.
 *
 * Approach: mount each limiter on a throwaway Express app backed by an
 * ephemeral listener, then hit it with `fetch`. This matches the existing
 * HTTP test style in `apps/server/src/runs/routes.test.ts` and avoids the
 * fragility of poking the middleware through ad-hoc req/res stubs. Each test
 * resets the limiter for its target IP so windows do not bleed between cases.
 *
 * `x-forwarded-for` is used to impersonate client IPs — `app.set('trust
 * proxy', 1)` makes Express read `req.ip` from the left-most forwarded entry,
 * which is exactly the production path (Railway / Fly inject this header).
 */
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { RequestHandler } from 'express';
import type { RateLimitRequestHandler } from 'express-rate-limit';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  API_RUNS_LONG_WINDOW_MAX,
  API_RUNS_SHORT_WINDOW_MAX,
  SHILL_WINDOW_MAX,
  apiRunsRateLimiters,
  isLoopback,
  shillRateLimiter,
} from './rate-limit.js';

// ─── Harness ───────────────────────────────────────────────────────────────

interface Harness {
  baseUrl: string;
  close: () => Promise<void>;
}

async function startHarness(handlers: readonly RequestHandler[]): Promise<Harness> {
  const app = express();
  // Mirror production: trust the first proxy hop so `req.ip` reflects the
  // x-forwarded-for client address in tests.
  app.set('trust proxy', 1);
  app.post('/target', ...handlers, (_req, res) => {
    res.status(200).json({ ok: true });
  });
  return new Promise<Harness>((resolve) => {
    const server: Server = app.listen(0, () => {
      const address = server.address() as AddressInfo;
      resolve({
        baseUrl: `http://127.0.0.1:${address.port.toString()}`,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

async function post(harness: Harness, clientIp: string): Promise<Response> {
  return fetch(`${harness.baseUrl}/target`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': clientIp,
    },
    body: '{}',
  });
}

function resetLimiter(limiter: RequestHandler, ip: string): void {
  (limiter as RateLimitRequestHandler).resetKey(ip);
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('isLoopback', () => {
  it('matches IPv4 / IPv6 / IPv4-mapped-IPv6 loopback literals', () => {
    expect(isLoopback('127.0.0.1')).toBe(true);
    expect(isLoopback('::1')).toBe(true);
    expect(isLoopback('::ffff:127.0.0.1')).toBe(true);
  });

  it('rejects non-loopback and undefined', () => {
    expect(isLoopback('10.0.0.1')).toBe(false);
    expect(isLoopback('2001:db8::1')).toBe(false);
    expect(isLoopback(undefined)).toBe(false);
  });

  // Edge cases the upstream middleware should never surface (req.ip is
  // always an IP literal, never a DNS name or empty string) but we lock
  // the contract down anyway so a future refactor cannot silently widen
  // the exemption to hostnames — `localhost` resolving to loopback is
  // DNS's job, not this function's.
  it('does not treat empty string, null, or hostnames as loopback', () => {
    expect(isLoopback('')).toBe(false);
    // Cast to the accepted union via `undefined` — `null` is not in the
    // declared type but may slip in from a malformed proxy chain. We keep
    // the test as a forward-compat guard.
    expect(isLoopback(null as unknown as undefined)).toBe(false);
    expect(isLoopback('localhost')).toBe(false);
  });
});

describe('apiRunsRateLimiters (POST /api/runs)', () => {
  const shortIp = '203.0.113.1';
  const longIp = '203.0.113.2';
  let harness: Harness;

  beforeEach(async () => {
    // Reset both limiters for every ip we touch so each test starts clean.
    for (const mw of apiRunsRateLimiters) {
      resetLimiter(mw, shortIp);
      resetLimiter(mw, longIp);
    }
    harness = await startHarness(apiRunsRateLimiters);
  });

  afterEach(async () => {
    await harness.close();
  });

  it('passes requests within the short-window quota', async () => {
    for (let i = 0; i < API_RUNS_SHORT_WINDOW_MAX; i += 1) {
      const res = await post(harness, shortIp);
      expect(res.status).toBe(200);
    }
  });

  it('returns 429 + Retry-After header + JSON body once the short window trips', async () => {
    for (let i = 0; i < API_RUNS_SHORT_WINDOW_MAX; i += 1) {
      await post(harness, shortIp);
    }
    const tripped = await post(harness, shortIp);
    expect(tripped.status).toBe(429);
    const body = (await tripped.json()) as { error?: string; retryAfter?: number };
    expect(body.error).toBe('rate_limited');
    expect(typeof body.retryAfter).toBe('number');
    expect((body.retryAfter ?? 0) > 0).toBe(true);
    const retryAfter = tripped.headers.get('retry-after');
    expect(retryAfter).not.toBeNull();
    expect(Number.parseInt(retryAfter ?? '0', 10)).toBeGreaterThan(0);
  });

  it('trips independently on the long window even when short is untouched', async () => {
    // Mount ONLY the long-window limiter so the short window cannot trip
    // first. This isolates the 1-hour cap's behaviour from the 15-min burst.
    const longLimiter = apiRunsRateLimiters[1];
    expect(longLimiter).toBeDefined();
    await harness.close();
    harness = await startHarness([longLimiter as RequestHandler]);
    resetLimiter(longLimiter as RequestHandler, longIp);

    for (let i = 0; i < API_RUNS_LONG_WINDOW_MAX; i += 1) {
      const res = await post(harness, longIp);
      expect(res.status).toBe(200);
    }
    const tripped = await post(harness, longIp);
    expect(tripped.status).toBe(429);
    const body = (await tripped.json()) as { error?: string };
    expect(body.error).toBe('rate_limited');
  });

  // ─── UX budget guarantees ────────────────────────────────────────────────
  // One complete Memind flow (brain-chat `/launch` + `/order` + `/lore` +
  // `/heartbeat` + 1-2 conversation turns) costs ~6 POST /api/runs hits.
  // Budget: a single IP must be able to run 3 flows untouched; the 4th
  // should start hitting the cap.

  it('lets a single IP complete 3 full Memind flows (18 POSTs) untouched', async () => {
    const flowsPerIp = 3;
    const postsPerFlow = 6;
    const total = flowsPerIp * postsPerFlow; // 18
    expect(total).toBeLessThanOrEqual(API_RUNS_SHORT_WINDOW_MAX);
    for (let i = 0; i < total; i += 1) {
      const res = await post(harness, shortIp);
      expect(res.status).toBe(200);
    }
  });

  it('trips the 21st POST after 4 flows so the short-window cap is enforced', async () => {
    // 4 flows × 6 POSTs = 24 hits. The 21st one is the first to exceed the
    // 20-hit short-window budget, so that's the one that should 429.
    for (let i = 0; i < API_RUNS_SHORT_WINDOW_MAX; i += 1) {
      const res = await post(harness, shortIp);
      expect(res.status).toBe(200);
    }
    const tripped = await post(harness, shortIp);
    expect(tripped.status).toBe(429);
  });

  it('counts each client IP independently — one IP tripping does not block others', async () => {
    // Burn `shortIp` down to 429 first.
    for (let i = 0; i < API_RUNS_SHORT_WINDOW_MAX; i += 1) {
      await post(harness, shortIp);
    }
    const trippedA = await post(harness, shortIp);
    expect(trippedA.status).toBe(429);
    // Fresh IP must still get a clean 200 on its very first hit.
    const freshIp = '203.0.113.9';
    for (const mw of apiRunsRateLimiters) resetLimiter(mw, freshIp);
    const freshHit = await post(harness, freshIp);
    expect(freshHit.status).toBe(200);
  });

  it('short window (15min) short-circuits before the 1-hour long window on the 21st hit', async () => {
    // Both limiters are mounted in `harness` (beforeEach wires the chain).
    // After 21 hits the short window (cap=20) is the first to fire, so the
    // Retry-After the caller sees should be minutes (≤ 15min = 900s), NOT
    // the hour-scale reset of the long window. If the chain order were
    // ever flipped, or a refactor ran the long limiter first, this test
    // would catch the regression because Retry-After would jump well past
    // 900s.
    for (let i = 0; i < API_RUNS_SHORT_WINDOW_MAX; i += 1) {
      await post(harness, shortIp);
    }
    const tripped = await post(harness, shortIp);
    expect(tripped.status).toBe(429);
    const retryAfterHeader = tripped.headers.get('retry-after');
    expect(retryAfterHeader).not.toBeNull();
    const retryAfter = Number.parseInt(retryAfterHeader ?? '0', 10);
    expect(retryAfter).toBeGreaterThan(0);
    // Strict upper bound: short window is 15 * 60 = 900s. Give a 1s fudge
    // for clock-edge rounding.
    expect(retryAfter).toBeLessThanOrEqual(901);
    const body = (await tripped.json()) as { retryAfter?: number };
    expect(typeof body.retryAfter).toBe('number');
    expect(body.retryAfter ?? 0).toBeLessThanOrEqual(901);
  });

  it('does NOT exempt loopback on /api/runs — that skip rule is shill-only', async () => {
    // The Brain meta-agent never self-calls its own POST /api/runs, so
    // loopback must be counted like any other IP. Without `x-forwarded-for`
    // the listener sees the socket's remoteAddress (loopback), so 21 hits
    // from a loopback client should still trip the short window.
    for (let i = 0; i < API_RUNS_SHORT_WINDOW_MAX; i += 1) {
      const res = await fetch(`${harness.baseUrl}/target`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      expect(res.status).toBe(200);
    }
    const tripped = await fetch(`${harness.baseUrl}/target`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(tripped.status).toBe(429);
  });
});

describe('shillRateLimiter (POST /shill/:tokenAddr)', () => {
  const externalIp = '198.51.100.7';
  let harness: Harness;

  beforeEach(async () => {
    resetLimiter(shillRateLimiter, externalIp);
    harness = await startHarness([shillRateLimiter]);
  });

  afterEach(async () => {
    await harness.close();
  });

  it('passes external traffic within the quota, then 429s on overflow', async () => {
    for (let i = 0; i < SHILL_WINDOW_MAX; i += 1) {
      const res = await post(harness, externalIp);
      expect(res.status).toBe(200);
    }
    const tripped = await post(harness, externalIp);
    expect(tripped.status).toBe(429);
    const body = (await tripped.json()) as { error?: string; retryAfter?: number };
    expect(body.error).toBe('rate_limited');
    expect(typeof body.retryAfter).toBe('number');
    const retryAfter = tripped.headers.get('retry-after');
    expect(retryAfter).not.toBeNull();
  });

  it('counts each client IP independently — one tripped IP does not block another', async () => {
    // Fill the external IP's bucket to 429.
    for (let i = 0; i < SHILL_WINDOW_MAX; i += 1) {
      await post(harness, externalIp);
    }
    const trippedA = await post(harness, externalIp);
    expect(trippedA.status).toBe(429);
    // A different external IP must still see 200 on its first hit; if the
    // limiter shared a counter across IPs this would also 429.
    const freshIp = '198.51.100.42';
    resetLimiter(shillRateLimiter, freshIp);
    const freshHit = await post(harness, freshIp);
    expect(freshHit.status).toBe(200);
  });

  it('exempts loopback traffic even past the external quota', async () => {
    // When there is no `x-forwarded-for` header (trust-proxy is set but the
    // client connected directly over loopback), `req.ip` resolves to the
    // socket's remoteAddress — `::ffff:127.0.0.1` on a dual-stack listener,
    // or `127.0.0.1` on an IPv4-only listener. Either way `isLoopback`
    // returns true and the limiter's `skip` hook keeps the counter at 0.
    for (let i = 0; i < SHILL_WINDOW_MAX * 3; i += 1) {
      const res = await fetch(`${harness.baseUrl}/target`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      expect(res.status).toBe(200);
    }
    // External clients still get rate-limited — confirms the skip only
    // covers loopback sources and the counter is otherwise intact.
    for (let i = 0; i < SHILL_WINDOW_MAX; i += 1) {
      await post(harness, externalIp);
    }
    const tripped = await post(harness, externalIp);
    expect(tripped.status).toBe(429);
  });
});
