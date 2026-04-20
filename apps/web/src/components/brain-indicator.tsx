'use client';

/**
 * BrainIndicator — slim TopBar-resident "Token Brain is here" control
 * (memind-scrollytelling-rebuild AC-MSR-3).
 *
 * The click forwards to the parent's `onClick` which opens the right-side
 * <BrainPanel /> (page.tsx owns the open-state toggle post P0-15). The
 * old <BrainDetailModal /> centred dialog was retired in the same cycle.
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
import {
  useBrainChatActivity,
  useRunState,
  type BrainChatActivity,
} from '@/hooks/useRunStateContext';
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
 * Derive the glyph mood from the runState + optional BrainChat activity.
 *
 * Priority order:
 *   1. If nothing is live (run idle + activity idle/error) → `idle`.
 *   2. If BrainChat is streaming/sending and carries a currentAgent, map
 *      it to that agent's mood. This keeps the TopBar glyph in sync with
 *      the persona the chat is actively routing through even when useRun
 *      never fired.
 *   3. Otherwise fall back to the last useRun log agent.
 *   4. Running with no logs and no activity persona → `work` as a safe
 *      generic "busy" mood.
 */
export function deriveGlyphMood(runState: RunState, activity?: BrainChatActivity): ShillingMood {
  if (deriveBrainStatus(runState, activity) === 'idle') return 'idle';
  if (
    activity &&
    (activity.status === 'sending' || activity.status === 'streaming') &&
    activity.currentAgent !== null
  ) {
    return AGENT_MOOD[activity.currentAgent] ?? 'work';
  }
  const { logs } = runState;
  const latest = logs[logs.length - 1];
  if (!latest) return 'work';
  return AGENT_MOOD[latest.agent] ?? 'work';
}

export interface BrainIndicatorViewProps {
  readonly runState: RunState;
  readonly onClick: () => void;
  /**
   * Optional BrainChat live activity signal. When present (and live) it
   * drives the ONLINE pill + glyph mood even if `runState` is idle.
   */
  readonly activity?: BrainChatActivity;
}

/**
 * Pure presentational indicator - compact pill with glyph + TOKEN BRAIN
 * label + status dot. No hooks, no browser APIs; tests render directly.
 */
export function BrainIndicatorView(props: BrainIndicatorViewProps): ReactElement {
  const { runState, onClick, activity } = props;
  const status: BrainStatus = deriveBrainStatus(runState, activity);
  const mood: ShillingMood = deriveGlyphMood(runState, activity);
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
 * component just forwards the click. We always read the BrainChat activity
 * from context so the indicator lights up during brain-chat runs even when
 * the caller passes a stale useRun-sourced `runState` prop (page.tsx does).
 */
export function BrainIndicator(props: BrainIndicatorProps): ReactElement {
  const contextRunState = useRunState();
  const activity = useBrainChatActivity();
  const runState = props.runState ?? contextRunState;
  const onClick = props.onClick ?? ((): void => {});
  return <BrainIndicatorView runState={runState} onClick={onClick} activity={activity} />;
}
