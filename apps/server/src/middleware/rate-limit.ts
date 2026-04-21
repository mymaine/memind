/**
 * Rate-limit middleware for the two routes that burn real credentials.
 *
 *   - `POST /api/runs`            — consumes LLM tokens (OpenRouter / Anthropic),
 *                                   optionally $0.01/post X API spend, and BSC
 *                                   mainnet gas. Two windows: a 15-minute burst
 *                                   cap and a 1-hour cumulative cap. Both are
 *                                   evaluated for every request; either one
 *                                   tripping yields a 429.
 *   - `POST /shill/:tokenAddr`    — only enqueues an order, but an attacker can
 *                                   fill the queue and force the Shiller to burn
 *                                   LLM + X API credits downstream. One 15-minute
 *                                   window, strict cap, with a loopback exemption
 *                                   so the in-process `/order` slash command (from
 *                                   brain-chat) is not throttled by its own host.
 *
 * The middleware is intentionally thin — it exports `RequestHandler` (and an
 * array for /api/runs) that the server's `index.ts` mounts ahead of the
 * feature routes. Keeping the library wiring here satisfies SOLID's single
 * responsibility: the route files stay focused on business logic, and this
 * file owns the throttling policy.
 *
 * Response contract on a trip:
 *   - status 429
 *   - JSON body: `{ "error": "rate_limited", "retryAfter": <seconds> }`
 *   - `Retry-After` header (integer seconds, RFC 7231 §7.1.3)
 *
 * Known limitations:
 *   - Uses the library's default in-process `MemoryStore`. Single-replica
 *     deployments only. If we ever scale out to multiple Railway replicas the
 *     effective limit becomes `N × threshold` per client because each replica
 *     tracks counters independently. Swap to a Redis-backed store (see
 *     `rate-limit-redis`) before turning on horizontal scaling.
 *   - `express-rate-limit` v8's default `keyGenerator` already calls
 *     `ipKeyGenerator` internally (IPv6 addresses are bucketed by their /56
 *     prefix), so we rely on the default for every limiter in this file for
 *     consistency. No explicit `keyGenerator` override anywhere.
 */
import type { Request, RequestHandler, Response } from 'express';
import rateLimit from 'express-rate-limit';

// ─── Policy constants ──────────────────────────────────────────────────────
// Exported so tests and observability code can import the same source of
// truth. Changing a threshold means changing one line here; nothing else
// should hardcode the numbers.

/** 15 minutes in milliseconds — short/burst window. */
export const API_RUNS_SHORT_WINDOW_MS = 15 * 60 * 1000;
/** Max POST /api/runs in the short window per client IP. */
export const API_RUNS_SHORT_WINDOW_MAX = 20;

/** 1 hour in milliseconds — sustained fallback window. */
export const API_RUNS_LONG_WINDOW_MS = 60 * 60 * 1000;
/** Max POST /api/runs in the long window per client IP. */
export const API_RUNS_LONG_WINDOW_MAX = 60;

/** 15 minutes in milliseconds — shill window. */
export const SHILL_WINDOW_MS = 15 * 60 * 1000;
/**
 * Max POST /shill/:tokenAddr per external client IP in the shill window.
 *
 * Sized so an attacker must spend five x402 USDC payments to queue five
 * downstream shill jobs (LLM + X API spend) every 15 minutes. Legitimate
 * creators hit /shill from brain-chat via loopback and are exempt, so this
 * cap only ever applies to direct external callers.
 */
export const SHILL_WINDOW_MAX = 5;

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Loopback check for the shill rate limiter's `skip` hook.
 *
 * The brain-chat `/order` slash command POSTs to the server's own
 * `/shill/:tokenAddr` from within the same process (a legitimate,
 * authenticated-by-colocation path). We must let those hits through
 * regardless of the per-window cap — otherwise a creator running `/order`
 * five times in a chat session would start getting 429s from their own
 * server. External callers never hit via a loopback address because the
 * server binds 0.0.0.0 and `trust proxy` rewrites `req.ip` to the forwarded
 * client address before this middleware runs.
 *
 * Accepts:
 *   - IPv4 loopback literal `127.0.0.1`
 *   - IPv6 loopback literal `::1`
 *   - IPv4-mapped IPv6 loopback `::ffff:127.0.0.1` (Node emits this when the
 *     server is listening on a dual-stack socket and a v4 client connects)
 */
