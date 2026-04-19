'use client';

/**
 * <SectionToc /> — sticky left-side table of contents for the immersive
 * single-page surface (immersive-single-page P1 Task 2 / AC-ISP-3).
 *
 * Visible on `md+` viewports only; sub-md viewers fall back to the slim
 * Header navigation (AC-ISP-4). The active section is highlighted with a
 * 2px accent left-border and bold label; clicking any item smooth-scrolls
 * the corresponding `#section-id` into view (HTML default `href="#..."`
 * plus CSS `scroll-margin-top` on each `<section>` handles Header offset
 * without JS).
 *
 * Split convention mirrors <HeaderView /> / <BrainStatusBarView />: the
 * pure `<SectionTocView />` is driven entirely by props so tests render it
 * via renderToStaticMarkup without a DOM; the client shell wires
 * `useSectionObserver` into the view.
 */
import type { ReactElement } from 'react';
import { useSectionObserver } from '@/hooks/useSectionObserver';

export interface SectionTocItem {
  readonly id: string;
  readonly label: string;
}

/**
 * 11 top-level sections in spec order (immersive-single-page §Section 順序
 * 總圖). Keep the labels terse — the TOC is a peripheral navigation aid, not
 * a copy surface.
 */
export const SECTION_TOC_ITEMS: readonly SectionTocItem[] = [
  { id: 'hero', label: 'Hero' },
  { id: 'problem', label: 'Problem' },
  { id: 'solution', label: 'Solution' },
  { id: 'brain-architecture', label: 'Brain' },
  { id: 'launch-demo', label: 'Launch demo' },
  { id: 'order-shill', label: 'Order shill' },
  { id: 'heartbeat-demo', label: 'Heartbeat' },
  { id: 'take-rate', label: 'Take rate' },
  { id: 'sku-matrix', label: 'SKU matrix' },
  { id: 'phase-map', label: 'Phase map' },
  { id: 'evidence', label: 'Evidence' },
] as const;

export interface SectionTocViewProps {
  readonly activeId: string | null;
  readonly items: readonly SectionTocItem[];
}

/**
 * Pure presentational TOC. No hooks, no browser APIs. Consumers (including
 * tests) pass the current activeId explicitly so output is deterministic.
 */
export function SectionTocView(props: SectionTocViewProps): ReactElement {
  const { activeId, items } = props;

  return (
    <nav
      aria-label="Page sections"
      // Hidden on sub-md viewports (AC-ISP-3); becomes a vertical flex stack
      // at md+. The sticky offset matches the Header height (56px) so the
      // TOC sits just under it.
      className="sticky top-[72px] hidden h-[calc(100vh-88px)] w-48 shrink-0 flex-col gap-1 self-start overflow-y-auto pr-2 md:flex"
    >
      <ul className="flex flex-col gap-0.5">
        {items.map((item) => {
          const active = item.id === activeId;
          const baseClass =
            'block py-1 pl-3 font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.5px] transition-colors';
          // Active variant: 2px accent left border + bold label. Inactive
          // variant keeps the same padding with a transparent border so the
          // text never shifts horizontally when activation flips.
          const stateClass = active
            ? 'border-l-2 border-accent font-semibold text-fg-primary'
            : 'border-l-2 border-transparent text-fg-tertiary hover:text-fg-primary';
          return (
            <li key={item.id}>
              <a
                href={`#${item.id}`}
                aria-current={active ? 'true' : undefined}
                className={`${baseClass} ${stateClass}`}
              >
                {item.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * Client shell that reads live scroll position (via `useSectionObserver`)
 * and feeds it to <SectionTocView />. The section id list is sourced from
 * `SECTION_TOC_ITEMS` so there is one canonical ordering.
 */
export function SectionToc(): ReactElement {
  const ids = SECTION_TOC_ITEMS.map((i) => i.id);
  const activeId = useSectionObserver(ids);
  return <SectionTocView activeId={activeId} items={SECTION_TOC_ITEMS} />;
}
