import { describe, it, expect, vi } from 'vitest';
import { Buffer } from 'node:buffer';
import {
  createPostToXTool,
  xPostInputSchema,
  xPostOutputSchema,
  buildOAuthBaseString,
  percentEncode,
  buildAuthorizationHeader,
  type PostToXToolConfig,
} from './x-post.js';

/**
 * post_to_x tests
 * ---------------
 * All tests are hermetic. Every outbound call goes through `config.fetchImpl`,
 * all time is fed via `config.nowMs`, all randomness via `config.randomBytesImpl`
 * and all backoff sleeps via `config.sleepImpl`. This lets us freeze signing
 * inputs for the HMAC fixture in Test 1 and drive retry branches in Test 7-9.
 */

// -------- Worked-example fixture for OAuth 1.0a signing (Test 1) -----------
//
// Inputs (chosen to be human-readable and free of any percent-encoding edge
// cases, so a reviewer can recompute the HMAC by hand):
//
//   method                = POST
//   url                   = https://api.x.com/2/tweets
//   oauth_consumer_key    = ck_test
//   oauth_consumer_secret = cs_test           (NOT in base string)
//   oauth_token           = tok_test
//   oauth_token_secret    = toks_test         (NOT in base string)
//   oauth_nonce           = abababababababababababababababab   (16 * 0xab hex)
//   oauth_timestamp       = 1700000000
//   oauth_signature_method = HMAC-SHA1
//   oauth_version         = 1.0
//
// Body: {"text":"hello"} — JSON bodies on X v2 are NOT signed.
//
// Expected sorted-pct-encoded params string:
//   oauth_consumer_key=ck_test&oauth_nonce=abababababababababababababababab
//   &oauth_signature_method=HMAC-SHA1&oauth_timestamp=1700000000
//   &oauth_token=tok_test&oauth_version=1.0
//
// Expected base string:
//   POST&https%3A%2F%2Fapi.x.com%2F2%2Ftweets&<pct-encoded sorted params>
//
// Signing key = pctEncode(consumer_secret) + '&' + pctEncode(token_secret)
//             = cs_test&toks_test
//
// HMAC-SHA1(base, key) base64 => dGz1E4OTxducnpY+NkPnniwhKb8=
//
// Reviewer: recompute via
//   node -e 'const c=require("crypto"); console.log(c.createHmac("sha1","cs_test&toks_test").update(<base>,"utf8").digest("base64"))'
const EXPECTED_BASE_STRING =
  'POST&https%3A%2F%2Fapi.x.com%2F2%2Ftweets&' +
  'oauth_consumer_key%3Dck_test%26' +
  'oauth_nonce%3Dabababababababababababababababab%26' +
  'oauth_signature_method%3DHMAC-SHA1%26' +
  'oauth_timestamp%3D1700000000%26' +
  'oauth_token%3Dtok_test%26' +
  'oauth_version%3D1.0';
const EXPECTED_SIGNATURE = 'dGz1E4OTxducnpY+NkPnniwhKb8=';

function deterministicRandom(): Buffer {
  // 16 bytes all 0xab -> hex "abababababababababababababababab"
  return Buffer.alloc(16, 0xab);
}

function frozenNow(): number {
  // 1700000000 seconds -> milliseconds
  return 1_700_000_000 * 1000;
}

