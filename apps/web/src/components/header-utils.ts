/**
 * Pure helpers behind the shared <Header /> component. Kept free of React so
 * they are node-testable without a DOM, matching the pattern used by
 * useScrollProgress / useScrollReveal — controller logic sits in plain TS,
 * the React shell only plumbs state.
 *
 * Supports AC-P4.7-1 (shared Header: sticky / three nav entries /
 * scroll-blur at > 80px).
 */

/**
 * `route` entries match the current pathname exactly. `anchor` entries point
 * at a section that is duplicated across multiple scenes (Evidence renders on
 * both `/` and `/market`), so their "active" semantics are any-of rather
 * than exact-match — see isActiveNavItem.
 */
export interface NavItem {
  readonly href: '/' | '/market' | '/#evidence' | '/market#evidence';
  readonly label: string;
  readonly kind: 'route' | 'anchor';
}

export const NAV_ITEMS: readonly NavItem[] = [
  { href: '/', label: 'Home', kind: 'route' },
  { href: '/market', label: 'Market', kind: 'route' },
  { href: '/#evidence', label: 'Evidence', kind: 'anchor' },
] as const;

/**
 * Decide whether a nav entry should show the active accent underline.
 *
 * - `route` kind: the pathname must exactly equal `href` (so `/market` does
 *   not keep Home highlighted and future `/foo` does not light either).
 * - `anchor` kind: the Evidence anchor exists on both `/` and `/market`, so
 *   the entry is considered active whenever the viewer is on either of those
 *   routes. usePathname() strips the hash, so we ignore it here too.
 */
export function isActiveNavItem(item: NavItem, pathname: string): boolean {
  if (item.kind === 'route') {
    return pathname === item.href;
  }
  // anchor — Evidence lives on both Home and Market scenes.
  return pathname === '/' || pathname === '/market';
}

/**
 * Compute the Tailwind class string for the outer <header>. Transparent
 * initially; once the page has scrolled past the threshold (caller passes
 * `scrolled=true` from useScrollProgress(80)), apply a translucent surface
 * + blur + accent-friendly border.
 *
 * The 150ms transition is always present so the global reduced-motion media
 * query in globals.css can zero out the duration without a component fork.
 */
export function headerOuterClass(scrolled: boolean): string {
  const base = 'transition-[background-color,backdrop-filter,border-color] duration-150 ease-out';
  if (scrolled) {
    return `${base} bg-bg-primary/80 backdrop-blur-md border-b border-border-default`;
  }
  return `${base} bg-transparent border-b border-transparent`;
}
