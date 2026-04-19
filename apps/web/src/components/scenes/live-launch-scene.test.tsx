/**
 * Tests for <LiveLaunchScene /> (BRAIN-P5 Task 1 / AC-BRAIN-6).
 *
 * LiveLaunchScene is the stand-alone section wrapper that hosts the
 * "Launch demo" operation block on the single-page home surface. It owns
 * four things:
 *
 *   1. The outer `<section id="launch-demo">` with `aria-labelledby` wiring.
 *   2. An intro header (h2 + pitch paragraph).
 *   3. A wrapper `data-testid="brain-chat-slot-launch"` preserved so page /
 *      external selectors can target the slot.
 *   4. An embedded `<BrainChat scope="launch" />` providing the chat-driven
 *      Launch flow.
 *
 * Testing strategy mirrors the sibling scene tests: node-env vitest with
 * `renderToStaticMarkup`. Client effects (`useScrollReveal`) never fire in
 * static render, so every assertion is purely structural.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { LiveLaunchScene } from './live-launch-scene.js';

function render(): string {
  return renderToStaticMarkup(<LiveLaunchScene />);
}

describe('<LiveLaunchScene /> contract', () => {
  it('mounts `<section id="launch-demo">` with the matching aria-labelledby heading', () => {
    const out = render();
    // The landmark owns its own section id so page.tsx mounts the scene
    // directly without a wrapper (wrapping would double the id). The
    // aria-labelledby wires the heading to the landmark for screen
    // readers.
    expect(out).toMatch(/<section[^>]+id="launch-demo"/);
    expect(out).toMatch(/aria-labelledby="launch-demo-heading"/);
    expect(out).toMatch(/<h2[^>]+id="launch-demo-heading"[^>]*>\s*Live Launch Demo\s*<\/h2>/);
  });

  it('renders the narrative intro paragraph so the section reads before the live panel lands', () => {
    const out = render();
    // The intro is a 2-3 line pitch describing what the live Launch demo
    // will do. Assert a high-signal substring so copy edits that drop the
    // "on-chain" beat fail loud.
    expect(out).toContain('deploys the token');
    expect(out).toContain('on-chain');
  });

  it('embeds the BrainChat surface with scope="launch" inside the brain-chat-slot wrapper', () => {
    const out = render();
    // The slot wrapper with the stable data-testid is preserved so page
    // selectors / external agents can still target the chat embed region.
    expect(out).toMatch(/data-testid="brain-chat-slot-launch"/);
    // BrainChat renders a landmark `<section aria-label="Brain chat" ...
    // data-scope="launch">` — asserting the scope attribute is the tightest
    // structural guarantee that the embed is wired with the right scope.
    expect(out).toMatch(/aria-label="Brain chat"[^>]*data-scope="launch"/);
  });
});