function baseConfig(overrides: Partial<PostToXToolConfig> = {}): PostToXToolConfig {
  return {
    apiKey: 'ck_test',
    apiKeySecret: 'cs_test',
    accessToken: 'tok_test',
    accessTokenSecret: 'toks_test',
    handle: 'hbnb2026bot',
    fetchImpl: vi.fn() as unknown as typeof fetch,
    nowMs: frozenNow,
    randomBytesImpl: deterministicRandom,
    sleepImpl: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

describe('percentEncode', () => {
  it('escapes RFC 3986 reserved-but-not-by-encodeURIComponent chars', () => {
    expect(percentEncode('!')).toBe('%21');
    expect(percentEncode("'")).toBe('%27');
    expect(percentEncode('(')).toBe('%28');
    expect(percentEncode(')')).toBe('%29');
    expect(percentEncode('*')).toBe('%2A');
  });

  it('passes unreserved chars through unchanged', () => {
    const unreserved = 'AZaz09-_.~';
    expect(percentEncode(unreserved)).toBe(unreserved);
  });

  it('encodes space as %20 and not +', () => {
    expect(percentEncode('hello world')).toBe('hello%20world');
  });
});

describe('buildOAuthBaseString + signing fixture', () => {
  it('produces the expected base string for the worked fixture', () => {
    const base = buildOAuthBaseString('POST', 'https://api.x.com/2/tweets', {
      oauth_consumer_key: 'ck_test',
      oauth_nonce: 'abababababababababababababababab',
      oauth_signature_method: 'HMAC-SHA1',
      oauth_timestamp: '1700000000',
      oauth_token: 'tok_test',
      oauth_version: '1.0',
    });
    expect(base).toBe(EXPECTED_BASE_STRING);
  });

  it('hand-computed HMAC-SHA1 base64 matches the documented value', async () => {
    // Drive the tool end-to-end and capture the Authorization header it built.
    let captured: string | undefined;
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      captured = (init?.headers as Record<string, string>).Authorization;
      return jsonResponse(201, {
        data: { id: '111', text: 'hello', edit_history_tweet_ids: ['111'] },
      });
    });

    const tool = createPostToXTool(baseConfig({ fetchImpl: fetchImpl as unknown as typeof fetch }));
    await tool.execute({ text: 'hello' });

    expect(captured).toBeDefined();
    expect(captured).toContain(`oauth_signature="${percentEncode(EXPECTED_SIGNATURE)}"`);
  });
});

describe('buildAuthorizationHeader', () => {
  it('joins all 7 oauth_* fields, alphabetically, each quoted with pct-encoded value', () => {
    const header = buildAuthorizationHeader({
      oauth_consumer_key: 'ck_test',
      oauth_nonce: 'abababababababababababababababab',
      oauth_signature: 'sig+value/==',
      oauth_signature_method: 'HMAC-SHA1',
      oauth_timestamp: '1700000000',
      oauth_token: 'tok_test',
      oauth_version: '1.0',
    });

    expect(header.startsWith('OAuth ')).toBe(true);
    const body = header.slice('OAuth '.length);
    const parts = body.split(', ');
    expect(parts).toHaveLength(7);

    const keys = parts.map((p) => p.split('=')[0]);
    expect(keys).toEqual([
      'oauth_consumer_key',
      'oauth_nonce',
      'oauth_signature',
      'oauth_signature_method',
      'oauth_timestamp',
      'oauth_token',
      'oauth_version',
    ]);

    // Each value must be wrapped in double quotes after percent-encoding.
    expect(body).toContain('oauth_signature="sig%2Bvalue%2F%3D%3D"');
    expect(body).toContain('oauth_signature_method="HMAC-SHA1"');
  });
});

describe('xPostInputSchema', () => {
  it('accepts text exactly 280 chars long', () => {
    const text = 'a'.repeat(280);
    expect(xPostInputSchema.safeParse({ text }).success).toBe(true);
  });

  it('rejects text 281 chars long', () => {
    const text = 'a'.repeat(281);
    expect(xPostInputSchema.safeParse({ text }).success).toBe(false);
  });

  it('rejects empty text', () => {
    expect(xPostInputSchema.safeParse({ text: '' }).success).toBe(false);
  });
});

