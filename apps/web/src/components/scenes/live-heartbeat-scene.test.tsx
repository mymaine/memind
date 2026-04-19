/**
 * Tests for <LiveHeartbeatScene /> (BRAIN-P5 Task 3 / AC-BRAIN-6).
 *
 * LiveHeartbeatScene hosts the "Autonomous Heartbeat" operation block with
 * a chat-driven heartbeat entry point. Same shape as the sibling scenes:
 * outer `<section id="heartbeat-demo">`, h2 intro header, a
 * `brain-chat-slot-heartbeat` wrapper around `<BrainChat scope="heartbeat" />`.
 * See live-launch-scene.test.tsx for the strategy rationale.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { LiveHeartbeatScene } from './live-heartbeat-scene.js';

function render(): string {
  return renderToStaticMarkup(<LiveHeartbeatScene />);
}

describe('<LiveHeartbeatScene /> contract', () => {
  it('mounts `<section id="heartbeat-demo">` with the matching aria-labelledby heading', () => {
    const out = render();
    expect(out).toMatch(/<section[^>]+id="heartbeat-demo"/);
    expect(out).toMatch(/aria-labelledby="heartbeat-demo-heading"/);
    expect(out).toMatch(
      /<h2[^>]+id="heartbeat-demo-heading"[^>]*>\s*Autonomous Heartbeat\s*<\/h2>/,
    );
  });

  it('renders the narrative intro paragraph describing the heartbeat autonomy loop', () => {
    const out = render();
    // Intro hinges on the two core heartbeat verbs: "tick" (autonomous
    // cadence) and "token address" (user-provided entry point).
    expect(out).toContain('token address');
    expect(out).toContain('ticks');
  });

  it('embeds the BrainChat surface with scope="heartbeat" inside the brain-chat-slot wrapper', () => {
    const out = render();
    expect(out).toMatch(/data-testid="brain-chat-slot-heartbeat"/);
    expect(out).toMatch(/aria-label="Brain chat"[^>]*data-scope="heartbeat"/);
  });
});
