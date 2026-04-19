/**
 * Tests for <Ch4Brain /> — fourth chapter of the scrollytelling narrative
 * (memind-scrollytelling-rebuild AC-MSR-9 ch4).
 *
 * Ports the interior-progress contract from
 * `docs/design/memind-handoff/project/components/chapters.jsx` Ch4Brain
 * (lines 163-250), with two FACT CORRECTIONS:
 *   - brain-core-sub reads `claude-sonnet-4.5 · 5s tick` (matches what
 *     `apps/server` actually calls via OpenRouter), NOT the design-stub
 *     `gpt-4o · 5s tick`.
 *   - UAT issue #7: X ships as a live channel from Phase 3 onward, so the
 *     port ring now shows 4 channels total (X live + 3 soon). A legend
 *     above the stage spells out persona-vs-channel semantics.
 *
 * Interior progress `p ∈ [0, 1]` drives:
 *
 *   - 4 persona ports (GLITCHY / CULTIST / DEGEN / SHILLER) at angles
 *     -140 / -40 / 40 / 140, radius 220. Each renders a voice sub-label.
 *   - 4 channel ports (X live, TELEGRAM / DISCORD / ON-CHAIN MSG soon) in
 *     a cross layout (angles 0 / -90 / 90 / 180) at radius 310-330.
 *   - Central brain core with think-mood mascot + TOKEN BRAIN label +
 *     model-tick footer.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Ch4Brain } from '../ch4-brain.js';

const PERSONAS = ['GLITCHY', 'CULTIST', 'DEGEN', 'SHILLER'] as const;
const PERSONA_VOICES = ['glitch voice', 'cult voice', 'degen voice', 'shill voice'] as const;
// UAT 2026-04-20 (round 3): channels switched from wordmarks to icon
// glyphs. The aria-label carries the human name (e.g. "Telegram (coming
// soon)") and the visible glyph is in the `.future-icon` span.
const SOON_CHANNEL_ARIA = [
  'Telegram (coming soon)',
  'Discord (coming soon)',
  'On-chain message (coming soon)',
] as const;
const LIVE_X_ICON = '\u{1D54F}';

describe('<Ch4Brain>', () => {
  it('renders all four persona labels', () => {
    const html = renderToStaticMarkup(<Ch4Brain p={1} />);
    for (const label of PERSONAS) {
      expect(html).toContain(label);
    }
  });

  it('renders the persona voice sub-labels (UAT issue #7)', () => {
    const html = renderToStaticMarkup(<Ch4Brain p={1} />);
    for (const voice of PERSONA_VOICES) {
      expect(html).toContain(voice);
    }
  });

  it('renders 4 channel ports (X live + 3 soon) as icon glyphs with aria labels', () => {
    const html = renderToStaticMarkup(<Ch4Brain p={1} />);
    // Every soon channel surfaces its human name in aria-label; the
    // visible glyph lives in `.future-icon` span (icon chosen per channel).
    for (const aria of SOON_CHANNEL_ARIA) {
      expect(html).toContain(`aria-label="${aria}"`);
    }
    // X ships as a live port — aria is live, icon is double-struck X.
    expect(html).toContain('aria-label="X (live)"');
    expect(html).toContain(LIVE_X_ICON);
    // 4 channel ports total; 3 soon, 1 live.
    const allSubs = html.match(/class="future-sub">(?:soon|live)<\/div>/g) ?? [];
    expect(allSubs).toHaveLength(4);
    const soonCount = (html.match(/class="future-sub">soon<\/div>/g) ?? []).length;
    const liveCount = (html.match(/class="future-sub">live<\/div>/g) ?? []).length;
    expect(soonCount).toBe(3);
    expect(liveCount).toBe(1);
  });

  it('renders the persona-vs-channel legend above the stage (UAT issue #7)', () => {
    const html = renderToStaticMarkup(<Ch4Brain p={0.5} />);
    expect(html).toMatch(/class="brain-legend"/);
    expect(html).toContain('persona = content voice');
    expect(html).toContain('channel = delivery surface');
    expect(html).toContain('X live');
  });

  it('X channel port gets the live modifier class (UAT issue #7)', () => {
    const html = renderToStaticMarkup(<Ch4Brain p={1} />);
    // Solid accent treatment sits on `.future-port--live` — one and only
    // one channel carries the modifier.
    const liveMatches = html.match(/class="future-port future-port--live"/g) ?? [];
    expect(liveMatches).toHaveLength(1);
  });

  it('brain-core-label reads "TOKEN BRAIN"', () => {
    const html = renderToStaticMarkup(<Ch4Brain p={0.5} />);
    expect(html).toMatch(/class="brain-core-label"[^>]*>TOKEN BRAIN</);
  });

  it('brain-core-sub reads "claude-sonnet-4.5 · 5s tick" (fact correction)', () => {
    // Regression guard — the design handoff still says "gpt-4o · 5s tick",
    // but the backend uses anthropic/claude-sonnet-4-5 via OpenRouter. If
    // someone re-ports verbatim from chapters.jsx this test will catch it.
    const html = renderToStaticMarkup(<Ch4Brain p={0.5} />);
    expect(html).toContain('claude-sonnet-4.5');
    expect(html).toContain('5s tick');
    expect(html).not.toContain('gpt-4o');
  });

  it('at p=0 channel ports render with opacity 0 (pulse below threshold)', () => {
    const html = renderToStaticMarkup(<Ch4Brain p={0} />);
    // Every channel port should have opacity:0 inline. Match both the
    // base `future-port` and the `future-port--live` modifier classes.
    const ports =
      html.match(/class="future-port(?: future-port--live)?"[^>]*style="([^"]*)"/g) ?? [];
    expect(ports.length).toBe(4);
    for (const port of ports) {
      expect(port).toMatch(/opacity:0\b/);
    }
  });

  it('at p=1 channel ports are visible (non-zero opacity)', () => {
    const html = renderToStaticMarkup(<Ch4Brain p={1} />);
    const ports =
      html.match(/class="future-port(?: future-port--live)?"[^>]*style="([^"]*)"/g) ?? [];
    expect(ports.length).toBe(4);
    for (const port of ports) {
      // Match opacity followed by a non-zero digit (handles inline float).
      expect(port).toMatch(/opacity:0?\.[1-9]/);
    }
  });

  it('renders the 4 radial rings inside .brain-lines SVG', () => {
    const html = renderToStaticMarkup(<Ch4Brain p={0.5} />);
    expect(html).toMatch(/class="brain-lines"/);
    const circles = html.match(/<circle /g) ?? [];
    expect(circles.length).toBe(4);
  });
});
