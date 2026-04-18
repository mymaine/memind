/**
 * Integration tests for <ShillingGlyph> using renderToStaticMarkup. jsdom is
 * not installed in this repo, so instead of RTL we snapshot the static HTML
 * and assert that:
 *   1. The root SVG carries the correct mood-specific class.
 *   2. Mood-specific overlays (limbs / symbols) appear or disappear as expected.
 *   3. ARIA / role attributes land.
 *
 * These tests do NOT drive keyframe timing — that lives entirely in CSS and is
 * validated visually on /demo/glyph. They only verify the structural contract
 * (what is in the DOM given `mood=X`).
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ShillingGlyph } from '../index.js';

function html(mood: Parameters<typeof ShillingGlyph>[0]['mood']) {
  return renderToStaticMarkup(<ShillingGlyph mood={mood} />);
}

describe('<ShillingGlyph /> structural contract', () => {
  it('renders an accessible root svg with role=img and default aria-label', () => {
    const out = html('idle');
    expect(out).toContain('role="img"');
    expect(out).toContain('aria-label="Shilling Market mascot"');
    expect(out).toMatch(/<svg[^>]+viewBox/);
  });

  it('applies the mood-specific class to the root svg', () => {
    expect(html('idle')).toContain('glyph--idle');
    expect(html('jump')).toContain('glyph--jump');
    expect(html('sleep')).toContain('glyph--sleep');
    expect(html('walk-left')).toContain('glyph--walk-left');
    expect(html('walk-right')).toContain('glyph--walk-right');
    expect(html('clap')).toContain('glyph--clap');
    expect(html('glitch')).toContain('glyph--glitch');
    expect(html('work')).toContain('glyph--work');
    expect(html('think')).toContain('glyph--think');
    expect(html('surprise')).toContain('glyph--surprise');
    expect(html('celebrate')).toContain('glyph--celebrate');
  });

  it('always renders the five core face elements (bracket, eyes, mouth, cursor)', () => {
    const out = html('idle');
    // We look for stable data-part hooks. Each part gets `data-part="X"`.
    expect(out).toContain('data-part="bracket"');
    expect(out).toContain('data-part="eye-left"');
    expect(out).toContain('data-part="eye-right"');
    expect(out).toContain('data-part="mouth"');
    expect(out).toContain('data-part="cursor"');
  });

  it('mounts walk limbs only for walk-left / walk-right moods', () => {
    expect(html('walk-left')).toContain('data-layer="limbs"');
    expect(html('walk-right')).toContain('data-layer="limbs"');
    expect(html('idle')).not.toContain('data-layer="limbs"');
    expect(html('sleep')).not.toContain('data-layer="limbs"');
  });

  it('mounts clap hands only for clap mood', () => {
    expect(html('clap')).toContain('data-layer="claps"');
    expect(html('idle')).not.toContain('data-layer="claps"');
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
    const out = renderToStaticMarkup(<ShillingGlyph mood="idle" ariaLabel="Brand logo" />);
    expect(out).toContain('aria-label="Brand logo"');
  });

  it('honors custom colors via CSS variables', () => {
    const out = renderToStaticMarkup(
      <ShillingGlyph mood="idle" primaryColor="#ff00ff" accentColor="#00ffff" />,
    );
    // Colors are exposed as CSS custom properties on the root svg style.
    expect(out).toContain('#ff00ff');
    expect(out).toContain('#00ffff');
  });

  it('applies a user-supplied className alongside the mood class', () => {
    const out = renderToStaticMarkup(<ShillingGlyph mood="idle" className="my-custom" />);
    expect(out).toContain('my-custom');
    expect(out).toContain('glyph--idle');
  });
});
