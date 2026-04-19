/**
 * Red tests for <AsciiBackdrop /> + its pure rAF-throttled scroll controller
 * (immersive-single-page P2 Task 1 / AC-ISP-8).
 *
 * Vitest runs in node env — there is no real window, matchMedia, or rAF.
 * Following the `useScrollProgress` / `useReducedMotion` split convention the
 * component source exposes a `createAsciiBackdropController` that takes
 * injected dependencies; tests drive every branch via fakes without touching
 * jsdom. The runtime `<AsciiBackdrop />` is the thin React shell.
 *
 * Four behaviours per the V4.7-P5 / P2 Task 1 brief:
 *   1. Render produces an <div aria-hidden="true" class="ascii-backdrop">.
 *   2. Controller.install() attaches a scroll listener when reduced-motion is
 *      OFF.
 *   3. Controller.install() is a no-op when reduced-motion is ON — no scroll
 *      listener registered, no CSS var write.
 *   4. The disposer returned by install() removes the scroll listener and
 *      cancels any pending rAF frame so unmount cleans up cleanly.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AsciiBackdrop, createAsciiBackdropController } from './ascii-backdrop.js';

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
    const [handler, options] = fakes.addEventListener.mock.calls[0];
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
    const handler = fakes.addEventListener.mock.calls[0][0] as () => void;
    handler();
    expect(fakes.raf).toHaveBeenCalledTimes(1);
    // Second scroll in the same frame must not re-schedule (rAF throttle).
    handler();
    expect(fakes.raf).toHaveBeenCalledTimes(1);
    // Dispose removes the listener + cancels the pending frame.
    dispose();
    expect(fakes.removeEventListener).toHaveBeenCalledTimes(1);
    expect(fakes.removeEventListener.mock.calls[0][0]).toBe(handler);
    expect(fakes.caf).toHaveBeenCalledWith(42);
  });
});
