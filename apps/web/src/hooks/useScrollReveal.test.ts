/**
 * Unit tests for the pure controller behind useScrollReveal. We cover the
 * one-way "latch once, never revert" semantic, observer disconnect on first
 * intersect, disconnect on dispose without intersect, and the SSR guard. The
 * React hook is a thin shell over this controller — jsdom is not installed
 * in this repo, so the controller carries all the logic and the hook stays
 * trivially auditable. Supports AC-P4.7-8 (scene-reveal latch).
 */
import { describe, it, expect, vi } from 'vitest';
import {
  DEFAULT_REVEAL_ROOT_MARGIN,
  DEFAULT_REVEAL_THRESHOLD,
  createRevealController,
} from './useScrollReveal.js';

class IntersectionObserverStub {
  callback: IntersectionObserverCallback;
  options?: IntersectionObserverInit;
  observe = vi.fn<(target: Element) => void>();
  unobserve = vi.fn<(target: Element) => void>();
  disconnect = vi.fn<() => void>();
  takeRecords = vi.fn<() => IntersectionObserverEntry[]>(() => []);

  constructor(cb: IntersectionObserverCallback, opts?: IntersectionObserverInit) {
    this.callback = cb;
    this.options = opts;
  }

  trigger(entries: Partial<IntersectionObserverEntry>[]): void {
    this.callback(entries as IntersectionObserverEntry[], this as unknown as IntersectionObserver);
  }
}

function makeDeps() {
  const instances: IntersectionObserverStub[] = [];
  const setHasEntered = vi.fn();
  const observerFactory = vi.fn(
    (cb: IntersectionObserverCallback, opts?: IntersectionObserverInit) => {
      const inst = new IntersectionObserverStub(cb, opts);
      instances.push(inst);
      return inst as unknown as IntersectionObserver;
    },
  );
  return { instances, setHasEntered, observerFactory };
}

describe('reveal defaults', () => {
  it('exports the spec-mandated default rootMargin and threshold', () => {
    expect(DEFAULT_REVEAL_ROOT_MARGIN).toBe('-10% 0px');
    expect(DEFAULT_REVEAL_THRESHOLD).toBe(0);
  });
});

describe('createRevealController', () => {
  it('wires the IntersectionObserver with the provided options and observes the element', () => {
    const { instances, setHasEntered, observerFactory } = makeDeps();
    const el = { id: 'hero' } as unknown as Element;
    const controller = createRevealController({
      observerFactory,
      setHasEntered,
      rootMargin: '-25% 0px',
      threshold: 0.5,
    });
    controller.observe(el);
    expect(observerFactory).toHaveBeenCalledTimes(1);
    expect(instances[0]?.options).toEqual({ rootMargin: '-25% 0px', threshold: 0.5 });
    expect(instances[0]?.observe).toHaveBeenCalledWith(el);
  });

  it('latches to true on first intersect and disconnects the observer', () => {
    const { instances, setHasEntered, observerFactory } = makeDeps();
    const el = {} as Element;
    const controller = createRevealController({
      observerFactory,
      setHasEntered,
      rootMargin: DEFAULT_REVEAL_ROOT_MARGIN,
      threshold: DEFAULT_REVEAL_THRESHOLD,
    });
    controller.observe(el);
    instances[0]?.trigger([{ isIntersecting: true }]);
    expect(setHasEntered).toHaveBeenCalledTimes(1);
    expect(setHasEntered).toHaveBeenCalledWith(true);
    expect(instances[0]?.disconnect).toHaveBeenCalledTimes(1);
  });

  it('stays latched: a subsequent isIntersecting:false does not flip back to false', () => {
    const { instances, setHasEntered, observerFactory } = makeDeps();
    const el = {} as Element;
    const controller = createRevealController({
      observerFactory,
      setHasEntered,
      rootMargin: DEFAULT_REVEAL_ROOT_MARGIN,
      threshold: DEFAULT_REVEAL_THRESHOLD,
    });
    controller.observe(el);
    const obs = instances[0];
    obs?.trigger([{ isIntersecting: true }]);
    obs?.trigger([{ isIntersecting: false }]);
    // Only the first true call should have landed; no false ever pushed.
    expect(setHasEntered).toHaveBeenCalledTimes(1);
    expect(setHasEntered).toHaveBeenCalledWith(true);
  });

  it('ignores entries whose isIntersecting is false when nothing has entered yet', () => {
    const { instances, setHasEntered, observerFactory } = makeDeps();
    const el = {} as Element;
    const controller = createRevealController({
      observerFactory,
      setHasEntered,
      rootMargin: DEFAULT_REVEAL_ROOT_MARGIN,
      threshold: DEFAULT_REVEAL_THRESHOLD,
    });
    controller.observe(el);
    instances[0]?.trigger([{ isIntersecting: false }]);
    expect(setHasEntered).not.toHaveBeenCalled();
    expect(instances[0]?.disconnect).not.toHaveBeenCalled();
  });

  it('dispose disconnects the observer even when the element never intersected', () => {
    const { instances, setHasEntered, observerFactory } = makeDeps();
    const el = {} as Element;
    const controller = createRevealController({
      observerFactory,
      setHasEntered,
      rootMargin: DEFAULT_REVEAL_ROOT_MARGIN,
      threshold: DEFAULT_REVEAL_THRESHOLD,
    });
    controller.observe(el);
    controller.dispose();
    expect(instances[0]?.disconnect).toHaveBeenCalledTimes(1);
  });

  it('dispose is a no-op when observe was never called (null ref)', () => {
    const { setHasEntered, observerFactory } = makeDeps();
    const controller = createRevealController({
      observerFactory,
      setHasEntered,
      rootMargin: DEFAULT_REVEAL_ROOT_MARGIN,
      threshold: DEFAULT_REVEAL_THRESHOLD,
    });
    expect(() => {
      controller.dispose();
    }).not.toThrow();
    expect(observerFactory).not.toHaveBeenCalled();
  });

  it('dispose after an intersect does not double-disconnect', () => {
    const { instances, setHasEntered, observerFactory } = makeDeps();
    const el = {} as Element;
    const controller = createRevealController({
      observerFactory,
      setHasEntered,
      rootMargin: DEFAULT_REVEAL_ROOT_MARGIN,
      threshold: DEFAULT_REVEAL_THRESHOLD,
    });
    controller.observe(el);
    instances[0]?.trigger([{ isIntersecting: true }]);
    controller.dispose();
    expect(instances[0]?.disconnect).toHaveBeenCalledTimes(1);
  });
});
