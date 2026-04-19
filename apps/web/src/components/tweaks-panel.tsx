/**
 * TweaksPanel — live dev-tweaks surface
 * (memind-scrollytelling-rebuild AC-MSR-12).
 *
 * Ported from design-handoff `app.jsx` lines 284-312. Only rendered when
 * `useTweakMode()` is active (parent posted `__activate_edit_mode` or
 * the URL carries `?edit=1`). Three controls:
 *
 *   - accent swatch strip (5 hardcoded palette entries, matches handoff)
 *   - scanlines overlay checkbox
 *   - reduced-motion override checkbox
 *
 * Styling lives in `.tweaks` / `.tweak-row` / `.swatches` / `.swatch`
 * classes in globals.css (ported alongside the handoff).
 */
import type { ReactElement } from 'react';

export interface TweaksState {
  readonly accent: string;
  readonly scanlines: boolean;
  readonly reduceMotion: boolean;
}

export const TWEAK_DEFAULTS: TweaksState = {
  accent: '#00d992',
  scanlines: true,
  reduceMotion: false,
};

/**
 * Accent palette offered by the panel. Matches the design-handoff
 * TweaksPanel swatch list 1:1 (green / BNB yellow / Coinbase blue /
 * pastel violet / warm red).
 */
export const TWEAK_ACCENT_SWATCHES: readonly string[] = [
  '#00d992',
  '#f0b90b',
  '#0052ff',
  '#818cf8',
  '#fb565b',
];

export interface TweaksPanelProps {
  readonly tweaks: TweaksState;
  readonly setTweak: <K extends keyof TweaksState>(k: K, v: TweaksState[K]) => void;
}

export function TweaksPanel({ tweaks, setTweak }: TweaksPanelProps): ReactElement {
  return (
    <div className="tweaks" role="dialog" aria-label="Live tweaks">
      <div className="tweaks-head">
        <span className="mono">Tweaks</span>
        <span className="mono" style={{ color: 'var(--fg-tertiary)' }}>
          {'// live'}
        </span>
      </div>
      <div className="tweak-row">
        <span className="mono">accent</span>
        <div className="swatches">
          {TWEAK_ACCENT_SWATCHES.map((c) => (
            <button
              key={c}
              type="button"
              className={`swatch ${tweaks.accent === c ? 'on' : ''}`}
              style={{ background: c }}
              aria-label={`Accent ${c}`}
              aria-pressed={tweaks.accent === c}
              onClick={() => setTweak('accent', c)}
            />
          ))}
        </div>
      </div>
      <label className="tweak-row">
        <span className="mono">scanlines</span>
        <input
          type="checkbox"
          checked={tweaks.scanlines}
          onChange={(e) => setTweak('scanlines', e.target.checked)}
        />
      </label>
      <label className="tweak-row">
        <span className="mono">reduce motion</span>
        <input
          type="checkbox"
          checked={tweaks.reduceMotion}
          onChange={(e) => setTweak('reduceMotion', e.target.checked)}
        />
      </label>
    </div>
  );
}
