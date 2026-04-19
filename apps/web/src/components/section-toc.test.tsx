/**
 * Tests for the rewritten <SectionToc /> - the fixed left-side chapter
 * list for the Memind scrollytelling surface
 * (memind-scrollytelling-rebuild AC-MSR-4).
 *
 * The old Tailwind md:flex card with <a href="#id"> anchor links has been
 * replaced by a frameless list of <button> entries that call `onJump(idx)`
 * when clicked. Styling (`.toc`, `.toc-item`, `.toc-num`, `.toc-title`)
 * comes from globals.css ported from the design handoff; the viewport
 * gating `<1100px` is handled entirely by CSS media query.
 *
 * Each item is a `<button type="button">` so keyboard focus + Enter/Space
 * activation work natively - there is no anchor fallback because the
 * scrollytelling surface owns the scroll math (not the browser hash jump).
 */
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SectionToc } from './section-toc.js';
import { CHAPTER_META } from '@/lib/chapters';

function render(activeIdx = 0, onJump: (i: number) => void = () => {}): string {
  return renderToStaticMarkup(<SectionToc activeIdx={activeIdx} onJump={onJump} />);
}

describe('<SectionToc />', () => {
  it('renders one .toc-item button per CHAPTER_META entry in order', () => {
    const out = render();
    const matches = out.match(/class="toc-item[^"]*"/g) ?? [];
    expect(matches.length).toBe(CHAPTER_META.length);
    // Titles come from CHAPTER_META; the first two should appear in render
    // order so we can spot a reversed mapping.
    expect(out.indexOf(CHAPTER_META[0]!.title)).toBeGreaterThanOrEqual(0);
    expect(out.indexOf(CHAPTER_META[1]!.title)).toBeGreaterThan(
      out.indexOf(CHAPTER_META[0]!.title),
    );
  });

  it('marks the active item with the `.active` class and leaves the others idle', () => {
    const out = render(2);
    // Exactly one `.toc-item active` class string.
    const actives = out.match(/class="toc-item active"/g) ?? [];
    expect(actives.length).toBe(1);
    // The active row sits in position 3 (idx 2) - its title follows the
    // `.toc-item active` class.
    expect(out).toMatch(new RegExp(`class="toc-item active"[^]*?${CHAPTER_META[2]!.title}`));
  });

  it('renders zero-padded two-digit .toc-num labels', () => {
    const out = render();
    expect(out).toContain('>01<');
    expect(out).toContain('>11<');
  });

  it('renders each item as a native <button type="button"> for Enter/Space activation', () => {
    const out = render();
    // Every .toc-item tag should be a <button> (no anchors).
    expect(out).not.toMatch(/<a[^>]*class="toc-item/);
    const buttons = out.match(/<button[^>]*class="toc-item/g) ?? [];
    expect(buttons.length).toBe(CHAPTER_META.length);
    expect(out).toMatch(/<button[^>]*type="button"[^>]*class="toc-item/);
  });

  it('wraps the list in the frameless `.toc` nav landmark (no md:flex box)', () => {
    const out = render();
    expect(out).toMatch(/<nav[^>]*class="toc"/);
    // The old card style used `rounded-[var(--radius-default)]` / `bg-bg-surface`
    // Tailwind utilities; the new frameless version must not emit them.
    expect(out).not.toMatch(/md:flex/);
    expect(out).not.toMatch(/bg-bg-surface/);
  });

  it('does not invoke onJump during static render', () => {
    const onJump = vi.fn();
    render(0, onJump);
    expect(onJump).not.toHaveBeenCalled();
  });
});
