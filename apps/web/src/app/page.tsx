'use client';

/**
 * Home page — sticky-pinned scrollytelling surface.
 *
 * The pre-pivot layout stacked 11 content sections vertically and relied on
 * `useScrollReveal` + `.scene` CSS to fade each one in as it entered the
 * viewport. Evaluator feedback was that the effect still read as "the page
 * is scrolling up" rather than "the camera is fixed and scenes are swapping
 * into focus". This revision rebuilds the surface as a sticky-pinned
 * scrollytelling layout:
 *
 *   ┌─ main                                                          ┐
 *   │   <Chapter ref=slotA>  h-screen, relative                      │
 *   │     <div className="sticky top-[56px] h-[calc(100vh-56px)]">   │
 *   │       <motion.div style={{opacity, scale, filter}}>            │
 *   │         <HeroScene />  (or <section id="hero"> wrapper)        │
 *   │       </motion.div>                                            │
 *   │     </div>                                                     │
 *   │   </Chapter>                                                   │
 *   │   <Chapter ref=slotB>  ...Problem...                           │
 *   │   ...                                                          │
 *   └──────────────────────────────────────────────────────────────── ┘
 *
 * Each chapter reserves one viewport of scroll distance (`h-screen` on the
 * slot) and pins the scene inside it (`sticky top-[56px]`, offset by the
 * Header height). As the viewer scrolls, the next chapter's sticky pin
 * takes over while the current chapter's pin releases — the effect is a
 * cross-fading stack of scenes at a fixed camera. All motion happens
 * in-place via opacity + scale + filter (NO translateY, AC-ISP-7).
 *
 * Scroll progress mapping (per-chapter):
 *   p < 0.25          → fade/scale/blur IN   (0 → 1, 0.92 → 1, 20px → 0)
 *   0.25 ≤ p ≤ 0.75   → fully resolved       (1, 1, 0)
 *   p > 0.75          → fade/scale/blur OUT  (1 → 0, 1 → 1.05, 0 → 20px)
 *
 * This produces the "focus in → hold → focus out" beat user feedback asked
 * for. The legacy `.scene` + `.scene--revealed` CSS still ships in
 * globals.css and is applied by the scene components themselves as a
 * reduced-motion fallback (under `prefers-reduced-motion: reduce`, the
 * motion MotionValues are effectively pinned to 0 progress by the user
 * agent's zero-animation-duration CSS override, but the scene components
 * independently latch to `.scene--revealed` via `useScrollReveal` so the
 * viewer still sees the final composed frame).
 *
 * The 11-section id contract (hero / problem / solution / brain-architecture
 * / launch-demo / order-shill / heartbeat-demo / take-rate / sku-matrix /
 * phase-map / evidence) is preserved unchanged — the scroll anchors, TOC,
 * and `/market#order-shill` redirect all still resolve correctly.
 *
 * Parallel agent note: scene component internals are being edited
 * concurrently (PixelHumanGlyph mount etc). We touch ONLY the wrappers in
 * this file — scene JSX is untouched.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactElement, ReactNode, RefObject } from 'react';
import { motion, useScroll, useTransform } from 'motion/react';
import { HeroScene } from '@/components/scenes/hero-scene';
import { ProblemScene } from '@/components/scenes/problem-scene';
import { SolutionScene } from '@/components/scenes/solution-scene';
import { BrainArchitectureScene } from '@/components/scenes/brain-architecture-scene';
import { LiveLaunchScene } from '@/components/scenes/live-launch-scene';
import { LiveOrderScene } from '@/components/scenes/live-order-scene';
import { LiveHeartbeatScene } from '@/components/scenes/live-heartbeat-scene';
import { VisionScene } from '@/components/scenes/vision-scene';
import { EvidenceScene } from '@/components/scenes/evidence-scene';
import { DevLogsDrawer } from '@/components/dev-logs-drawer';
import { SectionToc } from '@/components/section-toc';
import { Toast } from '@/components/toast';
import { useRun } from '@/hooks/useRun';
import { usePublishRunState } from '@/hooks/useRunStateContext';
import { FOOTER_TAGLINE } from '@/lib/narrative-copy';

/**
 * Single chapter of the scrollytelling surface. Reserves one viewport of
 * vertical scroll distance so the sticky child can pin the scene long enough
 * for the progress-linked motion to read as "focus in → hold → focus out".
 *
 * `useScroll({ target, offset: ['start end', 'end start'] })` returns a
 * MotionValue `p ∈ [0, 1]` where:
 *   p = 0    when the chapter's top edge sits at the viewport bottom
 *   p = 0.5  when the chapter is centred in the viewport
 *   p = 1    when the chapter's bottom edge sits at the viewport top
 *
 * We bracket the curve so the middle 50% (0.25–0.75) is the "resolved"
 * stage where the scene is fully visible. This matches the spec's
 * "focus-in → hold → focus-out" beat.
 *
 * Motion primitives are opacity + scale + filter only — no translateY
 * (AC-ISP-7 explicitly forbids vertical translation to avoid reviving the
 * "page is scrolling" read).
 */
