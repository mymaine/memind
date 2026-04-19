'use client';

/**
 * RunState context + provider + publishing hook.
 *
 * Shape of the problem: <Header /> (and the <BrainIndicator /> it mounts)
 * is mounted in `app/layout.tsx` so it appears on every route. But the
 * live `RunState` lives inside each page's `useRun()` instance. React
 * context only flows downward, so we hoist a provider above both the
 * Header and the pages, let the pages call `usePublishRunState(state)`
 * once per render, and have the indicator read the latest published value
 * via `useRunState()`.
 *
 * Why we are not refactoring `useRun`: the V4.7-P4 brief explicitly
 * forbids it. This file sits beside `useRun`, not inside it — pages keep
 * owning their `useRun` instance, and publishing is a one-line opt-in.
 *
 * Fallback behaviour: consumers that render outside a provider (e.g. the
 * `/demo/glyph` sandbox, or an unmounted test fixture) read `IDLE_STATE`
 * instead of crashing. `usePublishRunState` is a no-op outside a provider
 * — publishing on a page that forgot to mount the provider silently does
 * nothing rather than throwing mid-render.
 *
 * Design lock: docs/decisions/2026-04-19-brain-agent-positioning.md §Scope
 * — the `<BrainIndicator /> + <BrainPanel />` pair is the entire
 * "Brain is here" surface (post memind-scrollytelling-rebuild AC-MSR-7;
 * the prior <BrainDetailModal /> was retired with the slide-in panel),
 * and it MUST reflect real live run state for the demo climax to land.
 */
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { IDLE_STATE, type RunState } from './useRun-state';

interface RunStateContextValue {
  readonly runState: RunState;
  readonly publish: (state: RunState) => void;
}

const RunStateContext = createContext<RunStateContextValue | null>(null);

export function RunStateProvider({ children }: { children: ReactNode }) {
  const [runState, setRunState] = useState<RunState>(IDLE_STATE);
  const publish = useCallback((state: RunState) => setRunState(state), []);
  return (
    <RunStateContext.Provider value={{ runState, publish }}>{children}</RunStateContext.Provider>
  );
}

/**
 * Read the current published run state. Returns `IDLE_STATE` outside a
 * provider so consumers stay functional even on routes that never wrap
 * <RunStateProvider />.
 */
export function useRunState(): RunState {
  const ctx = useContext(RunStateContext);
  return ctx?.runState ?? IDLE_STATE;
}

/**
 * Publish the current run state into the context. Pages that own a
 * `useRun()` instance call this once; the `<BrainIndicator />` mounted
 * inside the Header in `app/layout.tsx` then reflects it automatically.
 * Outside a provider
 * this is a no-op — a page that forgot to wrap in <RunStateProvider />
 * silently fails to light up the indicator rather than crashing mid-render.
 */
export function usePublishRunState(state: RunState): void {
  const ctx = useContext(RunStateContext);
  const publish = ctx?.publish;
  useEffect(() => {
    if (publish) publish(state);
  }, [state, publish]);
}
