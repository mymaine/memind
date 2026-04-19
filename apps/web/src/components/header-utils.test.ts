/**
 * Unit tests for the pure helpers that back the shared <Header /> component.
 *
 * Post-immersive-single-page P1 Task 3 / AC-ISP-4: the Header menu is slimmed
 * down to a single primary nav entry (Home) + a GitHub icon link + the new
 * <BrainIndicator /> mounted alongside them. The former Market + Evidence
 * content anchors were removed — the sticky left-side SectionToc owns the
 * section jumps on `md+`, and sub-md viewers see the slim nav only.
 */
import { describe, it, expect } from 'vitest';
import { NAV_ITEMS, isActiveNavItem, headerOuterClass } from './header-utils.js';

describe('NAV_ITEMS', () => {
  it('contains exactly one primary nav entry (Home) after the AC-ISP-4 slim-down', () => {
    expect(NAV_ITEMS).toHaveLength(1);
    expect(NAV_ITEMS.map((i) => i.label)).toEqual(['Home']);
  });

  it('routes Home as kind=route targeting `/`', () => {
    const [home] = NAV_ITEMS;
    expect(home?.kind).toBe('route');
    expect(home?.href).toBe('/');
  });

  it('carries no anchor-kind entries (section jumps live in the SectionToc now)', () => {
    const anchors = NAV_ITEMS.filter((i) => i.kind === 'anchor');
    expect(anchors).toHaveLength(0);
  });
});

describe('isActiveNavItem', () => {
  const [home] = NAV_ITEMS;

  it('lights Home when pathname is exactly `/`', () => {
    expect(isActiveNavItem(home!, '/')).toBe(true);
  });

  it('does not light Home on any other route', () => {
    expect(isActiveNavItem(home!, '/market')).toBe(false);
    expect(isActiveNavItem(home!, '/foo')).toBe(false);
  });
});

describe('headerOuterClass', () => {
  it('renders the transparent variant before the scroll threshold', () => {
    const cls = headerOuterClass(false);
    expect(cls).toContain('bg-transparent');
    expect(cls).not.toContain('backdrop-blur-md');
  });

  it('renders the blurred variant once scrolled past the threshold', () => {
    const cls = headerOuterClass(true);
    expect(cls).toContain('backdrop-blur-md');
    expect(cls).not.toContain('bg-transparent');
  });

  it('always keeps the 150ms transition so reduced-motion can override it globally', () => {
    // globals.css @media (prefers-reduced-motion) zeros transition-duration
    // worldwide; the header just needs to declare the transition so the
    // reduced-motion override has something to flatten.
    expect(headerOuterClass(false)).toContain('duration-150');
    expect(headerOuterClass(true)).toContain('duration-150');
  });
});