interface ScrollChapterProps {
  readonly children: ReactNode;
  /**
   * Optional outer element tag. For chapters whose scene already owns a
   * `<section id="...">` (brain-architecture / launch-demo / order-shill
   * / heartbeat-demo / evidence), we render the slot as a plain `<div>` so
   * we do not duplicate the id. For chapters that need a wrapper section,
   * the caller wraps `children` in `<section id>` directly — the slot
   * itself stays `<div>` either way.
   */
  readonly slotClassName?: string;
}

function ScrollChapter({ children, slotClassName }: ScrollChapterProps): ReactElement {
  const slotRef = useRef<HTMLDivElement | null>(null);

  // `useScroll` with a `target` ref ties the progress MotionValue to this
  // chapter's scroll position. `offset: ['start end', 'end start']` means
  // progress 0 = slot's top at viewport's bottom, progress 1 = slot's
  // bottom at viewport's top (a full "scene traverses viewport" pass).
  const { scrollYProgress } = useScroll({
    target: slotRef as RefObject<HTMLElement>,
    offset: ['start end', 'end start'],
  });

  // Opacity curve — invisible → resolved → invisible.
  // Breakpoints 0 / 0.25 / 0.75 / 1 mirror the spec's focus-in / hold /
  // focus-out beat. The 0.25–0.75 "hold" window is wide enough that even a
  // scroll-happy viewer lingers in full opacity before the next chapter
  // starts fading in.
  const opacity = useTransform(scrollYProgress, [0, 0.25, 0.75, 1], [0, 1, 1, 0]);
  // Scale curve — compress in on entry, neutral during hold, slight
  // expand-past on exit so the scene feels like the camera is pulling
  // forward after the viewer moves on. Amplitude (0.92 → 1 → 1.05) matches
  // the globals.css `.scene` fallback so both paths "feel" the same.
  const scale = useTransform(scrollYProgress, [0, 0.25, 0.75, 1], [0.92, 1, 1, 1.05]);
  // Blur curve — defocus → sharp → defocus. 20px is aggressive enough that
  // the entering/leaving frames read as "out of focus" rather than "small
  // noise". Declared as a template literal so the string interpolation
  // flows through motion's style prop without extra wrapping.
  const blur = useTransform(scrollYProgress, [0, 0.25, 0.75, 1], [20, 0, 0, 20]);
  const filter = useTransform(blur, (b) => `blur(${b}px)`);

  return (
    <div ref={slotRef} className="relative h-screen">
      {/* Sticky pin — offset by the 56px sticky Header so the scene never
          slides under it. h-[calc(100vh-56px)] fills the remaining
          viewport; flex centring ensures the scene is vertically centred
          inside the pin. */}
      <div
        className={`sticky top-[56px] flex h-[calc(100vh-56px)] items-center justify-center ${slotClassName ?? ''}`.trim()}
      >
        <motion.div
          // `will-change` is a hint to the compositor that this element's
          // opacity/transform/filter are animated, so it gets its own
          // layer and the animations stay on the GPU fast-path.
          style={{ opacity, scale, filter, willChange: 'opacity, transform, filter' }}
          className="w-full"
        >
          {children}
        </motion.div>
      </div>
    </div>
  );
}

