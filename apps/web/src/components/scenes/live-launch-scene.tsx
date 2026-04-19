'use client';

/**
 * LiveLaunchScene — "Live Launch Demo" section
 * (BRAIN-P5 Task 1 / AC-BRAIN-6).
 *
 * Hosts the first of three live-operation sections on the single-page home
 * surface (Launch → Order Shill → Heartbeat). The section intro sets up the
 * Launch pitch beat and the embedded `<BrainChat scope="launch" />` runs
 * the chat-driven flow (theme → Creator persona → on-chain deploy).
 *
 * Layout mirrors <BrainArchitectureScene />: the scene owns its own
 * `<section id="launch-demo">` so page.tsx mounts it directly without an
 * outer wrapper (a wrapper would duplicate the id and break the TOC
 * anchor). Scroll reveal runs through the shared `useScrollReveal` latch;
 * `freeze` is preserved for deterministic tests.
 *
 * The `brain-chat-slot-launch` data-testid + class name are preserved on
 * the wrapper so existing selectors / external agents keep targeting the
 * chat region — BrainChat itself is a full `<section>` landmark with
 * `aria-label="Brain chat"` + `data-scope="launch"`.
 */
import { useRef } from 'react';
import { BrainChat } from '@/components/brain-chat';
import { useScrollReveal } from '@/hooks/useScrollReveal';

export interface LiveLaunchSceneProps {
  /** Deterministic reveal for tests — applies `.scene--revealed` regardless
   *  of IntersectionObserver firing. Mirrors the BrainArchitectureScene
   *  pattern so test code can paint the scene without async scroll. */
  readonly freeze?: boolean;
  /** Optional className merged into the outer section — lets page.tsx layer
   *  vertical rhythm utilities without forking the component. */
  readonly className?: string;
}

export function LiveLaunchScene({
  freeze = false,
  className,
}: LiveLaunchSceneProps): React.ReactElement {
  const sectionRef = useRef<HTMLElement | null>(null);
  const scrollRevealed = useScrollReveal(sectionRef);
  const revealed = scrollRevealed || freeze;

  const sceneClass = [
    'scene relative flex min-h-[85vh] flex-col items-center justify-center overflow-hidden px-6 py-16',
    revealed ? 'scene--revealed' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <section
      ref={sectionRef}
      id="launch-demo"
      aria-labelledby="launch-demo-heading"
      className={sceneClass}
      data-testid="live-launch-scene"
    >
      <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-6">
        <header className="flex flex-col gap-2">
          <span className="font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.5px] text-fg-tertiary">
            Operation · 1 / 3
          </span>
          <h2
            id="launch-demo-heading"
            className="font-[family-name:var(--font-sans-display)] text-[28px] font-semibold leading-[1.1] text-fg-emphasis"
          >
            Live Launch Demo
          </h2>
          <p className="max-w-[640px] font-[family-name:var(--font-sans-body)] text-[14px] leading-[1.5] text-fg-secondary">
            Tell the Brain a theme. It deploys the token, writes lore chapter 1, and reports back
            on-chain artifacts in seconds.
          </p>
        </header>

        {/* BrainChat embed — BRAIN-P5 Task 1. The wrapper keeps the stable
            `brain-chat-slot-launch` testid so external selectors can still
            target the chat region. BrainChat renders its own outer
            `<section aria-label="Brain chat" data-scope="launch">`. */}
        <div className="brain-chat-slot" data-testid="brain-chat-slot-launch">
          <BrainChat scope="launch" />
        </div>
      </div>
    </section>
  );
}
