/**
 * Tests for <Ch4Brain /> — fourth chapter of the scrollytelling narrative
 * (memind-scrollytelling-rebuild AC-MSR-9 ch4).
 *
 * Two FACT CORRECTIONS vs. the original draft:
 *   - brain-core-sub reads `autonomous tick · 60s` — no model name, no
 *     provider. The cadence matches the Heartbeat production default.
 *   - X ships as a live channel from Phase 3 onward, so the port ring
 *     shows 4 channels total (X live + 3 soon). A legend above the stage
 *     spells out persona-vs-channel semantics.
 *
 * Interior progress `p ∈ [0, 1]` drives:
 *
 *   - 4 persona ports (CREATOR / NARRATOR / SHILLER / HEARTBEAT) at
 *     angles -140 / -40 / 40 / 140, radius 220. Labels map 1:1 to the
 *     invoke_* tools registered in `apps/server/src/tools/invoke-persona.ts`
 *     so the animation and the agent runtime read the same roster. Each
 *     port renders a voice sub-label.
 *   - 4 channel ports (X live, TELEGRAM / DISCORD / ON-CHAIN MSG soon) in
 *     a cross layout (angles 0 / -90 / 90 / 180) at radius 310-330.
 *   - Central brain core with think-mood mascot + TOKEN BRAIN label +
 *     model-tick footer.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Ch4Brain } from '../ch4-brain.js';

const PERSONAS = ['CREATOR', 'NARRATOR', 'SHILLER', 'HEARTBEAT'] as const;
const PERSONA_VOICES = [
  'deploys BSC tokens',
  'writes lore chapters',
  'shills on X',
  '60s autonomous tick',
] as const;
// UAT round 4 (2026-04-20): channel ports render inline brand SVGs. The
// aria-label keeps the human name, `data-icon` on the port is the stable
// brand slug we assert against here (unicode glyph tests were removed).
const SOON_CHANNEL_ARIA = [
  'Telegram (coming soon)',
  'Discord (coming soon)',
  'On-chain message (coming soon)',
] as const;
const CHANNEL_ICON_IDS = ['x', 'telegram', 'discord', 'onchain'] as const;

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
    // X ships as a live port — aria tag marks it live.
    expect(html).toContain('aria-label="X (live)"');
    // Every channel port carries its brand slug via `data-icon` and
    // renders an inline <svg> inside `.future-icon`.
    for (const iconId of CHANNEL_ICON_IDS) {
      expect(html).toContain(`data-icon="${iconId}"`);
    }
    const svgCount = (html.match(/class="future-icon"[^>]*><svg/g) ?? []).length;
    expect(svgCount).toBe(4);
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

  it('brain-core-sub reads "autonomous tick · 60s" (no model / provider leak)', () => {
    // Regression guard — the brain core sub-caption must not leak the
    // underlying LLM model or provider name. Cadence is the Heartbeat
    // production default (60s).
    const html = renderToStaticMarkup(<Ch4Brain p={0.5} />);
    expect(html).toContain('autonomous tick');
    expect(html).toContain('60s');
    expect(html).not.toMatch(/claude|sonnet|opus|haiku|gpt|openrouter|anthropic/i);
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
