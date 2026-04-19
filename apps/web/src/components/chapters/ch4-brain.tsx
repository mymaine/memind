'use client';

/**
 * <Ch4Brain> — fourth chapter of the Memind scrollytelling narrative
 * (memind-scrollytelling-rebuild AC-MSR-9 ch4).
 *
 * Ported from
 * `docs/design/memind-handoff/project/components/chapters.jsx` lines 163-250,
 * with two FACT CORRECTIONS:
 *
 *   - `brain-core-sub` reads "claude-sonnet-4.5 · 5s tick" to match what
 *     `apps/server` actually calls via OpenRouter
 *     (`anthropic/claude-sonnet-4-5`). The design handoff still says
 *     `gpt-4o · 5s tick`; the ch4-brain.test.tsx regression guards this.
 *   - UAT issue #7 — X (Twitter) ships as a live delivery channel from
 *     Phase 3 onward (see `docs/decisions/2026-04-19-x-posting-agent.md`),
 *     so the port ring now declares 4 channels: `X (live)` + 3 soon
 *     channels (TELEGRAM / DISCORD / ON-CHAIN MSG). The sub-caption above
 *     the stage clarifies persona = content voice vs. channel = delivery
 *     surface — the UAT reported confusion about what the 4+3 labels meant.
 *
 * Interior progress `p ∈ [0, 1]` drives:
 *
 *     pulse = clamp((p - 0.2) / 0.6)
 *
 * The pulse fades in 4 radial rings (r = 80 / 160 / 240 / 320) and 4
 * persona ports (GLITCHY / CULTIST / DEGEN / SHILLER) around a radius-220
 * circle. Once pulse passes 0.55, 4 channel ports appear at radius 310-330:
 * X (shipped, solid accent), TELEGRAM / DISCORD / ON-CHAIN MSG (soon,
 * dashed). Channels sit at angles -135 / -45 / 45 / 135 so they interleave
 * with the persona spokes instead of stacking on top.
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
  /** Short voice descriptor rendered under the label (UAT issue #7). */
  readonly voice: string;
}

type ChannelStatus = 'live' | 'soon';

interface ChannelPort {
  readonly a: number;
  readonly r: number;
  readonly label: string;
  readonly status: ChannelStatus;
}

const PERSONAS: readonly PersonaPort[] = [
  { a: -140, label: 'GLITCHY', mood: 'glitch', color: 'var(--accent)', voice: 'glitch voice' },
  { a: -40, label: 'CULTIST', mood: 'clap', color: 'var(--chain-bnb)', voice: 'cult voice' },
  { a: 40, label: 'DEGEN', mood: 'surprise', color: 'var(--chain-base)', voice: 'degen voice' },
  {
    a: 140,
    label: 'SHILLER',
    mood: 'megaphone',
    color: 'var(--chain-ipfs)',
    voice: 'shill voice',
  },
];

// Cross layout: X top, TELEGRAM left, DISCORD right, ON-CHAIN MSG bottom.
// UAT 2026-04-20: radii shrunk from 310-330 / 220 so the whole stage fits
// inside a typical 900-1000px viewport without spilling into the legend
// row above or the closing CTA below. Persona ring stays outside the
// brain-core badge but well inside the channel cross.
const CHANNELS: readonly ChannelPort[] = [
  { a: 0, r: 240, label: 'X', status: 'live' },
  { a: -90, r: 260, label: 'TELEGRAM', status: 'soon' },
  { a: 90, r: 260, label: 'DISCORD', status: 'soon' },
  { a: 180, r: 240, label: 'ON-CHAIN MSG', status: 'soon' },
];

const RING_RADII = [60, 120, 180, 240] as const;
const PERSONA_RADIUS = 170;

function polar(angleDeg: number, radius: number): { readonly x: number; readonly y: number } {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: Math.cos(rad) * radius, y: Math.sin(rad) * radius };
}

export function Ch4Brain({ p }: Ch4BrainProps): ReactElement {
  const pulse = clamp((p - 0.2) / 0.6);

  return (
    <div className="ch ch-brain">
      <Label n={4}>1 brain · 4 personas · 4 channels</Label>
      {/* UAT issue #7 — explicit legend above the brain stage so viewers
       * don't have to guess which ring is which. Persona = content voice
       * (how the brain speaks), channel = delivery surface (where the
       * brain speaks). X is live today; the rest ship next. */}
      <div className="brain-legend">
        <span className="mono" style={{ color: 'var(--fg-tertiary)' }}>
          persona = content voice
        </span>
        <span className="mono" style={{ color: 'var(--fg-tertiary)' }}>
          {'\u00b7'}
        </span>
        <span className="mono" style={{ color: 'var(--fg-tertiary)' }}>
          channel = delivery surface
        </span>
        <span className="mono" style={{ color: 'var(--fg-tertiary)' }}>
          {'\u00b7'}
        </span>
        <span className="mono" style={{ color: 'var(--accent)' }}>
          X live
        </span>
        <span className="mono" style={{ color: 'var(--fg-tertiary)' }}>
          {'\u00b7'}
        </span>
        <span className="mono" style={{ color: 'var(--fg-tertiary)' }}>
          others shipping
        </span>
      </div>
      <div className="brain-stage">
        <svg
          className="brain-lines"
          viewBox="-320 -240 640 480"
          preserveAspectRatio="xMidYMid meet"
        >
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
          {/* Channel spokes — dashed for soon channels, solid accent for
           * the live X channel (UAT issue #7). Appear after persona pulse
           * settles. */}
          {CHANNELS.map((c, i) => {
            const { x, y } = polar(c.a, c.r);
            const len = clamp((pulse - 0.4) * 2 - i * 0.1);
            const live = c.status === 'live';
            return (
              <line
                key={c.label}
                x1="0"
                y1="0"
                x2={x * len}
                y2={y * len}
                stroke={live ? 'var(--accent)' : 'var(--fg-tertiary)'}
                strokeWidth={live ? '1.4' : '1'}
                strokeDasharray={live ? undefined : '3 5'}
                strokeOpacity={live ? 0.8 : 0.4}
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
        {/* Persona ports — absolute-positioned around the brain core.
         * `persona-voice` sub-label spells out the content voice for each
         * persona (UAT issue #7 clarification). */}
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
              <div className="persona-voice">{pp.voice}</div>
            </div>
          );
        })}
        {/* Channel ports — 4 delivery surfaces. `X` is live (solid accent
         * label + `live` tag); the rest are dashed with a `soon` tag. */}
        {CHANNELS.map((c, i) => {
          const { x, y } = polar(c.a, c.r);
          const appear = clamp((pulse - 0.55) * 3 - i * 0.1);
          const live = c.status === 'live';
          return (
            <div
              key={c.label}
              className={live ? 'future-port future-port--live' : 'future-port'}
              style={{
                transform: `translate(${x}px, ${y}px)`,
                opacity: appear * (live ? 0.95 : 0.6),
              }}
            >
              <div className="future-label">{c.label}</div>
              <div className="future-sub">{live ? 'live' : 'soon'}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
