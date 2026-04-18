'use client';

/**
 * /market — Shilling Market route (V4.7-P4 Task 9).
 *
 * Pre-V4.7 this page rendered a 2-column grid (inline order form + right-
 * side ShillOrderPanel + LogPanel). That flat layout has been retired in
 * favour of the same 6-scene skeleton used on /:
 *
 *   HeroScene (Market copy) → ProblemScene → SolutionScene →
 *   ProductScene(kind='order') → (Vision + Evidence land in V4.7-P5)
 *   → DevLogsDrawer
 *
 * OrderPanel inside ProductScene owns the tokenAddr / tokenSymbol /
 * creatorBrief form, validation, submission, processing / posted / failed /
 * error views — so this page no longer carries any form logic.
 * ShillOrderPanel + LogPanel are still mounted, but inside DevLogsDrawer
 * (Orders / Logs tabs).
 *
 * Page-level responsibility is down to three things:
 *   - Own a single `useRun()` instance and share it across ProductScene +
 *     DevLogsDrawer so everyone renders from the same live run state.
 *   - Override the HeroScene copy + anchor targets so Market reads as an
 *     order-first surface.
 *   - Lift terminal errors into the Toast banner.
 *
 * Hero CTA trade-off (documented): HeroScene's PRIMARY CTA labelled
 * "Launch a token" is a Home-page concept. On Market we pass
 * `launchAnchorId="order"` so both CTAs scroll to the OrderPanel anchor.
 * The PRIMARY label is slightly off-semantic here but does not break any
 * acceptance criteria (AC-P4.7-1 pins CTA order on / only). A polish pass
 * in V4.7-P5 may extend HeroScene with a Market-specific primary label.
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
import { HERO_PITCH_MARKET, HERO_SUBCOPY_MARKET } from '@/lib/narrative-copy';

export default function MarketPage(): React.ReactElement {
  const hookResult = useRun();
  const { state } = hookResult;

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
        {/* Shared <Header /> is mounted at the layout level (V4.7-P1 Task 4).
            Market Hero overrides pitch + subcopy + anchor targets; see the
            trade-off note in the file header re: PRIMARY CTA label. */}
        <HeroScene
          pitch={HERO_PITCH_MARKET}
          subcopy={HERO_SUBCOPY_MARKET}
          launchAnchorId="order"
          orderHref="#order"
        />
        <ProblemScene />
        <SolutionScene />
        <ProductScene kind="order" runController={hookResult} />
        <VisionScene />
        <EvidenceScene />
        <footer className="border-t border-border-default pt-2 text-[11px] text-fg-tertiary">
          <span className="font-[family-name:var(--font-mono)]">
            Four.Meme AI Sprint · Phase 4.6 Shilling Market · base-sepolia
          </span>
        </footer>
      </main>
      <DevLogsDrawer runState={state} host="market" />
      <Toast message={toastMessage} onDismiss={clearToast} />
    </>
  );
}
