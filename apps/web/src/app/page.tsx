'use client';

/**
 * Home page — StickyStage scrollytelling shell + TopBar / TOC / Watermark
 * (memind-scrollytelling-rebuild AC-MSR-1/-3/-4/-5).
 *
 * All 11 chapters are absolutely positioned inside a single sticky viewport
 * (`.sticky-viewport`) and cross-fade in place as the user scrolls through
 * the surrounding `.scroll-slot` spacer. The spacer's height reserves
 * `SLOT_VH * vh` pixels per chapter plus one tail `vh`, so the sticky pin
 * stays active for the entire narrative. Opacity / scale / blur are driven
 * by a single `useScrollY()` → `StickyStage` chain — no translateY anywhere.
 *
 * Real chapter components replace placeholders one-by-one in P0 Tasks 3-13;
 * each slot currently gets a <ChPlaceholder /> tile unless an entry in
 * `REAL_COMPS` overrides it. FooterDrawer / BrainPanel mounts land in the
 * next P0 tasks.
 *
 * Shell composition (AC-MSR-3/-4/-5):
 *   - <Header /> (TopBar) - fixed top, reads activeIdx + progress
 *   - <SectionToc /> - fixed left, click to jump to mid-hold of chapter
 *   - <StickyStage /> - the cross-fading viewport of chapter tiles
 *   - <Watermark /> - fixed bottom-right chapter stamp
 *
 * The TopBar mounts here (not layout.tsx) because it needs live
 * `activeIdx` / `progress` props from the StickyStage scroll chain. The
 * RunStateProvider still lives in layout.tsx, so the TopBar's embedded
 * <BrainIndicator /> reads run state through context.
 */
import { useCallback, useEffect, useState, type CSSProperties, type ReactElement } from 'react';
import { Ch1Hero } from '@/components/chapters/ch1-hero';
import { Ch2Problem } from '@/components/chapters/ch2-problem';
import { Ch3Solution } from '@/components/chapters/ch3-solution';
import { Ch4Brain } from '@/components/chapters/ch4-brain';
import { Ch5Launch } from '@/components/chapters/ch5-launch';
import { Ch6Shill } from '@/components/chapters/ch6-shill';
import { Ch7Heartbeat } from '@/components/chapters/ch7-heartbeat';
import { Ch8TakeRate } from '@/components/chapters/ch8-take-rate';
import { Ch9SKU } from '@/components/chapters/ch9-sku';
import { Ch10Phase } from '@/components/chapters/ch10-phase';
import { Ch11Evidence } from '@/components/chapters/ch11-evidence';
import { BrainPanel } from '@/components/brain-panel';
import { FooterDrawer } from '@/components/footer-drawer';
import { Header } from '@/components/header';
import { ScanlinesOverlay } from '@/components/scanlines-overlay';
import { SectionToc } from '@/components/section-toc';
import { StickyStage, type StickyStageChapter } from '@/components/sticky-stage';
import { TweaksPanel, TWEAK_DEFAULTS, type TweaksState } from '@/components/tweaks-panel';
import { Watermark } from '@/components/watermark';
import { useActiveChapter } from '@/hooks/useActiveChapter';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { useRun } from '@/hooks/useRun';
import { usePublishRunState } from '@/hooks/useRunStateContext';
import { useScrollY } from '@/hooks/useScrollY';
import { useTweakMode } from '@/hooks/useTweakMode';
import {
  CHAPTER_META,
  SLOT_VH,
  chapterScrollTarget,
  resolveChapterIndexFromHash,
} from '@/lib/chapters';

/**
 * Shell placeholder for a chapter. Renders a centred mono label so the
 * scrollytelling engine can be exercised end-to-end before the real Ch1-11
 * components land. Styled off the ported `.ch` primitive so the spacing +
 * max-width match the real chapters.
 */
function ChPlaceholder({ title }: { title: string }): ReactElement {
  return (
    <div
      className="ch"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        height: '100%',
      }}
    >
      <div className="mono" style={{ color: 'var(--fg-tertiary)', letterSpacing: 2, fontSize: 14 }}>
        {title} · placeholder
      </div>
    </div>
  );
}