describe('createPostToXTool factory guards', () => {
  it('throws when any credential is missing', () => {
    expect(() =>
      createPostToXTool({
        apiKey: '',
        apiKeySecret: 'x',
        accessToken: 'x',
        accessTokenSecret: 'x',
      }),
    ).toThrow(/credential/i);

    expect(() =>
      createPostToXTool({
        apiKey: 'x',
        apiKeySecret: '',
        accessToken: 'x',
        accessTokenSecret: 'x',
      }),
    ).toThrow(/credential/i);

    expect(() =>
      createPostToXTool({
        apiKey: 'x',
        apiKeySecret: 'x',
        accessToken: '',
        accessTokenSecret: 'x',
      }),
    ).toThrow(/credential/i);

    expect(() =>
      createPostToXTool({
        apiKey: 'x',
        apiKeySecret: 'x',
        accessToken: 'x',
        accessTokenSecret: '',
      }),
    ).toThrow(/credential/i);
  });
});

describe('createPostToXTool.execute happy path', () => {
  it('POSTs to /2/tweets and returns canonical result with handle-based URL', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(201, {
        data: {
          id: '1800000000000000001',
          text: 'hello world',
          edit_history_tweet_ids: ['1800000000000000001'],
        },
      }),
    );
    const tool = createPostToXTool(baseConfig({ fetchImpl: fetchImpl as unknown as typeof fetch }));

    const out = await tool.execute({ text: 'hello world' });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const callArgs = fetchImpl.mock.calls[0] as [string, RequestInit];
    const [url, init] = callArgs;
    expect(url).toBe('https://api.x.com/2/tweets');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    const authHeader = headers.Authorization ?? '';
    expect(authHeader.startsWith('OAuth ')).toBe(true);
    expect(init.body).toBe(JSON.stringify({ text: 'hello world' }));

    expect(xPostOutputSchema.safeParse(out).success).toBe(true);
    expect(out.tweetId).toBe('1800000000000000001');
    expect(out.text).toBe('hello world');
    expect(out.url).toBe('https://x.com/hbnb2026bot/status/1800000000000000001');
    expect(out.postedAt).toBe(new Date(frozenNow()).toISOString());
  });

  it('includes reply.in_reply_to_tweet_id when replyToTweetId supplied', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(201, {
        data: { id: '222', text: 'reply', edit_history_tweet_ids: ['222'] },
      }),
    );
    const tool = createPostToXTool(baseConfig({ fetchImpl: fetchImpl as unknown as typeof fetch }));

    await tool.execute({ text: 'reply', replyToTweetId: '111' });

    const callArgs = fetchImpl.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(callArgs[1].body)) as Record<string, unknown>;
    expect(body).toEqual({ text: 'reply', reply: { in_reply_to_tweet_id: '111' } });
  });
});

describe('createPostToXTool.execute URL fallback', () => {
  it('uses https://x.com/i/web/status/<id> when handle is undefined', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(201, { data: { id: '900', text: 'x', edit_history_tweet_ids: ['900'] } }),
      );
    const tool = createPostToXTool(
      baseConfig({ handle: undefined, fetchImpl: fetchImpl as unknown as typeof fetch }),
    );

    const out = await tool.execute({ text: 'x' });
    expect(out.url).toBe('https://x.com/i/web/status/900');
  });
});

describe('createPostToXTool.execute retry policy', () => {
  it('honours Retry-After on 429 then retries once', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ detail: 'Too Many Requests' }), {
          status: 429,
          headers: { 'content-type': 'application/json', 'Retry-After': '7' },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(201, {
          data: { id: '555', text: 'ok', edit_history_tweet_ids: ['555'] },
        }),
      );

    const tool = createPostToXTool(
      baseConfig({ fetchImpl: fetchImpl as unknown as typeof fetch, sleepImpl: sleep }),
    );

    const out = await tool.execute({ text: 'ok' });
    expect(out.tweetId).toBe('555');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(7000);
  });

  it('does NOT retry on non-retryable 4xx (401)', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ detail: 'Unauthorized' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const tool = createPostToXTool(
      baseConfig({ fetchImpl: fetchImpl as unknown as typeof fetch, sleepImpl: sleep }),
    );

    await expect(tool.execute({ text: 'bad' })).rejects.toThrow(/Unauthorized/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('retries network errors with exponential backoff then gives up', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNRESET'));

    const tool = createPostToXTool(
      baseConfig({
        fetchImpl: fetchImpl as unknown as typeof fetch,
        sleepImpl: sleep,
        maxRetries: 3,
        initialBackoffMs: 100,
      }),
    );

    // Fix 6: final error must use the new "N+1 attempts (N retries)" wording.
    await expect(tool.execute({ text: 'net' })).rejects.toThrow(
      /gave up after 4 attempts \(3 retries\)/,
    );

    // 1 initial attempt + 3 retries = 4 fetch calls, 3 backoff sleeps at 100, 200, 400ms.
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(sleep).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenNthCalledWith(1, 100);
    expect(sleep).toHaveBeenNthCalledWith(2, 200);
    expect(sleep).toHaveBeenNthCalledWith(3, 400);
  });
});

