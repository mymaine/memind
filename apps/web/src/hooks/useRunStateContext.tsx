'use client';

/**
 * RunState context + provider + publishing hook + mirror API.
 *
 * Shape of the problem: <Header /> (and the <BrainIndicator /> it mounts)
 * is mounted in `app/layout.tsx` so it appears on every route. But the
 * live `RunState` lives inside each page's `useRun()` instance. React
 * context only flows downward, so we hoist a provider above both the
 * Header and the pages, let the pages call `usePublishRunState(state)`
 * once per render, and have the indicator read the latest published value
 * via `useRunState()`.
 *
 * UAT bug fix (Memind demo): the BrainPanel mounts <BrainChat /> which
 * runs its own `useBrainChat` hook. That hook opens a separate run via
 * POST /api/runs {kind:'brain-chat'} and consumes the SSE stream
 * independently of useRun. The FooterDrawer only reads the useRun-sourced
 * state, so brain-chat runs left Logs / Artifacts / Console tabs empty —
 * the demo's marquee feature looked frozen.
 *
 * The mirror API (`pushLog`, `pushArtifact`) lets external SSE consumers
 * splice their live events into the shared RunState without refactoring
 * useRun itself. Consumers subscribe to the merged view via `useRunState()`
 * — the provider merges the published snapshot with the mirror extras via
 * the pure `mergeRunState` helper (exported for unit tests).
 *
 * Why we are not refactoring `useRun`: the V4.7-P4 brief explicitly
 * forbids it. This file sits beside `useRun`, not inside it — pages keep
 * owning their `useRun` instance, publishing is a one-line opt-in, and
 * the mirror is an additive surface that leaves useRun's internals alone.
 *
 * Fallback behaviour: consumers that render outside a provider (e.g. the
 * `/demo/glyph` sandbox, or an unmounted test fixture) read `IDLE_STATE`
 * instead of crashing. `usePublishRunState` and `useRunStateMirror` are
 * no-ops outside a provider so pages that forgot to mount the provider
 * silently degrade rather than throwing mid-render.
 *
 * Design lock: the `<BrainIndicator /> + <BrainPanel />` pair is the entire
 * "Brain is here" surface (post memind-scrollytelling-rebuild AC-MSR-7;
 * the prior <BrainDetailModal /> was retired with the slide-in panel),
 * and it MUST reflect real live run state for the demo climax to land.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import type { AgentId, Artifact, LogEvent } from '@hack-fourmeme/shared';
import { deriveNaturalKey } from '@hack-fourmeme/shared';
import { IDLE_STATE, type RunState } from './useRun-state';

/**
 * Live activity signal emitted by `useBrainChat`. BrainChat owns a run that
 * `useRun` never sees, so the TopBar <BrainIndicator /> and the right-side
 * <BrainPanel /> meta rows used to stay frozen at IDLE while the chat was
 * actively streaming. This shape lets the hook publish just enough signal
 * (status + current persona + event count) for the status bar / TICK row
 * to light up without re-plumbing every SSE payload into RunState.
 */
export type BrainChatActivityStatus = 'idle' | 'sending' | 'streaming' | 'error';
export interface BrainChatActivity {
  readonly status: BrainChatActivityStatus;
  readonly currentAgent: AgentId | null;
  /**
   * Running count of SSE events for the in-flight `send()`. Reset to 0 on
   * every new send, frozen at the last value on terminal `error`, and
   * cleared on terminal `done` / `reset()` via the `idle` transition.
   */
  readonly eventCount: number;
}

export const EMPTY_BRAIN_CHAT_ACTIVITY: BrainChatActivity = {
  status: 'idle',
  currentAgent: null,
  eventCount: 0,
};

interface RunStateContextValue {
  readonly runState: RunState;
  readonly publish: (state: RunState) => void;
  readonly pushLog: (log: LogEvent) => void;
  readonly pushArtifact: (artifact: Artifact) => void;
  readonly resetMirror: () => void;
  readonly brainChatActivity: BrainChatActivity;
  readonly setBrainChatActivity: (activity: BrainChatActivity) => void;
}

