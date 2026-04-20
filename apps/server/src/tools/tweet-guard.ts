/**
 * tweet-guard — shared content-guard helpers for every tweet-emitting tool.
 *
 * Before this module existed, the regex patterns + prompt fragments that
 * describe "what must NEVER appear in an outbound tweet" lived inline inside
 * `post-shill-for.ts`. Phase 4.7 widened the set of tweet producers beyond
 * the paid-shill path:
 *
 *   - `post_to_x` (x-post.ts): any persona can call this directly, and there
 *     was no safety net between the LLM's free-form draft and the X API. X's
 *     2026 anti-spam rail rejects raw `0x…40-hex` addresses during the first
 *     7 days after OAuth-token regeneration with a 403 — the heartbeat runner
 *     kept hitting that wall because its system prompt told the model to
 *     include the full tokenAddr.
 *   - `heartbeat-runner.ts`: shares the "write a short tweet" prompt shape
 *     with post-shill-for but had its own divergent copy that forced the
 *     model to embed the tokenAddr + bscscan URL.
 *
 * Centralising the guard patterns and prompt fragments here keeps every
 * tweet surface honest against the same contract. Each caller pairs
 * `checkTweetGuard` (post-generation regex match) with
 * `sanitizeTweetAddresses` (pre-guard rewrite that anonymises any 40-hex
 * address) — the latter is a belt-and-suspenders layer so even a
 * pattern-violating LLM draft can be forwarded safely to the X API during
 * the cooldown window.
 */

// -------------------- types ------------------------------------------------

export interface GuardPattern {
  readonly label: string;
  readonly pattern: RegExp;
}

export interface GuardResult {
  readonly ok: boolean;
  readonly violations: readonly string[];
}

export interface CheckTweetGuardOptions {
  /**
   * When `true`, the URL-bearing four.meme click-through path is allowed and
   * a raw 0x address is permitted (URL mode). When `false` (default, "safe
   * mode") both are banned because X's post-OAuth cooldown rejects them.
   */
  readonly includeFourMemeUrl: boolean;
}

// -------------------- constants --------------------------------------------

/**
 * Hard character cap enforced by the X API itself. `xPostInputSchema` on
 * x-post.ts rejects anything over this too, but the LLM producers need the
 * same bound so their retry loops can surface a `length>280` violation
 * BEFORE the network call would have bounced it.
 */
export const TWEET_HARD_CAP = 280;

/**
 * Guards applied in BOTH modes. Paid-intent leaks never fit the organic
 * voice and other block explorers (bscscan / base-sepolia) are always a
 * distraction for demo viewers.
 *
 * `\bpaid\b` / `\bshill\b` use word boundaries so `unpaid`, `repaid`, and
 * `shills` do not false-match. See post-shill-for.test.ts for the lock-in.
 */
export const BASE_GUARDS: readonly GuardPattern[] = [
  { label: 'bscscan', pattern: /bscscan/i },
  { label: 'base-sepolia', pattern: /base-sepolia/i },
  // Paid-intent leak words — word-boundary so common substrings pass.
  { label: 'paid', pattern: /\bpaid\b/i },
  { label: 'sponsored', pattern: /\bsponsored\b/i },
  { label: 'promotion', pattern: /\bpromotion\b/i },
  { label: 'hired', pattern: /\bhired\b/i },
  { label: 'shill', pattern: /\bshill\b/i },
];

/**
 * Extra guards applied ONLY in safe mode (`includeFourMemeUrl=false`).
 *
 * X's 2026 anti-spam rail blocks any post containing a URL or a raw
 * `0x…40-hex` crypto address during the first 7 days after OAuth token
 * regeneration. Hackathon demo-day falls inside that cooldown, so safe mode
 * refuses both classes of content entirely.
 */
