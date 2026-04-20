import { describe, it, expect } from 'vitest';
import {
  BASE_GUARDS,
  NO_URL_GUARDS,
  BASE_RULES_NO_URL,
  BASE_RULES_WITH_URL,
  checkTweetGuard,
  sanitizeTweetAddresses,
} from './tweet-guard.js';

/**
 * tweet-guard tests
 * -----------------
 * Pure unit tests covering the three exported surfaces that replaced the
 * inline guards previously buried in post-shill-for.ts:
 *
 *   1. `checkTweetGuard(text, { includeFourMemeUrl })` — returns a GuardResult
 *      with the ordered violation labels. Safe mode (default) blocks URLs +
 *      raw 0x...40-hex addresses; URL mode only enforces BASE_GUARDS + 280
 *      char cap.
 *   2. `sanitizeTweetAddresses(text)` — anonymises every 40-hex address in
 *      the body into `0xABCDEF...EFGH` (prefix 6 + ellipsis + suffix 4).
 *      Used as a belt-and-suspenders rewrite step by `post_to_x` before the
 *      guard fires, so a misbehaving LLM cannot slip a raw address past the
 *      X API during the 7-day cooldown.
 *   3. Static metadata (`BASE_GUARDS`, `NO_URL_GUARDS`, rule strings) is
 *      exposed so the heartbeat runner + x-post tool can reuse the same
 *      prompt fragments without drifting regex definitions.
 */

const VALID_ADDR = '0x1234567890abcdef1234567890abcdef12345678';
const UPPER_ADDR = '0xABCDEF0123456789ABCDEF0123456789ABCDEF01';

describe('checkTweetGuard (safe mode / includeFourMemeUrl=false)', () => {
  it('accepts a clean tweet with no URL, no address, and under 280 chars', () => {
    const text = '$HBNB2026-BAT cavern lore hits different at dusk 👁';
    const result = checkTweetGuard(text, { includeFourMemeUrl: false });
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it('rejects a raw 40-hex 0x address', () => {
    const text = `$BAT check ${VALID_ADDR} for details`;
    const result = checkTweetGuard(text, { includeFourMemeUrl: false });
    expect(result.ok).toBe(false);
    expect(result.violations).toContain('crypto-address');
  });

  it('rejects a bscscan URL (bscscan label from BASE_GUARDS)', () => {
    const text = '$BAT see bscscan.com/token/0x... for details';
    const result = checkTweetGuard(text, { includeFourMemeUrl: false });
    expect(result.ok).toBe(false);
    expect(result.violations).toContain('bscscan');
  });

  it('rejects a tweet containing the word "paid"', () => {
    const text = '$BAT I was paid to post this';
    const result = checkTweetGuard(text, { includeFourMemeUrl: false });
    expect(result.ok).toBe(false);
    expect(result.violations).toContain('paid');
  });

  it('rejects a tweet longer than 280 chars (length>280 violation)', () => {
    const text = 'a'.repeat(300);
    const result = checkTweetGuard(text, { includeFourMemeUrl: false });
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.startsWith('length>'))).toBe(true);
  });

  it('rejects a https:// URL in safe mode', () => {
    const text = '$BAT see https://example.com';
    const result = checkTweetGuard(text, { includeFourMemeUrl: false });
    expect(result.ok).toBe(false);
    expect(result.violations).toContain('https://');
  });
});

describe('checkTweetGuard (URL mode / includeFourMemeUrl=true)', () => {
  it('accepts a tweet containing a four.meme URL + raw address', () => {
    const text = `$HBNB2026-BAT cavern lore 👁 https://four.meme/token/${VALID_ADDR}`;
    const result = checkTweetGuard(text, { includeFourMemeUrl: true });
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it('still rejects bscscan in URL mode', () => {
    const text = `$BAT https://bscscan.com/token/${VALID_ADDR}`;
    const result = checkTweetGuard(text, { includeFourMemeUrl: true });
    expect(result.ok).toBe(false);
    expect(result.violations).toContain('bscscan');
  });

  it('still rejects paid-intent words in URL mode', () => {
    const text = `$BAT sponsored drop https://four.meme/token/${VALID_ADDR}`;
    const result = checkTweetGuard(text, { includeFourMemeUrl: true });
    expect(result.ok).toBe(false);
    expect(result.violations).toContain('sponsored');
  });

  it('still enforces the 280-char cap in URL mode', () => {
    const text = 'a'.repeat(281);
    const result = checkTweetGuard(text, { includeFourMemeUrl: true });
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.startsWith('length>'))).toBe(true);
  });
});

