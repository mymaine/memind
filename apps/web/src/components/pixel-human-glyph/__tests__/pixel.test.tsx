// Structural contract tests for <PixelHumanGlyph>. Mirrors
// shilling-glyph/glyph.test.tsx: render to static markup, then assert class
// and data-attribute hooks. CSS timing is verified visually on /demo/glyph.
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PixelHumanGlyph } from '../index.js';
import { MOODS } from '../mood-registry.js';

function html(mood: Parameters<typeof PixelHumanGlyph>[0]['mood']) {
  return renderToStaticMarkup(<PixelHumanGlyph mood={mood} />);
}

describe('<PixelHumanGlyph /> structural contract', () => {
  it('renders an accessible root svg with role=img and default aria-label', () => {
    const out = html('idle');
    expect(out).toContain('role="img"');
    expect(out).toContain('aria-label="Pixel mascot"');
    expect(out).toMatch(/<svg[^>]+viewBox/);
  });

  it('applies the mood-specific class to the root svg for all 10 moods', () => {
    for (const mood of MOODS) {
      const out = html(mood);
      expect(out).toContain(`pixel--${mood}`);
    }
  });

  it('always renders the core figure parts', () => {
    const out = html('idle');
    expect(out).toContain('data-layer="figure"');
    expect(out).toContain('data-part="head"');
    expect(out).toContain('data-part="hand-left"');
    expect(out).toContain('data-part="hand-right"');
    expect(out).toContain('data-part="foot-left"');
    expect(out).toContain('data-part="foot-right"');
  });

  it('has no torso, limb, or cheek parts (minimalist figure contract)', () => {
    const out = html('idle');
    expect(out).not.toContain('data-part="body"');
    expect(out).not.toContain('data-part="arm-left"');
    expect(out).not.toContain('data-part="arm-right"');
    expect(out).not.toContain('data-part="leg-left"');
    expect(out).not.toContain('data-part="leg-right"');
    expect(out).not.toContain('data-part="cheeks"');
  });

  it('mounts sleep Zs only for sleep mood', () => {
    expect(html('sleep')).toContain('data-layer="sleep-zs"');
    expect(html('idle')).not.toContain('data-layer="sleep-zs"');
  });

  it('mounts work dots only for work mood', () => {
    expect(html('work')).toContain('data-layer="work-dots"');
    expect(html('idle')).not.toContain('data-layer="work-dots"');
  });

  it('mounts think dots only for think mood', () => {
    expect(html('think')).toContain('data-layer="think-dots"');
    expect(html('idle')).not.toContain('data-layer="think-dots"');
  });

  it('mounts surprise bang only for surprise mood', () => {
    expect(html('surprise')).toContain('data-layer="surprise-bang"');
    expect(html('idle')).not.toContain('data-layer="surprise-bang"');
  });

  it('mounts celebrate sparkles only for celebrate mood', () => {
    expect(html('celebrate')).toContain('data-layer="celebrate-sparkles"');
    expect(html('idle')).not.toContain('data-layer="celebrate-sparkles"');
  });

  it('honors custom aria-label', () => {
    const out = renderToStaticMarkup(<PixelHumanGlyph mood="idle" ariaLabel="Pixel buddy" />);
    expect(out).toContain('aria-label="Pixel buddy"');
  });

  it('honors custom colors via CSS variables', () => {
    const out = renderToStaticMarkup(
      <PixelHumanGlyph mood="idle" primaryColor="#ff00ff" accentColor="#00ffff" />,
    );
    expect(out).toContain('#ff00ff');
    expect(out).toContain('#00ffff');
  });

  it('applies a user-supplied className alongside the mood class', () => {
    const out = renderToStaticMarkup(<PixelHumanGlyph mood="idle" className="my-custom" />);
    expect(out).toContain('my-custom');
    expect(out).toContain('pixel--idle');
  });

  it('scales the svg by size prop while preserving viewBox aspect ratio', () => {
    // viewBox is 12x10, so width = round(size * 12/10) = 58 for size=48.
    const out = renderToStaticMarkup(<PixelHumanGlyph mood="idle" size={48} />);
    expect(out).toContain('height="48"');
    expect(out).toContain('width="58"');
  });
});
