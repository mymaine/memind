/**
 * Unit tests for the pure controller behind useScrollProgress. We cover the
 * threshold math, the rAF debounce (many scrolls collapse into one setState),
 * threshold changes recomputing the result, and the cleanup path. The React
 * hook itself is a thin shell over the controller and is exercised by hand —
 * jsdom is not installed in this repo, so we keep all logic in a node-testable
 * controller. Supports AC-P4.7-1 (Header scroll-blur at 80px).
 */
import { describe, it, expect, vi } from 'vitest';
import { shouldBeScrolled, createScrollProgressController } from './useScrollProgress.js';

describe('shouldBeScrolled', () => {
  it('returns false when scrollY is at or below the threshold', () => {
    expect(shouldBeScrolled(0, 80)).toBe(false);
    expect(shouldBeScrolled(80, 80)).toBe(false);
  });

  it('returns true when scrollY exceeds the threshold', () => {
    expect(shouldBeScrolled(81, 80)).toBe(true);
    expect(shouldBeScrolled(500, 80)).toBe(true);
  });

  it('handles a zero threshold (any positive scroll counts as scrolled)', () => {
    expect(shouldBeScrolled(0, 0)).toBe(false);
    expect(shouldBeScrolled(1, 0)).toBe(true);
  });
});

describe('createScrollProgressController', () => {
  function makeDeps(initialScrollY = 0) {
    let scrollY = initialScrollY;
    let rafCb: FrameRequestCallback | null = null;
    let nextRafId = 1;
    const setScrolled = vi.fn();
    const raf = vi.fn((cb: FrameRequestCallback): number => {
      rafCb = cb;
      return nextRafId++;
    });
    const caf = vi.fn();
    const controller = createScrollProgressController({
      threshold: 80,
      getScrollY: () => scrollY,
      setScrolled,
      raf,
      caf,
    });
    return {
      controller,
      setScrolled,
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

  it('reads scrollY once on sync() and pushes the derived boolean', () => {
    const { controller, setScrolled, setScrollY } = makeDeps();
    setScrollY(120);
    controller.sync();
    expect(setScrolled).toHaveBeenCalledTimes(1);
    expect(setScrolled).toHaveBeenCalledWith(true);
  });

  it('debounces multiple scroll events into a single setScrolled via rAF', () => {
    const { controller, setScrolled, raf, flushRaf, setScrollY } = makeDeps();
    setScrollY(120);
    controller.handleScroll();
    controller.handleScroll();
    controller.handleScroll();
    expect(raf).toHaveBeenCalledTimes(1);
    expect(setScrolled).not.toHaveBeenCalled();
    flushRaf();
    expect(setScrolled).toHaveBeenCalledTimes(1);
    expect(setScrolled).toHaveBeenCalledWith(true);
  });

  it('updates the result when scrollY drops back below the threshold', () => {
    const { controller, setScrolled, flushRaf, setScrollY } = makeDeps();
    setScrollY(120);
    controller.handleScroll();
    flushRaf();
    expect(setScrolled).toHaveBeenLastCalledWith(true);
    setScrollY(50);
    controller.handleScroll();
    flushRaf();
    expect(setScrolled).toHaveBeenLastCalledWith(false);
  });

  it('allows a fresh rAF schedule after the previous frame flushed', () => {
    const { controller, raf, flushRaf, setScrollY } = makeDeps();
    setScrollY(120);
    controller.handleScroll();
    flushRaf();
    controller.handleScroll();
    expect(raf).toHaveBeenCalledTimes(2);
  });

  it('dispose cancels a pending rAF', () => {
    const { controller, caf, raf } = makeDeps();
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
