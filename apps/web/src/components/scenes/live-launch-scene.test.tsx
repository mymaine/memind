/**
 * Red tests for <LiveLaunchScene /> (immersive-single-page P1 Task 5 /
 * AC-ISP-5).
 *
 * LiveLaunchScene is the stand-alone section wrapper that hosts the
 * "Launch demo" operation block on the single-page home surface. This
 * skeleton revision only owns three things:
 *
 *   1. The outer `<section id="launch-demo">` with `aria-labelledby` wiring.
 *   2. An intro header (h2 + 2-3 line pitch paragraph) so the section
 *      reads as a self-contained story beat before the live panel lands.
 *   3. A `brain-chat-slot` placeholder div tagged
 *      `data-testid="brain-chat-slot-launch"` — BRAIN-P5 will swap this
 *      for `<BrainChat scope="launch" />`. Keeping the slot carved out
 *      here means the parallel BRAIN-P5 agent can drop the chat surface
 *      in without touching this file's structure.
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

describe('<LiveLaunchScene /> skeleton contract', () => {
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
    // will do once the Brain chat surface lands. Assert a high-signal
    // substring so copy edits that drop the "on-chain" beat fail loud.
    expect(out).toContain('deploys the token');
    expect(out).toContain('on-chain');
  });

  it('reserves a `brain-chat-slot-launch` placeholder for the BRAIN-P5 <BrainChat /> embed', () => {
    const out = render();
    // Slot stub; BRAIN-P5 replaces its inner markup with <BrainChat
    // scope="launch" />. The data-testid + stable class name let the
    // downstream agent target the slot without touching this file.
    expect(out).toMatch(/data-testid="brain-chat-slot-launch"/);
    expect(out).toMatch(/class="[^"]*\bbrain-chat-slot\b/);
  });
});
