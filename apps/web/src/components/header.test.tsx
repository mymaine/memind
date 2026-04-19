/**
 * Static-render assertions for the shared <Header /> surface.
 *
 * The real Header is a client-only shell that reads usePathname() and
 * useScrollProgress() — calling those outside of Next's server component
 * render tree would crash renderToStaticMarkup, so the logic that cares
 * about props lives in <HeaderView />, a pure presentational component.
 * These tests drive HeaderView directly with explicit props; the Header
 * wrapper is smoke-tested by asserting it exports a function (the
 * meaningful behaviour — active nav, scroll blur — is covered by
 * HeaderView + header-utils tests).
 *
 * Post-immersive-single-page P1 Task 3 / AC-ISP-4 + AC-ISP-6: the menu is
 * slimmed to a single primary nav entry (Home), a GitHub icon link and a
 * <BrainIndicator /> mounted on the right. The former Market + Evidence
 * content anchors were dropped — section jumps are owned by the left-side
 * SectionToc on `md+` and the Header nav on sub-md.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Header, HeaderView } from './header.js';
import { NAV_ITEMS } from './header-utils.js';
import { BRAND_NAME } from '../lib/narrative-copy.js';
import { IDLE_STATE } from '@/hooks/useRun-state';

function render(props: Partial<Parameters<typeof HeaderView>[0]> = {}): string {
  return renderToStaticMarkup(
    <HeaderView
      pathname="/"
      scrolled={false}
      brandName={BRAND_NAME}
      navItems={NAV_ITEMS}
      githubUrl="#"
      runState={IDLE_STATE}
      brainModalOpen={false}
      onOpenBrainModal={() => {}}
      {...props}
    />,
  );
}

describe('<HeaderView /> static render', () => {
  it('surfaces the BRAND_NAME wordmark', () => {
    expect(render()).toContain(BRAND_NAME);
  });

  it('renders the slim primary nav — Home only, no Market or Evidence', () => {
    const out = render();
    expect(out).toContain('>Home<');
    expect(out).not.toContain('>Market<');
    expect(out).not.toContain('>Evidence<');
  });

  it('wraps nav entries in a <nav> landmark labelled "Primary"', () => {
    const out = render();
    expect(out).toMatch(/<nav[^>]+aria-label="Primary"/);
  });

  it('mounts a <BrainIndicator /> in the header (aria-label + TOKEN BRAIN label)', () => {
    const out = render();
    expect(out).toContain('TOKEN BRAIN');
    expect(out).toMatch(/aria-label="Open Token Brain detail"/);
  });

  it('exposes the GitHub link with external-link hygiene and an aria-label', () => {
    const out = render({ githubUrl: 'https://github.com/example/repo' });
    // Opens in a new tab and drops referrer/window-opener context.
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer"');
    // Mentions "GitHub" in the accessible name so screen readers announce it.
    expect(out).toMatch(/aria-label="[^"]*GitHub[^"]*"/);
    expect(out).toContain('href="https://github.com/example/repo"');
  });

  it('marks the active nav entry with aria-current=page', () => {
    const out = render({ pathname: '/' });
    // Home should light up on `/`.
    expect(out).toMatch(/aria-current="page"[^>]*>[^<]*Home/);
  });

  it('switches the outer class to the blur variant when scrolled is true', () => {
    const before = render({ scrolled: false });
    const after = render({ scrolled: true });
    expect(before).toContain('bg-transparent');
    expect(after).toContain('backdrop-blur-md');
  });

  it('renders <PixelHumanGlyph mood=idle> as the brand mark (logo)', () => {
    // The pixel glyph is the shipped brand mark (ASCII ShillingGlyph was
    // retired from the header after style A/B comparison). We assert the
    // root <svg> attributes so a future refactor that drops the logo or
    // flips mood away from idle fails loudly.
    const out = render();
    expect(out).toContain('aria-label="Shilling Market logo"');
    expect(out).toContain('pixel-root');
    expect(out).toContain('pixel--idle');
    expect(out).toContain('data-mood="idle"');
  });
});

describe('<Header /> export contract', () => {
  it('exports a function component so the client shell can be mounted', () => {
    expect(typeof Header).toBe('function');
  });
});