function makePlaceholderComp(label: string): StickyStageChapter['Comp'] {
  // Wrap ChPlaceholder so every chapter keeps the required `p: number` prop
  // shape required by StickyStageChapter.Comp — interior progress is simply
  // ignored by the placeholder tile.
  const PlaceholderComp = function Placeholder(_props: { p: number }): ReactElement {
    return <ChPlaceholder title={label} />;
  };
  PlaceholderComp.displayName = `ChPlaceholder(${label})`;
  return PlaceholderComp;
}

// Real chapter components land in P0 Tasks 3-13 one-by-one. Until then each
// slot uses <ChPlaceholder /> keyed off CHAPTER_META so the StickyStage
// engine still has 11 tiles to cross-fade and the TOC / Watermark stay in
// sync. `REAL_COMPS` is the escape hatch — its entries override the
// placeholder for any chapter whose real component has shipped.
const REAL_COMPS: Partial<Record<string, StickyStageChapter['Comp']>> = {
  hero: Ch1Hero,
  problem: Ch2Problem,
  solution: Ch3Solution,
  'brain-architecture': Ch4Brain,
  'launch-demo': Ch5Launch,
  'order-shill': Ch6Shill,
  'heartbeat-demo': Ch7Heartbeat,
  'take-rate': Ch8TakeRate,
  'sku-matrix': Ch9SKU,
  'phase-map': Ch10Phase,
  evidence: Ch11Evidence,
};

const CHAPTERS: readonly StickyStageChapter[] = CHAPTER_META.map((m, idx) => ({
  id: m.id,
  title: m.title,
  Comp: REAL_COMPS[m.id] ?? makePlaceholderComp(`CH${String(idx + 1).padStart(2, '0')} ${m.title}`),
}));

