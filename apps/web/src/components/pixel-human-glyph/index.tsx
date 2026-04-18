'use client';

// <PixelHumanGlyph> — minimalist pixel-art chibi figure used as the brand
// mark. 10 moods, CSS keyframes only, no per-frame JS.
import { useEffect, type CSSProperties, type ReactElement } from 'react';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { getMoodConfig, type ShillingMood } from './mood-registry';
import { PixelFigure } from './pixel-figure';
import { PixelSymbols } from './pixel-symbols';
import './pixel-animations.css';

export type { ShillingMood } from './mood-registry';

export interface PixelHumanGlyphProps {
  size?: number;
  mood?: ShillingMood;
  onMoodComplete?: () => void;
  primaryColor?: string;
  accentColor?: string;
  className?: string;
  ariaLabel?: string;
}

const DEFAULT_PRIMARY = '#00d992';
const DEFAULT_ACCENT = '#f0b000';
// viewBox is a 12x10 window starting at (x=4, y=0) so the figure's content
// (x=6..13, y=2..7) sits centered with ~2 units of padding on each side —
// enough headroom for jump / celebrate translate animations without needing
// a larger canvas that would make the figure read as small.
const VIEWBOX_X = 4;
const VIEWBOX_Y = 0;
const VIEWBOX_WIDTH = 12;
const VIEWBOX_HEIGHT = 10;

// Mood → CSS class. Namespaced under `pixel--` so keyframes in
// pixel-animations.css can target a mood without bleeding into unrelated
// styles elsewhere on the page.
const MOOD_CSS_CLASS: Record<ShillingMood, string> = {
  idle: 'pixel--idle',
  'walk-left': 'pixel--walk-left',
  'walk-right': 'pixel--walk-right',
  jump: 'pixel--jump',
  clap: 'pixel--clap',
  glitch: 'pixel--glitch',
  sleep: 'pixel--sleep',
  work: 'pixel--work',
  think: 'pixel--think',
  surprise: 'pixel--surprise',
  celebrate: 'pixel--celebrate',
  sunglasses: 'pixel--sunglasses',
  'type-keyboard': 'pixel--type-keyboard',
  megaphone: 'pixel--megaphone',
};

export function PixelHumanGlyph(props: PixelHumanGlyphProps): ReactElement {
  const {
    size = 32,
    mood = 'idle',
    onMoodComplete,
    primaryColor = DEFAULT_PRIMARY,
    accentColor = DEFAULT_ACCENT,
    className,
    ariaLabel = 'Pixel mascot',
  } = props;

  const reducedMotion = useReducedMotion();

  // One-shot moods auto-return to idle after their configured durationMs.
  useEffect(() => {
    const cfg = getMoodConfig(mood);
    if (cfg.loop) return;
    if (typeof window === 'undefined') return;
    const id = window.setTimeout(() => {
      onMoodComplete?.();
    }, cfg.durationMs ?? 0);
    return () => window.clearTimeout(id);
  }, [mood, onMoodComplete]);

  const rootClassName = [
    'pixel-root',
    MOOD_CSS_CLASS[mood],
    reducedMotion ? 'pixel--reduced' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  // Non-square viewBox (12x10). Keep size as the height; width scales by the
  // viewBox aspect ratio so the figure never distorts.
  const height = size;
  const width = Math.round(size * (VIEWBOX_WIDTH / VIEWBOX_HEIGHT));

  const rootStyle = {
    '--pixel-primary': primaryColor,
    '--pixel-accent': accentColor,
  } as CSSProperties;

  return (
    <svg
      role="img"
      aria-label={ariaLabel}
      className={rootClassName}
      width={width}
      height={height}
      viewBox={`${VIEWBOX_X} ${VIEWBOX_Y} ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
      style={rootStyle}
      data-mood={mood}
      xmlns="http://www.w3.org/2000/svg"
    >
      <g className="pixel-stage">
        <PixelFigure />
        <PixelSymbols mood={mood} />
      </g>
    </svg>
  );
}