export function isLoopback(ip: string | undefined): boolean {
  if (ip === undefined) return false;
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

/**
 * Shared 429 handler used by every limiter in this module.
 *
 * `express-rate-limit` exposes `req.rateLimit.resetTime` on the augmented
 * request; we convert it to whole seconds (ceiling) so clients see a
 * positive `Retry-After` even when less than one second remains. Falls back
 * to the configured window when `resetTime` is missing (e.g. when an
 * external store omits it).
 */
function makeRateLimitHandler(windowMs: number): (req: Request, res: Response) => void {
  return (req, res) => {
    // The augmented request from express-rate-limit carries a `rateLimit`
    // property with the per-client info. Its type is declared via module
    // augmentation in the library's `d.ts`, but we narrow explicitly here
    // to keep noUncheckedIndexedAccess + strict happy.
    const info = (req as Request & { rateLimit?: { resetTime?: Date } }).rateLimit;
    const resetTime = info?.resetTime;
    const remainingMs =
      resetTime !== undefined ? Math.max(resetTime.getTime() - Date.now(), 0) : windowMs;
    const retryAfter = Math.ceil(remainingMs / 1000);
    res.setHeader('Retry-After', retryAfter.toString());
    res.status(429).json({ error: 'rate_limited', retryAfter });
  };
}

// ─── Limiters ──────────────────────────────────────────────────────────────

/**
 * 15-minute burst limiter for `POST /api/runs`.
 *
 * Separated from the 1-hour ceiling so the two windows can trip
 * independently — a caller making 25 hits in 5 minutes trips this one even
 * though the 1-hour total is still under 60.
 */
const apiRunsShortLimiter: RequestHandler = rateLimit({
  windowMs: API_RUNS_SHORT_WINDOW_MS,
  limit: API_RUNS_SHORT_WINDOW_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  handler: makeRateLimitHandler(API_RUNS_SHORT_WINDOW_MS),
});

/**
 * 1-hour sustained limiter for `POST /api/runs`.
 *
 * Catches the slow-drip attacker who stays under the burst cap but would
 * otherwise rack up 80+ runs an hour.
 */
const apiRunsLongLimiter: RequestHandler = rateLimit({
  windowMs: API_RUNS_LONG_WINDOW_MS,
  limit: API_RUNS_LONG_WINDOW_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  handler: makeRateLimitHandler(API_RUNS_LONG_WINDOW_MS),
});

/**
 * Middleware chain for `POST /api/runs`. Both windows are checked for every
 * request; whichever trips first wins. Mount as-is with the spread operator:
 *
 *   app.post('/api/runs', ...apiRunsRateLimiters, handler)
 *
 * Exporting an array (instead of wrapping both behind a single handler) keeps
 * each limiter's headers and reset timers intact — monitoring can still read
 * per-window state from the standard `RateLimit-*` headers.
 */
export const apiRunsRateLimiters: readonly RequestHandler[] = [
  apiRunsShortLimiter,
  apiRunsLongLimiter,
];

/**
 * Single-window limiter for `POST /shill/:tokenAddr`. Skips loopback sources
 * so the in-process `/order` slash from brain-chat is never throttled.
 *
 * Must be mounted BEFORE `@x402/express`'s `paymentMiddleware` — otherwise
 * the facilitator verifies the payment authorisation (and, in `http` mode,
 * may submit an on-chain settle) before the limiter trips, so the caller
 * loses USDC on a request that ultimately 429s.
 */
export const shillRateLimiter: RequestHandler = rateLimit({
  windowMs: SHILL_WINDOW_MS,
  limit: SHILL_WINDOW_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => isLoopback(req.ip),
  // No explicit keyGenerator — library v8's default already uses
  // ipKeyGenerator under the hood, so v6 addresses are bucketed by /56 prefix
  // and single-prefix floods cannot spawn fresh keys. Kept consistent with
  // apiRunsRateLimiters for one less surprise when reading this file.
  handler: makeRateLimitHandler(SHILL_WINDOW_MS),
});
