'use client';

/**
 * <Header /> — fixed TopBar for the Memind scrollytelling surface
 * (memind-scrollytelling-rebuild AC-MSR-3).
 *
 * The previous slim Tailwind Header (brand link + Home nav + GitHub icon +
 * BrainIndicator modal) was retired with the handoff pivot. The new TopBar
 * ports design-spec `app.jsx:TopBar`: a brand cluster on the left (22px
 * PixelHumanGlyph + MEMIND wordmark + meme x mind tag) and a progress /
 * brain cluster on the right (NN/MM mono counter + 120px progress bar +
 * <BrainIndicator /> button that opens the BrainPanel).
 *
 * Layout + styling comes from the ported `.topbar*` classes in globals.css;
 * there is no Tailwind utility string so the visual language lives entirely
 * in CSS and the component just wires props to markup.
 *
 * Split convention (HeaderView + Header shell) is preserved so tests can
 * render the pure view via renderToStaticMarkup without a DOM. The shell
 * currently just forwards props untouched — when P0-15 lands the BrainPanel
 * it will own the panel open-state and pass `onBrainClick` back to itself.
 */
import type { ReactElement } from 'react';
import type { RunState } from '@/hooks/useRun-state';
import { PixelHumanGlyph } from '@/components/pixel-human-glyph';
import { BrainIndicator } from '@/components/brain-indicator';

export interface HeaderViewProps {
  readonly activeIdx: number;
  readonly total: number;
  /** Overall scroll progress, 0..1. */
  readonly progress: number;
  readonly runState: RunState;
  readonly onBrainClick: () => void;
}

/**
 * Pure presentational TopBar - no hooks, no browser APIs. Consumers pass
 * the chapter state + onBrainClick handler explicitly so SSR tests render
 * the whole bar deterministically.
 */
export function HeaderView(props: HeaderViewProps): ReactElement {
  const { activeIdx, total, progress, runState, onBrainClick } = props;
  const counter = `${String(activeIdx + 1).padStart(2, '0')}/${String(total).padStart(2, '0')}`;
  // Clamp to [0,100] so a stray > 1 progress (e.g. bounce scroll) never
  // overflows the bar and a negative value never visually collapses below 0.
  const fillPercent = Math.max(0, Math.min(100, progress * 100));
  return (
    <header className="topbar">
      <div className="topbar-brand">
        <span className="brand-mark">
          <PixelHumanGlyph
            size={22}
            mood="idle"
            primaryColor="var(--accent)"
            accentColor="var(--chain-bnb)"
          />
        </span>
        <span className="brand-wordmark">MEMIND</span>
        <span className="brand-sep mono">{'//'}</span>
        <span className="brand-tag">meme × mind</span>
      </div>
      <div className="topbar-nav">
        <span className="mono topbar-progress">
          {counter}
          <span className="topbar-progress-bar">
            <span
              className="topbar-progress-fill"
              style={{ width: `${fillPercent.toFixed(1)}%` }}
            />
          </span>
        </span>
        <BrainIndicator runState={runState} onClick={onBrainClick} />
      </div>
    </header>
  );
}

export interface HeaderProps {
  readonly activeIdx: number;
  readonly total: number;
  readonly progress: number;
  readonly runState: RunState;
  readonly onBrainClick?: () => void;
}

/**
 * Client shell. Thin by design - forwards props to <HeaderView /> and
 * provides a no-op `onBrainClick` default so callers without a BrainPanel
 * wired yet (page.tsx during the P0-2 -> P0-15 window) render without
 * exploding.
 */
export function Header(props: HeaderProps): ReactElement {
  const onBrainClick = props.onBrainClick ?? ((): void => {});
  return (
    <HeaderView
      activeIdx={props.activeIdx}
      total={props.total}
      progress={props.progress}
      runState={props.runState}
      onBrainClick={onBrainClick}
    />
  );
}
