'use client';

/**
 * LiveOrderScene — "Order a Shill" section (BRAIN-P5 Task 2 / AC-BRAIN-6).
 *
 * Second of three live-operation sections. The embedded
 * `<BrainChat scope="order" />` drives the chat-based Pitch persona
 * commissioning flow. See live-launch-scene.tsx for the shared rationale
 * (own section id, shared useScrollReveal latch, `freeze` escape hatch for
 * tests).
 */
import { useRef } from 'react';
import { BrainChat } from '@/components/brain-chat';
import { useScrollReveal } from '@/hooks/useScrollReveal';
import { PixelHumanGlyph } from '@/components/pixel-human-glyph';

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
    'scene relative flex min-h-[85vh] flex-col items-center justify-center overflow-hidden px-6 py-16',
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
        <header className="flex items-start justify-between gap-6">
          <div className="flex flex-col gap-2">
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
          </div>
          {/* Scope mascot — Shiller persona shouts through a megaphone. */}
          <div
            className="hidden shrink-0 sm:block"
            data-testid="live-order-mascot"
          >
            <PixelHumanGlyph
              size={80}
              mood="megaphone"
              ariaLabel="Memind mascot: order scope"
            />
          </div>
        </header>

        {/* BrainChat embed — BRAIN-P5 Task 2. Wrapper preserves the stable
            data-testid; BrainChat owns its own landmark with scope="order". */}
        <div className="brain-chat-slot" data-testid="brain-chat-slot-order">
          <BrainChat scope="order" />
        </div>
      </div>
    </section>
  );
}
