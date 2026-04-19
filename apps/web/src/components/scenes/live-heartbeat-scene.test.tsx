/**
 * Red tests for <LiveHeartbeatScene /> (immersive-single-page P1 Task 5 /
 * AC-ISP-5).
 *
 * LiveHeartbeatScene hosts the "Autonomous Heartbeat" operation block.
 * Same skeleton shape as the sibling live-demo scenes: outer
 * `<section id="heartbeat-demo">`, h2 intro header, and a
 * `brain-chat-slot-heartbeat` placeholder for BRAIN-P5. See
 * live-launch-scene.test.tsx for the strategy rationale.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { LiveHeartbeatScene } from './live-heartbeat-scene.js';

function render(): string {
  return renderToStaticMarkup(<LiveHeartbeatScene />);
}

describe('<LiveHeartbeatScene /> skeleton contract', () => {
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

  it('reserves a `brain-chat-slot-heartbeat` placeholder for the BRAIN-P5 <BrainChat /> embed', () => {
    const out = render();
    expect(out).toMatch(/data-testid="brain-chat-slot-heartbeat"/);
    expect(out).toMatch(/class="[^"]*\bbrain-chat-slot\b/);
  });
});
