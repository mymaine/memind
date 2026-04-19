/**
 * Tests for <Ch10Phase /> — phase map chapter of the scrollytelling narrative
 * (memind-scrollytelling-rebuild AC-MSR-9 ch10).
 *
 * Ports the interior-progress contract from
 * `docs/design/memind-handoff/project/components/chapters.jsx` Ch10Phase
 * (lines 488-521):
 *
 *   - Three phase nodes: LAUNCH (shipped) / HEARTBEAT (building) /
 *     SWARM (future). Each node carries a status chip wired to the
 *     `phase-status-shipped|building|future` classes.
 *   - Progress cursor line: `cursor = lerp(0, 2, clamp(p * 1.2))` drives
 *     `phase-line-fill` width `(cursor / 2) * 100%`. Active node is the
 *     one closest to the cursor within 0.6 units.
 *   - Two bottom glyphs: walk-left (tertiary) + walk-right (accent).
 *
 * Fact correction (spec §Ch10 事實修正): Phase 2 desc MUST NOT mention
 * "Base L2 expansion". We ship Base Sepolia only for x402; main token
 * deploy stays on BSC mainnet. Rewritten to mention the heartbeat ship
 * date instead. This is a regression guard.
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

  it('applies the correct status class to each phase (shipped / building / future)', () => {
    const html = renderToStaticMarkup(<Ch10Phase p={1} />);
    expect(html).toContain('phase-status phase-status-shipped');
    expect(html).toContain('phase-status phase-status-building');
    expect(html).toContain('phase-status phase-status-future');
  });

  it('progress cursor line width scales with p (0 at p=0, 100% at p >= 1/1.2)', () => {
    const zero = renderToStaticMarkup(<Ch10Phase p={0} />);
    expect(zero).toMatch(/class="phase-line-fill"[^>]*style="width:0%/);
    // p=1 saturates cursor to 2 (via clamp(p*1.2)=1, lerp(0,2,1)=2), so
    // width = 100%.
    const full = renderToStaticMarkup(<Ch10Phase p={1} />);
    expect(full).toMatch(/class="phase-line-fill"[^>]*style="width:100%/);
  });

  it('Phase 2 description does NOT mention "Base L2 expansion" (fact correction)', () => {
    const html = renderToStaticMarkup(<Ch10Phase p={1} />);
    // Regression guard: spec §Ch10 事實修正 replaces the original
    // "Base L2 expansion" copy with the heartbeat-shipped phrasing.
    expect(html).not.toMatch(/Base L2 expansion/i);
    // The corrected copy references the 2026-04-20 heartbeat ship.
    expect(html).toMatch(/heartbeat agent shipped 2026-04-20/);
  });

  it('renders the two bottom glyphs (walk-left tertiary + walk-right accent)', () => {
    const html = renderToStaticMarkup(<Ch10Phase p={0.5} />);
    expect(html).toMatch(/data-mood="walk-left"/);
    expect(html).toMatch(/data-mood="walk-right"/);
    // The wrapper sits inside .phase-glyphs.
    expect(html).toMatch(/class="phase-glyphs"/);
  });
});
