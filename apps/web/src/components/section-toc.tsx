'use client';

/**
 * <SectionToc /> - fixed left-side chapter list for the Memind
 * scrollytelling surface (memind-scrollytelling-rebuild AC-MSR-4).
 *
 * Ported from design-handoff `app.jsx:SectionToc` - a frameless list of
 * numbered chapter buttons. The active entry is highlighted with a 2px
 * accent left-border + bold label via the ported `.toc-item.active` class.
 *
 * Clicking a row calls `onJump(idx)`; the parent page owns the scroll
 * math (computes the mid-hold scroll position for the selected chapter
 * and triggers `window.scrollTo`). Browser hash anchors are not used
 * because the sticky-stage cross-fade is driven by scrollY, not anchor
 * navigation.
 *
 * Viewport gating `< 1100px -> display: none` lives entirely in the
 * `.toc` CSS rule (globals.css), so this component has no breakpoint
 * logic.
 */
import type { ReactElement } from 'react';
import { CHAPTER_META } from '@/lib/chapters';

export interface SectionTocProps {
  readonly activeIdx: number;
  readonly onJump: (idx: number) => void;
}

export function SectionToc(props: SectionTocProps): ReactElement {
  const { activeIdx, onJump } = props;
  return (
    <nav className="toc" aria-label="Chapters">
      {CHAPTER_META.map((ch, i) => {
        const active = i === activeIdx;
        return (
          <button
            key={ch.id}
            type="button"
            className={`toc-item${active ? ' active' : ''}`}
            onClick={() => onJump(i)}
            aria-current={active ? 'true' : undefined}
          >
            <span className="toc-num">{String(i + 1).padStart(2, '0')}</span>
            <span className="toc-title">{ch.title}</span>
          </button>
        );
      })}
    </nav>
  );
}