/**
 * Exported so integration tests can stand up a minimal context fixture
 * without running the full provider (our vitest config is node-only and
 * has no jsdom, so effect-driven setState cannot be exercised). Callers
 * in application code should use `<RunStateProvider>` instead.
 */
export const RunStateContext = createContext<RunStateContextValue | null>(null);

/**
 * Pure merge kernel. Combines the published RunState snapshot with the
 * mirrored log / artifact arrays coming from external SSE consumers.
 *
 * Rules:
 *   - Phase / runId / error / toolCalls / assistantText come from the
 *     published snapshot unchanged. The mirror API deliberately does NOT
 *     surface tool-use or assistant-delta events — those are scoped to
 *     BrainChat's own nested UI.
 *   - logs = [...published.logs, ...extraLogs]. Mirror entries always
 *     render after the published ones in insertion order.
 *   - artifacts: natural-key dedupe. Published rows flow through first (so
 *     a page-owned `useRun()` still wins ordering for matching kinds),
 *     then mirror rows. For each artifact with a non-null natural key the
 *     later writer replaces the earlier one — this is how a
 *     SSE-fed `shill-order(queued)` can be upgraded by a `/api/artifacts`-
 *     hydrated `shill-order(done)` without rendering a duplicate. Artifacts
 *     whose natural key is `null` (heartbeat-tick / heartbeat-decision)
 *     always fall through and stack.
 *
 * Edge case: IDLE_STATE's TypeScript discriminant pins logs/artifacts to
 * `[]`, but we still want the FooterDrawer to render BrainChat-only
 * activity when the page never called `useRun()`. We widen the returned
 * shape to `RunState` by casting through the idle discriminant — the
 * runtime carries whatever arrays we pass.
 */
export function mergeRunState(
  published: RunState,
  extraLogs: readonly LogEvent[],
  extraArtifacts: readonly Artifact[],
): RunState {
  if (extraLogs.length === 0 && extraArtifacts.length === 0) {
    return published;
  }
  const mergedLogs: LogEvent[] = [...published.logs, ...extraLogs];
  const mergedArtifacts = dedupeArtifacts([...published.artifacts, ...extraArtifacts]);
  return {
    ...published,
    logs: mergedLogs,
    artifacts: mergedArtifacts,
  } as RunState;
}

/**
 * Natural-key dedupe for an artifact sequence. Later entries with the same
 * natural key replace earlier ones (status transitions, layer-2 anchor
 * stamping, meme-image metadata fills). Null-keyed entries are always kept
 * so heartbeat ticks / decisions stack verbatim.
 *
 * Exported so `useBrainChat` / other consumers can use the same dedupe
 * logic on their own internal collections without re-implementing the
 * key derivation.
 */
export function dedupeArtifacts(input: readonly Artifact[]): Artifact[] {
  const seen = new Map<string, number>();
  const out: Artifact[] = [];
  for (const artifact of input) {
    const key = deriveNaturalKey(artifact);
    if (key === null) {
      out.push(artifact);
      continue;
    }
    const existingIdx = seen.get(key);
    if (existingIdx === undefined) {
      seen.set(key, out.length);
      out.push(artifact);
    } else {
      // Later writer wins — replace in place so ordering relative to other
      // artifacts stays stable (the earliest appearance anchors the slot).
      out[existingIdx] = artifact;
    }
  }
  return out;
}

