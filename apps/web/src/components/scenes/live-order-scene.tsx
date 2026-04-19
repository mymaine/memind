'use client';

/**
 * LiveOrderScene — "Order a Shill" section skeleton
 * (immersive-single-page P1 Task 5 / AC-ISP-5).
 *
 * Second of three live-operation sections. Skeleton only — BRAIN-P5 will
 * replace `brain-chat-slot-order` with `<BrainChat scope="order" />`. See
 * live-launch-scene.tsx for the shared rationale (own section id, shared
 * useScrollReveal latch, `freeze` escape hatch for tests).
 */
import { useRef } from 'react';
import { useScrollReveal } from '@/hooks/useScrollReveal';

export interface LiveOrderSceneProps {
  readonly freeze?: boolean;
  readonly className?: string;
}

export function LiveOrderScene({
  freeze = false,
  className,
}: LiveOrderSceneProps): React.ReactElement {
  const sectionRef = useRef<HTMLElement | null>(null);
  const scrollRevealed = useScrollReveal(sectionRef);
  const revealed = scrollRevealed || freeze;

  const sceneClass = [
    'scene relative flex flex-col items-center overflow-hidden px-6 py-16',
    revealed ? 'scene--revealed' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <section
      ref={sectionRef}
      id="order-shill"
      aria-labelledby="order-shill-heading"
      className={sceneClass}
      data-testid="live-order-scene"
    >
      <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-6">
        <header className="flex flex-col gap-2">
          <span className="font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.5px] text-fg-tertiary">
            Operation · 2 / 3
          </span>
          <h2
            id="order-shill-heading"
            className="font-[family-name:var(--font-sans-display)] text-[28px] font-semibold leading-[1.1] text-fg-emphasis"
          >
            Order a Shill
          </h2>
          <p className="max-w-[640px] font-[family-name:var(--font-sans-body)] text-[14px] leading-[1.5] text-fg-secondary">
            Commission a shill. The Shiller persona drafts an on-voice tweet and posts from an aged
            X account for 0.01 USDC.
          </p>
        </header>

        <div
          className="brain-chat-slot rounded-[var(--radius-card)] border border-dashed border-border-default bg-bg-surface p-6"
          data-testid="brain-chat-slot-order"
        >
          <p className="font-[family-name:var(--font-mono)] text-[12px] uppercase tracking-[0.5px] text-fg-tertiary">
            Chat surface coming in BRAIN-P5
          </p>
        </div>
      </div>
    </section>
  );
}
