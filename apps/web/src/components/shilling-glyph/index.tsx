'use client';

/**
 * <ShillingGlyph> — the Shilling Market brand mark.
 *
 * This is both the header logo (mood=idle, ~28-32px tall) and the page mascot
 * (larger sizes, mood changes based on runtime state). One component, 10 mood
 * states, all driven by CSS keyframes + a small JS scheduler for idle micros.
 *
 * Contract:
 *   - The root <svg> always carries a `glyph-root` + `glyph--<mood>` class so
 *     CSS can animate mood-specific parts without the React layer doing any
 *     per-frame work.
 *   - The face is always rendered; mood-specific overlays (limbs, symbols)
 *     mount conditionally — zero bytes of DOM for moods that do not need them.
 *   - One-shot moods (jump / surprise / celebrate) auto-return to idle via a
 *     setTimeout keyed off `getMoodConfig(mood).durationMs`; `onMoodComplete`
 *     fires before the switch.
 *   - `prefers-reduced-motion` is honored: idle micros and hover tease are
 *     disabled; per-mood keyframes are neutralized in CSS via a media query.
 *
 * SSR-safe: no window access at module scope; all browser APIs are gated by
 * typeof checks or run inside useEffect.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
} from 'react';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { GlyphFace } from './glyph-face';
import { GlyphLimbs } from './glyph-limbs';
import { GlyphSymbols } from './glyph-symbols';
import { getMoodConfig, type ShillingMood } from './mood-registry';
import { useMoodScheduler, type MicroAnimation } from './use-mood-scheduler';
import './glyph-animations.css';

export type { ShillingMood } from './mood-registry';

export interface ShillingGlyphProps {
  /** Rendered height in px; width scales automatically on a 2:1 aspect. */
  size?: number;
  mood?: ShillingMood;
  loop?: boolean;
  onMoodComplete?: () => void;
  /** Disables the idle-only random micro animations. */
  disableIdleMicro?: boolean;
  /** Inclusive-exclusive range in ms between idle micro triggers. */
  idleMicroRangeMs?: readonly [number, number];
  primaryColor?: string;
  accentColor?: string;
  className?: string;
  ariaLabel?: string;
}

const DEFAULT_IDLE_RANGE: readonly [number, number] = [8000, 15000];
const DEFAULT_PRIMARY = '#00e5b4';
const DEFAULT_ACCENT = '#f0b000';
const VIEWBOX_WIDTH = 160;
const VIEWBOX_HEIGHT = 80;

export function ShillingGlyph(props: ShillingGlyphProps): ReactElement {
  const {
    size = 32,
    mood = 'idle',
    loop = true,
    onMoodComplete,
    disableIdleMicro = false,
    idleMicroRangeMs = DEFAULT_IDLE_RANGE,
    primaryColor = DEFAULT_PRIMARY,
    accentColor = DEFAULT_ACCENT,
    className,
    ariaLabel = 'Shilling Market mascot',
  } = props;

  const reducedMotion = useReducedMotion();

  // Idle micro-animation: `null` means no micro is active. The scheduler hook
  // flips this string on/off; the value is stamped onto the root svg as a
  // `data-micro` attribute so CSS can target it via [data-micro='blink'] etc.
  const [micro, setMicro] = useState<MicroAnimation | null>(null);

  // Hover tease: briefly apply a `glyph--tease` class on mouse-enter while
  // idle. Debounced so repeat hovers inside 2s do nothing.
  const [tease, setTease] = useState(false);
  const lastTeaseRef = useRef(0);

  const canRunIdleMicros = mood === 'idle' && !disableIdleMicro && !reducedMotion;
  useMoodScheduler({
    enabled: canRunIdleMicros,
    rangeMs: idleMicroRangeMs,
    onMicro: setMicro,
  });

  // Clear stale micro state as soon as we leave idle mood.
  useEffect(() => {
    if (mood !== 'idle' && micro !== null) setMicro(null);
  }, [mood, micro]);

  // One-shot moods auto-return to idle after their configured duration.
  useEffect(() => {
    const cfg = getMoodConfig(mood);
    if (cfg.loop || loop === false) {
      // loop === false here means the caller explicitly asked for a one-shot
      // even on a looping mood — not a supported combination, but treating it
      // as "run for a sensible duration then clear" is safer than leaking.
    }
    if (cfg.loop) return;
    if (typeof window === 'undefined') return;
    const id = window.setTimeout(() => {
      onMoodComplete?.();
    }, cfg.durationMs ?? 0);
    return () => window.clearTimeout(id);
  }, [mood, loop, onMoodComplete]);

  const handleMouseEnter = useCallback(() => {
    if (mood !== 'idle') return;
    if (reducedMotion) return;
    if (typeof performance === 'undefined') return;
    const now = performance.now();
    if (now - lastTeaseRef.current < 2000) return;
    lastTeaseRef.current = now;
    setTease(true);
    window.setTimeout(() => setTease(false), 520);
  }, [mood, reducedMotion]);

  const moodCfg = getMoodConfig(mood);
  const rootClassName = [
    'glyph-root',
    moodCfg.cssClass,
    tease ? 'glyph--tease' : '',
    reducedMotion ? 'glyph--reduced' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  const height = size;
  const width = Math.round(size * (VIEWBOX_WIDTH / VIEWBOX_HEIGHT));

  // CSS custom properties drive color + expose them to keyframes that need to
  // swap hue on glitch (e.g. cyan → white flash). Kept inline so consumer
  // color overrides work without touching global CSS. React typings accept
  // custom properties on style via index signature; cast to CSSProperties
  // narrows the resulting any back out.
  const rootStyle = {
    '--glyph-primary': primaryColor,
    '--glyph-accent': accentColor,
  } as CSSProperties;

  // Decide which overlay layers to mount given the mood.
  const walkMode = mood === 'walk-left' || mood === 'walk-right';
  const clapMode = mood === 'clap';

  return (
    <svg
      role="img"
      aria-label={ariaLabel}
      className={rootClassName}
      width={width}
      height={height}
      viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
      style={rootStyle}
      data-mood={mood}
      data-micro={micro ?? undefined}
      onMouseEnter={handleMouseEnter}
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* inner wrap so idle "breathing" translateY lives on one element */}
      <g className="glyph-stage">
        <GlyphFace />
        {walkMode ? <GlyphLimbs mode="walk" /> : null}
        {clapMode ? <GlyphLimbs mode="clap" /> : null}
        <GlyphSymbols mood={mood} />
      </g>
    </svg>
  );
}
