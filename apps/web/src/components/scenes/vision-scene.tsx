'use client';

/**
 * VisionScene — "why this is a primitive, not a feature" (AC-P4.7-6).
 *
 * Four sub-blocks stacked vertically inside an 80vh `<section>`:
 *
 *   0. Brain architecture (AC-P4.7-brain-arch)
 *      Central `Token Brain` hub radiating to four shipped persona ports
 *      (Creator / Narrator / Market-maker-Shiller / Heartbeat) and three
 *      greyed-out future persona slots (Launch Boost / Community Ops /
 *      Alpha Feed). Every label, role and status is read from
 *      `BRAIN_ARCHITECTURE` in narrative-copy — no hardcoded persona
 *      strings. Shipped ports carry `border-accent` at full opacity;
 *      future slots carry the concrete marker class `brain-port--future`
 *      plus `border-dashed` and 60% opacity. The sub-block is landmarked
 *      via `aria-labelledby` pointing at the visible heading so screen
 *      readers can jump to it. Connectors are pure Tailwind bordered
 *      divs (no `<svg>`, no `<canvas>`, no chart library) — pitch-layer
 *      lock per docs/decisions/2026-04-19-brain-agent-positioning.md.
 *      On viewports below `md` the radial collapses to a vertical stack
 *      (central Brain header → shipped list → future list) rather than
 *      forcing the hub-and-spoke at phone width.
 *
 *   1. SKU expansion matrix
 *      Four cards (Shill / Launch Boost / Community Ops / Alpha Feed) read
 *      from VISION_SKUS — all sell-side by design (buy-side SKUs are
 *      excluded per AGENTS.md hard rule #2). Only the shipped SKU (Shill)
 *      carries the accent
 *      breathing-border variant `.sku-card--shipped`; the other three render
 *      in a muted (opacity + default border) variant. The breathing keyframe
 *      lives in globals.css as `sku-shipped-breathe`; reduced-motion CSS
 *      collapses it to a static glow (per reduced-motion matrix row
 *      "Vision SKU pulse").
 *
 *   2. Take-rate projection (three-tier card grid)
 *      Three cards side-by-side read from VISION_TAKERATE:
 *        · Demo floor      — the literal $0.01 × 5% = $1.6/d proof number.
 *                            Labelled "floor, not ceiling" so viewers do not
 *                            mistake it for the business ceiling.
 *        · Real-world      — marketplace-standard pricing ($1–5/shill, 10%
 *                            take, 3,200 orders/d → $117k–$584k/y).
 *        · Multi-SKU TAM   — Shill + Launch Boost + Community Ops + Alpha
 *                            summed to ~$2M/y GMV.
 *      A prior revision shipped a hand-drawn SVG bar chart next to the
 *      numbers; it was removed because it anchored the eye on the $1.6/d
 *      demo-floor figure — exactly the framing this redesign is meant to
 *      correct. The three cards carry the visual weight now.
 *
 *   3. Phase map
 *      Horizontal 3-step diagram reading Phase 1 → Phase 2 → Phase 3. Phase 2
 *      (this project) is highlighted via both the semantic class
 *      `.phase-node--highlighted` (accent border + bg tint) and the shared
 *      `signal-pulse` keyframe (already in globals.css). Phase 1 → 2 line is
 *      an accent gradient (shipped + live path); Phase 2 → 3 is a dashed
 *      connector (future path).
 *
 * Scroll reveal (AC-P4.7-8):
 *   Outer section carries `.scene`; useScrollReveal adds `.scene--revealed`
 *   on first entry. Mirrors the SolutionScene `freeze` escape hatch for
 *   tests — forces the revealed variant so markup paints without waiting on
 *   IntersectionObserver.
 *
 * Spec hard-lines honoured:
 *   - Take-rate numbers are static strings read from narrative-copy — no
 *     runtime derivation (spec "需求邊界外 · 不做商業化數字的動態計算").
 *   - No chart library (spec "需求邊界外 · 不引入 UI 組件庫"). The previous
 *     hand-drawn SVG bar was dropped per the three-tier redesign.
 */
import { useRef } from 'react';
import { useScrollReveal } from '@/hooks/useScrollReveal';
import {
  BRAIN_ARCHITECTURE,
  PHASE_MAP,
  VISION_SKUS,
  VISION_TAKERATE,
  type BrainPersonaPort,
  type PhaseNode,
  type VisionSku,
} from '@/lib/narrative-copy';

export interface VisionSceneProps {
  /** Deterministic reveal for tests — applies `.scene--revealed` regardless
   *  of IntersectionObserver firing. Mirrors the SolutionScene pattern. */
  readonly freeze?: boolean;
  /** Optional className merged into the outer section — lets page.tsx layer
   *  vertical rhythm utilities without forking the component. */
  readonly className?: string;
}

/** SKU status glyph — ✅ for shipped, 🔒 for next/roadmap. Kept inline (no
 *  icon lib) so the 4 glyphs render identically on all platforms. */
