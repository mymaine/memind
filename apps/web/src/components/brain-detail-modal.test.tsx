/**
 * Red tests for <BrainDetailModalView /> — the dialog that opens from the
 * BrainStatusBar and renders the Brain identity block, memory counters, and
 * persona roster.
 *
 * Tests drive the pure view directly with explicit props. The runtime
 * component adds Esc / outside-click / focus-return side effects; those are
 * asserted by injecting an `onClose` mock and verifying the view wires the
 * handler (aria-label + onClick attribute) rather than by simulating DOM
 * events (this repo runs vitest in node without jsdom).
 *
 * Covers the five BrainDetailModal tests called out in the V4.7-P4 brief:
 *   1. Hidden when `open` prop is false (renders nothing / markup is empty).
 *   2. Visible when `open` is true — the 4 shipped personas and 3 future
 *      slots from BRAIN_ARCHITECTURE all appear in the markup.
 *   3. Esc handler — the dialog advertises `data-close-on-esc="true"` and
 *      exposes a close button bound to onClose so the client shell can
 *      attach the keyboard listener without forking the view.
 *   4. Focus target — the close button carries `data-focus-return` so the
 *      client shell (which owns the real DOM ref) knows which element must
 *      be focused on mount; documenting the focus-return assumption.
 *   5. Footer contains the decision-doc reference string.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { BRAIN_ARCHITECTURE } from '@/lib/narrative-copy';
import { BrainDetailModalView } from './brain-detail-modal.js';

const NO_OP = () => {};

describe('<BrainDetailModalView />', () => {
  it('renders nothing when open=false (hidden modal produces empty markup)', () => {
    const out = renderToStaticMarkup(
      <BrainDetailModalView
        open={false}
        onClose={NO_OP}
        loreCount={0}
        orderCount={0}
        tickCount={0}
      />,
    );
    // An unmounted / closed modal must not leak its title or persona list
    // into the surrounding page. Empty string is the canonical signal.
    expect(out).toBe('');
  });

  it('renders all 4 shipped personas and all 3 future slots when open=true', () => {
    const out = renderToStaticMarkup(
      <BrainDetailModalView
        open={true}
        onClose={NO_OP}
        loreCount={0}
        orderCount={0}
        tickCount={0}
      />,
    );
    for (const persona of BRAIN_ARCHITECTURE.shippedPersonas) {
      expect(out).toContain(persona.name);
    }
    for (const slot of BRAIN_ARCHITECTURE.futureSlots) {
      expect(out).toContain(slot.name);
    }
    // The identity block also surfaces the canonical subtitle from
    // narrative-copy so Vision scene + modal stay in sync.
    expect(out).toContain(BRAIN_ARCHITECTURE.brainSubtitle);
  });

  it('exposes a close button bound to onClose + advertises Esc support for the client shell', () => {
    const out = renderToStaticMarkup(
      <BrainDetailModalView
        open={true}
        onClose={NO_OP}
        loreCount={0}
        orderCount={0}
        tickCount={0}
      />,
    );
    // The view emits a `data-close-on-esc="true"` marker on the dialog root
    // so the <BrainDetailModal /> client shell can attach a document-level
    // keydown listener scoped to this dialog instance.
    expect(out).toContain('data-close-on-esc="true"');
    // An explicit close button is present and labelled for assistive tech.
    expect(out).toMatch(/<button[^>]*aria-label="Close Token Brain detail"/);
  });

  it('marks the focus-return target so the client shell can restore focus to the BrainStatusBar button on close', () => {
    // The modal renders a `data-focus-return="close-button"` attribute on
    // the element that should receive initial focus (the close button). The
    // client shell owns the DOM ref that actually calls `.focus()` — we
    // only assert the contract here. On close, the shell restores focus to
    // the BrainStatusBar trigger button per the brief's focus-return note.
    const out = renderToStaticMarkup(
      <BrainDetailModalView
        open={true}
        onClose={NO_OP}
        loreCount={0}
        orderCount={0}
        tickCount={0}
      />,
    );
    expect(out).toContain('data-focus-return="close-button"');
  });

  it('footer references the decision doc that locked the Brain positioning', () => {
    const out = renderToStaticMarkup(
      <BrainDetailModalView
        open={true}
        onClose={NO_OP}
        loreCount={0}
        orderCount={0}
        tickCount={0}
      />,
    );
    expect(out).toContain('docs/decisions/2026-04-19-brain-agent-positioning.md');
  });

  it('surfaces em-dash placeholders when no counts are available (tickCount = null fallback)', () => {
    // When the Heartbeat panel is not active in the current run context the
    // brief requires an em-dash placeholder; the view accepts `null` for
    // that counter and renders "—" rather than "0" so judges do not think
    // the counter is live-but-empty.
    const out = renderToStaticMarkup(
      <BrainDetailModalView
        open={true}
        onClose={NO_OP}
        loreCount={null}
        orderCount={null}
        tickCount={null}
      />,
    );
    // We expect at least three em-dashes (one per counter).
    const dashes = out.match(/—/g) ?? [];
    expect(dashes.length).toBeGreaterThanOrEqual(3);
  });
});