export default function HomePage(): ReactElement {
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

  return (
    <>
      <div className="mx-auto flex w-full max-w-[1400px] gap-8 px-6">
        {/* Sticky left-side TOC (immersive-single-page P1 Task 2 / AC-ISP-3).
            Hidden on sub-md viewports; the slim Header nav is the fallback. */}
        <SectionToc />

        {/* The scrollytelling column. `relative` anchors the sticky
            children to this element so each chapter's pin is bounded by
            its own slot, not by the overall page. `pb-20` preserves the
            original tail gap above the footer. */}
        <main className="relative flex-1 pb-20">
          {/* Shared <Header /> is mounted at the layout level (V4.7-P1 Task 4). */}

          {/* ─── Narrative: Hero → Problem → Solution → Brain architecture ────
              HeroScene / ProblemScene / SolutionScene do NOT emit their own
              `<section id>`, so we wrap them in one here. BrainArchitectureScene
              owns its own `<section id="brain-architecture">` so we mount it
              directly inside the slot (wrapping it would duplicate the id and
              break the TOC anchor). */}
          <ScrollChapter>
            <section id="hero">
              <HeroScene />
            </section>
          </ScrollChapter>
          <ScrollChapter>
            <section id="problem">
              <ProblemScene />
            </section>
          </ScrollChapter>
          <ScrollChapter>
            <section id="solution">
              <SolutionScene />
            </section>
          </ScrollChapter>
          <ScrollChapter>
            <BrainArchitectureScene />
          </ScrollChapter>

          {/* ─── Operation: Launch / Order Shill / Heartbeat live demos ───────
              Each live-demo scene owns its own `<section id>` so they mount
              directly inside the slot. Skeletons carry a `brain-chat-slot-*`
              placeholder that BRAIN-P5 will swap for
              `<BrainChat scope="launch|order|heartbeat" />`. `hookResult` is
              intentionally NOT threaded in: the shared `useRun()` instance is
              retained on this page so the DevLogsDrawer + BrainIndicator keep
              reflecting the live run; BRAIN-P5 decides whether the BrainChat
              embeds need the controller prop once they land. */}
          <ScrollChapter>
            <LiveLaunchScene />
          </ScrollChapter>
          <ScrollChapter>
            <LiveOrderScene />
          </ScrollChapter>
          <ScrollChapter>
            <LiveHeartbeatScene />
          </ScrollChapter>

          {/* ─── Business: take-rate → SKU matrix → phase map ────────────────
              T4 will split <VisionScene /> into three stand-alone scenes
              (take-rate / sku-matrix / phase-map). For now the whole
              VisionScene lives under #take-rate; #sku-matrix and #phase-map
              are empty placeholder anchors that T4 will populate. We still
              reserve a scroll chapter for each so the TOC anchor jumps land
              on a pinned frame instead of a zero-height gap. */}
          <ScrollChapter>
            <section id="take-rate">
              <VisionScene />
            </section>
          </ScrollChapter>
          {/* TODO(immersive-T4): mount <SkuMatrixScene /> once split from <VisionScene />. */}
          <ScrollChapter>
            <section id="sku-matrix" aria-hidden="true" />
          </ScrollChapter>
          {/* TODO(immersive-T4): mount <PhaseMapScene /> once split from <VisionScene />. */}
          <ScrollChapter>
            <section id="phase-map" aria-hidden="true" />
          </ScrollChapter>

          {/* ─── Trust: on-chain + engineering evidence ───────────────────────
              <EvidenceScene /> already renders its own
              `<section id="evidence">`, so we mount it directly inside the
              slot — wrapping would duplicate the id. */}
          <ScrollChapter>
            <EvidenceScene />
          </ScrollChapter>

          <footer className="border-t border-border-default pt-2 text-[11px] text-fg-tertiary">
            <span className="font-[family-name:var(--font-mono)]">{FOOTER_TAGLINE}</span>
          </footer>
        </main>
      </div>
      {/* Drawer is fixed bottom (position:fixed in its own styles), so it
          lives outside <main> and does not participate in the scroll flow.
          BRAIN-P5 Task 4 threads the shared useRun() controller through so
          the Panels fallback tab can drive LaunchPanel + OrderPanel directly.
          Note: the drawer's collapsed form is a thin strip (~40px) and the
          sticky scenes reserve their own pin height, so the drawer does
          not occlude scene content unless the user explicitly expands it. */}
      <DevLogsDrawer runState={state} host="home" runController={hookResult} />
      <Toast message={toastMessage} onDismiss={clearToast} />
    </>
  );
}
