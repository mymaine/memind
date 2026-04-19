/**
 * Pure helpers behind the shared <Header /> component. Kept free of React so
 * they are node-testable without a DOM, matching the pattern used by
 * useScrollProgress / useScrollReveal — controller logic sits in plain TS,
 * the React shell only plumbs state.
 *
 * Post-immersive-single-page P1 Task 3 / AC-ISP-4: the Header menu is
 * slimmed to a single primary nav entry (Home). The former Market +
 * Evidence anchors were dropped — section jumps are owned by the sticky
 * <SectionToc /> on `md+` and the slim Header nav on sub-md.
 */

/**
 * `route` entries match the current pathname exactly. The type keeps the
 * `anchor` kind available for future nav entries without introducing a
 * breaking change, but no anchor entries ship today.
 */
export interface NavItem {
  readonly href: '/';
  readonly label: string;
  readonly kind: 'route' | 'anchor';
}

export const NAV_ITEMS: readonly NavItem[] = [{ href: '/', label: 'Home', kind: 'route' }] as const;

/**
 * Decide whether a nav entry should show the active accent underline.
 *
 * - `route` kind: the pathname must exactly equal `href`.
 * - `anchor` kind: reserved for future use — currently returns false because
 *   no anchor entries are registered.
 */
export function isActiveNavItem(item: NavItem, pathname: string): boolean {
  if (item.kind === 'route') {
    return pathname === item.href;
  }
  return false;
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
