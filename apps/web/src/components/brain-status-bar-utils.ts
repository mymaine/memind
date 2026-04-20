/**
 * Pure helpers behind the Brain surface (<BrainIndicator /> today; was
 * <BrainStatusBar /> pre-immersive pivot). Kept free of React so they are
 * node-testable without a DOM and can be reused by any future surface that
 * wants to derive "who is the Brain currently acting as".
 *
 * Policy:
 *   - Status is `online` when `runState.phase === 'running'` OR when the
 *     BrainChat activity is sending / streaming. The chat run lives outside
 *     `useRun()` so without the second source the indicator stays pinned to
 *     IDLE even though the transcript is streaming (2026-04-20 UAT bug).
 *   - Active persona prefers the BrainChat `activity.currentAgent` while
 *     the chat is in flight — that signal reflects the live SSE `agent`
 *     field. Otherwise we fall back to the last-log agent of `useRun()`'s
 *     running snapshot. Neither present → null (the bar omits the
 *     segment rather than flashing stale state).
 *   - Agent ids are the code-side names (creator / narrator / market-maker
 *     / heartbeat); the pitch-layer persona labels are the one-way map
 *     defined below. Keeping the map local honours the decision doc's
 *     "code keeps agent, UI uses persona" rule without leaking it across
 *     the repo.
 *
 * `activity` is optional on both helpers so existing call sites (console
 * tab, pre-context code paths) compile unchanged — the optional argument
 * is additive and collapses to the legacy behaviour when omitted.
 */
import type { AgentId } from '@hack-fourmeme/shared';
import type { RunState } from '@/hooks/useRun-state';
import type { BrainChatActivity } from '@/hooks/useRunStateContext';

export type BrainStatus = 'online' | 'idle';

/**
 * One-way code-agent → pitch-persona label map. Kept in one place (here)
 * so renames only touch a single file.
 */
const AGENT_TO_PERSONA_LABEL: Record<AgentId, string> = {
  creator: 'Creator',
  narrator: 'Narrator',
  'market-maker': 'Market-maker / Shiller',
  heartbeat: 'Heartbeat',
  brain: 'Brain',
  shiller: 'Shiller',
};

function isActivityLive(activity: BrainChatActivity | undefined): boolean {
  if (!activity) return false;
  return activity.status === 'sending' || activity.status === 'streaming';
}

export function deriveBrainStatus(runState: RunState, activity?: BrainChatActivity): BrainStatus {
  if (runState.phase === 'running') return 'online';
  if (isActivityLive(activity)) return 'online';
  return 'idle';
}

/**
 * Returns the pitch-layer label of the active persona. Priority order:
 *   1. BrainChat activity currentAgent when sending / streaming.
 *   2. Most recent log agent while `useRun()` is running.
 *   3. null (the bar omits the segment).
 */
export function deriveActivePersonaLabel(
  runState: RunState,
  activity?: BrainChatActivity,
): string | null {
  if (isActivityLive(activity) && activity && activity.currentAgent !== null) {
    return AGENT_TO_PERSONA_LABEL[activity.currentAgent];
  }
  if (runState.phase !== 'running') return null;
  const { logs } = runState;
  if (logs.length === 0) return null;
  const latest = logs[logs.length - 1];
  if (latest === undefined) return null;
  return AGENT_TO_PERSONA_LABEL[latest.agent];
}
