'use client';

/**
 * <Ch4Brain> — fourth chapter of the Memind scrollytelling narrative
 * (memind-scrollytelling-rebuild AC-MSR-9 ch4).
 *
 * Ported from
 * `docs/design/memind-handoff/project/components/chapters.jsx` lines 163-250,
 * with one FACT CORRECTION:
 *
 *   - `brain-core-sub` reads "claude-sonnet-4.5 · 5s tick" to match what
 *     `apps/server` actually calls via OpenRouter
 *     (`anthropic/claude-sonnet-4-5`). The design handoff still says
 *     `gpt-4o · 5s tick`; the ch4-brain.test.tsx regression guards this.
 *
 * Interior progress `p ∈ [0, 1]` drives:
 *
 *     pulse = clamp((p - 0.2) / 0.6)
 *
 * The pulse fades in 4 radial rings (r = 80 / 160 / 240 / 320) and 4
 * persona ports (GLITCHY / CULTIST / DEGEN / SHILLER) around a radius-220
 * circle. Once pulse passes 0.55, 3 future ports (TELEGRAM / DISCORD /
 * ONCHAIN) appear as dashed "soon" labels at radius 310-330.
 *
 * Circle-coord convention: angle `a` in degrees, `a=0` points up. Converted
 * via `(a - 90) * PI/180` so trig reads natural (cos=x, sin=y).
 */
import type { ReactElement } from 'react';
import { PixelHumanGlyph, type ShillingMood } from '@/components/pixel-human-glyph';
import { Label, clamp, lerp } from './chapter-primitives';

interface Ch4BrainProps {
  /** Interior progress 0..1 emitted by <StickyStage /> for this chapter. */
  readonly p: number;
}

interface PersonaPort {
  readonly a: number;
  readonly label: string;
  readonly mood: ShillingMood;
  readonly color: string;
}

interface FuturePort {
  readonly a: number;
  readonly r: number;
  readonly label: string;
}

const PERSONAS: readonly PersonaPort[] = [
  { a: -140, label: 'GLITCHY', mood: 'glitch', color: 'var(--accent)' },
  { a: -40, label: 'CULTIST', mood: 'clap', color: 'var(--chain-bnb)' },
  { a: 40, label: 'DEGEN', mood: 'surprise', color: 'var(--chain-base)' },
  { a: 140, label: 'SHILLER', mood: 'megaphone', color: 'var(--chain-ipfs)' },
];

const FUTURES: readonly FuturePort[] = [
  { a: -90, r: 310, label: 'TELEGRAM' },
  { a: 0, r: 330, label: 'DISCORD' },
  { a: 90, r: 310, label: 'ONCHAIN' },
];

const RING_RADII = [80, 160, 240, 320] as const;
const PERSONA_RADIUS = 220;

function polar(angleDeg: number, radius: number): { readonly x: number; readonly y: number } {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: Math.cos(rad) * radius, y: Math.sin(rad) * radius };
}

export function Ch4Brain({ p }: Ch4BrainProps): ReactElement {
  const pulse = clamp((p - 0.2) / 0.6);

  return (
    <div className="ch ch-brain">
      <Label n={4}>1 brain · 4 personas · 3 ports</Label>
      <div className="brain-stage">
        <svg className="brain-lines" viewBox="-400 -280 800 560">
          {/* Radial rings — grow stroke opacity as the pulse rolls out. */}
          {RING_RADII.map((r, i) => (
            <circle
              key={r}
              cx="0"
              cy="0"
              r={r}
              fill="none"
              stroke="var(--border-default)"
              strokeDasharray="2 6"
              strokeOpacity={lerp(0.15, 0.6, clamp(pulse * 1.2 - i * 0.1))}
            />
          ))}
          {/* Persona spokes — one line per persona, length tracks pulse. */}
          {PERSONAS.map((pp, i) => {
            const { x, y } = polar(pp.a, PERSONA_RADIUS);
            const len = clamp(pulse * 1.4 - i * 0.08);
            return (
              <line
                key={pp.label}
                x1="0"
                y1="0"
                x2={x * len}
                y2={y * len}
                stroke={pp.color}
                strokeWidth="1.2"
                strokeOpacity={0.7}
              />
            );
          })}
          {/* Future spokes — dashed, appear after persona pulse settles. */}
          {FUTURES.map((f, i) => {
            const { x, y } = polar(f.a, f.r);
            const len = clamp((pulse - 0.4) * 2 - i * 0.1);
            return (
              <line
                key={f.label}
                x1="0"
                y1="0"
                x2={x * len}
                y2={y * len}
                stroke="var(--fg-tertiary)"
                strokeWidth="1"
                strokeDasharray="3 5"
                strokeOpacity={0.4}
              />
            );
          })}
        </svg>
        {/* Central brain core. Model label is the fact-corrected value. */}
        <div className="brain-core">
          <PixelHumanGlyph
            size={130}
            mood="think"
            primaryColor="var(--accent)"
            accentColor="var(--chain-bnb)"
          />
          <div className="brain-core-label">TOKEN BRAIN</div>
          <div className="brain-core-sub">claude-sonnet-4.5 · 5s tick</div>
        </div>
        {/* Persona ports — absolute-positioned around the brain core. */}
        {PERSONAS.map((pp, i) => {
          const { x, y } = polar(pp.a, PERSONA_RADIUS);
          const appear = clamp(pulse * 1.4 - i * 0.08 - 0.5);
          return (
            <div
              key={pp.label}
              className="persona-port"
              style={{ transform: `translate(${x}px, ${y}px)`, opacity: appear }}
            >
              <PixelHumanGlyph
                size={62}
                mood={pp.mood}
                primaryColor={pp.color}
                accentColor="var(--chain-bnb)"
              />
              <div className="persona-label">{pp.label}</div>
            </div>
          );
        })}
        {/* Future ports — dashed labels with the "soon" tag. */}
        {FUTURES.map((f, i) => {
          const { x, y } = polar(f.a, f.r);
          const appear = clamp((pulse - 0.55) * 3 - i * 0.1);
          return (
            <div
              key={f.label}
              className="future-port"
              style={{ transform: `translate(${x}px, ${y}px)`, opacity: appear * 0.6 }}
            >
              <div className="future-label">{f.label}</div>
              <div className="future-sub">soon</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
