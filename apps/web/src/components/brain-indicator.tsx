'use client';

/**
 * BrainIndicator — slim Header-resident "Token Brain is here" control
 * (immersive-single-page P1 Task 3 / AC-ISP-6).
 *
 * Replaces the independent <BrainStatusBar /> strip that previously sat
 * under the Header: AC-ISP-6 collapses the three stacked bars (Header,
 * BrainStatusBar, DevLogsDrawer) into two (Header, DevLogsDrawer) by
 * folding the Brain surface into the Header itself. Clicking opens the
 * shared <BrainDetailModal /> — the modal internals are unchanged.
 *
 * Split into <BrainIndicatorView /> (pure, props-only, node-testable via
 * renderToStaticMarkup) and <BrainIndicator /> (client shell that owns the
 * modal-open state + subscribes to the layout-level RunStateContext).
 * Mirrors the <HeaderView /> / <BrainStatusBarView /> pattern shipped on
 * this repo.
 *
 * Status + persona derivation delegates to `brain-status-bar-utils` —
 * `deriveBrainStatus` and `deriveActivePersonaLabel` are reused verbatim so
 * the Brain-label semantics stay identical across the codebase.
 */
import { useState, type ReactElement } from 'react';
import type { RunState } from '@/hooks/useRun-state';
import { useRunState } from '@/hooks/useRunStateContext';
import {
  deriveActivePersonaLabel,
  deriveBrainStatus,
  type BrainStatus,
} from './brain-status-bar-utils';
import { BrainDetailModal } from './brain-detail-modal';
import { PixelHumanGlyph, type ShillingMood } from './pixel-human-glyph';

// Status → mascot mood. `sleep` evokes the "not ticking" idle state; `work`
// evokes the active runtime. Keeps the indicator's header real-estate tiny
// (size=20) so the mascot reads as a status glyph rather than a standalone
// illustration.
const STATUS_MOOD: Readonly<Record<BrainStatus, ShillingMood>> = {
  idle: 'sleep',
  online: 'work',
};

export interface BrainIndicatorViewProps {
  readonly runState: RunState;
  readonly modalOpen: boolean;
  readonly onOpen: () => void;
}

/**
 * Pure presentational indicator — compact, inline-safe for the Header
 * right slot. No hooks, no browser APIs; tests render this directly.
 */
export function BrainIndicatorView(props: BrainIndicatorViewProps): ReactElement {
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
      className="inline-flex h-8 items-center gap-2 rounded-[var(--radius-default)] border border-border-default bg-bg-surface px-2.5 font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.5px] text-fg-tertiary transition-colors hover:border-accent hover:text-fg-primary focus:outline-none focus-visible:border-accent md:text-[12px]"
    >
      {/* Status mascot — replaces the old 12x12 accent-circle glyph. The
          mood swaps with BrainStatus: sleep ↔ idle, work ↔ online. Size 20
          keeps the indicator compact so it still fits the Header's 32px
          button row. */}
      <span className="shrink-0" data-testid="brain-indicator-mascot">
        <PixelHumanGlyph
          size={20}
          mood={STATUS_MOOD[status]}
          ariaLabel={`Token Brain status: ${statusLabel}`}
        />
      </span>

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
          <span className="hidden truncate text-fg-primary md:inline">{activePersona}</span>
        </>
      ) : null}
    </button>
  );
}

export interface BrainIndicatorProps {
  /**
   * Optional live run state. When absent the indicator subscribes to the
   * layout-level RunStateContext (default IDLE_STATE if no page publishes).
   * Tests and Header passes fixtures directly to bypass the provider.
   */
  readonly runState?: RunState;
}

/**
 * Client shell — owns modal-open state, subscribes to RunStateContext,
 * mounts <BrainDetailModal />. Mounted by <Header /> in the right slot.
 */
export function BrainIndicator(props: BrainIndicatorProps): ReactElement {
  const [open, setOpen] = useState(false);
  const contextRunState = useRunState();
  const runState = props.runState ?? contextRunState;

  return (
    <>
      <BrainIndicatorView runState={runState} modalOpen={open} onOpen={() => setOpen(true)} />
      <BrainDetailModal open={open} onClose={() => setOpen(false)} runState={runState} />
    </>
  );
}
