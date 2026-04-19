'use client';

/**
 * BrainIndicator — slim TopBar-resident "Token Brain is here" control
 * (memind-scrollytelling-rebuild AC-MSR-3).
 *
 * Replaces the previous modal-owning indicator: the click no longer opens a
 * <BrainDetailModal /> inline; it forwards to the parent's `onClick` which
 * will open the right-slide-in BrainPanel landing in P0-15. Until the panel
 * is wired, the handler is a no-op — the button still mounts so the visual
 * language matches the design spec.
 *
 * Split into <BrainIndicatorView /> (pure, props-only, node-testable via
 * renderToStaticMarkup) and <BrainIndicator /> (client shell that subscribes
 * to RunStateContext for a default runState when none is passed).
 *
 * The mascot mood now tracks the active persona during a run: creator ->
 * type-keyboard, narrator -> think, market-maker -> megaphone, heartbeat ->
 * walk-right, brain -> think, shiller -> megaphone. Idle collapses to
 * `idle` so the glyph reads as resting.
 */
import type { ReactElement } from 'react';
import type { AgentId } from '@hack-fourmeme/shared';
import type { RunState } from '@/hooks/useRun-state';
import { useRunState } from '@/hooks/useRunStateContext';
import { deriveBrainStatus, type BrainStatus } from './brain-status-bar-utils';
import { PixelHumanGlyph, type ShillingMood } from './pixel-human-glyph';

// Agent -> mood map for the online path. Picked to match the design-spec
// intent: creator types, narrator thinks, market-maker/shiller shouts,
// heartbeat walks. Falls back to `work` so any new agent id added upstream
// still renders a sensible glyph instead of crashing.
const AGENT_MOOD: Partial<Record<AgentId, ShillingMood>> = {
  creator: 'type-keyboard',
  narrator: 'think',
  'market-maker': 'megaphone',
  heartbeat: 'walk-right',
  brain: 'think',
  shiller: 'megaphone',
};

/**
 * Derive the glyph mood from the runState. Idle runs always show `idle`.
 * When running, use the latest log's agent to pick a persona-flavoured mood
 * so the indicator reads as "the brain is doing X right now".
 */
export function deriveGlyphMood(runState: RunState): ShillingMood {
  if (deriveBrainStatus(runState) === 'idle') return 'idle';
  const { logs } = runState;
  const latest = logs[logs.length - 1];
  if (!latest) return 'work';
  return AGENT_MOOD[latest.agent] ?? 'work';
}

export interface BrainIndicatorViewProps {
  readonly runState: RunState;
  readonly onClick: () => void;
}

/**
 * Pure presentational indicator - compact pill with glyph + TOKEN BRAIN
 * label + status dot. No hooks, no browser APIs; tests render directly.
 */
export function BrainIndicatorView(props: BrainIndicatorViewProps): ReactElement {
  const { runState, onClick } = props;
  const status: BrainStatus = deriveBrainStatus(runState);
  const mood: ShillingMood = deriveGlyphMood(runState);
  const statusLabel = status === 'online' ? 'ONLINE' : 'IDLE';
  const statusColor = status === 'online' ? 'var(--accent)' : 'var(--fg-tertiary)';

  return (
    <button type="button" aria-label="Open brain panel" onClick={onClick} className="brain-ind">
      <span data-testid="brain-indicator-mascot">
        <PixelHumanGlyph
          size={16}
          mood={mood}
          primaryColor="var(--accent)"
          accentColor="var(--chain-bnb)"
          ariaLabel={`Token Brain status: ${statusLabel.toLowerCase()}`}
        />
      </span>
      <span>TOKEN BRAIN</span>
      <span style={{ color: statusColor }}>· {statusLabel}</span>
    </button>
  );
}

export interface BrainIndicatorProps {
  /**
   * Optional live run state. When absent the indicator subscribes to the
   * layout-level RunStateContext (default IDLE_STATE if no page publishes).
   */
  readonly runState?: RunState;
  /** Forwarded as the button's onClick; default is a no-op. */
  readonly onClick?: () => void;
}

/**
 * Client shell - subscribes to RunStateContext if the caller does not pass
 * a runState. The parent (TopBar) owns the BrainPanel open state so this
 * component just forwards the click.
 */
export function BrainIndicator(props: BrainIndicatorProps): ReactElement {
  const contextRunState = useRunState();
  const runState = props.runState ?? contextRunState;
  const onClick = props.onClick ?? ((): void => {});
  return <BrainIndicatorView runState={runState} onClick={onClick} />;
}