export default function HomePage(): ReactElement {
  const hookResult = useRun();
  // Publish run state so the TopBar's <BrainIndicator /> reflects live
  // ONLINE/IDLE + active persona through RunStateContext.
  usePublishRunState(hookResult.state);

  // BrainPanel open-state (AC-MSR-7). Clicking the TopBar brain indicator
  // flips `brainOpen` and optionally seeds the composer via `brainDraft`
  // so Hero CTAs (`/launch `, `/order `) can pre-fill the textarea. The
  // draft is nullable so an explicit-null open resets the composer.
  const [brainOpen, setBrainOpen] = useState<boolean>(false);
  const [brainDraft, setBrainDraft] = useState<string | undefined>(undefined);
  const openBrain = useCallback((draft?: string): void => {
    setBrainDraft(draft);
    setBrainOpen(true);
  }, []);
  const closeBrain = useCallback((): void => {
    setBrainOpen(false);
  }, []);

  // Viewport height state. SSR initialises to a sane 800 so the first paint
  // reserves a plausible scroll height; a post-mount effect syncs with the
  // real window and listens for resize.
  const [vh, setVh] = useState<number>(() =>
    typeof window !== 'undefined' ? window.innerHeight : 800,
  );
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onResize = (): void => setVh(window.innerHeight);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const scrollY = useScrollY();
  const { activeIdx, progress } = useActiveChapter(scrollY, vh, CHAPTERS.length);
  // System-level `prefers-reduced-motion: reduce` (AC-MSR-14). Merged
  // with the Tweaks panel override below — if either source asks for
  // reduced motion, <StickyStage /> short-circuits to the final state.
  const systemReducedMotion = useReducedMotion();

  // Tweaks state (AC-MSR-12). The panel is only mounted when
  // `useTweakMode()` reports true (parent posted `__activate_edit_mode`
  // or the URL carries `?edit=1`); the tweaks state itself lives here
  // so the rest of the page (scanlines overlay, accent CSS var, the
  // stage's reducedMotion prop) can react to it even when the panel
  // is hidden.
  const tweakActive = useTweakMode();
  const [tweaks, setTweaks] = useState<TweaksState>(TWEAK_DEFAULTS);
  const setTweak = useCallback(<K extends keyof TweaksState>(k: K, v: TweaksState[K]): void => {
    setTweaks((prev) => ({ ...prev, [k]: v }));
  }, []);
  const reducedMotion = systemReducedMotion || tweaks.reduceMotion;
  // Applied to the root element as a CSS variable so the ported
  // `--accent` reference (TopBar, watermark-title, chapter accents)
  // picks up the swatch change live.
  const accentStyle: CSSProperties = { ['--accent' as never]: tweaks.accent };

  // Scroll-slot height uses a pure CSS `calc(... * 100vh)` string so SSR
  // and client emit identical markup — avoids the Next.js hydration
  // mismatch we saw when the JS-computed `totalScrollH` pixel value
  // differed between the SSR default (vh=800) and the real client vh
  // (e.g. 1366 on a 15" laptop). The browser resolves the calc against
  // the live viewport on every layout pass, so resize needs no JS.
  const scrollSlotHeight = `calc((${CHAPTERS.length} * ${SLOT_VH} + 1) * 100vh)`;

  // TOC click handler - scrolls to the mid-hold window of the selected
  // chapter so the target is fully visible on arrival (see spec §Anchor Jump
  // port from app.jsx:onJump). Browser smooth-scroll handles easing.
  const onJump = useCallback((i: number) => {
    if (typeof window === 'undefined') return;
    window.scrollTo({
      top: chapterScrollTarget(i, window.innerHeight),
      behavior: 'smooth',
    });
  }, []);

  // Anchor-jump effect (AC-MSR-10). The single sticky stage replaces the
  // old per-section `<section id>` anchors, so `/market → /#order-shill`
  // and in-page `<a href="#evidence">` jumps need a JS hop that translates
  // the hash into a scroll target at mid-hold. Listening to `hashchange`
  // lets deep links keep working after the first paint too.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const jumpToHash = (): void => {
      const idx = resolveChapterIndexFromHash(window.location.hash);
      if (idx === null) return;
      // `auto` (not smooth) on first paint so a deep-linked load lands
      // instantly instead of scrolling in. Subsequent `hashchange` events
      // (user clicks in-page anchor) get smooth.
      window.scrollTo({ top: chapterScrollTarget(idx, window.innerHeight), behavior: 'auto' });
    };
    // Delay one frame so StickyStage has measured vh and painted.
    const raf = requestAnimationFrame(jumpToHash);
    const onHashChange = (): void => {
      const idx = resolveChapterIndexFromHash(window.location.hash);
      if (idx === null) return;
      window.scrollTo({
        top: chapterScrollTarget(idx, window.innerHeight),
        behavior: 'smooth',
      });
    };
    window.addEventListener('hashchange', onHashChange);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('hashchange', onHashChange);
    };
  }, []);

  const currentTitle = CHAPTERS[activeIdx]?.title ?? '';

  return (
    <div style={accentStyle}>
      <Header
        activeIdx={activeIdx}
        total={CHAPTERS.length}
        progress={progress}
        runState={hookResult.state}
        onBrainClick={() => openBrain()}
      />
      <SectionToc activeIdx={activeIdx} onJump={onJump} />
      {/*
       * CRT scanlines overlay (AC-MSR-13). On by default per the
       * design-handoff TWEAK_DEFAULTS.scanlines=true, but suppressed
       * whenever reduced-motion is on (OS or Tweaks panel) — the
       * flicker of the repeating gradient stacks poorly with
       * motion-sensitivity.
       */}
      <ScanlinesOverlay enabled={tweaks.scanlines && !reducedMotion} />
      <div className="scroll-slot" style={{ height: scrollSlotHeight }}>
        <StickyStage
          chapters={CHAPTERS}
          scrollY={scrollY}
          vh={vh}
          reducedMotion={reducedMotion}
          activeIdx={activeIdx}
        />
      </div>
      <Watermark activeIdx={activeIdx} total={CHAPTERS.length} title={currentTitle} />
      <BrainPanel
        open={brainOpen}
        onClose={closeBrain}
        runState={hookResult.state}
        initialDraft={brainDraft}
      />
      {/*
       * FooterDrawer intentionally receives no `runState` prop so it
       * subscribes to the merged RunStateContext via `useRunState()`.
       * That context mirrors BrainChat SSE events (logs + artifacts)
       * in addition to the useRun-published state — without this the
       * Memind demo's Logs / Artifacts / Console tabs stay empty while
       * BrainPanel is actively streaming. See
       * `hooks/useRunStateContext.tsx` docblock for the mirror contract.
       */}
      <FooterDrawer />
      {tweakActive && <TweaksPanel tweaks={tweaks} setTweak={setTweak} />}
    </div>
  );
}
