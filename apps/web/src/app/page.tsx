'use client';

/**
 * Home page — 6-scene skeleton (V4.7-P4 Task 8).
 *
 * The pre-V4.7 8-panel flat layout (ThemeInput + ArchitectureDiagram + view
 * toggle + LogPanel/TimelineView + TxList + AnchorLedgerPanel +
 * HeartbeatSection) has been retired in favour of the narrative scene chain:
 *
 *   HeroScene → ProblemScene → SolutionScene → ProductScene(kind='launch')
 *   → (Vision + Evidence land in V4.7-P5) → DevLogsDrawer
 *
 * The page owns a single `useRun()` instance so:
 *   - LaunchPanel (inside ProductScene) drives token launches through it.
 *   - DevLogsDrawer reflects the same live run state (logs / artifacts / tx).
 *   - The page-level error→Toast effect observes the same phase without
 *     needing a second hook subscription.
 *
 * HeartbeatSection still owns its own independent `useRun()` inside the
 * drawer (AC-V2-4 deliberate decoupling — user pastes the BSC address
 * manually), so it is not affected by this page-level state.
 */
import { useCallback, useEffect, useState } from 'react';
import { HeroScene } from '@/components/scenes/hero-scene';
import { ProblemScene } from '@/components/scenes/problem-scene';
import { SolutionScene } from '@/components/scenes/solution-scene';
import { ProductScene } from '@/components/scenes/product-scene';
import { VisionScene } from '@/components/scenes/vision-scene';
import { EvidenceScene } from '@/components/scenes/evidence-scene';
import { DevLogsDrawer } from '@/components/dev-logs-drawer';
import { Toast } from '@/components/toast';
import { useRun } from '@/hooks/useRun';

export default function HomePage(): React.ReactElement {
  const hookResult = useRun();
  const { state } = hookResult;

  // V2-P5 Task 6: surface 409 concurrency (and any other terminal) errors as
  // a toast. The page-level error banner previously sat next to ThemeInput;
  // LaunchPanel now owns that banner internally, so the toast is the only
  // page-level responsibility left.
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const errorMessage = state.phase === 'error' ? state.error : null;
  useEffect(() => {
    if (errorMessage !== null && errorMessage.length > 0) {
      setToastMessage(errorMessage);
    }
  }, [errorMessage]);
  const clearToast = useCallback(() => {
    setToastMessage(null);
  }, []);

  return (
    <>
      <main className="mx-auto flex min-h-[calc(100vh-56px)] max-w-[1400px] flex-col gap-12 px-6 py-4 pb-20">
        {/* Shared <Header /> is mounted at the layout level (V4.7-P1 Task 4). */}
        <HeroScene />
        <ProblemScene />
        <SolutionScene />
        <ProductScene kind="launch" runController={hookResult} />
        <VisionScene />
        <EvidenceScene />
        <footer className="border-t border-border-default pt-2 text-[11px] text-fg-tertiary">
          <span className="font-[family-name:var(--font-mono)]">
            Four.Meme AI Sprint · submission 2026-04-22 UTC 15:59
          </span>
        </footer>
      </main>
      {/* Drawer is fixed bottom (position:fixed in its own styles), so it
          lives outside <main> and does not participate in the scroll flow. */}
      <DevLogsDrawer runState={state} host="home" />
      <Toast message={toastMessage} onDismiss={clearToast} />
    </>
  );
}
