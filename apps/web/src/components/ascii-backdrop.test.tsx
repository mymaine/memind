/**
 * Tests for <AsciiBackdrop /> + its pure rAF-throttled scroll controller.
 *
 * Two specs covered in one file:
 *   - P2 Task 1 / AC-ISP-8 (mini): fixed layer + scroll parallax + reduced-
 *     motion guard. Covered by the first 4 tests.
 *   - P2 Task 2 / AC-ISP-9 (advanced): character density switches per
 *     section; Brain online shifts the layer toward the Brain indicator.
 *     Covered by the extra 4 tests at the bottom of this file.
 *
 * Vitest runs in node env — there is no real window, matchMedia, or rAF.
 * The component source exposes:
 *   - `createAsciiBackdropController` (pure scroll controller) for the scroll-
 *     listener branch coverage;
 *   - `AsciiBackdropView({ activeSection, brainStatus })` (pure SSR view) so
 *     we can assert `data-section` / `data-brain` without jsdom / React state.
 * The runtime `<AsciiBackdrop />` is the thin client shell that plumbs the
 * `useSectionObserver` + `useRunState` hooks into the view and installs the
 * scroll controller on mount.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  AsciiBackdrop,
  AsciiBackdropView,
  createAsciiBackdropController,
  generateAsciiGrid,
  resolveMotif,
} from './ascii-backdrop.js';

interface Fakes {
  readonly addEventListener: ReturnType<typeof vi.fn>;
  readonly removeEventListener: ReturnType<typeof vi.fn>;
  readonly setCssVar: ReturnType<typeof vi.fn>;
  readonly raf: ReturnType<typeof vi.fn>;
  readonly caf: ReturnType<typeof vi.fn>;
}

function makeFakes(): Fakes {
  return {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    setCssVar: vi.fn(),
    raf: vi.fn(),
    caf: vi.fn(),
  };
}

function makeController(reducedMotion: boolean, fakes: Fakes, scrollY = 0) {
  return createAsciiBackdropController({
    reducedMotion: () => reducedMotion,
    addScrollListener: fakes.addEventListener,
    removeScrollListener: fakes.removeEventListener,
    setScrollVar: fakes.setCssVar,
    getScrollY: () => scrollY,
    raf: fakes.raf,
    caf: fakes.caf,
  });
}

describe('<AsciiBackdrop />', () => {
  it('renders an aria-hidden <div class="ascii-backdrop">', () => {
    const out = renderToStaticMarkup(<AsciiBackdrop />);
    expect(out).toMatch(/<div[^>]*class="[^"]*ascii-backdrop[^"]*"/);
    expect(out).toContain('aria-hidden="true"');
  });
});

describe('createAsciiBackdropController', () => {
  it('install() attaches a scroll listener when reduced-motion is OFF', () => {
    const fakes = makeFakes();
    const ctrl = makeController(false, fakes);
    ctrl.install();
    expect(fakes.addEventListener).toHaveBeenCalledTimes(1);
    const firstCall = fakes.addEventListener.mock.calls[0] ?? [];
    const [handler, options] = firstCall;
    expect(typeof handler).toBe('function');
    // Passive listener so scroll stays on the compositor thread.
    expect(options).toEqual({ passive: true });
  });

  it('install() is a no-op when reduced-motion is ON — no listener, no CSS var write', () => {
    const fakes = makeFakes();
    const ctrl = makeController(true, fakes);
    ctrl.install();
    expect(fakes.addEventListener).not.toHaveBeenCalled();
    expect(fakes.setCssVar).not.toHaveBeenCalled();
    expect(fakes.raf).not.toHaveBeenCalled();
  });

  it('dispose() removes the scroll listener and cancels any pending rAF frame', () => {
    const fakes = makeFakes();
    // Capture the rAF callback so we can verify a queued handle exists before dispose.
    fakes.raf.mockImplementation(() => 42);
    const ctrl = makeController(false, fakes, 128);
    const dispose = ctrl.install();
    // Fire a scroll; controller schedules one rAF and stores the handle.
    const installCall = fakes.addEventListener.mock.calls[0] ?? [];
    const handler = installCall[0] as () => void;
    handler();
    expect(fakes.raf).toHaveBeenCalledTimes(1);
    // Second scroll in the same frame must not re-schedule (rAF throttle).
    handler();
    expect(fakes.raf).toHaveBeenCalledTimes(1);
    // Dispose removes the listener + cancels the pending frame.
    dispose();
    expect(fakes.removeEventListener).toHaveBeenCalledTimes(1);
    const removeCall = fakes.removeEventListener.mock.calls[0] ?? [];
    expect(removeCall[0]).toBe(handler);
    expect(fakes.caf).toHaveBeenCalledWith(42);
  });
});

/**
 * Advanced view — P2 Task 2 / AC-ISP-9.
 *
 * The runtime shell reads `useSectionObserver()` + `deriveBrainStatus()` and
 * passes both into this view. The view writes `data-section` + `data-brain`
 * attributes on the backdrop div; CSS in globals.css swaps the `::before`
 * character palette on `[data-section=...]` and translates the layer toward
 * the Header Brain indicator on `[data-brain="online"]`.
 */
