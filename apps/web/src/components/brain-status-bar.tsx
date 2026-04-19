'use client';

/**
 * BrainStatusBar — always-visible "Token Brain is here" strip (V4.7-P4).
 *
 * Lives directly under the shared <Header /> on every route so a judge
 * watching the demo feels the Brain exists without opening a new route.
 * Clicking anywhere on the bar opens <BrainDetailModal /> where the Brain
 * identity block, memory counters, and persona roster live.
 *
 * Design lock: docs/decisions/2026-04-19-brain-agent-positioning.md §Scope
 * forbids opening `/brain` as a new route — this bar + modal is the entire
 * "brain is here" surface.
 *
 * Split into <BrainStatusBarView /> (pure, props-only, node-testable via
 * renderToStaticMarkup) and <BrainStatusBar /> (client shell that owns the
 * modal-open state + wires useRun). Mirrors the <HeaderView /> / <Header />
 * pattern already shipped on this repo.
 *
 * TODO(brain-runstate-thread): the client shell currently mounts in the
 * root layout with no runState. Threading per-page useRun() state into a
 * layout-level component requires a RunStateContext provider that wraps
 * <main> in each page, which the V4.7-P4 brief explicitly excludes
 * ("Do not refactor useRun"). The pure view already accepts `runState`,
 * so the wiring work is an <= 30 LoC follow-up whenever the context lands.
 */
import { useState } from 'react';
import type { ReactElement } from 'react';
import type { RunState } from '@/hooks/useRun-state';
import { IDLE_STATE } from '@/hooks/useRun-state';
import { BRAIN_ARCHITECTURE } from '@/lib/narrative-copy';
import {
  deriveActivePersonaLabel,
  deriveBrainStatus,
  type BrainStatus,
} from './brain-status-bar-utils';
import { BrainDetailModal } from './brain-detail-modal';

export interface BrainStatusBarViewProps {
  readonly runState: RunState;
  readonly modalOpen: boolean;
  readonly onOpen: () => void;
}

/**
 * Pure presentational bar — no browser APIs, no hooks. Tests drive this
 * directly via renderToStaticMarkup. Layout / client shell wires the
 * modalOpen + onOpen props.
 */
export function BrainStatusBarView(props: BrainStatusBarViewProps): ReactElement {
  const { runState, modalOpen, onOpen } = props;
  const status: BrainStatus = deriveBrainStatus(runState);
  const activePersona = deriveActivePersonaLabel(runState);
  const statusLabel = status === 'online' ? 'online' : 'idle';
  const statusColor = status === 'online' ? 'text-accent-text' : 'text-fg-tertiary';

  return (
    <button
      type="button"
      aria-haspopup="dialog"
      aria-expanded={modalOpen}
      aria-controls="brain-detail-modal"
      aria-label="Open Token Brain detail"
      onClick={onOpen}
      className="sticky top-14 z-30 flex w-full items-center gap-3 border-b border-border-default bg-bg-primary/95 px-6 py-1.5 font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.5px] text-fg-tertiary backdrop-blur-sm transition-colors hover:bg-bg-surface focus:outline-none focus-visible:border-accent md:text-[12px]"
    >
      {/* Glyph — static 16x16 SVG signalling Brain presence. No animation
          in the default frame; the signal-pulse keyframe in globals.css is
          opt-in via the `brain-glyph--pulse` class (unused today to stay
          under design.md §7's "no decorative loops" rule). */}
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden="true"
        className="shrink-0 text-accent"
      >
        <circle cx="8" cy="8" r="3" fill="currentColor" />
        <circle
          cx="8"
          cy="8"
          r="6.5"
          stroke="currentColor"
          strokeOpacity="0.5"
          strokeDasharray="2 2"
        />
      </svg>

      <span className="font-semibold text-accent-text">TOKEN BRAIN</span>

      <span aria-hidden className="text-border-default">
        ·
      </span>

      <span className={statusColor}>{statusLabel}</span>

      {activePersona !== null ? (
        <>
          <span aria-hidden className="text-border-default">
            ·
          </span>
          <span className="truncate text-fg-secondary">
            <span className="hidden md:inline">active persona: </span>
            <span className="text-fg-primary">{activePersona}</span>
          </span>
        </>
      ) : null}

      <span className="ml-auto hidden text-fg-tertiary md:inline">
        {BRAIN_ARCHITECTURE.brainSubtitle}
      </span>

      <span className="ml-2 shrink-0 text-accent-text" aria-hidden>
        view brain ↗
      </span>
    </button>
  );
}

export interface BrainStatusBarProps {
  /**
   * Optional live run state. When absent the bar shows `idle` and omits the
   * active-persona line. Pages that already own a `useRun()` instance can
   * pass its state through so the bar reflects the in-flight persona.
   */
  readonly runState?: RunState;
}

/**
 * Client shell — owns modal-open state and mounts <BrainDetailModal />. The
 * layout root mounts this without runState (falls back to IDLE_STATE); see
 * the TODO in the file header about threading live state from /  + /market.
 */
export function BrainStatusBar(props: BrainStatusBarProps): ReactElement {
  const [open, setOpen] = useState(false);
  const runState = props.runState ?? IDLE_STATE;

  return (
    <>
      <BrainStatusBarView runState={runState} modalOpen={open} onOpen={() => setOpen(true)} />
      <BrainDetailModal open={open} onClose={() => setOpen(false)} runState={runState} />
    </>
  );
}
