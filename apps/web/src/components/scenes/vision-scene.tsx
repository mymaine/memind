'use client';

/**
 * VisionScene — "why this is a primitive, not a feature" (AC-P4.7-6).
 *
 * Three sub-blocks stacked vertically inside an 80vh `<section>`:
 *
 *   1. SKU expansion matrix
 *      Four cards (Shill / Snipe / LP Provisioning / Alpha Feed) read from
 *      VISION_SKUS. Only the shipped SKU (Shill) carries the accent
 *      breathing-border variant `.sku-card--shipped`; the other three render
 *      in a muted (opacity + default border) variant. The breathing keyframe
 *      lives in globals.css as `sku-shipped-breathe`; reduced-motion CSS
 *      collapses it to a static glow (per reduced-motion matrix row
 *      "Vision SKU pulse").
 *
 *   2. Take-rate projection
 *      Left column: VISION_TAKERATE.formula / .derivation / .result stacked
 *      vertically, separated by hairlines. The result line is accent-coloured
 *      so the eye lands on "$1.6/d protocol revenue (conservative)". Right
 *      column: a hand-drawn SVG bar chart (no recharts — see spec "需求邊界
 *      外"). Three bars (tokens/d · paid · revenue) with hand-tuned heights
 *      chosen for visual weight rather than proportional scale; the chart is
 *      illustrative, the real numbers live in the text column next to it.
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
 *   - No chart library — bar chart is plain inline SVG (spec "需求邊界外 ·
 *     不引入 UI 組件庫" + the Vision row "SVG 手繪，無 recharts 依賴").
 */
import { useRef } from 'react';
import { useScrollReveal } from '@/hooks/useScrollReveal';
import {
  PHASE_MAP,
  VISION_SKUS,
  VISION_TAKERATE,
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

/**
 * Take-rate bar chart — hand-drawn SVG.
 *
 * Heights are picked for visual weight (tokens >> paid >> revenue) rather
 * than literal proportional scale; the true numbers are in the adjacent text
 * column. The viewBox matches the rendered size so no scaling surprises. Two
 * <text> nodes per bar: value label above, axis label below.
 */
function TakerateBarChart(): React.ReactElement {
  const bars = [
    {
      label: 'tokens/d',
      value: '32k',
      height: 120,
      color: 'var(--color-accent-subtle)',
    },
    {
      label: 'paid',
      value: '3.2k',
      height: 70,
      color: 'var(--color-accent)',
    },
    {
      label: 'revenue',
      value: '$1.6/d',
      height: 35,
      color: 'var(--color-accent-text)',
    },
  ] as const;

  const W = 240;
  const H = 180;
  const BAR_W = 50;
  const GAP = 70;
  const BASELINE_Y = 160;
  const LEFT_PAD = 20;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width={W}
      height={H}
      role="img"
      aria-label="Take-rate projection chart: 32k tokens per day, 3.2k paid shills, $1.6 per day revenue"
    >
      {bars.map((b, i) => {
        const x = LEFT_PAD + i * GAP;
        const y = BASELINE_Y - b.height;
        return (
          <g key={b.label}>
            <rect x={x} y={y} width={BAR_W} height={b.height} fill={b.color} rx={4} />
            <text
              x={x + BAR_W / 2}
              y={y - 5}
              textAnchor="middle"
              fontSize="11"
              fill="var(--color-fg-primary)"
              fontFamily="var(--font-mono)"
            >
              {b.value}
            </text>
            <text
              x={x + BAR_W / 2}
              y={BASELINE_Y + 14}
              textAnchor="middle"
              fontSize="10"
              fill="var(--color-fg-tertiary)"
              fontFamily="var(--font-mono)"
            >
              {b.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** SKU status glyph — ✅ for shipped, 🔒 for next/roadmap. Kept inline (no
 *  icon lib) so the 4 glyphs render identically on all platforms. */
function statusGlyph(status: VisionSku['status']): string {
  return status === 'shipped' ? '✅' : '🔒';
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

        {/* ─── Sub-block 2 · Take-rate projection ──────────────────────── */}
        <div className="flex flex-col gap-4">
          <span className="font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.5px] text-fg-tertiary">
            Take-rate model (conservative)
          </span>
          <div className="grid grid-cols-1 items-center gap-8 md:grid-cols-[1fr_auto]">
            {/* Left · formula / derivation / result stack */}
            <div className="flex flex-col gap-3">
              <div
                className="font-[family-name:var(--font-mono)] text-[14px] leading-[1.5] text-fg-primary"
                data-testid="vision-takerate-formula"
              >
                {VISION_TAKERATE.formula}
              </div>
              <span
                aria-hidden="true"
                className="block h-px w-full bg-[color:var(--color-border-default)]"
              />
              <div
                className="font-[family-name:var(--font-mono)] text-[14px] leading-[1.5] text-fg-primary"
                data-testid="vision-takerate-derivation"
              >
                {VISION_TAKERATE.derivation}
              </div>
              <span
                aria-hidden="true"
                className="block h-px w-full bg-[color:var(--color-border-default)]"
              />
              <div
                className="font-[family-name:var(--font-sans-display)] text-[24px] font-semibold leading-[1.2] text-accent-text"
                data-testid="vision-takerate-result"
              >
                {VISION_TAKERATE.result}
              </div>
            </div>
            {/* Right · hand-drawn bar chart */}
            <div className="flex items-end justify-center md:justify-start">
              <TakerateBarChart />
            </div>
          </div>
        </div>

        {/* ─── Sub-block 3 · Phase map ─────────────────────────────────── */}
        <div className="flex flex-col gap-4">
          <span className="font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.5px] text-fg-tertiary">
            Agent commerce primitive · Phase 2
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
