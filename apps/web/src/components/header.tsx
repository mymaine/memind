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

// Canonical repo URL for the TopBar GitHub jump-off. Hard-coded because
// there is no config plumbing for "where does this build publish its
// source" and the deployment target is a single public repo.
const REPO_URL = 'https://github.com/mymaine/memind';

// Inline GitHub mark — the widely published simple-icons.org path. Using
// `currentColor` so the icon can inherit the TopBar's fg-tertiary /
// accent-on-hover treatment via CSS.
function GitHubMark(): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="currentColor"
      aria-hidden
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}

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
            size={32}
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
        <a
          className="topbar-github"
          href={REPO_URL}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="View source on GitHub"
          title="View source on GitHub"
        >
          <GitHubMark />
        </a>
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
