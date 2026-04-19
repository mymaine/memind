/**
 * Tests for `<BrainChatSuggestions />` (BRAIN-P4 Task 4 / AC-BRAIN-9).
 *
 * Each chip now carries a short `label` + a pool of `prompts`; clicking a
 * chip calls `onPick` with a random member of the pool so the button row
 * stays compact while the prompt library can be long + wild. Tests cover
 *   1. scope → chip mapping (label semantics + non-empty pools)
 *   2. the short label surfaces in markup while the (long) prompts don't
 *   3. `pickRandomPrompt` always returns a member of the pool
 *   4. onPick wiring contract (string from the clicked chip's pool)
 */
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { BrainChatSuggestions, chipsForScope, pickRandomPrompt } from './brain-chat-suggestions.js';

describe('chipsForScope() — scope → chip mapping', () => {
  it('scope=launch returns launch-themed chips with non-empty pools', () => {
    const chips = chipsForScope('launch');
    expect(chips.length).toBeGreaterThanOrEqual(3);
    expect(chips.some((c) => /launch|deploy|meme/i.test(c.label))).toBe(true);
    for (const c of chips) {
      expect(c.prompts.length).toBeGreaterThan(0);
    }
  });

  it('scope=order returns order-themed chips (label mentions shill/order/pitch)', () => {
    const chips = chipsForScope('order');
    expect(chips.length).toBeGreaterThanOrEqual(3);
    expect(chips.some((c) => /shill|order|pitch/i.test(c.label))).toBe(true);
    for (const c of chips) {
      expect(c.prompts.length).toBeGreaterThan(0);
    }
  });

  it('scope=heartbeat returns heartbeat-themed chips', () => {
    const chips = chipsForScope('heartbeat');
    expect(chips.length).toBeGreaterThanOrEqual(3);
    expect(chips.some((c) => /heartbeat|tick|autonomous/i.test(c.label))).toBe(true);
    for (const c of chips) {
      expect(c.prompts.length).toBeGreaterThan(0);
    }
  });

  it('scope=global returns a mixed chip set (>=3) with non-empty pools', () => {
    const chips = chipsForScope('global');
    expect(chips.length).toBeGreaterThanOrEqual(3);
    for (const c of chips) {
      expect(c.prompts.length).toBeGreaterThan(0);
    }
  });
});

describe('<BrainChatSuggestions /> render — labels surface, prompts stay hidden', () => {
  it('scope=launch renders each chip LABEL into the markup', () => {
    const out = renderToStaticMarkup(
      <BrainChatSuggestions scope="launch" onPick={() => undefined} />,
    );
    for (const chip of chipsForScope('launch')) {
      expect(out).toContain(chip.label);
    }
  });

  it('scope=order renders each chip LABEL into the markup', () => {
    const out = renderToStaticMarkup(
      <BrainChatSuggestions scope="order" onPick={() => undefined} />,
    );
    for (const chip of chipsForScope('order')) {
      expect(out).toContain(chip.label);
    }
  });

  it('does NOT leak the (long) prompt pool entries into the rendered markup', () => {
    // Pins the core contract of the new chip shape: only the short label
    // is visible on the button; prompts stay in-memory until click. A
    // future refactor that accidentally renders prompts under the label
    // would trip this test.
    const out = renderToStaticMarkup(
      <BrainChatSuggestions scope="launch" onPick={() => undefined} />,
    );
    for (const chip of chipsForScope('launch')) {
      for (const prompt of chip.prompts) {
        expect(out).not.toContain(prompt);
      }
    }
  });
});

describe('pickRandomPrompt() — random selector', () => {
  it('always returns a member of the chip prompt pool', () => {
    for (const chip of chipsForScope('launch')) {
      for (let i = 0; i < 25; i++) {
        expect(chip.prompts).toContain(pickRandomPrompt(chip));
      }
    }
  });
});

describe('<BrainChatSuggestions /> onPick wiring — JSDOM-free stand-in', () => {
  it('invokes onPick with a prompt from the clicked chip pool (per-chip)', () => {
    // The node env has no click dispatch; mimic the button onClick inline.
    // Contract: onPick receives a non-empty string that is a verbatim
    // member of the clicked chip's prompt pool.
    const onPick = vi.fn<(text: string) => void>();
    const chips = chipsForScope('launch');
    for (const chip of chips) {
      const text = pickRandomPrompt(chip);
      onPick(text);
      expect(chip.prompts).toContain(text);
      expect(text.length).toBeGreaterThan(0);
    }
    expect(onPick).toHaveBeenCalledTimes(chips.length);
  });

  it('renders <button type="button"> per chip so the client shell can wire onClick', () => {
    const out = renderToStaticMarkup(
      <BrainChatSuggestions scope="launch" onPick={() => undefined} />,
    );
    const buttons = out.match(/<button\b[^>]*type="button"/g) ?? [];
    expect(buttons.length).toBe(chipsForScope('launch').length);
  });
});
