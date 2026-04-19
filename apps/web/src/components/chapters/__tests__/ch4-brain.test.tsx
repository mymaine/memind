/**
 * Tests for <Ch4Brain /> — fourth chapter of the scrollytelling narrative
 * (memind-scrollytelling-rebuild AC-MSR-9 ch4).
 *
 * Ports the interior-progress contract from
 * `docs/design/memind-handoff/project/components/chapters.jsx` Ch4Brain
 * (lines 163-250), with one FACT CORRECTION: the brain-core-sub reads
 * `claude-sonnet-4.5 · 5s tick` (matches what `apps/server` actually calls
 * via OpenRouter), NOT the design-stub `gpt-4o · 5s tick`.
 *
 * Interior progress `p ∈ [0, 1]` drives:
 *
 *   - 4 persona ports (GLITCHY / CULTIST / DEGEN / SHILLER) at angles
 *     -140 / -40 / 40 / 140, radius 220.
 *   - 3 future ports (TELEGRAM / DISCORD / ONCHAIN) at radius 310-330 with
 *     dashed "soon" tags.
 *   - Central brain core with think-mood mascot + TOKEN BRAIN label +
 *     model-tick footer.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Ch4Brain } from '../ch4-brain.js';

const PERSONAS = ['GLITCHY', 'CULTIST', 'DEGEN', 'SHILLER'] as const;
const FUTURES = ['TELEGRAM', 'DISCORD', 'ONCHAIN'] as const;

describe('<Ch4Brain>', () => {
  it('renders all four persona labels', () => {
    const html = renderToStaticMarkup(<Ch4Brain p={1} />);
    for (const label of PERSONAS) {
      expect(html).toContain(label);
    }
  });

  it('renders all three future-port labels with a soon tag', () => {
    const html = renderToStaticMarkup(<Ch4Brain p={1} />);
    for (const label of FUTURES) {
      expect(html).toContain(label);
    }
    // Each future-port carries a "soon" tag — 3 total.
    const soons = html.match(/class="future-sub"/g) ?? [];
    expect(soons.length).toBe(3);
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

  it('at p=0 future ports render with opacity 0 (pulse below threshold)', () => {
    const html = renderToStaticMarkup(<Ch4Brain p={0} />);
    // Every future-port should have opacity:0 inline.
    const futurePorts = html.match(/class="future-port"[^>]*style="([^"]*)"/g) ?? [];
    expect(futurePorts.length).toBe(3);
    for (const port of futurePorts) {
      expect(port).toMatch(/opacity:0\b/);
    }
  });

  it('at p=1 future ports are visible (non-zero opacity)', () => {
    const html = renderToStaticMarkup(<Ch4Brain p={1} />);
    const futurePorts = html.match(/class="future-port"[^>]*style="([^"]*)"/g) ?? [];
    expect(futurePorts.length).toBe(3);
    for (const port of futurePorts) {
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
