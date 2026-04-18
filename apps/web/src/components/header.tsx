'use client';

/**
 * Shared sticky Header (AC-P4.7-1).
 *
 * Split into two pieces so the logic is testable without a browser:
 *   - <HeaderView /> is a pure presentational component driven by props
 *     (pathname, scrolled, brandName, navItems, githubUrl). It is what the
 *     unit tests render via renderToStaticMarkup.
 *   - <Header /> is the client shell: calls usePathname() and
 *     useScrollProgress(80) to wire the view to live browser state.
 *
 * The left side carries the <ShillingGlyph mood='idle' /> brand mark — an
 * SVG face with breathing idle animation and occasional blink / wink
 * micros — next to the BRAND_NAME wordmark. The Header context pins the
 * mood to `idle` and never changes it; mood-driven variants live on the
 * Hero / Mascot surfaces instead. The right side hosts three nav links
 * (Home / Market / Evidence) and a GitHub icon link. Nothing here touches
 * CSS — all styling is Tailwind v4 tokens already registered in
 * globals.css.
 *
 * TODO(lead): ShillingGlyph defaults to `#00e5b4` primary; design.md
 * specifies `--color-accent` (#00d992) for Shilling Market. Intentionally
 * left as default here so the canonical color pass can land as a single
 * theme-wide sweep (likely via CSS var override on `.glyph-root`) rather
 * than a one-off `primaryColor` prop at every call site.
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useScrollProgress } from '@/hooks/useScrollProgress';
import { BRAND_NAME } from '@/lib/narrative-copy';
import { ShillingGlyph } from '@/components/shilling-glyph';
import {
  NAV_ITEMS,
  headerOuterClass,
  isActiveNavItem,
  type NavItem,
} from '@/components/header-utils';

// TODO(lead): swap in the canonical repo URL once the hackathon submission
// picks a public GitHub mirror. Placeholder `#` keeps the icon harmless in
// the meantime — the link target is non-navigating rather than broken.
const GITHUB_URL_PLACEHOLDER = '#';

export interface HeaderViewProps {
  readonly pathname: string | null;
  readonly scrolled: boolean;
  readonly brandName: string;
  readonly navItems: readonly NavItem[];
  readonly githubUrl: string;
}

/**
 * Pure presentational header — no browser APIs, no hooks. Consumers
 * (including tests) pass the current pathname + scrolled flag as props so
 * the output is fully deterministic.
 */
export function HeaderView(props: HeaderViewProps): React.ReactElement {
  const { pathname, scrolled, brandName, navItems, githubUrl } = props;
  const outer = headerOuterClass(scrolled);
  return (
    <header
      className={`sticky top-0 z-40 flex h-14 items-center ${outer}`}
      data-scrolled={scrolled ? 'true' : 'false'}
    >
      <div className="mx-auto flex w-full max-w-[1400px] items-center gap-6 px-6">
        {/* Brand mark — <ShillingGlyph> at mood=idle paired with the
            wordmark. The glyph's own CSS drives the breathing + idle
            micros (blink / wink / smirk-amp), replacing the earlier
            signal-pulse dot with a proper face. ShillingGlyph is a
            'use client' component but its initial SSR markup is stable
            (reduced-motion server snapshot returns false), so it renders
            cleanly through renderToStaticMarkup in tests. */}
        <Link
          href="/"
          aria-label={`${brandName} — Home`}
          className="flex items-center gap-3 text-fg-primary"
        >
          <ShillingGlyph size={32} mood="idle" ariaLabel={`${brandName} logo`} />
          <span className="font-[family-name:var(--font-sans-display)] text-[18px] font-semibold uppercase tracking-[0.5px]">
            {brandName}
          </span>
        </Link>

        {/* Primary nav landmark. Nav entries use aria-current="page" when
            the computed active flag is true so screen readers announce the
            active route without us needing a visible label. */}
        <nav aria-label="Primary" className="ml-auto flex items-center gap-5">
          <ul className="flex items-center gap-5">
            {navItems.map((item) => {
              const active = pathname !== null && isActiveNavItem(item, pathname);
              const base =
                'font-[family-name:var(--font-mono)] text-[13px] uppercase tracking-[0.5px] transition-colors';
              const color = active
                ? 'text-fg-primary border-b-2 border-accent pb-0.5'
                : 'text-fg-tertiary hover:text-fg-primary border-b-2 border-transparent pb-0.5';
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={`${base} ${color}`}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
          <a
            href={githubUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="GitHub repository"
            className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-default)] text-fg-tertiary transition-colors hover:text-fg-primary"
          >
            {/* Hand-drawn GitHub mark (minimal Octocat silhouette). Kept as
                inline SVG to avoid pulling in an icon library — the design
                budget forbids extra deps. */}
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 .5C5.65.5.5 5.65.5 12a11.5 11.5 0 0 0 7.86 10.92c.58.11.79-.25.79-.56 0-.28-.01-1.02-.02-2-3.2.7-3.88-1.54-3.88-1.54-.52-1.33-1.28-1.68-1.28-1.68-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.71 1.26 3.37.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.47.11-3.06 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.79 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.77.11 3.06.74.81 1.19 1.84 1.19 3.1 0 4.42-2.69 5.39-5.26 5.68.41.35.78 1.05.78 2.11 0 1.52-.01 2.75-.01 3.13 0 .31.21.68.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
            </svg>
          </a>
        </nav>
      </div>
    </header>
  );
}

/**
 * Client shell that feeds live browser state into <HeaderView />. Kept thin
 * on purpose so the presentational layer stays node-testable.
 */
export function Header(): React.ReactElement {
  const pathname = usePathname();
  const scrolled = useScrollProgress(80);
  return (
    <HeaderView
      pathname={pathname}
      scrolled={scrolled}
      brandName={BRAND_NAME}
      navItems={NAV_ITEMS}
      githubUrl={GITHUB_URL_PLACEHOLDER}
    />
  );
}
