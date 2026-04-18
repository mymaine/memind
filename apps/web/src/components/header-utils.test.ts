/**
 * Unit tests for the pure helpers that back the shared <Header /> component.
 *
 * Covers AC-P4.7-1:
 *   - NAV_ITEMS has exactly the three entries spec'd (Home / Market / Evidence).
 *   - isActiveNavItem matches exact-route semantics for Home / Market.
 *   - Evidence anchor lights up on both `/` and `/market` because the anchor is
 *     duplicated on every scene where Evidence renders.
 *   - headerOuterClass toggles between transparent and backdrop-blur variants
 *     based on the scrolled boolean — the only piece of scroll plumbing we
 *     need to assert, since useScrollProgress is already covered elsewhere.
 */
import { describe, it, expect } from 'vitest';
import { NAV_ITEMS, isActiveNavItem, headerOuterClass } from './header-utils.js';

describe('NAV_ITEMS', () => {
  it('contains exactly three entries in spec order (Home / Market / Evidence)', () => {
    expect(NAV_ITEMS).toHaveLength(3);
    expect(NAV_ITEMS.map((i) => i.label)).toEqual(['Home', 'Market', 'Evidence']);
  });

  it('routes Home and Market as kind=route, Evidence as kind=anchor', () => {
    const [home, market, evidence] = NAV_ITEMS;
    expect(home?.kind).toBe('route');
    expect(home?.href).toBe('/');
    expect(market?.kind).toBe('route');
    expect(market?.href).toBe('/market');
    expect(evidence?.kind).toBe('anchor');
  });

  it('only uses `#evidence` as the anchor fragment (no other hashes sneak in)', () => {
    const anchors = NAV_ITEMS.filter((i) => i.kind === 'anchor').map((i) => i.href);
    expect(anchors.every((h) => h.includes('#evidence'))).toBe(true);
    const hashes = NAV_ITEMS.map((i) => {
      const idx = i.href.indexOf('#');
      return idx === -1 ? null : i.href.slice(idx);
    }).filter((h): h is string => h !== null);
    expect(hashes.every((h) => h === '#evidence')).toBe(true);
  });
});

describe('isActiveNavItem', () => {
  const [home, market, evidence] = NAV_ITEMS;

  it('lights Home when pathname is exactly `/`', () => {
    expect(isActiveNavItem(home!, '/')).toBe(true);
  });

  it('does not light Home when pathname is `/market`', () => {
    expect(isActiveNavItem(home!, '/market')).toBe(false);
  });

  it('lights Market when pathname is `/market`', () => {
    expect(isActiveNavItem(market!, '/market')).toBe(true);
  });

  it('does not light Market when pathname is `/`', () => {
    expect(isActiveNavItem(market!, '/')).toBe(false);
  });

  it('lights Evidence on `/` (anchor exists on the Home scene)', () => {
    expect(isActiveNavItem(evidence!, '/')).toBe(true);
  });

  it('lights Evidence on `/market` (anchor exists on the Market scene too)', () => {
    expect(isActiveNavItem(evidence!, '/market')).toBe(true);
  });

  it('does not light any entry on an unknown route', () => {
    expect(isActiveNavItem(home!, '/foo')).toBe(false);
    expect(isActiveNavItem(market!, '/foo')).toBe(false);
    expect(isActiveNavItem(evidence!, '/foo')).toBe(false);
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
