/**
 * Tests for <Ch10Phase /> — phase map chapter of the scrollytelling narrative
 * (memind-scrollytelling-rebuild AC-MSR-9 ch10).
 *
 * Interior-progress contract:
 *
 *   - Three phase nodes: LAUNCH (shipped) / HEARTBEAT (shipped) /
 *     SWARM (future). Each node carries a status chip wired to the
 *     `phase-status-shipped|building|future` classes.
 *   - Progress cursor line: `cursor = lerp(0, 2, clamp(p * 1.2))` drives
 *     `phase-line-fill` width `(cursor / 2) * 100%`. Active node is the
 *     one closest to the cursor within 0.6 units.
 *   - Two bottom glyphs: walk-left (tertiary) + walk-right (accent).
 *
 * Fact corrections (regression guards):
 *   - Phase 2 desc MUST NOT mention "Base L2 expansion". We ship Base
 *     Sepolia only for x402; main token deploy stays on BSC mainnet.
 *   - Phase 2 status chip is `shipped` (not `building`) now that the
 *     heartbeat agent has actually landed. The `when` column reads
 *     `2026-04` and the desc notes the exact ship date.
 *
 * vitest runs without jsdom; render via `renderToStaticMarkup` + regex.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Ch10Phase } from '../ch10-phase.js';

describe('<Ch10Phase>', () => {
  it('renders exactly three phase nodes (LAUNCH / HEARTBEAT / SWARM)', () => {
    const html = renderToStaticMarkup(<Ch10Phase p={1} />);
    const nodes = html.match(/class="phase-node[^"]*"/g) ?? [];
    expect(nodes.length).toBe(3);
    expect(html).toContain('PHASE 1 \u00b7 LAUNCH');
    expect(html).toContain('PHASE 2 \u00b7 HEARTBEAT');
    expect(html).toContain('PHASE 3 \u00b7 SWARM');
  });

  it('applies the correct status class to each phase (2x shipped + 1x future)', () => {
    const html = renderToStaticMarkup(<Ch10Phase p={1} />);
    const shipped = (html.match(/phase-status phase-status-shipped/g) ?? []).length;
    const future = (html.match(/phase-status phase-status-future/g) ?? []).length;
    expect(shipped).toBe(2);
    expect(future).toBe(1);
    // Regression guard: Phase 2 used to read `building` while the desc
    // claimed the heartbeat was already shipped. The chip is now correct.
    expect(html).not.toContain('phase-status phase-status-building');
  });

  it('progress cursor line width scales with p (0 at p=0, 100% at p >= 1/1.2)', () => {
    const zero = renderToStaticMarkup(<Ch10Phase p={0} />);
    expect(zero).toMatch(/class="phase-line-fill"[^>]*style="width:0%/);
    // p=1 saturates cursor to 2 (via clamp(p*1.2)=1, lerp(0,2,1)=2), so
    // width = 100%.
    const full = renderToStaticMarkup(<Ch10Phase p={1} />);
    expect(full).toMatch(/class="phase-line-fill"[^>]*style="width:100%/);
  });

  it('Phase 2 description is honest: no "Base L2 expansion", states the ship date', () => {
    const html = renderToStaticMarkup(<Ch10Phase p={1} />);
    // Regression guard: the original draft claimed a Base L2 expansion we
    // never built; the fix references the actual heartbeat ship instead.
    expect(html).not.toMatch(/Base L2 expansion/i);
    // The corrected copy references the 2026-04-20 heartbeat ship.
    expect(html).toMatch(/shipped 2026-04-20/);
  });

  it('at p=0.5 the swarm stage has mounted its two mascots with token labels', () => {
    const html = renderToStaticMarkup(<Ch10Phase p={0.5} />);
    // 2026-04-20: the old bottom glyph pair (walk-left / walk-right)
    // was replaced by a swarm dialogue theatre — two negotiating brains
    // anchor the Phase-3 preview.
    expect(html).toMatch(/class="swarm-stage"/);
    expect(html).toMatch(/class="swarm-actor swarm-actor-left"/);
    expect(html).toMatch(/class="swarm-actor swarm-actor-right"/);
    expect(html).toContain('$FROG.brain');
    expect(html).toContain('$PEPE.brain');
    // Regression: the old phase-glyphs row is gone.
    expect(html).not.toMatch(/class="phase-glyphs"/);
  });

  it('swarm dialogue fades bubbles in with scripted thresholds', () => {
    // At p=0.40 the stage has finished fading in, but bubble 1 (t=0.45)
    // is still dormant — the 0.05-wide "quiet beat" the viewer uses to
    // register the set before the negotiation starts.
    const early = renderToStaticMarkup(<Ch10Phase p={0.4} />);
    const earlyBubbles = early.match(/class="swarm-bubble swarm-bubble-/g) ?? [];
    expect(earlyBubbles).toHaveLength(0);
    // At p=1 all four bubbles have surfaced — FROG opens, PEPE counters,
    // FROG closes, then the x402 system line lands centre.
    const full = renderToStaticMarkup(<Ch10Phase p={1} />);
    const fullBubbles = full.match(/class="swarm-bubble swarm-bubble-/g) ?? [];
    expect(fullBubbles).toHaveLength(4);
    expect(full).toContain('gm. 500 USDC for 3 shills this weekend?');
    expect(full).toContain('x402 handshake');
    expect(full).toContain('tweets deploy');
  });

  it('closes with the ecosystem-flywheel tagline that frames the whole chapter', () => {
    const html = renderToStaticMarkup(<Ch10Phase p={1} />);
    expect(html).toMatch(/class="swarm-tagline"/);
    expect(html).toContain('ecosystem flywheel');
    expect(html).toContain('brains pay brains');
    expect(html).toContain('four.meme grows');
  });

  it('surfaces an x402 handshake receipt card beside the theatre', () => {
    // Shell regardless of p: the card is always in the DOM; only its
    // status / price / tx contents swap as p progresses.
    const html = renderToStaticMarkup(<Ch10Phase p={1} />);
    expect(html).toMatch(/class="swarm-body"/);
    expect(html).toMatch(/class="deal"/);
    expect(html).toContain('x402 \u00b7 handshake receipt');
    for (const key of ['BUYER', 'SELLER', 'SKU', 'PRICE', 'TAKE', 'TX']) {
      expect(html).toContain(key);
    }
    expect(html).toContain('chain \u00b7 BNB');
    expect(html).toContain('four.meme \u00b7 2%');
  });

  it('receipt walks OFFERED → COUNTERED → SIGNING → SETTLED with bubble thresholds', () => {
    // p < 0.60 → OFFERED, flat 500 USDC (only the FROG offer on stage).
    const offered = renderToStaticMarkup(<Ch10Phase p={0.5} />);
    expect(offered).toContain('OFFERED');
    expect(offered).toContain('awaiting counter');
    expect(offered).not.toContain('strike was');

    // 0.60 ≤ p < 0.75 → COUNTERED, 500 struck through + 300 USDC.
    const countered = renderToStaticMarkup(<Ch10Phase p={0.68} />);
    expect(countered).toContain('COUNTERED');
    expect(countered).toMatch(/class="strike was"[^>]*>500 USDC/);
    expect(countered).toMatch(/class="is"[^>]*>300 USDC/);

    // 0.75 ≤ p < 0.90 → SIGNING, tx pending.
    const signing = renderToStaticMarkup(<Ch10Phase p={0.82} />);
    expect(signing).toContain('SIGNING');
    expect(signing).toContain('pending');

    // p ≥ 0.90 → SETTLED with real tx + block.
    const settled = renderToStaticMarkup(<Ch10Phase p={0.95} />);
    expect(settled).toContain('SETTLED');
    expect(settled).toContain('0x4a7e1c\u20269f02');
    expect(settled).toContain('block #47,102,938');
  });
});
