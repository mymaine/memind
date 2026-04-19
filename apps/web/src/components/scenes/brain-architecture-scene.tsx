'use client';

/**
 * BrainArchitectureScene — "1 Brain + pluggable personas" stand-alone scene
 * (immersive-single-page P1 Task 4).
 *
 * Extracted from `<VisionScene />` so the immersive single-page home surface
 * can mount the Brain architecture section directly under its own TOC anchor
 * (`#brain-architecture`). The extraction is behaviour-preserving: every
 * string still comes from `BRAIN_ARCHITECTURE` in narrative-copy (pitch-layer
 * lock per docs/decisions/2026-04-19-brain-agent-positioning.md), connectors
 * remain pure Tailwind bordered divs (no `<svg>`, no `<canvas>`, no chart
 * library), and the accessibility landmark wiring (`aria-labelledby`) is
 * preserved verbatim.
 *
 * Layout:
 *   Central `Token Brain` hub radiating to four shipped persona ports
 *   (Creator / Narrator / Market-maker / Heartbeat) and three greyed-out
 *   future persona slots (Launch Boost / Community Ops / Alpha Feed).
 *   Shipped ports carry `border-accent` at full opacity; future slots carry
 *   the concrete marker class `brain-port--future` plus `border-dashed` and
 *   60% opacity. On viewports below `md` the radial collapses to a vertical
 *   stack (central Brain header → shipped list → future list) rather than
 *   forcing the hub-and-spoke at phone width.
 *
 * Scroll reveal:
 *   Outer section carries `.scene`; useScrollReveal adds `.scene--revealed`
 *   on first entry. Mirrors the VisionScene `freeze` escape hatch for tests —
 *   forces the revealed variant so markup paints without waiting on
 *   IntersectionObserver.
 *
 * Section id:
 *   The outer landmark mounts as `<section id="brain-architecture">` so
 *   page.tsx can render <BrainArchitectureScene /> directly without an outer
 *   wrapper (a wrapper would emit two DOM elements with `id="brain-architecture"`).
 */
import { useRef } from 'react';
import { useScrollReveal } from '@/hooks/useScrollReveal';
import { BRAIN_ARCHITECTURE, type BrainPersonaPort } from '@/lib/narrative-copy';

export interface BrainArchitectureSceneProps {
  /** Deterministic reveal for tests — applies `.scene--revealed` regardless
   *  of IntersectionObserver firing. Mirrors the VisionScene pattern. */
  readonly freeze?: boolean;
  /** Optional className merged into the outer section — lets page.tsx layer
   *  vertical rhythm utilities without forking the component. */
  readonly className?: string;
}

/**
 * BrainPortCard — one persona "port" around the Brain hub. Two visual
 * variants fan out from the `status` field:
 *
 *   - `shipped`: solid accent border (`border-accent`), full opacity,
 *     shipped role text emphasised. Used for the four already-live
 *     personas (Creator / Narrator / Market-maker / Heartbeat).
 *   - `next` / `roadmap`: dashed border (`border-dashed`), 60% opacity,
 *     muted text, plus the concrete marker class `brain-port--future` so
 *     tests and future reduced-motion CSS can target the "not yet" cards
 *     without relying on inline styles.
 *
 * Every string rendered here is passed in from `BRAIN_ARCHITECTURE` — no
 * hardcoded persona names (pitch-layer lock per
 * docs/decisions/2026-04-19-brain-agent-positioning.md).
 */
function BrainPortCard({ port }: { readonly port: BrainPersonaPort }): React.ReactElement {
  const isShipped = port.status === 'shipped';
  const cardClass = [
    'brain-port relative flex flex-col gap-1 rounded-[var(--radius-card)] bg-bg-surface p-4',
    'border',
    isShipped
      ? 'border-accent'
      : 'brain-port--future border-dashed border-border-default opacity-60',
  ].join(' ');

  return (
    <article className={cardClass} data-testid={`brain-port-${port.name}`}>
      <div className="flex items-center justify-between gap-2">
        <h4 className="font-[family-name:var(--font-sans-display)] text-[14px] font-semibold leading-[1.2] text-fg-primary">
          {port.name}
        </h4>
        {isShipped ? null : (
          <span
            className="inline-flex items-center rounded-full border border-border-default bg-bg-elevated px-2 py-[1px] font-[family-name:var(--font-mono)] text-[10px] uppercase tracking-[0.6px] text-fg-tertiary"
            data-testid={`brain-port-pill-${port.name}`}
          >
            {port.status.toUpperCase()}
          </span>
        )}
      </div>
      <p
        className={`font-[family-name:var(--font-sans-body)] text-[12px] leading-[1.4] ${
          isShipped ? 'text-fg-secondary' : 'text-fg-tertiary'
        }`}
      >
        {port.role}
      </p>
    </article>
  );
}

export function BrainArchitectureScene({
  freeze = false,
  className,
}: BrainArchitectureSceneProps): React.ReactElement {
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
      id="brain-architecture"
      aria-labelledby="brain-architecture-heading"
      className={sceneClass}
      data-testid="vision-brain-architecture"
    >
      <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-5">
        <div className="flex flex-col gap-1">
          <h3
            id="brain-architecture-heading"
            className="font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.5px] text-fg-tertiary"
          >
            Brain architecture
          </h3>
          <p className="font-[family-name:var(--font-sans-body)] text-[13px] leading-[1.4] text-fg-secondary">
            {BRAIN_ARCHITECTURE.brainSubtitle}
          </p>
        </div>

        {/* Brain hub — centred on md+, static full-width on mobile. */}
        <div className="flex flex-col items-center gap-4">
          <div
            className="brain-hub flex flex-col items-center gap-1 rounded-[var(--radius-card)] border-2 border-accent bg-bg-elevated px-5 py-3 text-center"
            data-testid="brain-hub"
          >
            <span
              aria-hidden="true"
              className="font-[family-name:var(--font-mono)] text-[10px] uppercase tracking-[0.6px] text-fg-tertiary"
            >
              {/* small overline above the hub label keeps the card dense
                  without introducing a second typographic scale */}
              runtime
            </span>
            <span className="font-[family-name:var(--font-sans-display)] text-[18px] font-semibold leading-[1.1] text-accent-text">
              {BRAIN_ARCHITECTURE.brainLabel}
            </span>
          </div>

          {/* Vertical trunk connector — only visible on md+ where the
              radial-ish hub-and-spoke reads. Mobile drops it because the
              columns stack and a dangling line adds noise. */}
          <span aria-hidden="true" className="hidden h-4 w-[1px] bg-border-default md:block" />
        </div>

        {/* Shipped persona row — 1 column on mobile, 4 columns on md+. */}
        <div className="flex flex-col gap-3">
          <span className="font-[family-name:var(--font-mono)] text-[10px] uppercase tracking-[0.6px] text-fg-tertiary">
            Shipped personas
          </span>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
            {BRAIN_ARCHITECTURE.shippedPersonas.map((port) => (
              <BrainPortCard key={port.name} port={port} />
            ))}
          </div>
        </div>

        {/* Future slot row — same grid semantics; each card carries the
            dashed/muted variant and an uppercase status pill. */}
        <div className="flex flex-col gap-3">
          <span className="font-[family-name:var(--font-mono)] text-[10px] uppercase tracking-[0.6px] text-fg-tertiary">
            Plugs in next
          </span>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
            {BRAIN_ARCHITECTURE.futureSlots.map((port) => (
              <BrainPortCard key={port.name} port={port} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