describe('<AsciiBackdropView />', () => {
  it('writes the active section id into data-section so CSS can swap the palette', () => {
    const hero = renderToStaticMarkup(
      <AsciiBackdropView activeSection="hero" brainStatus="idle" />,
    );
    expect(hero).toMatch(/data-section="hero"/);
    const problem = renderToStaticMarkup(
      <AsciiBackdropView activeSection="problem" brainStatus="idle" />,
    );
    expect(problem).toMatch(/data-section="problem"/);
    // Sections without an active id fall back to `hero` so CSS always has a
    // concrete palette key to match.
    const nullActive = renderToStaticMarkup(
      <AsciiBackdropView activeSection={null} brainStatus="idle" />,
    );
    expect(nullActive).toMatch(/data-section="hero"/);
  });

  it('writes the derived Brain status into data-brain so CSS can apply the offset', () => {
    const online = renderToStaticMarkup(
      <AsciiBackdropView activeSection="hero" brainStatus="online" />,
    );
    expect(online).toMatch(/data-brain="online"/);
    const idle = renderToStaticMarkup(
      <AsciiBackdropView activeSection="hero" brainStatus="idle" />,
    );
    expect(idle).toMatch(/data-brain="idle"/);
  });

  it('still renders the aria-hidden class="ascii-backdrop" root with both data attrs', () => {
    const out = renderToStaticMarkup(
      <AsciiBackdropView activeSection="brain-architecture" brainStatus="online" />,
    );
    expect(out).toMatch(/<div[^>]*class="[^"]*ascii-backdrop[^"]*"/);
    expect(out).toContain('aria-hidden="true"');
    expect(out).toMatch(/data-section="brain-architecture"/);
    expect(out).toMatch(/data-brain="online"/);
  });

  it('emits a <pre class="ascii-backdrop-grid"> child carrying the generated grid', () => {
    const out = renderToStaticMarkup(
      <AsciiBackdropView activeSection="hero" brainStatus="idle" cols={20} rows={3} />,
    );
    expect(out).toMatch(/<pre[^>]*class="ascii-backdrop-grid"/);
    // Grid must be non-empty so the backdrop actually paints something.
    expect(out).toMatch(/<pre[^>]*>[^<]+<\/pre>/);
  });
});

describe('generateAsciiGrid', () => {
  it('tiles the motif to the requested cols × rows with alternating row offset', () => {
    const grid = generateAsciiGrid('ab', 6, 4);
    const lines = grid.split('\n');
    expect(lines).toHaveLength(4);
    expect(lines[0]).toBe('ababab');
    // Odd rows shift by one motif char so the pattern does not read as stripes.
    expect(lines[1]).toBe('bababa');
    expect(lines[2]).toBe('ababab');
    expect(lines[3]).toBe('bababa');
  });

  it('returns an empty string when any dimension is zero', () => {
    expect(generateAsciiGrid('ab', 0, 10)).toBe('');
    expect(generateAsciiGrid('ab', 10, 0)).toBe('');
    expect(generateAsciiGrid('', 10, 10)).toBe('');
  });

  it('resolveMotif maps each section id to its palette and falls back to hero', () => {
    expect(resolveMotif('hero')).toBe('* . ');
    expect(resolveMotif('problem')).toBe('·   ');
    expect(resolveMotif('brain-architecture')).toBe('◉ ');
    expect(resolveMotif('evidence')).toBe('✓ ');
    expect(resolveMotif(null)).toBe('* . ');
    expect(resolveMotif('unknown-section')).toBe('* . ');
  });

  it('switching active section between renders does not re-install the scroll controller', () => {
    // The controller is a pure function; installing it multiple times with
    // identical deps returns independent disposers and attaches listeners
    // every time. The React shell guards against that by only installing in
    // the mount effect. Here we assert the contract: a fresh install() on a
    // controller with reduced-motion=false attaches exactly ONE listener —
    // re-rendering the view with a different `activeSection` must never be
    // able to schedule a duplicate install, because the view is pure.
    const fakes = makeFakes();
    const ctrl = makeController(false, fakes);
    ctrl.install();
    // Render the view twice with different section / brain props — pure so
    // no side effects can leak into the controller.
    renderToStaticMarkup(<AsciiBackdropView activeSection="hero" brainStatus="idle" />);
    renderToStaticMarkup(<AsciiBackdropView activeSection="problem" brainStatus="online" />);
    expect(fakes.addEventListener).toHaveBeenCalledTimes(1);
  });
});
