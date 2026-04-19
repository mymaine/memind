/**
 * Regression tests for scoped CSS rules that the dashboard depends on.
 *
 * Vitest runs in node here (no jsdom), so instead of mounting real
 * components and measuring layout we read `globals.css` as a string and
 * assert that specific selectors + properties are present. This locks in
 * UAT fixes whose correctness is purely at the CSS layer.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const cssPath = fileURLToPath(new URL('./globals.css', import.meta.url));
const css = readFileSync(cssPath, 'utf8');

/**
 * Extract the CSS declarations block for a given selector (up to the
 * first closing brace). Returns empty string if not found so the
 * assertion below produces a helpful "expected X to contain Y" diff.
 */
function bodyFor(selector: string): string {
  const idx = css.indexOf(selector);
  if (idx === -1) return '';
  const openBrace = css.indexOf('{', idx);
  const closeBrace = css.indexOf('}', openBrace);
  if (openBrace === -1 || closeBrace === -1) return '';
  return css.slice(openBrace + 1, closeBrace);
}

describe('globals.css — brain-chat-markdown long-hash wrapping (UAT 2026-04-20)', () => {
  // Context: the assistant sometimes prints a full 0x tx hash
  // (`0x85763d2587042984727f6fce8b31b35f2f17e22c3804aa7f9...`) inside
  // markdown. Without explicit wrapping rules, browsers never break
  // all-hex runs, so the string blew past the 460px BrainChat panel.
  // These rules allow the paragraph / code / anchor to wrap anywhere.

  it('.brain-chat-markdown declares overflow-wrap: anywhere', () => {
    expect(bodyFor('.brain-chat-markdown ')).toMatch(/overflow-wrap:\s*anywhere/);
  });

  it('.brain-chat-markdown declares word-break: break-word', () => {
    expect(bodyFor('.brain-chat-markdown ')).toMatch(/word-break:\s*break-word/);
  });

  it('.brain-chat-markdown code wraps long hashes with word-break: break-all', () => {
    const body = bodyFor('.brain-chat-markdown code');
    expect(body).toMatch(/overflow-wrap:\s*anywhere/);
    expect(body).toMatch(/word-break:\s*break-all/);
  });

  it('.brain-chat-markdown pre wraps long hashes with word-break: break-all', () => {
    const body = bodyFor('.brain-chat-markdown pre');
    expect(body).toMatch(/overflow-wrap:\s*anywhere/);
    expect(body).toMatch(/word-break:\s*break-all/);
    expect(body).toMatch(/white-space:\s*pre-wrap/);
  });

  it('.brain-chat-markdown a wraps long URL hashes with word-break: break-all', () => {
    const body = bodyFor('.brain-chat-markdown a ');
    expect(body).toMatch(/overflow-wrap:\s*anywhere/);
    expect(body).toMatch(/word-break:\s*break-all/);
  });
});
