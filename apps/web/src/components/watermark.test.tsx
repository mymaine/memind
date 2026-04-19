/**
 * Tests for <Watermark /> - the fixed bottom-right chapter stamp
 * (memind-scrollytelling-rebuild AC-MSR-5).
 *
 * Displays `NN` (big) + `/ MM` (dim) plus the current chapter title. The
 * root is `.watermark mono`; positioning (`position: fixed; right: 24px;
 * bottom: 72px`) lives in globals.css.
 *
 * aria-hidden because the watermark duplicates information the TopBar
 * progress counter + Ch label already surface; screen readers should not
 * re-announce the chapter count.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Watermark } from './watermark.js';

describe('<Watermark />', () => {
  it('renders the zero-padded active counter + total (01 / 11 at idx=0)', () => {
    const out = renderToStaticMarkup(<Watermark activeIdx={0} total={11} title="HERO" />);
    expect(out).toContain('01');
    expect(out).toContain('/ 11');
  });

  it('updates the counter when activeIdx advances (05 / 11 at idx=4)', () => {
    const out = renderToStaticMarkup(<Watermark activeIdx={4} total={11} title="LAUNCH DEMO" />);
    expect(out).toContain('05');
    expect(out).toContain('/ 11');
  });

  it('surfaces the current chapter title under the counter', () => {
    const out = renderToStaticMarkup(
      <Watermark activeIdx={2} total={11} title="BRAIN ARCHITECTURE" />,
    );
    expect(out).toContain('BRAIN ARCHITECTURE');
    expect(out).toMatch(/class="watermark-title"/);
  });

  it('mounts under `.watermark mono` with aria-hidden so screen readers skip it', () => {
    const out = renderToStaticMarkup(<Watermark activeIdx={0} total={11} title="HERO" />);
    expect(out).toMatch(/<div[^>]*class="watermark mono"[^>]*aria-hidden="true"/);
  });
});