describe('sanitizeTweetAddresses', () => {
  it('returns the input unchanged when no address is present', () => {
    const text = '$HBNB2026-BAT cavern lore at dusk';
    expect(sanitizeTweetAddresses(text)).toBe(text);
  });

  it('shortens a single 40-hex address into the `0xABCDEF…WXYZ` form', () => {
    const text = `check ${VALID_ADDR} now`;
    const expected = `check 0x123456…5678 now`;
    expect(sanitizeTweetAddresses(text)).toBe(expected);
  });

  it('shortens uppercase-hex addresses as well (case-insensitive regex)', () => {
    const text = `watch ${UPPER_ADDR}`;
    const expected = `watch 0xABCDEF…EF01`;
    expect(sanitizeTweetAddresses(text)).toBe(expected);
  });

  it('shortens every address when the tweet contains multiple', () => {
    const other = '0xdeadbeef00000000000000000000000000001111';
    const text = `${VALID_ADDR} vs ${other}`;
    const result = sanitizeTweetAddresses(text);
    expect(result).toContain('0x123456…5678');
    expect(result).toContain('0xdeadbe…1111');
    expect(result).not.toContain(VALID_ADDR);
    expect(result).not.toContain(other);
  });

  it('also shortens addresses embedded inside a four.meme URL', () => {
    // URL mode is the only surface where four.meme URLs appear — but we
    // apply the sanitiser universally (belt-and-suspenders for safe mode
    // too). The tool boundary decides whether the sanitised text is still
    // acceptable (URL mode: yes; safe mode: still fails guard because the
    // URL itself is banned).
    const text = `visit https://four.meme/token/${VALID_ADDR} now`;
    const result = sanitizeTweetAddresses(text);
    expect(result).toBe('visit https://four.meme/token/0x123456…5678 now');
  });

  it('does not shrink strings shorter than 40 hex chars', () => {
    const text = 'short 0xabc and 0xabcdef12 are unchanged';
    expect(sanitizeTweetAddresses(text)).toBe(text);
  });

  it('sanitized output passes the safe-mode address guard', () => {
    const dirty = `$BAT watch ${VALID_ADDR}`;
    const sanitized = sanitizeTweetAddresses(dirty);
    const result = checkTweetGuard(sanitized, { includeFourMemeUrl: false });
    // URL + paid guards are not tripped here; the only original violation
    // (crypto-address) is gone once we shorten the hex.
    expect(result.violations).not.toContain('crypto-address');
  });
});

describe('exported metadata', () => {
  it('BASE_GUARDS contains expected labels', () => {
    const labels = BASE_GUARDS.map((g) => g.label);
    expect(labels).toEqual(
      expect.arrayContaining(['bscscan', 'base-sepolia', 'paid', 'sponsored', 'shill']),
    );
  });

  it('NO_URL_GUARDS contains expected labels', () => {
    const labels = NO_URL_GUARDS.map((g) => g.label);
    expect(labels).toEqual(
      expect.arrayContaining(['http://', 'https://', 'www.', 'four.meme', 'crypto-address']),
    );
  });

  it('BASE_RULES_NO_URL describes safe-mode rules', () => {
    expect(BASE_RULES_NO_URL).toMatch(/Do NOT include http/i);
    expect(BASE_RULES_NO_URL).toMatch(/raw token address/i);
  });

  it('BASE_RULES_WITH_URL instructs the model to include the four.meme URL', () => {
    expect(BASE_RULES_WITH_URL).toMatch(/four\.meme\/token/i);
  });
});
