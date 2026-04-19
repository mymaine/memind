'use client';

/**
 * Home page — immersive single-page surface (immersive-single-page P1 Task 1 /
 * AC-ISP-1 + AC-ISP-2).
 *
 * The pre-pivot structure shipped `/` and `/market` as two parallel
 * 6-scene pages (Hero → Problem → Solution → ProductScene → Vision →
 * Evidence). The pivot collapses both into a single scroll-driven surface
 * whose sections are ordered as narrative → live operation → business →
 * on-chain evidence:
 *
 *   #hero               → reuses <HeroScene />           (narrative)
 *   #problem            → reuses <ProblemScene />        (narrative)
 *   #solution           → reuses <SolutionScene />       (narrative)
 *   #brain-architecture → placeholder (T4 mounts scene)  (narrative)
 *   #launch-demo        → placeholder (T5 mounts scene)  (operation)
 *   #order-shill        → placeholder (T5 mounts scene)  (operation)
 *   #heartbeat-demo     → placeholder (T5 mounts scene)  (operation)
 *   #take-rate          → currently hosts <VisionScene />(business)
 *   #sku-matrix         → placeholder (T4 splits scene)  (business)
 *   #phase-map          → placeholder (T4 splits scene)  (business)
 *   #evidence           → reuses <EvidenceScene />       (trust)
 *
 * Each section is a wrapping `<section id className="scene ...">` in this
 * file. Nested <section> (wrapper + inner scene's own <section>) is valid
 * HTML; the wrapper exists only to expose the stable section id without
 * mutating the scene internals (forbidden by the P1 Task 1 brief). The
 * wrapper carries `.scene scene--revealed` so the page-level `.scene`
 * reveal CSS does not leave the wrapper permanently invisible — the inner
 * scene continues to run its own `useScrollReveal` latch independently.
 *
 * <ProductScene kind="launch" /> is deliberately not mounted in this
 * revision. T5 will replace it with `<LiveLaunchScene />` inside
 * `#launch-demo`. The page still owns a single `useRun()` instance so the
 * shared DevLogsDrawer and the Header's <BrainIndicator /> (via
 * RunStateContext) continue to reflect the live run state once T5 wires
 * the operation panels back in.
 */
import { useCallback, useEffect, useState } from 'react';
import { HeroScene } from '@/components/scenes/hero-scene';
import { ProblemScene } from '@/components/scenes/problem-scene';
import { SolutionScene } from '@/components/scenes/solution-scene';
import { BrainArchitectureScene } from '@/components/scenes/brain-architecture-scene';
import { VisionScene } from '@/components/scenes/vision-scene';
import { EvidenceScene } from '@/components/scenes/evidence-scene';
import { DevLogsDrawer } from '@/components/dev-logs-drawer';
import { SectionToc } from '@/components/section-toc';
import { Toast } from '@/components/toast';
import { useRun } from '@/hooks/useRun';
import { usePublishRunState } from '@/hooks/useRunStateContext';
import { FOOTER_TAGLINE } from '@/lib/narrative-copy';

export default function HomePage(): React.ReactElement {
  const hookResult = useRun();
  const { state } = hookResult;
  // Publish into the layout-level RunStateContext so the Header's
  // <BrainIndicator /> reflects the live run (active persona +
  // online/idle status). No-op outside a provider.
  usePublishRunState(state);

  // Page-level toast surfaces terminal errors (e.g. 409 concurrency) from
  // the shared useRun instance. Panels own their inline error banners; the
  // toast catches anything that reaches the page boundary.
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

  // Wrapper shell class — `scene--revealed` is applied up-front so the
  // page-level `.scene` reveal CSS does not hide the wrapper before the
  // inner scene's own reveal latch fires.
  const wrapperClass = 'scene scene--revealed';
  // Placeholder class — `.scene` only; no reveal latch. Placeholders are
  // empty until T4/T5 mount their scenes, so their opacity:0 default is
  // invisible-either-way.
  const placeholderClass = 'scene';

  return (
    <>
      <div className="mx-auto flex w-full max-w-[1400px] gap-8 px-6">
        {/* Sticky left-side TOC (immersive-single-page P1 Task 2 / AC-ISP-3).
            Hidden on sub-md viewports; the slim Header nav is the fallback. */}
        <SectionToc />

        <main className="flex min-h-[calc(100vh-56px)] flex-1 flex-col gap-12 py-4 pb-20">
          {/* Shared <Header /> is mounted at the layout level (V4.7-P1 Task 4). */}

          {/* ─── Narrative: Hero → Problem → Solution → Brain architecture ──── */}
          <section id="hero" className={wrapperClass}>
            <HeroScene />
          </section>
          <section id="problem" className={wrapperClass}>
            <ProblemScene />
          </section>
          <section id="solution" className={wrapperClass}>
            <SolutionScene />
          </section>
          {/* <BrainArchitectureScene /> owns its own `<section
            id="brain-architecture">` so we mount it directly — wrapping it
            would emit two DOM elements with `id="brain-architecture"` and
            break the TOC anchor. The inner scene runs its own
            useScrollReveal latch. (immersive-single-page P1 Task 4, done) */}
          <BrainArchitectureScene />

          {/* ─── Operation: Launch / Order Shill / Heartbeat live demos ─────── */}
          {/* TODO(immersive-T5): mount <LiveLaunchScene runController={hookResult} />. */}
          <section id="launch-demo" className={placeholderClass} aria-hidden="true" />
          {/* TODO(immersive-T5): mount <LiveOrderScene runController={hookResult} />. */}
          <section id="order-shill" className={placeholderClass} aria-hidden="true" />
          {/* TODO(immersive-T5): mount <LiveHeartbeatScene />. */}
          <section id="heartbeat-demo" className={placeholderClass} aria-hidden="true" />

          {/* ─── Business: take-rate → SKU matrix → phase map ────────────────
            T4 will split <VisionScene /> into three stand-alone scenes
            (take-rate / sku-matrix / phase-map). For now the whole VisionScene
            lives under #take-rate so its take-rate cards, SKU matrix and
            phase map all remain on the page; #sku-matrix and #phase-map are
            empty placeholder anchors that T4 will populate. */}
          <section id="take-rate" className={wrapperClass}>
            <VisionScene />
          </section>
          {/* TODO(immersive-T4): mount <SkuMatrixScene /> once split from <VisionScene />. */}
          <section id="sku-matrix" className={placeholderClass} aria-hidden="true" />
          {/* TODO(immersive-T4): mount <PhaseMapScene /> once split from <VisionScene />. */}
          <section id="phase-map" className={placeholderClass} aria-hidden="true" />

          {/* ─── Trust: on-chain + engineering evidence ───────────────────────
            <EvidenceScene /> already renders its own `<section id="evidence"
            className="scene ...">`, so we mount it directly instead of
            wrapping it — wrapping would emit two DOM elements with
            `id="evidence"` (invalid HTML + duplicate TOC target). */}
          <EvidenceScene />

          <footer className="border-t border-border-default pt-2 text-[11px] text-fg-tertiary">
            <span className="font-[family-name:var(--font-mono)]">{FOOTER_TAGLINE}</span>
          </footer>
        </main>
      </div>
      {/* Drawer is fixed bottom (position:fixed in its own styles), so it
          lives outside <main> and does not participate in the scroll flow. */}
      <DevLogsDrawer runState={state} host="home" />
      <Toast message={toastMessage} onDismiss={clearToast} />
    </>
  );
}
