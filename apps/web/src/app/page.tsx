'use client';

/**
 * Home page — StickyStage scrollytelling shell + TopBar mount
 * (memind-scrollytelling-rebuild P0 Task 1 + AC-MSR-3).
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
 * `REAL_COMPS` overrides it. TOC / Watermark / FooterDrawer / BrainPanel
 * mounts land in the next P0 tasks.
 *
 * The TopBar (<Header />) mounts here (not layout.tsx) because it needs live
 * `activeIdx` / `progress` props from the StickyStage scroll chain. The
 * RunStateProvider still lives in layout.tsx, so the TopBar's embedded
 * <BrainIndicator /> reads run state through context.
 */
import { useEffect, useState, type ReactElement } from 'react';
import { Ch1Hero } from '@/components/chapters/ch1-hero';
import { Header } from '@/components/header';
import { StickyStage, type StickyStageChapter } from '@/components/sticky-stage';
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

  return (
    <>
      <Header
        activeIdx={activeIdx}
        total={CHAPTERS.length}
        progress={progress}
        runState={hookResult.state}
        // BrainPanel open-state handler lands in P0-15; wire a no-op for now
        // so the button still mounts and the TOKEN BRAIN pill renders.
        onBrainClick={() => {}}
      />
      <div className="scroll-slot" style={{ height: totalScrollH }}>
        <StickyStage chapters={CHAPTERS} scrollY={scrollY} vh={vh} />
      </div>
    </>
  );
}
