'use client';

/**
 * TopNav — primary site navigation shared by every route.
 *
 * Two link pills let the viewer hop between the Phase 4.5 Agent-to-Agent
 * dashboard (`/`) and the Phase 4.6 Shilling Market (`/market`). The current
 * route gets an accent border so the active surface is obvious at a glance
 * during the demo. This component is a client component because it reads
 * `usePathname()` to decide which pill is active; the root layout stays a
 * server component and simply mounts `<TopNav />`.
 *
 * Styling follows the Terminal Cyber tokens already in play (border-default,
 * bg-surface, fg-tertiary, accent) — no new Tailwind classes or CSS.
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';

// `href` uses literal string unions so Next.js typed routes are satisfied
// without casting. Extending the nav later requires adding the new route to
// the union explicitly — intentional friction to keep nav entries honest.
const NAV_ITEMS = [
  { href: '/', label: 'Agent-to-Agent' },
  { href: '/market', label: 'Shilling Market' },
] as const;

export function TopNav(): React.ReactElement {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Primary"
      className="sticky top-0 z-40 flex h-11 items-center border-b border-border-default bg-bg-primary/95 backdrop-blur"
    >
      <ul className="mx-auto flex w-full max-w-[1400px] items-center gap-2 px-6">
        {NAV_ITEMS.map((item) => {
          // Match `/market` exactly; `/` only when path is exactly root so any
          // future `/foo` route does not light up the root pill.
          const isActive = item.href === '/' ? pathname === '/' : pathname === item.href;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={isActive ? 'page' : undefined}
                className={`inline-flex items-center rounded-[var(--radius-card)] border px-3 py-1 font-[family-name:var(--font-mono)] text-[12px] uppercase tracking-[0.5px] transition-colors ${
                  isActive
                    ? 'border-accent bg-bg-surface text-accent-text'
                    : 'border-border-default text-fg-tertiary hover:text-fg-primary'
                }`}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
