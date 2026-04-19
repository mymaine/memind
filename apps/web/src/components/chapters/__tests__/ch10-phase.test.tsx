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

  it('renders the two bottom glyphs (walk-left tertiary + walk-right accent)', () => {
    const html = renderToStaticMarkup(<Ch10Phase p={0.5} />);
    expect(html).toMatch(/data-mood="walk-left"/);
    expect(html).toMatch(/data-mood="walk-right"/);
    // The wrapper sits inside .phase-glyphs.
    expect(html).toMatch(/class="phase-glyphs"/);
  });
});
