import { createHmac, randomBytes as cryptoRandomBytes } from 'node:crypto';
import type { Buffer } from 'node:buffer';
import { z } from 'zod';
import type { AgentTool } from '@hack-fourmeme/shared';

/**
 * post_to_x tool — publishes a single tweet to the X API v2 endpoint
 * `POST https://api.x.com/2/tweets` using OAuth 1.0a User Context.
 *
 * Why hand-rolled OAuth: the project ships zero third-party Twitter or OAuth
 * helpers. Everything here is built on `fetch` + `node:crypto` so the auth
 * path is auditable and free of transitive risk.
 *
 * Signing summary (RFC 5849 + X API v2 quirk):
 *   1. Collect the 6 oauth_* request params (consumer_key, nonce, sig_method,
 *      timestamp, token, version). On v2 JSON endpoints the JSON body is NOT
 *      part of the signature base string — only oauth_* params participate.
 *   2. Percent-encode each key and value per RFC 3986, sort by encoded key,
 *      join `k=v` pairs with `&`.
 *   3. Base string = `POST` + `&` + pctEncode(url) + `&` + pctEncode(joined).
 *   4. Signing key = pctEncode(consumer_secret) + `&` + pctEncode(token_secret).
 *   5. oauth_signature = base64(HMAC-SHA1(base, key)).
 *   6. Authorization header = `OAuth ` + sorted `k="pctEncode(v)"` joined `, `.
 *
 * All time, randomness, network, and sleep is injected via factory config so
 * the signing fixture is fully hermetic in tests.
 */

// -------------------- schemas ----------------------------------------------

export const xPostInputSchema = z.object({
  text: z.string().min(1, 'text must be at least 1 char').max(280, 'text must be <= 280 chars'),
  replyToTweetId: z.string().optional(),
});
export type XPostInput = z.infer<typeof xPostInputSchema>;

export const xPostOutputSchema = z.object({
  tweetId: z.string().min(1),
  text: z.string(),
  postedAt: z.string().datetime(),
  url: z.string().url(),
});
export type XPostOutput = z.infer<typeof xPostOutputSchema>;

// -------------------- config ------------------------------------------------

export interface PostToXToolConfig {
  apiKey: string;
  apiKeySecret: string;
  accessToken: string;
  accessTokenSecret: string;
  /**
   * Public handle (without the leading `@`) used to build the canonical tweet
   * URL `https://x.com/<handle>/status/<id>`. When undefined the tool falls
   * back to `https://x.com/i/web/status/<id>` which resolves to the same tweet
   * but without surfacing the author handle in the URL.
   */
  handle?: string;
  /** Test seam — defaults to global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Test seam — defaults to `Date.now`. */
  nowMs?: () => number;
  /** Test seam — defaults to `crypto.randomBytes`. */
  randomBytesImpl?: (n: number) => Buffer;
  /** Test seam — defaults to `setTimeout`-based promise. */
  sleepImpl?: (ms: number) => Promise<void>;
  /** Maximum retry attempts on retryable errors (429, 5xx, network). Default 3. */
  maxRetries?: number;
  /** Initial exponential backoff in ms. Doubled each attempt. Default 2000. */
  initialBackoffMs?: number;
}

// -------------------- constants --------------------------------------------

const X_TWEETS_ENDPOINT = 'https://api.x.com/2/tweets';
const OAUTH_SIGNATURE_METHOD = 'HMAC-SHA1';
const OAUTH_VERSION = '1.0';
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_INITIAL_BACKOFF_MS = 2_000;

// -------------------- percent-encoding -------------------------------------

/**
 * Strict RFC 3986 percent-encoding. `encodeURIComponent` leaves `!*'()` alone
 * (they are "reserved sub-delims" in RFC 3986 section 2.2) so we escape them
 * manually to match the OAuth 1.0a signature contract.
 */
export function percentEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (ch) => {
    const hex = ch.charCodeAt(0).toString(16).toUpperCase();
    return `%${hex}`;
  });
}

// -------------------- signature base + header ------------------------------

interface OAuthParams {
  oauth_consumer_key: string;
  oauth_nonce: string;
  oauth_signature_method: string;
  oauth_timestamp: string;
  oauth_token: string;
  oauth_version: string;
}

interface SignedOAuthParams extends OAuthParams {
  oauth_signature: string;
}

/**
 * Build the OAuth 1.0a signature base string. The JSON request body is
 * intentionally not included — X API v2 JSON endpoints sign only oauth_*
 * params per the platform's documented deviation from the raw RFC 5849 flow.
 */