export function RunStateProvider({ children }: { children: ReactNode }): ReactElement {
  const [published, setPublished] = useState<RunState>(IDLE_STATE);
  const [extraLogs, setExtraLogs] = useState<LogEvent[]>([]);
  const [extraArtifacts, setExtraArtifacts] = useState<Artifact[]>([]);
  const [brainChatActivity, setBrainChatActivityState] =
    useState<BrainChatActivity>(EMPTY_BRAIN_CHAT_ACTIVITY);

  const publish = useCallback((state: RunState) => setPublished(state), []);
  const pushLog = useCallback((log: LogEvent) => {
    setExtraLogs((prev) => [...prev, log]);
  }, []);
  const pushArtifact = useCallback((artifact: Artifact) => {
    setExtraArtifacts((prev) => [...prev, artifact]);
  }, []);
  const resetMirror = useCallback(() => {
    setExtraLogs([]);
    setExtraArtifacts([]);
  }, []);
  const setBrainChatActivity = useCallback((next: BrainChatActivity) => {
    setBrainChatActivityState(next);
  }, []);

  const runState = useMemo(
    () => mergeRunState(published, extraLogs, extraArtifacts),
    [published, extraLogs, extraArtifacts],
  );

  const value = useMemo<RunStateContextValue>(
    () => ({
      runState,
      publish,
      pushLog,
      pushArtifact,
      resetMirror,
      brainChatActivity,
      setBrainChatActivity,
    }),
    [
      runState,
      publish,
      pushLog,
      pushArtifact,
      resetMirror,
      brainChatActivity,
      setBrainChatActivity,
    ],
  );

  return <RunStateContext.Provider value={value}>{children}</RunStateContext.Provider>;
}

/**
 * Read the merged run state (useRun's published snapshot + BrainChat
 * mirror extras). Returns `IDLE_STATE` outside a provider so consumers
 * stay functional even on routes that never wrap <RunStateProvider />.
 */
export function useRunState(): RunState {
  const ctx = useContext(RunStateContext);
  return ctx?.runState ?? IDLE_STATE;
}

/**
 * Publish the current run state into the context. Pages that own a
 * `useRun()` instance call this once; the `<BrainIndicator />` mounted
 * inside the Header in `app/layout.tsx` then reflects it automatically.
 * Outside a provider this is a no-op — a page that forgot to wrap in
 * <RunStateProvider /> silently fails to light up the indicator rather
 * than crashing mid-render.
 */
export function usePublishRunState(state: RunState): void {
  const ctx = useContext(RunStateContext);
  const publish = ctx?.publish;
  useEffect(() => {
    if (publish) publish(state);
  }, [state, publish]);
}

/**
 * Imperative mirror API for SSE consumers outside the page's `useRun()`
 * instance (notably `useBrainChat`). Lets them splice their live log and
 * artifact events into the shared RunState so the FooterDrawer tabs
 * reflect brain-chat activity.
 *
 * Outside a provider every method is a no-op — same fail-soft contract
 * as `usePublishRunState`.
 */
export interface RunStateMirror {
  readonly pushLog: (log: LogEvent) => void;
  readonly pushArtifact: (artifact: Artifact) => void;
  readonly resetMirror: () => void;
  /**
   * Publish the latest BrainChat activity snapshot (status + persona +
   * event count). No-op outside a provider so the hook does not need to
   * guard call sites. See `BrainChatActivity` for the contract.
   */
  readonly setBrainChatActivity: (activity: BrainChatActivity) => void;
}

const NO_OP_MIRROR: RunStateMirror = {
  pushLog: () => {
    /* no-op outside provider */
  },
  pushArtifact: () => {
    /* no-op outside provider */
  },
  resetMirror: () => {
    /* no-op outside provider */
  },
  setBrainChatActivity: () => {
    /* no-op outside provider */
  },
};

export function useRunStateMirror(): RunStateMirror {
  const ctx = useContext(RunStateContext);
  // Memoise the returned surface so callers that put the mirror in a
  // useCallback dep array (e.g. useBrainChat.send) do not have their
  // callback identity churn on every provider render.
  return useMemo<RunStateMirror>(() => {
    if (!ctx) return NO_OP_MIRROR;
    return {
      pushLog: ctx.pushLog,
      pushArtifact: ctx.pushArtifact,
      resetMirror: ctx.resetMirror,
      setBrainChatActivity: ctx.setBrainChatActivity,
    };
  }, [ctx]);
}

/**
 * Read the latest BrainChat activity snapshot. Outside a provider returns
 * `EMPTY_BRAIN_CHAT_ACTIVITY` so consumers (BrainIndicator / BrainPanel)
 * still render the idle pill without special-casing the unwrapped test /
 * SSR path.
 */
export function useBrainChatActivity(): BrainChatActivity {
  const ctx = useContext(RunStateContext);
  return ctx?.brainChatActivity ?? EMPTY_BRAIN_CHAT_ACTIVITY;
}
