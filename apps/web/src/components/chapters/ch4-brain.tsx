'use client';

/**
 * <Ch4Brain> — fourth chapter of the Memind scrollytelling narrative
 * (memind-scrollytelling-rebuild AC-MSR-9 ch4).
 *
 * Ported from the design handoff, with two FACT CORRECTIONS:
 *
 *   - `brain-core-sub` reads "claude-sonnet-4.5 · 5s tick" to match what
 *     `apps/server` actually calls via OpenRouter
 *     (`anthropic/claude-sonnet-4-5`). The design handoff still says
 *     `gpt-4o · 5s tick`; the ch4-brain.test.tsx regression guards this.
 *   - UAT issue #7 — X (Twitter) ships as a live delivery channel from
 *     Phase 3 onward, so the port ring now declares 4 channels: `X (live)` +
 *     3 soon channels (TELEGRAM / DISCORD / ON-CHAIN MSG). The sub-caption
 *     above the stage clarifies persona = content voice vs. channel =
 *     delivery surface — the UAT reported confusion about what the 4+3
 *     labels meant.
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
import type { ReactElement, ReactNode } from 'react';
import { PixelHumanGlyph, type ShillingMood } from '@/components/pixel-human-glyph';
import { Label, clamp, lerp } from './chapter-primitives';

/*
 * Channel brand icons — inline SVG so `currentColor` picks up the accent
 * green when the port is live (X) and the dim fg-tertiary when soon
 * (Telegram / Discord / on-chain). Paths are the widely-published
 * simple-icons.org brand marks, rendered at viewBox 24×24.
 */
const IconX = (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden xmlns="http://www.w3.org/2000/svg">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-6.61-8.638L1.99 21.75H-1.32l7.73-8.835L-1.79 2.25H5.27l5.977 7.901L18.244 2.25zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z" />
  </svg>
);

const IconTelegram = (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden xmlns="http://www.w3.org/2000/svg">
    <path d="M11.944 0A12 12 0 000 12a12 12 0 0012 12 12 12 0 0012-12A12 12 0 0012 0a12 12 0 00-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 01.171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212-.07-.062-.174-.041-.249-.024-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.245-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
  </svg>
);

const IconDiscord = (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden xmlns="http://www.w3.org/2000/svg">
    <path d="M20.317 4.37a19.79 19.79 0 00-4.885-1.515.074.074 0 00-.079.037c-.21.375-.444.865-.608 1.249a18.27 18.27 0 00-5.487 0 12.76 12.76 0 00-.617-1.25.077.077 0 00-.079-.037A19.736 19.736 0 003.677 4.37a.07.07 0 00-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 00.031.057 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 00-.041-.106 13.1 13.1 0 01-1.872-.892.077.077 0 01-.008-.128 10.2 10.2 0 00.372-.292.074.074 0 01.077-.01c3.928 1.793 8.18 1.793 12.061 0a.074.074 0 01.079.009c.12.099.246.198.373.292a.077.077 0 01-.007.128 12.3 12.3 0 01-1.873.891.077.077 0 00-.04.107c.36.698.772 1.362 1.225 1.993a.076.076 0 00.084.028 19.84 19.84 0 006.002-3.03.077.077 0 00.032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.955 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418Z" />
  </svg>
);

const IconOnChain = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
    xmlns="http://www.w3.org/2000/svg"
  >
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </svg>
);

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
  /** Inline SVG brand-mark rendered inside the port (UAT round 4). */
  readonly icon: ReactNode;
  /** Stable test hook (matches the brand slug). */
  readonly iconId: string;
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
// UAT round 4 (2026-04-20): swap Unicode glyphs for real brand SVGs. The
// `label` keeps the human name (used for aria-label + tooltip), `iconId`
// is a stable test hook, `icon` is the inline SVG rendered in the port.
const CHANNELS: readonly ChannelPort[] = [
  { a: 0, r: 240, label: 'X', iconId: 'x', icon: IconX, status: 'live' },
  {
    a: -90,
    r: 260,
    label: 'Telegram',
    iconId: 'telegram',
    icon: IconTelegram,
    status: 'soon',
  },
  { a: 90, r: 260, label: 'Discord', iconId: 'discord', icon: IconDiscord, status: 'soon' },
  {
    a: 180,
    r: 240,
    label: 'On-chain message',
    iconId: 'onchain',
    icon: IconOnChain,
    status: 'soon',
  },
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
              aria-label={`${c.label} (${live ? 'live' : 'coming soon'})`}
              title={c.label}
              data-icon={c.iconId}
            >
              <div className="future-icon" aria-hidden>
                {c.icon}
              </div>
              <div className="future-sub">{live ? 'live' : 'soon'}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
