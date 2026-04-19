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
import { useCallback, useEffect, useState, type ReactElement } from 'react';
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
import { SectionToc } from '@/components/section-toc';
import { StickyStage, type StickyStageChapter } from '@/components/sticky-stage';
import { Watermark } from '@/components/watermark';
import { useActiveChapter } from '@/hooks/useActiveChapter';
import { useRun } from '@/hooks/useRun';
import { usePublishRunState } from '@/hooks/useRunStateContext';
import { useScrollY } from '@/hooks/useScrollY';
import { CHAPTER_META } from '@/lib/chapters';

const SLOT_VH = 2.2;

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

  const slotPx = SLOT_VH * vh;
  const totalScrollH = CHAPTERS.length * slotPx + vh;

  // TOC click handler - scrolls to the mid-hold window of the selected
  // chapter so the target is fully visible on arrival (see spec §Anchor Jump
  // port from app.jsx:onJump). Browser smooth-scroll handles easing.
  const onJump = useCallback((i: number) => {
    if (typeof window === 'undefined') return;
    const px = SLOT_VH * window.innerHeight;
    window.scrollTo({ top: i * px + px * 0.3, behavior: 'smooth' });
  }, []);

  const currentTitle = CHAPTERS[activeIdx]?.title ?? '';

  return (
    <>
      <Header
        activeIdx={activeIdx}
        total={CHAPTERS.length}
        progress={progress}
        runState={hookResult.state}
        onBrainClick={() => openBrain()}
      />
      <SectionToc activeIdx={activeIdx} onJump={onJump} />
      <div className="scroll-slot" style={{ height: totalScrollH }}>
        <StickyStage chapters={CHAPTERS} scrollY={scrollY} vh={vh} />
      </div>
      <Watermark activeIdx={activeIdx} total={CHAPTERS.length} title={currentTitle} />
      <BrainPanel
        open={brainOpen}
        onClose={closeBrain}
        runState={hookResult.state}
        initialDraft={brainDraft}
      />
      <FooterDrawer runState={hookResult.state} />
    </>
  );
}
