'use client';

/**
 * LaunchPanel — the productised Home run surface (AC-P4.7-5).
 *
 * Composes four states around the `useRun()` lifecycle, mapped through the
 * pure `deriveLaunchState` reducer:
 *
 *   idle     → "Step 1 · Launch a token" overline + <ThemeInput> (which
 *              internally carries PresetButtons + "Run swarm" CTA).
 *   running  → "Running swarm" overline + <RunProgress> 3-step indicator +
 *              meme thumbnail once the `meme-image` artifact lands.
 *   success  → "Done · deployed" overline + big <MemeImageCard> + $SYMBOL
 *              chip + <ResultPills> (5 explorer pills) + "Run another".
 *   error    → "Error" overline + error banner + "Run another".
 *
 * Composition model:
 *   - The panel is stateful + hook-driven. Tests drive it by passing a
 *     `runController` shaped like `UseRunResult`; production code omits the
 *     prop so `useRun()` takes over.
 *   - The 409 toast + error-banner-in-page logic stays on the page layer
 *     (V4.7-P4 Task 8). This component only owns its own view states.
 *   - `Run another` calls the injected / hooked `resetRun()` — the existing
 *     hook helper closes the SSE, nulls refs, and pushes IDLE_STATE so the
 *     panel naturally re-renders in the `idle` branch.
 *
 * Structural guarantee: `<section id="launch-panel">` is always the outer
 * wrapper so the HeroScene PRIMARY CTA (`#launch-panel`) keeps anchoring
 * regardless of the live state.
 */
import { useMemo, type ReactElement } from 'react';
import type { Artifact } from '@hack-fourmeme/shared';
import { MemeImageCard } from '@/components/meme-image-card';
import { ThemeInput } from '@/components/theme-input';
import { EMPTY_ASSISTANT_TEXT, EMPTY_TOOL_CALLS } from '@/hooks/useRun-state';
import { useRun, type UseRunResult } from '@/hooks/useRun';
import { deriveLaunchState, type LaunchPanelState } from './derive-launch-state';
import { ResultPills } from './result-pills';
import { RunProgress, type RunProgressStep } from './run-progress';

export interface LaunchPanelProps {
  /**
   * Optional `useRun()` injection for tests. Omit in production so the
   * panel hooks into the real SSE lifecycle.
   */
  readonly runController?: UseRunResult;
  readonly className?: string;
}

// Overline style mirrors the spec: "Step 1 · Launch a token" typography
// (font-mono, 11px-ish uppercase, tracking 0.5px, fg-tertiary).
const OVERLINE_CLASS =
  'font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.5px] text-fg-tertiary';

const SECTION_CLASS =
  'flex flex-col gap-4 rounded-[var(--radius-card)] border border-border-default bg-bg-surface p-6';

// Secondary button style for `Run another` — border-default, transparent
// background, hover promotes to accent border. Mirrors the HeroScene
// secondary CTA look without duplicating the anchor/link wrapper.
const SECONDARY_BUTTON_CLASS =
  'inline-flex items-center justify-center rounded-[var(--radius-default)] border border-border-default bg-transparent px-4 py-2 font-[family-name:var(--font-sans-body)] text-[13px] font-medium text-fg-primary transition-colors duration-150 hover:border-accent';

/**
 * Map the reduced running-state step statuses to the shape RunProgress
 * expects. Order is locked to the orchestrator emit sequence (spec §Product-
 * in-Action): Creator → Narrator → Market-maker.
 */
function toProgressSteps(steps: {
  creator: 'idle' | 'running' | 'done';
  narrator: 'idle' | 'running' | 'done';
  marketMaker: 'idle' | 'running' | 'done';
}): readonly RunProgressStep[] {
  return [
    { key: 'creator', label: 'Creator', status: steps.creator },
    { key: 'narrator', label: 'Narrator', status: steps.narrator },
    { key: 'market-maker', label: 'Market-maker', status: steps.marketMaker },
  ];
}

/**
 * Build the artifact list fed to <ResultPills> on the success state. The
 * meme-image is rendered as the big thumbnail card above, so we exclude it
 * from the pill row (avoids duplication) and feed the remaining 5 possible
 * artifacts in the order readers scan: token → deploy tx → creator lore →
 * narrator lore → x402 settle. Any nulls are filtered so partial success
 * sets still render a tight row.
 */