export function buildOAuthBaseString(method: string, url: string, params: OAuthParams): string {
  const encoded: [string, string][] = (Object.entries(params) as [string, string][]).map(
    ([k, v]) => [percentEncode(k), percentEncode(v)],
  );
  encoded.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const joined = encoded.map(([k, v]) => `${k}=${v}`).join('&');
  return `${method.toUpperCase()}&${percentEncode(url)}&${percentEncode(joined)}`;
}

/**
 * Assemble the Authorization header value from the signed oauth_* bundle.
 * All 7 fields must be present; they are emitted alphabetically so the header
 * is deterministic and inspectable.
 */
export function buildAuthorizationHeader(params: SignedOAuthParams): string {
  const entries = Object.entries(params).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const pieces = entries.map(([k, v]) => `${k}="${percentEncode(v)}"`);
  return `OAuth ${pieces.join(', ')}`;
}

// -------------------- signing driver ---------------------------------------

interface SigningDeps {
  apiKey: string;
  apiKeySecret: string;
  accessToken: string;
  accessTokenSecret: string;
  nowMs: () => number;
  randomBytesImpl: (n: number) => Buffer;
}

function signRequest(method: string, url: string, deps: SigningDeps): string {
  const nonce = deps.randomBytesImpl(16).toString('hex');
  const timestamp = Math.floor(deps.nowMs() / 1000).toString();

  const unsigned: OAuthParams = {
    oauth_consumer_key: deps.apiKey,
    oauth_nonce: nonce,
    oauth_signature_method: OAUTH_SIGNATURE_METHOD,
    oauth_timestamp: timestamp,
    oauth_token: deps.accessToken,
    oauth_version: OAUTH_VERSION,
  };

  const baseString = buildOAuthBaseString(method, url, unsigned);
  const signingKey = `${percentEncode(deps.apiKeySecret)}&${percentEncode(deps.accessTokenSecret)}`;
  const signature = createHmac('sha1', signingKey).update(baseString, 'utf8').digest('base64');

  return buildAuthorizationHeader({ ...unsigned, oauth_signature: signature });
}

// -------------------- error parsing ----------------------------------------

/**
 * Extract a human-readable error message from the two shapes the X v2 API
 * emits on failure: `{ detail: "..." }` and `{ errors: [{ message: "..." }] }`.
 * Falls back to the raw body snippet when neither shape matches.
 */
async function extractErrorMessage(response: Response): Promise<string> {
  const rawText = await response.text().catch(() => '');
  if (!rawText) return `HTTP ${response.status.toString()}`;
  try {
    const parsed = JSON.parse(rawText) as { detail?: string; errors?: Array<{ message?: string }> };
    if (typeof parsed.detail === 'string' && parsed.detail.length > 0) return parsed.detail;
    if (Array.isArray(parsed.errors) && parsed.errors.length > 0) {
      const joined = parsed.errors
        .map((e) => (typeof e.message === 'string' ? e.message : ''))
        .filter((s) => s.length > 0)
        .join('; ');
      if (joined.length > 0) return joined;
    }
  } catch {
    // Fall through to raw body snippet.
  }
  return rawText.slice(0, 300);
}

// -------------------- retry policy -----------------------------------------

