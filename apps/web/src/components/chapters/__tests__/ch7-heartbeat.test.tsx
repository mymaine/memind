/**
 * Tests for <Ch7Heartbeat /> — autonomous-heartbeat chapter
 * (memind-scrollytelling-rebuild AC-MSR-9 ch7).
 *
 * Ports the interior-progress contract from the design handoff. Two
 * concurrent animations:
 *   - EKG polyline: `strokeDasharray=1000`, `strokeDashoffset = 1000 - p*1000`
 *   - Decision log: `ticks = floor(p * 14)` drives which of 8 scripted
 *     decision rows are rendered. Pass `p = 1` to see all 8.
 *
 * vitest runs under `node` with no jsdom, so we render via
 * `renderToStaticMarkup` + regex.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Ch7Heartbeat } from '../ch7-heartbeat.js';

// CSS-regression source for UAT issue #9.
const GLOBALS_CSS = readFileSync(path.resolve(__dirname, '../../../app/globals.css'), 'utf8');

describe('<Ch7Heartbeat>', () => {
  it('at p=0 no decision row is rendered (ticks = floor(0) = 0)', () => {
    const html = renderToStaticMarkup(<Ch7Heartbeat p={0} />);
    const matches = html.match(/class="hb-op-row"/g) ?? [];
    expect(matches).toHaveLength(0);
    // Headline + operator.log header still render.
    expect(html).toContain('every 60 seconds');
    expect(html).toContain('operator.log');
  });

  it('at p=0.5 seven decision rows are rendered (ticks = floor(7) = 7)', () => {
    const html = renderToStaticMarkup(<Ch7Heartbeat p={0.5} />);
    const matches = html.match(/class="hb-op-row"/g) ?? [];
    expect(matches).toHaveLength(7);
    // First 7 decisions present; eighth ("sleep 60s") not yet.
    expect(html).toContain('read mentions');
    expect(html).toContain('mint reply');
    expect(html).not.toContain('sleep 60s');
  });

  it('at p=1 all eight decision rows are rendered (ticks capped by array length)', () => {
    const html = renderToStaticMarkup(<Ch7Heartbeat p={1} />);
    const matches = html.match(/class="hb-op-row"/g) ?? [];
    expect(matches).toHaveLength(8);
    expect(html).toContain('sleep 60s');
  });

  it('at p=0.5 the EKG polyline stroke-dashoffset resolves to 500 (1000 - p*1000)', () => {
    const html = renderToStaticMarkup(<Ch7Heartbeat p={0.5} />);
    // SSR serializes `strokeDashoffset={500}` as `stroke-dashoffset="500"`
    expect(html).toMatch(/stroke-dashoffset="500"/);
    // Base strokeDasharray is always 1000.
    expect(html).toMatch(/stroke-dasharray="1000"/);
  });

  it('renders the headline copy "every 60 seconds, the brain wakes up and decides"', () => {
    const html = renderToStaticMarkup(<Ch7Heartbeat p={0.4} />);
    expect(html).toContain('every 60 seconds');
    expect(html).toContain('wakes up and');
    expect(html).toContain('decides');
    // Mascot glyph mounts with walk-right mood.
    expect(html).toMatch(/data-mood="walk-right"/);
  });

  it('.hb-pulse centers its EKG content vertically inside the grid (UAT issue #9)', () => {
    // UAT: the EKG trace pinned to the top of its two-row cell, leaving a
    // dead band below. justify-content:center on the flex column keeps the
    // SVG + axis labels aligned with the operator.log midline.
    const stripped = GLOBALS_CSS.replace(/\/\*[\s\S]*?\*\//g, '');
    const rule = stripped.match(/\.hb-pulse\s*\{([^}]*)\}/);
    expect(rule).not.toBeNull();
    const body = rule?.[1] ?? '';
    expect(body).toMatch(/display:\s*flex/);
    expect(body).toMatch(/flex-direction:\s*column/);
    expect(body).toMatch(/justify-content:\s*center/);
  });
});