function buildPillArtifacts(state: Extract<LaunchPanelState, { kind: 'success' }>): Artifact[] {
  const list: (Artifact | null)[] = [
    state.bscTokenArtifact,
    state.deployTxArtifact,
    state.creatorLoreArtifact,
    state.narratorLoreArtifact,
    state.x402TxArtifact,
  ];
  return list.filter((a): a is Artifact => a !== null);
}

/**
 * Derive the `$SYMBOL` chip text from the bsc-token label. When the label
 * is missing (partial artifact set) we fall back to a generic `HBNB2026-*`
 * placeholder so the chip never shows up empty. The `$` prefix is always
 * inlined by this function — callers render the string verbatim.
 */
function deriveSymbolChip(state: Extract<LaunchPanelState, { kind: 'success' }>): string {
  const label = state.bscTokenArtifact?.label;
  if (typeof label === 'string' && label.length > 0) {
    return `$${label}`;
  }
  return '$HBNB2026-*';
}

export function LaunchPanel({ runController, className }: LaunchPanelProps): ReactElement {
  // Rules-of-hooks require an unconditional hook call; we always call
  // `useRun()` even when the caller injects a controller (tests pass
  // `runController` + never exercise the hook's live path). The unused
  // return is a trivial cost given React's reconciler already skips the
  // hook body on every render.
  const hookResult = useRun();
  const controller = runController ?? hookResult;
  const { state: runState, startRun, resetRun } = controller;

  const launchState = useMemo<LaunchPanelState>(
    () =>
      deriveLaunchState({
        phase: runState.phase,
        artifacts: runState.phase === 'idle' ? [] : runState.artifacts,
        toolCalls: runState.phase === 'idle' ? EMPTY_TOOL_CALLS : runState.toolCalls,
        assistantText: runState.phase === 'idle' ? EMPTY_ASSISTANT_TEXT : runState.assistantText,
        logs: runState.phase === 'idle' ? [] : runState.logs,
        error: runState.phase === 'error' ? runState.error : null,
      }),
    [runState],
  );

  const containerClass = `${SECTION_CLASS} ${className ?? ''}`.trim();

  return (
    <section id="launch-panel" className={containerClass}>
      {launchState.kind === 'idle' ? (
        <>
          <span className={OVERLINE_CLASS}>Step 1 · Launch a token</span>
          <ThemeInput onRun={startRun} disabled={false} />
        </>
      ) : null}

      {launchState.kind === 'running' ? (
        <>
          <span className={OVERLINE_CLASS}>Running swarm</span>
          <RunProgress
            steps={toProgressSteps(launchState.steps)}
            latestToolUse={launchState.latestToolUse}
          />
          {launchState.memeImageArtifact !== null ? (
            <MemeImageCard artifact={launchState.memeImageArtifact} />
          ) : null}
        </>
      ) : null}

      {launchState.kind === 'success' ? (
        <>
          <span className={OVERLINE_CLASS}>Done · deployed</span>
          <MemeImageCard artifact={launchState.memeImageArtifact} />
          <div className="flex items-center gap-3">
            <span
              data-testid="launch-symbol-chip"
              className="inline-flex items-center rounded-full border border-accent bg-bg-surface px-3 py-1 font-[family-name:var(--font-mono)] text-[12px] font-semibold uppercase tracking-[0.5px] text-accent"
            >
              {deriveSymbolChip(launchState)}
            </span>
          </div>
          <ResultPills artifacts={buildPillArtifacts(launchState)} />
          <div>
            <button
              type="button"
              onClick={resetRun}
              data-testid="launch-run-another"
              className={SECONDARY_BUTTON_CLASS}
            >
              Run another
            </button>
          </div>
        </>
      ) : null}

      {launchState.kind === 'error' ? (
        <>
          <span className={`${OVERLINE_CLASS} text-[color:var(--color-danger)]`}>Error</span>
          <div
            role="alert"
            className="rounded-[var(--radius-card)] border border-[color:var(--color-danger)] p-2 text-[13px] text-fg-primary"
          >
            <span className="font-[family-name:var(--font-mono)] text-fg-tertiary">error · </span>
            {launchState.message}
          </div>
          <div>
            <button
              type="button"
              onClick={resetRun}
              data-testid="launch-run-another"
              className={SECONDARY_BUTTON_CLASS}
            >
              Run another
            </button>
          </div>
        </>
      ) : null}
    </section>
  );
}