describe('createPostToXTool.execute content guard layer (2026-04-21)', () => {
  const VALID_ADDR = '0x1234567890abcdef1234567890abcdef12345678';

  it('sanitizes a raw 0x address in the tweet body BEFORE the network call', async () => {
    // The Heartbeat runner and other LLM-driven callers occasionally slip a
    // full 40-hex address through. X's 2026 post-OAuth cooldown bounces such
    // posts with a 403. post_to_x is the last line of defence: rewrite the
    // address into the short form (0xABCDEF…WXYZ) before signing the request
    // so the body X sees is already anonymised.
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(201, {
        data: { id: '101', text: 'sanitized', edit_history_tweet_ids: ['101'] },
      }),
    );
    const tool = createPostToXTool(baseConfig({ fetchImpl: fetchImpl as unknown as typeof fetch }));

    await tool.execute({ text: `$HBNB2026-BAT watch ${VALID_ADDR} cavern dispatch` });

    const callArgs = fetchImpl.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(callArgs[1].body)) as { text: string };
    expect(body.text).not.toContain(VALID_ADDR);
    expect(body.text).toContain('0x123456…5678');
  });

  it('rejects a draft containing "paid" via the guard (no network call)', async () => {
    const fetchImpl = vi.fn();
    const tool = createPostToXTool(baseConfig({ fetchImpl: fetchImpl as unknown as typeof fetch }));

    await expect(tool.execute({ text: 'I was paid to post this — honest' })).rejects.toThrow(
      /tweet content guard rejected/i,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects a draft containing a bscscan URL via the guard (no network call)', async () => {
    const fetchImpl = vi.fn();
    const tool = createPostToXTool(baseConfig({ fetchImpl: fetchImpl as unknown as typeof fetch }));

    await expect(
      tool.execute({ text: `check https://bscscan.com/token/${VALID_ADDR} for details` }),
    ).rejects.toThrow(/tweet content guard rejected/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects a draft containing a bare URL via the safe-mode guard (no network call)', async () => {
    // Even a four.meme click-through URL cannot ship during the 7-day cooldown
    // — the gate is mode-less on this surface so downstream callers must rely
    // on post_shill_for's URL-mode path (which never reaches here) or wait
    // for the cooldown to expire before enabling URL bodies.
    const fetchImpl = vi.fn();
    const tool = createPostToXTool(baseConfig({ fetchImpl: fetchImpl as unknown as typeof fetch }));

    await expect(
      tool.execute({ text: 'visit https://four.meme/token/short for more' }),
    ).rejects.toThrow(/tweet content guard rejected/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('createPostToXTool.execute v2 error parsing', () => {
  it('surfaces { detail } shape as clean Error message', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ detail: 'Tweet text too long' }), {
        status: 422,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const tool = createPostToXTool(baseConfig({ fetchImpl: fetchImpl as unknown as typeof fetch }));

    await expect(tool.execute({ text: 'short' })).rejects.toThrow(/Tweet text too long/);
  });

  it('surfaces { errors: [{ message }] } shape as clean Error message', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ errors: [{ message: 'duplicate content' }] }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const tool = createPostToXTool(baseConfig({ fetchImpl: fetchImpl as unknown as typeof fetch }));

    await expect(tool.execute({ text: 'dup' })).rejects.toThrow(/duplicate content/);
  });
});
