/**
 * Unit tests for the pure controller behind useScrollY.
 *
 * The design-handoff StickyStage drives every chapter's opacity/scale/blur
 * from `window.scrollY`. We need a single rAF-batched scrollY value across
 * the whole surface so rapid scroll events collapse into one React render.
 *
 * vitest runs in `node` env (no jsdom) so we keep all logic in a pure
 * controller (`createScrollYController`) and inject fakes. The React hook is
 * a thin shell that plumbs window + rAF into it; its cleanup path is
 * exercised through the controller's `dispose()` contract.
 */
import { describe, it, expect, vi } from 'vitest';
import { createScrollYController } from './useScrollY.js';

describe('createScrollYController', () => {
  function makeDeps(initialScrollY = 0) {
    let scrollY = initialScrollY;
    let rafCb: FrameRequestCallback | null = null;
    let nextRafId = 1;
    const setY = vi.fn<(y: number) => void>();
    const raf = vi.fn((cb: FrameRequestCallback): number => {
      rafCb = cb;
      return nextRafId++;
    });
    const caf = vi.fn();
    const controller = createScrollYController({
      getScrollY: () => scrollY,
      setY,
      raf,
      caf,
    });
    return {
      controller,
      setY,
      raf,
      caf,
      flushRaf: () => {
        if (rafCb) {
          const cb = rafCb;
          rafCb = null;
          cb(performance.now());
        }
      },
      setScrollY: (next: number) => {
        scrollY = next;
      },
    };
  }

  it('sync() reads scrollY once and pushes the value (initial 0)', () => {
    const { controller, setY } = makeDeps(0);
    controller.sync();
    expect(setY).toHaveBeenCalledTimes(1);
    expect(setY).toHaveBeenCalledWith(0);
  });

  it('handleScroll debounces bursts into one rAF-flushed setY with the latest value', () => {
    const { controller, setY, raf, flushRaf, setScrollY } = makeDeps(0);
    setScrollY(120);
    controller.handleScroll();
    controller.handleScroll();
    controller.handleScroll();
    expect(raf).toHaveBeenCalledTimes(1);
    expect(setY).not.toHaveBeenCalled();
    setScrollY(260);
    flushRaf();
    expect(setY).toHaveBeenCalledTimes(1);
    expect(setY).toHaveBeenCalledWith(260);
  });

  it('dispose cancels a pending rAF handle', () => {
    const { controller, raf, caf } = makeDeps();
    controller.handleScroll();
    const rafId = raf.mock.results[0]?.value as number;
    controller.dispose();
    expect(caf).toHaveBeenCalledWith(rafId);
  });

  it('dispose is a no-op when no rAF is pending', () => {
    const { controller, caf } = makeDeps();
    controller.dispose();
    expect(caf).not.toHaveBeenCalled();
  });
});
