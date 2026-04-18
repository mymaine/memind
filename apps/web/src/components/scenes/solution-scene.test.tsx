/**
 * Red tests for <SolutionScene /> (V4.7-P3 Task 2 / AC-P4.7-4).
 *
 * The scene follows Problem and precedes Product — 100vh, three side-by-side
 * step cards (Launch → Pay → Shill) with the middle card hosting an embedded,
 * autoplay instance of <UsdcParticleFlow /> (the x402 micro-animation) plus a
 * static tx-hash pill that flashes to echo settlement.
 *
 * The scene's own contract — what this file asserts — is structural; all
 * motion sits inside <UsdcParticleFlow /> (already tested) or pure CSS
 * keyframes (trusted per spec "Testing Strategy · not tested").
 *
 *   1. Outer <section> has aria-label="Solution" for landmark a11y.
 *   2. Outer <section> carries the `.scene` class so globals.css scene-reveal
 *      picks it up (shared AC-P4.7-8 wiring).
 *   3. Renders all three SOLUTION_STEPS titles (Launch / Pay / Shill).
 *   4. Renders all three SOLUTION_STEPS bodies (the single-line descriptions
 *      from narrative-copy — asserted via a substring stable across copy
 *      edits: "One-line prompt" for Launch so the full paragraph drift does
 *      not false-fail).
 *   5. The middle card embeds <UsdcParticleFlow /> — asserted by presence of
 *      the particle group (two role="img" elements show up: one for the
 *      scene-level animation container in card 2, one from UsdcParticleFlow
 *      itself).
 *   6. The middle card renders a tx pill containing the demo-proof x402
 *      hash prefix ("BASE 0x62e4..c3df") so the viewer reads the pill as
 *      the on-chain receipt — matches EVIDENCE_ARTIFACTS[3].
 *   7. Copy overrides (`steps` prop) replace the narrative-copy defaults —
 *      same escape hatch pattern as HeroScene / ProblemScene. When overridden
 *      only the override titles appear (no default leakage).
 *   8. `freeze={true}` renders a deterministic frame with the tx pill locked
 *      on (via the `tx-pill--flashing` class absent / static variant) and
 *      the outer `.scene--revealed` class applied so the scene paints in
 *      tests without depending on scroll.
 *
 * Strategy: node-env vitest + renderToStaticMarkup, mirroring hero-scene and
 * problem-scene. renderToStaticMarkup skips client effects, so useScrollReveal
 * and UsdcParticleFlow's rAF never fire — perfect for structural assertions.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SolutionScene, TX_PILL_LABEL } from './solution-scene.js';
import { EVIDENCE_ARTIFACTS, SOLUTION_STEPS } from '../../lib/narrative-copy.js';

function render(props: Parameters<typeof SolutionScene>[0] = {}): string {
  return renderToStaticMarkup(<SolutionScene {...props} />);
}

describe('<SolutionScene /> structural contract', () => {
  it('marks the outer landmark with aria-label="Solution"', () => {
    const out = render();
    expect(out).toMatch(/<section[^>]+aria-label="Solution"/);
  });

  it('applies the `.scene` class on the outer landmark (scene-reveal hook)', () => {
    const out = render();
    expect(out).toMatch(/<section[^>]+class="[^"]*\bscene\b/);
  });

  it('renders every SOLUTION_STEPS title (Launch / Pay / Shill)', () => {
    const out = render();
    for (const step of SOLUTION_STEPS) {
      expect(out).toContain(step.title);
    }
  });

  it('renders the three SOLUTION_STEPS bodies (stable substrings)', () => {
    const out = render();
    // Stable anchor phrases taken from narrative-copy — drift in either
    // direction surfaces in the narrative-copy snapshot test first; the
    // substring check here confirms the SolutionScene propagates them.
    expect(out).toContain('One-line prompt');
    expect(out).toContain('0.01 USDC per shill');
    expect(out).toContain('aged X account');
  });

  it('embeds the <UsdcParticleFlow /> instance in the middle card', () => {
    const out = render();
    // UsdcParticleFlow renders its own role="img" wrapper; the scene itself
    // does NOT otherwise surface a role="img" element, so at least one
    // particle-group marker is the cheapest way to assert the embed without
    // coupling to internal layout.
    expect(out).toMatch(/data-testid="particle-group"/);
    expect(out).toMatch(/role="img"[^>]+aria-label="[^"]*USDC/);
  });

  it('renders the tx-hash pill with the demo-proof BASE 0x62e4..c3df label', () => {
    const out = render();
    // Hardcoded from EVIDENCE_ARTIFACTS[3].value (base-sepolia x402 tx). We
    // show the prefix + suffix truncation so the viewer reads it as a real
    // settlement hash — matches the demo-video narration.
    expect(out).toContain('BASE');
    expect(out).toContain('0x62e4');
    expect(out).toContain('c3df');
  });

  it('allows overriding `steps` — only the supplied entries render (single-source escape hatch)', () => {
    const out = render({
      steps: [
        { title: 'A', body: 'x-body' },
        { title: 'B', body: 'y-body' },
        { title: 'C', body: 'z-body' },
      ],
    });
    expect(out).toContain('A');
    expect(out).toContain('x-body');
    expect(out).toContain('B');
    expect(out).toContain('y-body');
    expect(out).toContain('C');
    expect(out).toContain('z-body');
    // Default body texts must NOT leak when the override fully replaces the
    // list — protects the single-source invariant.
    expect(out).not.toContain('One-line prompt');
    expect(out).not.toContain('aged X account');
  });

  it('freeze=true locks the scene into its revealed state and the tx pill on', () => {
    const out = render({ freeze: true });
    // When frozen (tests + reduced-motion share this path), the section must
    // paint its revealed variant so structural assertions see the final
    // layout without depending on scroll. `.scene--revealed` is the marker.
    expect(out).toMatch(/<section[^>]+class="[^"]*\bscene--revealed\b/);
    // Tx pill stays on — static drop-shadow variant; the flashing class is
    // absent so reduced-motion users see a steady glow rather than a blink.
    expect(out).toMatch(/data-testid="tx-pill"/);
    expect(out).not.toMatch(/data-testid="tx-pill"[^>]+class="[^"]*\btx-pill--flashing\b/);
  });

  it('TX_PILL_LABEL mirrors the x402 settlement artifact short hash', () => {
    // Review P2-3: spec comment in solution-scene.tsx promises the pill stays
    // in sync with EVIDENCE_ARTIFACTS[3]; this test pins that invariant so a
    // drift on either side breaks the build instead of surviving review.
    const settlement = EVIDENCE_ARTIFACTS[3];
    expect(settlement.chain).toBe('base-sepolia');
    expect(settlement.kind).toBe('tx');
    const expected = `BASE ${settlement.value.slice(0, 6)}..${settlement.value.slice(-4)}`;
    expect(TX_PILL_LABEL).toBe(expected);
  });
});