function isRetryableStatus(status: number): boolean {
  if (status === 429) return true;
  if (status >= 500 && status < 600) return true;
  return false;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// -------------------- factory ----------------------------------------------

export function createPostToXTool(cfg: PostToXToolConfig): AgentTool<XPostInput, XPostOutput> {
  // Fail fast on missing credentials — this tool has no meaningful degraded
  // mode, and leaking half-configured requests to the X API wastes credits.
  for (const [label, value] of [
    ['apiKey', cfg.apiKey],
    ['apiKeySecret', cfg.apiKeySecret],
    ['accessToken', cfg.accessToken],
    ['accessTokenSecret', cfg.accessTokenSecret],
  ] as const) {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new Error(`post_to_x: missing credential "${label}"`);
    }
  }

  const fetchImpl = cfg.fetchImpl ?? fetch;
  const nowMs = cfg.nowMs ?? (() => Date.now());
  const randomBytesImpl = cfg.randomBytesImpl ?? ((n: number) => cryptoRandomBytes(n));
  const sleepImpl = cfg.sleepImpl ?? defaultSleep;
  const maxRetries = cfg.maxRetries ?? DEFAULT_MAX_RETRIES;
  const initialBackoffMs = cfg.initialBackoffMs ?? DEFAULT_INITIAL_BACKOFF_MS;
  const handle = cfg.handle;

  return {
    name: 'post_to_x',
    description:
      'Publish a single tweet via X API v2 POST /2/tweets using OAuth 1.0a User Context. ' +
      'Input: { text (<=280 chars), replyToTweetId? }. Output: { tweetId, text, postedAt, url }. ' +
      'Use when the Creator/Narrator agent decides to broadcast an on-chain milestone or lore ' +
      'excerpt. Honours X rate limits (429 Retry-After) and retries transient 5xx / network ' +
      'failures with exponential backoff; non-retryable 4xx surface immediately.',
    inputSchema: xPostInputSchema,
    outputSchema: xPostOutputSchema,
    async execute(input): Promise<XPostOutput> {
      const parsed = xPostInputSchema.parse(input);

      const body: { text: string; reply?: { in_reply_to_tweet_id: string } } = {
        text: parsed.text,
      };
      if (parsed.replyToTweetId !== undefined) {
        body.reply = { in_reply_to_tweet_id: parsed.replyToTweetId };
      }
      const serialisedBody = JSON.stringify(body);

      // Retry loop. Attempt 0 is the initial request; we sleep BEFORE attempt
      // `n` (for n >= 1) using either Retry-After or exponential backoff.
      let lastError: Error | undefined;
      let nextBackoff = initialBackoffMs;

      for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        // Re-sign on every attempt so the nonce + timestamp are fresh. The X
        // server rejects replayed signatures, so retrying with the same
        // header would bake in a silent failure.
        const authorization = signRequest('POST', X_TWEETS_ENDPOINT, {
          apiKey: cfg.apiKey,
          apiKeySecret: cfg.apiKeySecret,
          accessToken: cfg.accessToken,
          accessTokenSecret: cfg.accessTokenSecret,
          nowMs,
          randomBytesImpl,
        });

        let response: Response;
        try {
          response = await fetchImpl(X_TWEETS_ENDPOINT, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: authorization,
            },
            body: serialisedBody,
          });
        } catch (err) {
          // Network / DNS / timeout — treat as retryable.
          lastError = err instanceof Error ? err : new Error(String(err));
          if (attempt === maxRetries) break;
          await sleepImpl(nextBackoff);
          nextBackoff *= 2;
          continue;
        }

        if (response.status === 201 || response.status === 200) {
          const payload = (await response.json()) as {
            data?: { id?: string; text?: string };
          };
          const id = payload.data?.id;
          const tweetText = payload.data?.text ?? parsed.text;
          if (typeof id !== 'string' || id.length === 0) {
            throw new Error('post_to_x: success response missing data.id');
          }
          const url =
            handle !== undefined && handle !== ''
              ? `https://x.com/${handle}/status/${id}`
              : `https://x.com/i/web/status/${id}`;

          return xPostOutputSchema.parse({
            tweetId: id,
            text: tweetText,
            postedAt: new Date(nowMs()).toISOString(),
            url,
          });
        }

        if (!isRetryableStatus(response.status)) {
          const message = await extractErrorMessage(response);
          throw new Error(`post_to_x: X API returned ${response.status.toString()} — ${message}`);
        }

        // Retryable HTTP failure. Capture the error message for exhaustion
        // case then sleep + continue (if we still have attempts left).
        const message = await extractErrorMessage(response);
        lastError = new Error(
          `post_to_x: X API returned ${response.status.toString()} — ${message}`,
        );
        if (attempt === maxRetries) break;

        let waitMs = nextBackoff;
        if (response.status === 429) {
          const retryAfter = response.headers.get('retry-after');
          const asSeconds = retryAfter !== null ? Number.parseInt(retryAfter, 10) : Number.NaN;
          if (Number.isFinite(asSeconds) && asSeconds > 0) {
            waitMs = asSeconds * 1000;
          }
        }
        await sleepImpl(waitMs);
        nextBackoff *= 2;
      }

      const reason = lastError?.message ?? 'unknown error';
      // Fix 6: "N retries" alone reads ambiguously in logs (3 retries ==
      // 4 total attempts). Surface both counts so operators don't have to
      // mentally add the initial attempt when triaging incidents.
      const totalAttempts = maxRetries + 1;
      throw new Error(
        `post_to_x: gave up after ${totalAttempts.toString()} attempts (${maxRetries.toString()} retries) (${reason})`,
      );
    },
  };
}