export const NO_URL_GUARDS: readonly GuardPattern[] = [
  { label: 'http://', pattern: /http:\/\//i },
  { label: 'https://', pattern: /https:\/\//i },
  { label: 'www.', pattern: /www\./i },
  { label: 'four.meme', pattern: /four\.meme/i },
  // Raw EVM address (40 hex chars, case-insensitive). X treats this as a
  // crypto-address marker regardless of URL context, so safe mode refuses
  // the raw form in any part of the tweet.
  { label: 'crypto-address', pattern: /0x[a-f0-9]{40}/i },
];

// -------------------- address sanitiser ------------------------------------

const ADDRESS_REGEX_GLOBAL = /0x[a-fA-F0-9]{40}/g;

/**
 * Replace every 40-hex `0x…` address in `text` with its short form
 * `0xABCDEF…WXYZ` (6 hex prefix + `…` + 4 hex suffix, preserving original
 * case). Used by tweet-emitting tools as a final rewrite pass before the
 * guard fires, so any address the LLM sneaks through still lands on X in an
 * anonymised shape — X's anti-spam rail only fingerprints the raw 40-hex
 * form, not this shortened token.
 *
 * URLs that embed an address (e.g. `https://four.meme/token/<addr>`) are
 * also shortened here. In URL mode that rewrite preserves the click-through
 * link's validity only when the rendering client follows the resolver
 * forgivingly — for safe mode the URL itself is still banned, so the
 * combined sanitise + guard pipeline refuses the tweet outright.
 */
export function sanitizeTweetAddresses(text: string): string {
  return text.replace(ADDRESS_REGEX_GLOBAL, (match) => {
    // `match` is always 42 chars (`0x` + 40 hex). Slice to 6+4 so the output
    // reads `0x<prefix6>…<suffix4>` without ambiguity.
    const prefix = match.slice(0, 8); // `0x` + 6 hex = 8 chars
    const suffix = match.slice(-4);
    return `${prefix}…${suffix}`;
  });
}

// -------------------- guard checker ----------------------------------------

/**
 * Run the configured regex guards against `tweet` and report the ordered
 * list of violation labels. Empty `violations` array means clean; the
 * caller decides whether to publish or to retry the LLM with the list
 * injected as feedback.
 */
export function checkTweetGuard(tweet: string, options: CheckTweetGuardOptions): GuardResult {
  const violations: string[] = [];
  const patterns = options.includeFourMemeUrl ? BASE_GUARDS : [...BASE_GUARDS, ...NO_URL_GUARDS];
  for (const { label, pattern } of patterns) {
    if (pattern.test(tweet)) violations.push(label);
  }
  if (tweet.length > TWEET_HARD_CAP) {
    violations.push(`length>${String(TWEET_HARD_CAP)}`);
  }
  return { ok: violations.length === 0, violations };
}

// -------------------- prompt fragments -------------------------------------
//
// Each tweet-emitting persona builds its own system prompt, but they all
// need the same "never do these" boilerplate. Exporting the fragments here
// lets the heartbeat runner and the paid-shill tool stay decoupled while
// sharing the exact same rule wording — critical because the guard regexes
// above only work if the LLM was told to avoid those exact patterns.

/**
 * Safe-mode rule block: no URLs, no raw 0x address, no paid-intent leaks.
 * Heartbeat + post-shill-for both import this string and wrap it with
 * persona-specific context (`You are a curious reader…` vs `Each tick…`).
 */
export const BASE_RULES_NO_URL = `Rules (all MANDATORY):
- Output the tweet text ONLY. No preamble, no JSON, no markdown fences.
- Length: roughly 60-70 tokens, <= 250 characters (hard cap at 280). Keep it one line.
- Lead with the $SYMBOL, not a URL.
- Do NOT include http:// or https:// or www. or any URL (URLs + crypto addresses are blocked by X for the first 7 days after authentication — safe mode skips them).
- Do NOT mention bscscan, four.meme, base-sepolia, or any block explorer.
- Do NOT write the words "paid", "sponsored", "promotion", "hired", or "shill".
- Do NOT include the raw token address (0x... 40-hex) — X treats it as a crypto address and blocks the post during the 7-day cooldown. Refer to the token by its $SYMBOL only.
- Vary emoji + hashtag usage.
- Write in the voice of a curious reader who just discovered the project.`;

/**
 * URL-mode rule block: the four.meme click-through URL is required at the
 * tail; other explorer URLs + paid-intent leaks stay banned.
 */
export const BASE_RULES_WITH_URL = `Rules (all MANDATORY):
- Output the tweet text ONLY. No preamble, no JSON, no markdown fences.
- Length: roughly 70-90 tokens, <= 280 characters including the URL. Keep it tight (we enforce raw char count — URLs do NOT t.co-fold for our guard).
- The four.meme URL alone is ~66 chars — budget at most ~200 chars for the body + emoji + hashtags.
- Lead with the $SYMBOL.
- INCLUDE the four.meme token URL at the end of the tweet so readers can click through to the token page. Format: https://four.meme/token/<TOKEN_ADDRESS> — use the exact address supplied in the user prompt (full 0x...40-hex, lowercase).
- Do NOT include any other URL — no bscscan, no base-sepolia explorers, no personal links. The single four.meme/token URL is the only allowed link.
- Do NOT write the words "paid", "sponsored", "promotion", "hired", or "shill" anywhere.
- Vary emoji + hashtag usage (boilerplate "check this out" drives X spam detection).
- Write in the voice of a curious reader who just discovered the project.
- Never mention that you were paid, sponsored, or hired to post.`;
