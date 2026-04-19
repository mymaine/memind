/**
 * Tests for <AsciiBackdrop /> — sparse starfield rebuild.
 *
 * Post-scrollytelling:
 *   - No scroll listener / no scroll controller (the layer is completely
 *     static). Parallax + rAF throttle removed.
 *   - Grid is sparse (≤ 12% density) and deterministic per (palette, size).
 *
 * We exercise:
 *   - `AsciiBackdropView` (pure SSR view) for data-section / data-brain /
 *     the `<pre>` child with a non-empty grid.
 *   - `generateAsciiGrid` (pure) for density + determinism.
 *   - `resolvePalette` (pure) for section → palette mapping + hero fallback.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  AsciiBackdrop,
  AsciiBackdropView,
  generateAsciiGrid,
  resolvePalette,
} from './ascii-backdrop.js';

describe('<AsciiBackdrop />', () => {
  it('renders an aria-hidden <div class="ascii-backdrop"> root', () => {
    const out = renderToStaticMarkup(<AsciiBackdrop />);
    expect(out).toMatch(/<div[^>]*class="[^"]*ascii-backdrop[^"]*"/);
    expect(out).toContain('aria-hidden="true"');
  });

  it('emits a <pre class="ascii-backdrop-grid"> child carrying the generated grid', () => {
    const out = renderToStaticMarkup(<AsciiBackdrop />);
    expect(out).toMatch(/<pre[^>]*class="ascii-backdrop-grid"/);
  });
});

describe('<AsciiBackdropView />', () => {
  it('writes the active section id into data-section so CSS can key off it', () => {
    const hero = renderToStaticMarkup(
      <AsciiBackdropView activeSection="hero" brainStatus="idle" />,
    );
    expect(hero).toMatch(/data-section="hero"/);
    const problem = renderToStaticMarkup(
      <AsciiBackdropView activeSection="problem" brainStatus="idle" />,
    );
    expect(problem).toMatch(/data-section="problem"/);
    const nullActive = renderToStaticMarkup(
      <AsciiBackdropView activeSection={null} brainStatus="idle" />,
    );
    expect(nullActive).toMatch(/data-section="hero"/);
  });

  it('writes the derived Brain status into data-brain so CSS can apply the offset', () => {
    const online = renderToStaticMarkup(
      <AsciiBackdropView activeSection="hero" brainStatus="online" />,
    );
    expect(online).toMatch(/data-brain="online"/);
    const idle = renderToStaticMarkup(
      <AsciiBackdropView activeSection="hero" brainStatus="idle" />,
    );
    expect(idle).toMatch(/data-brain="idle"/);
  });

  it('renders a non-empty <pre> with both data attrs on the root', () => {
    const out = renderToStaticMarkup(
      <AsciiBackdropView
        activeSection="brain-architecture"
        brainStatus="online"
        cols={40}
        rows={6}
      />,
    );
    expect(out).toMatch(/<div[^>]*class="[^"]*ascii-backdrop[^"]*"/);
    expect(out).toContain('aria-hidden="true"');
    expect(out).toMatch(/data-section="brain-architecture"/);
    expect(out).toMatch(/data-brain="online"/);
    expect(out).toMatch(/<pre[^>]*>[\s\S]+<\/pre>/);
  });
});

describe('generateAsciiGrid', () => {
  it('produces a rows × cols grid with sparse glyph density', () => {
    const palette = { glyphs: ['*'], density: 0.1 };
    const grid = generateAsciiGrid(palette, 100, 20);
    const lines = grid.split('\n');
    expect(lines).toHaveLength(20);
    for (const line of lines) {
      expect(line.length).toBe(100);
    }
    // Density check: expect roughly 10% glyphs, allow wide slack for PRNG.
    const glyphCount = (grid.match(/\*/g) ?? []).length;
    const totalCells = 100 * 20;
    const ratio = glyphCount / totalCells;
    expect(ratio).toBeGreaterThan(0.04);
    expect(ratio).toBeLessThan(0.2);
  });

  it('is deterministic for the same (palette, cols, rows)', () => {
    const palette = { glyphs: ['*', '·'], density: 0.1 };
    const a = generateAsciiGrid(palette, 50, 10);
    const b = generateAsciiGrid(palette, 50, 10);
    expect(a).toBe(b);
  });

  it('returns an empty string when any dimension is zero or no glyphs', () => {
    const palette = { glyphs: ['*'], density: 0.1 };
    expect(generateAsciiGrid(palette, 0, 10)).toBe('');
    expect(generateAsciiGrid(palette, 10, 0)).toBe('');
    expect(generateAsciiGrid({ glyphs: [], density: 0.1 }, 10, 10)).toBe('');
  });

  it('different sections produce different star patterns', () => {
    const a = generateAsciiGrid(resolvePalette('hero'), 40, 8);
    const b = generateAsciiGrid(resolvePalette('problem'), 40, 8);
    expect(a).not.toBe(b);
  });
});

describe('resolvePalette', () => {
  it('maps known sections to palettes and falls back to hero', () => {
    expect(resolvePalette('hero').glyphs).toEqual(expect.arrayContaining(['*']));
    expect(resolvePalette('brain-architecture').glyphs).toEqual(expect.arrayContaining(['◉']));
    expect(resolvePalette('evidence').glyphs).toEqual(expect.arrayContaining(['✓']));
    expect(resolvePalette(null).glyphs).toEqual(resolvePalette('hero').glyphs);
    expect(resolvePalette('unknown-section').glyphs).toEqual(resolvePalette('hero').glyphs);
  });

  it('keeps densities atmospheric (≤ 0.12)', () => {
    const keys = [
      'hero',
      'problem',
      'solution',
      'brain-architecture',
      'launch-demo',
      'order-shill',
      'heartbeat-demo',
      'take-rate',
      'sku-matrix',
      'phase-map',
      'evidence',
    ];
    for (const k of keys) {
      const p = resolvePalette(k);
      expect(p.density).toBeGreaterThan(0);
      expect(p.density).toBeLessThanOrEqual(0.12);
    }
  });
});