function statusGlyph(status: VisionSku['status']): string {
  return status === 'shipped' ? '✅' : '🔒';
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

/**
 * SKU card — the four status variants fan out into two visual modes:
 *   - shipped: accent border + breathing animation + "LIVE" pill
 *   - next / roadmap: default border + opacity-70 for "not yet"
 * The `data-testid="sku-card-${name}"` hook lets tests target individual
 * cards without relying on DOM ordering.
 */
function SkuCard({ sku }: { readonly sku: VisionSku }): React.ReactElement {
  const isShipped = sku.status === 'shipped';
  const cardClass = [
    'sku-card relative flex flex-col gap-3 rounded-[var(--radius-card)] p-5',
    'bg-bg-surface border',
    isShipped ? 'sku-card--shipped border-accent' : 'border-border-default opacity-70',
  ].join(' ');

  return (
    <article className={cardClass} data-testid={`sku-card-${sku.name}`}>
      {/* Status row: glyph + status label (+ LIVE pill for shipped). */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span aria-hidden="true">{statusGlyph(sku.status)}</span>
          <span className="font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.5px] text-fg-tertiary">
            {sku.status}
          </span>
        </div>
        {isShipped ? (
          <span
            className="inline-flex items-center rounded-full border border-accent bg-bg-elevated px-2 py-[1px] font-[family-name:var(--font-mono)] text-[10px] uppercase tracking-[0.6px] text-accent-text"
            data-testid="sku-live-pill"
          >
            LIVE
          </span>
        ) : null}
      </div>
      <h3 className="font-[family-name:var(--font-sans-display)] text-[20px] font-semibold leading-[1.2] text-fg-primary">
        {sku.name}
      </h3>
      <p className="font-[family-name:var(--font-sans-body)] text-[13px] leading-[1.4] text-fg-secondary">
        {sku.note}
      </p>
    </article>
  );
}

/**
 * Phase node — circular dot + stacked label stack. Highlighted variant
 * (Phase 2) gets both `phase-node--highlighted` (accent border + tinted
 * bg) and the shared `signal-pulse` class so the reduced-motion CSS can
 * target either. Non-highlighted nodes carry default border only.
 */
function PhaseNodeView({ node }: { readonly node: PhaseNode }): React.ReactElement {
  const { phase, name, owner, highlighted } = node;
  const dotClass = [
    'phase-node flex h-8 w-8 items-center justify-center rounded-full border-2',
    highlighted
      ? 'phase-node--highlighted signal-pulse border-accent bg-bg-elevated'
      : 'border-border-default bg-bg-surface',
  ].join(' ');

  return (
    <div className="flex min-w-[140px] flex-col items-center gap-2 text-center">
      <div className={dotClass} data-testid={`phase-node-${phase.toString()}`}>
        <span className="font-[family-name:var(--font-mono)] text-[12px] font-semibold text-fg-primary">
          {phase.toString()}
        </span>
      </div>
      <span className="font-[family-name:var(--font-mono)] text-[10px] uppercase tracking-[0.6px] text-fg-tertiary">
        Phase {phase.toString()}
      </span>
      <span
        className={`font-[family-name:var(--font-sans-display)] text-[14px] font-semibold leading-[1.2] ${
          highlighted ? 'text-accent-text' : 'text-fg-primary'
        }`}
      >
        {name}
      </span>
      <span className="font-[family-name:var(--font-sans-body)] text-[11px] leading-[1.3] text-fg-tertiary">
        {owner}
      </span>
    </div>
  );
}

export function VisionScene({ freeze = false, className }: VisionSceneProps): React.ReactElement {
  const sectionRef = useRef<HTMLElement | null>(null);
  const scrollRevealed = useScrollReveal(sectionRef);
  const revealed = scrollRevealed || freeze;

  const sceneClass = [
    'scene relative flex min-h-[80vh] flex-col items-center overflow-hidden px-6 py-16',
    revealed ? 'scene--revealed' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <section ref={sectionRef} aria-label="Vision" className={sceneClass}>
      <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-16">
        {/* Overline heading — orients without dominating, mirrors Solution. */}
        <div className="flex flex-col items-center gap-3">
          <h2
            className="font-[family-name:var(--font-sans-display)] text-[18px] font-semibold uppercase tracking-[0.45px] text-fg-tertiary"
            data-testid="vision-overline"
          >
            The commerce primitive
          </h2>
          <span aria-hidden="true" className="block h-[2px] w-20 rounded-full bg-accent" />
        </div>

        {/* ─── Sub-block 0 · Brain architecture ─────────────────────────── */}
        {/*
         * Pitch-layer data source: `BRAIN_ARCHITECTURE` in narrative-copy.
         * One `Token Brain` hub + four shipped persona ports + three future
         * slots. Landmarked via `aria-labelledby` so screen readers can jump
         * to the region; the visible heading carries the matching `id`.
         *
         * Layout strategy:
         *   - `< md`  : vertical stack (heading → shipped list → future list).
         *     Radial does not read at phone width; the stack degrades
         *     gracefully and keeps every persona reachable.
         *   - `≥ md`  : centred Brain hub card flanked top by a 4-column
         *     shipped-port row and bottom by a 3-column future-slot row.
         *     Pure Tailwind bordered divs connect hub → port (no `<svg>`,
         *     no `<canvas>`, no chart library).
         */}
        <section
          aria-labelledby="brain-architecture-heading"
          className="flex flex-col gap-5"
          data-testid="vision-brain-architecture"
        >
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
        </section>

        {/* ─── Sub-block 1 · SKU expansion matrix ───────────────────────── */}
        <div className="flex flex-col gap-4">
          <span className="font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.5px] text-fg-tertiary">
            SKU expansion
          </span>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            {VISION_SKUS.map((sku) => (
              <SkuCard key={sku.name} sku={sku} />
            ))}
          </div>
        </div>

        {/* ─── Sub-block 2 · Take-rate projection (three-tier grid) ────── */}
        {/*
         * Three cards, equal visual weight, no bar chart. The left card is
         * the demo-floor proof ($1.6/d) — kept on-screen so judges can tie
         * the number back to the live run, but flanked by real-world pricing
         * and multi-SKU TAM so nobody mistakes the floor for the ceiling.
         */}
        <div className="flex flex-col gap-4">
          <span className="font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.5px] text-fg-tertiary">
            Take-rate model (conservative)
          </span>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            {/* Card 1 · Demo floor — literal $1.6/d from the live run. */}
            <article
              className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border-default bg-bg-surface p-5"
              data-testid="vision-takerate-demo-floor"
            >
              <span className="font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.5px] text-fg-tertiary">
                {VISION_TAKERATE.demoFloor.label}
              </span>
              <div className="font-[family-name:var(--font-mono)] text-[14px] leading-[1.5] text-fg-primary">
                {VISION_TAKERATE.demoFloor.formula}
              </div>
              <p className="font-[family-name:var(--font-sans-body)] text-[13px] leading-[1.4] text-fg-secondary">
                {VISION_TAKERATE.demoFloor.caption}
              </p>
            </article>

            {/* Card 2 · Real-world pricing — marketplace-standard numbers. */}
            <article
              className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border-default bg-bg-surface p-5"
              data-testid="vision-takerate-real-world"
            >
              <span className="font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.5px] text-fg-tertiary">
                {VISION_TAKERATE.realWorld.label}
              </span>
              <div className="font-[family-name:var(--font-mono)] text-[14px] leading-[1.5] text-fg-primary">
                {VISION_TAKERATE.realWorld.formula}
              </div>
              <div className="font-[family-name:var(--font-sans-display)] text-[22px] font-semibold leading-[1.2] text-accent-text">
                {VISION_TAKERATE.realWorld.result}
              </div>
              <p className="font-[family-name:var(--font-sans-body)] text-[13px] leading-[1.4] text-fg-secondary">
                {VISION_TAKERATE.realWorld.caption}
              </p>
            </article>

            {/* Card 3 · Multi-SKU TAM — four-row breakdown summing to ~$2M. */}
            <article
              className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border-default bg-bg-surface p-5"
              data-testid="vision-takerate-multi-sku"
            >
              <span className="font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.5px] text-fg-tertiary">
                {VISION_TAKERATE.multiSkuTam.label}
              </span>
              <dl className="flex flex-col gap-1">
                {VISION_TAKERATE.multiSkuTam.breakdown.map((row) => (
                  <div key={row.sku} className="flex items-baseline justify-between gap-3">
                    <dt className="font-[family-name:var(--font-mono)] text-[12px] text-fg-primary">
                      {row.sku}
                    </dt>
                    <dd className="font-[family-name:var(--font-mono)] text-[12px] text-accent-text">
                      {row.annual}
                    </dd>
                  </div>
                ))}
              </dl>
              <div className="font-[family-name:var(--font-sans-display)] text-[22px] font-semibold leading-[1.2] text-accent-text">
                {VISION_TAKERATE.multiSkuTam.total}
              </div>
            </article>
          </div>
        </div>

        {/* ─── Sub-block 3 · Phase map ─────────────────────────────────── */}
        <div className="flex flex-col gap-4">
          <span className="font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.5px] text-fg-tertiary">
            Token Brain · Agentic Mode Phase 2
          </span>
          <div className="flex flex-col items-stretch gap-6 md:flex-row md:items-start md:justify-between">
            {PHASE_MAP.map((node, idx) => {
              const isLast = idx === PHASE_MAP.length - 1;
              // Connector class — Phase 1→2 uses the accent-gradient variant
              // ("shipped + live"); Phase 2→3 uses the dashed "future" one.
              // The connector is hidden on small screens where nodes stack.
              const connectorClass = idx === 0 ? 'phase-line' : 'phase-line phase-line--future';
              return (
                <div key={node.phase} className="flex flex-1 items-start">
                  <PhaseNodeView node={node} />
                  {isLast ? null : (
                    <span
                      aria-hidden="true"
                      className={`${connectorClass} mx-2 mt-4 hidden flex-1 md:block`}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
