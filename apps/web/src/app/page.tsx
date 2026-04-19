'use client';

/**
 * Home page — StickyStage scrollytelling shell
 * (memind-scrollytelling-rebuild P0 Task 1).
 *
 * All 11 chapters are absolutely positioned inside a single sticky viewport
 * (`.sticky-viewport`) and cross-fade in place as the user scrolls through
 * the surrounding `.scroll-slot` spacer. The spacer's height reserves
 * `SLOT_VH * vh` pixels per chapter plus one tail `vh`, so the sticky pin
 * stays active for the entire narrative. Opacity / scale / blur are driven
 * by a single `useScrollY()` → `StickyStage` chain — no translateY anywhere.
 *
 * This task only stands up the engine: each chapter is represented by a
 * placeholder tile (`ChPlaceholder`) so the shell is verifiable with a
 * live `next dev` reload. P0 Tasks 3-13 replace the placeholders with the
 * real chapter components one by one. TopBar / TOC / Watermark /
 * FooterDrawer / BrainPanel mounts are deferred to Tasks 2, 14, 15.
 *
 * `useRun()` + `usePublishRunState(state)` are kept wired up — the existing
 * <Header /> in layout.tsx still renders the <BrainIndicator /> and needs
 * live run state to drive the ONLINE/IDLE badge.
 */
import { useEffect, useState, type ReactElement } from 'react';
import { StickyStage, type StickyStageChapter } from '@/components/sticky-stage';
import { useActiveChapter } from '@/hooks/useActiveChapter';
import { useRun } from '@/hooks/useRun';
import { usePublishRunState } from '@/hooks/useRunStateContext';
import { useScrollY } from '@/hooks/useScrollY';

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

const CHAPTERS: readonly StickyStageChapter[] = [
  { id: 'hero', title: 'PAY USDC. GET TWEETS.', Comp: makePlaceholderComp('CH01 HERO') },
  { id: 'problem', title: 'THE GRAVEYARD', Comp: makePlaceholderComp('CH02 PROBLEM') },
  { id: 'solution', title: 'THE FIX', Comp: makePlaceholderComp('CH03 SOLUTION') },
  {
    id: 'brain-architecture',
    title: 'BRAIN ARCHITECTURE',
    Comp: makePlaceholderComp('CH04 BRAIN'),
  },
  { id: 'launch-demo', title: 'LAUNCH DEMO', Comp: makePlaceholderComp('CH05 LAUNCH') },
  { id: 'order-shill', title: 'SHILL DEMO', Comp: makePlaceholderComp('CH06 SHILL') },
  {
    id: 'heartbeat-demo',
    title: 'HEARTBEAT',
    Comp: makePlaceholderComp('CH07 HEARTBEAT'),
  },
  { id: 'take-rate', title: 'TAKE RATE', Comp: makePlaceholderComp('CH08 TAKE RATE') },
  { id: 'sku-matrix', title: 'SKU MATRIX', Comp: makePlaceholderComp('CH09 SKU') },
  { id: 'phase-map', title: 'PHASE MAP', Comp: makePlaceholderComp('CH10 PHASE') },
  { id: 'evidence', title: 'EVIDENCE', Comp: makePlaceholderComp('CH11 EVIDENCE') },
];

export default function HomePage(): ReactElement {
  const hookResult = useRun();
  // Publish run state so the layout-level <Header /><BrainIndicator /> keeps
  // reflecting active persona + ONLINE/IDLE, even while the dedicated
  // TopBar / BrainPanel mounts are still pending (P0 Tasks 2 / 15).
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
  useActiveChapter(scrollY, vh, CHAPTERS.length);

  const slotPx = SLOT_VH * vh;
  const totalScrollH = CHAPTERS.length * slotPx + vh;

  return (
    <div className="scroll-slot" style={{ height: totalScrollH }}>
      <StickyStage chapters={CHAPTERS} scrollY={scrollY} vh={vh} />
    </div>
  );
}
