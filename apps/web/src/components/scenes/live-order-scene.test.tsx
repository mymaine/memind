/**
 * Tests for <LiveOrderScene /> (BRAIN-P5 Task 2 / AC-BRAIN-6).
 *
 * LiveOrderScene hosts the "Order a Shill" operation block with a chat-
 * driven pitch commissioning flow. Same shape as LiveLaunchScene: outer
 * `<section id="order-shill">`, h2 intro header, a `brain-chat-slot-order`
 * wrapper around the embedded `<BrainChat scope="order" />`. See
 * live-launch-scene.test.tsx for the strategy rationale.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { LiveOrderScene } from './live-order-scene.js';

function render(): string {
  return renderToStaticMarkup(<LiveOrderScene />);
}

describe('<LiveOrderScene /> contract', () => {
  it('mounts `<section id="order-shill">` with the matching aria-labelledby heading', () => {
    const out = render();
    expect(out).toMatch(/<section[^>]+id="order-shill"/);
    expect(out).toMatch(/aria-labelledby="order-shill-heading"/);
    expect(out).toMatch(/<h2[^>]+id="order-shill-heading"[^>]*>\s*Order a Shill\s*<\/h2>/);
  });

  it('renders the narrative intro paragraph describing the shill commission flow', () => {
    const out = render();
    // Intro hinges on the 0.01 USDC payment beat + aged X account fact —
    // both are core pitch points for the Order SKU.
    expect(out).toContain('0.01 USDC');
    expect(out).toContain('aged X account');
  });

  it('embeds the BrainChat surface with scope="order" inside the brain-chat-slot wrapper', () => {
    const out = render();
    expect(out).toMatch(/data-testid="brain-chat-slot-order"/);
    expect(out).toMatch(/aria-label="Brain chat"[^>]*data-scope="order"/);
  });

  it('renders the scope mascot in the header with mood="megaphone"', () => {
    const out = render();
    // Order scope maps to the Shiller persona, which shouts on-voice
    // tweets — mascot mood "megaphone".
    expect(out).toMatch(/data-testid="live-order-mascot"/);
    expect(out).toMatch(
      /data-testid="live-order-mascot"[^]*?data-mood="megaphone"/,
    );
  });
});
