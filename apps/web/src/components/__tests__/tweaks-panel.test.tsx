/**
 * Tests for `<TweaksPanel />` (memind-scrollytelling-rebuild AC-MSR-12).
 *
 * Vitest runs in the node env without jsdom, so these checks focus on
 * static structure (swatch count / class state / checkbox state) and on
 * verifying the callback wiring does not fire during the render phase.
 * Interactive click behaviour is validated at the page level by the
 * browser smoke check in the AC-MSR-12 verification pass.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  TWEAK_ACCENT_SWATCHES,
  TWEAK_DEFAULTS,
  TweaksPanel,
  type TweaksState,
} from '../tweaks-panel.js';

function renderPanel(
  tweaks: TweaksState = TWEAK_DEFAULTS,
  setTweak = vi.fn() as <K extends keyof TweaksState>(k: K, v: TweaksState[K]) => void,
): string {
  return renderToStaticMarkup(<TweaksPanel tweaks={tweaks} setTweak={setTweak} />);
}

describe('<TweaksPanel />', () => {
  it('renders the 5 accent swatch buttons from TWEAK_ACCENT_SWATCHES', () => {
    const out = renderPanel();
    // Every swatch has `aria-label="Accent <hex>"` and a background style.
    for (const hex of TWEAK_ACCENT_SWATCHES) {
      expect(out).toContain(`aria-label="Accent ${hex}"`);
      // Escape the swatch hex for the regex (none contain regex metachars today).
      expect(out).toMatch(new RegExp(`background:${hex}`));
    }
    // Exactly 5 swatch buttons render. Match only class names starting
    // with `swatch ` or `swatch"` so the parent `.swatches` wrapper div
    // is excluded.
    const swatches = out.match(/class="swatch(?: on)?\s*"/g) ?? [];
    expect(swatches.length).toBe(TWEAK_ACCENT_SWATCHES.length);
  });

  it('marks the current accent swatch with the `on` class and aria-pressed=true', () => {
    const tweaks: TweaksState = { ...TWEAK_DEFAULTS, accent: '#f0b90b' };
    const out = renderPanel(tweaks);
    // Selected swatch gets `swatch on`.
    expect(out).toMatch(/class="swatch on"[^>]*background:#f0b90b/);
    expect(out).toMatch(
      /aria-label="Accent #f0b90b"[^>]*aria-pressed="true"|aria-pressed="true"[^>]*aria-label="Accent #f0b90b"/,
    );
    // Non-selected swatches remain `swatch ` (with trailing space).
    expect(out).toMatch(/class="swatch "[^>]*background:#00d992/);
  });

  it('renders the scanlines checkbox and reflects the current state', () => {
    const on = renderPanel({ ...TWEAK_DEFAULTS, scanlines: true });
    // Find the scanlines row: `scanlines` label + checked input.
    expect(on).toContain('scanlines');
    // React emits `checked=""` for checked inputs under renderToStaticMarkup.
    expect(on).toMatch(/<input[^>]*type="checkbox"[^>]*checked[^>]*\/>/);

    const off = renderPanel({ ...TWEAK_DEFAULTS, scanlines: false, reduceMotion: false });
    // With both flags off, neither checkbox should carry the `checked`
    // attribute — verify by asserting no checkbox input has checked set.
    expect(off).not.toMatch(/<input[^>]*type="checkbox"[^>]*checked/);
  });

  it('renders the reduce-motion checkbox and reflects the current state', () => {
    const on = renderPanel({ ...TWEAK_DEFAULTS, scanlines: false, reduceMotion: true });
    expect(on).toContain('reduce motion');
    // Exactly one checked input — the reduce-motion row.
    const checkedInputs = on.match(/<input[^>]*type="checkbox"[^>]*checked/g) ?? [];
    expect(checkedInputs.length).toBe(1);
  });

  it('does not invoke setTweak during the render phase', () => {
    const setTweak = vi.fn() as <K extends keyof TweaksState>(k: K, v: TweaksState[K]) => void;
    renderPanel(TWEAK_DEFAULTS, setTweak);
    expect(setTweak).not.toHaveBeenCalled();
  });
});
