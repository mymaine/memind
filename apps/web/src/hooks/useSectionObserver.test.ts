/**
 * Unit tests for the pure controller behind useSectionObserver
 * (immersive-single-page P1 Task 2 / AC-ISP-3).
 *
 * The hook drives the sticky TOC active-section highlight on `md+`. We split
 * the logic out as `createSectionObserverController` so the math (pick the
 * section with the largest intersectionRatio) is testable without a DOM;
 * the React shell on top plumbs real `IntersectionObserver` + state into it.
 *
 * These mirror useScrollReveal.test.ts's stub-observer pattern so tests stay
 * node-testable (vitest environment = node; no jsdom in this repo).
 */
import { describe, it, expect, vi } from 'vitest';
import { createSectionObserverController } from './useSectionObserver.js';

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
  const setActiveId = vi.fn<(id: string | null) => void>();
  const observerFactory = vi.fn(
    (cb: IntersectionObserverCallback, opts?: IntersectionObserverInit) => {
      const inst = new IntersectionObserverStub(cb, opts);
      instances.push(inst);
      return inst as unknown as IntersectionObserver;
    },
  );
  // `getElementById` stub — return a sentinel element per id so observe() can
  // be called. The controller itself does not inspect the element beyond
  // passing it to observer.observe(), so any non-null object is enough.
  const getElementById = vi.fn((id: string) => ({ id }) as unknown as Element);
  return { instances, setActiveId, observerFactory, getElementById };
}

describe('createSectionObserverController', () => {
  it('creates one IntersectionObserver and observes every resolvable section id', () => {
    const { instances, setActiveId, observerFactory, getElementById } = makeDeps();
    const controller = createSectionObserverController({
      observerFactory,
      setActiveId,
      getElementById,
      sectionIds: ['hero', 'problem', 'solution'],
      rootMargin: '-56px 0px 0px 0px',
    });
    controller.start();
    expect(observerFactory).toHaveBeenCalledTimes(1);
    expect(instances[0]?.observe).toHaveBeenCalledTimes(3);
  });

  it('picks the section with the largest intersectionRatio as active', () => {
    const { instances, setActiveId, observerFactory, getElementById } = makeDeps();
    const controller = createSectionObserverController({
      observerFactory,
      setActiveId,
      getElementById,
      sectionIds: ['hero', 'problem', 'solution'],
    });
    controller.start();
    const obs = instances[0];
    obs?.trigger([
      { isIntersecting: true, intersectionRatio: 0.2, target: { id: 'hero' } as Element },
      { isIntersecting: true, intersectionRatio: 0.7, target: { id: 'problem' } as Element },
      { isIntersecting: true, intersectionRatio: 0.1, target: { id: 'solution' } as Element },
    ]);
    // `problem` has the biggest ratio, so it wins.
    expect(setActiveId).toHaveBeenLastCalledWith('problem');
  });

  it('tracks the latest state across multiple trigger batches (non-intersecting drops its ratio)', () => {
    const { instances, setActiveId, observerFactory, getElementById } = makeDeps();
    const controller = createSectionObserverController({
      observerFactory,
      setActiveId,
      getElementById,
      sectionIds: ['hero', 'problem'],
    });
    controller.start();
    const obs = instances[0];
    obs?.trigger([
      { isIntersecting: true, intersectionRatio: 0.9, target: { id: 'hero' } as Element },
    ]);
    expect(setActiveId).toHaveBeenLastCalledWith('hero');
    obs?.trigger([
      { isIntersecting: false, intersectionRatio: 0, target: { id: 'hero' } as Element },
      { isIntersecting: true, intersectionRatio: 0.6, target: { id: 'problem' } as Element },
    ]);
    expect(setActiveId).toHaveBeenLastCalledWith('problem');
  });

  it('skips section ids whose element cannot be resolved (no observe call, no crash)', () => {
    const { instances, setActiveId, observerFactory } = makeDeps();
    // Only `hero` and `solution` resolve; `problem` is null.
    const getElementById = vi.fn((id: string) =>
      id === 'problem' ? null : ({ id } as unknown as Element),
    );
    const controller = createSectionObserverController({
      observerFactory,
      setActiveId,
      getElementById,
      sectionIds: ['hero', 'problem', 'solution'],
    });
    controller.start();
    // Observer still created (even if some ids are missing), and observe is
    // only called for the ids that resolved.
    expect(observerFactory).toHaveBeenCalledTimes(1);
    expect(instances[0]?.observe).toHaveBeenCalledTimes(2);
  });

  it('dispose disconnects the observer and is safe to call twice', () => {
    const { instances, setActiveId, observerFactory, getElementById } = makeDeps();
    const controller = createSectionObserverController({
      observerFactory,
      setActiveId,
      getElementById,
      sectionIds: ['hero'],
    });
    controller.start();
    controller.dispose();
    controller.dispose();
    expect(instances[0]?.disconnect).toHaveBeenCalledTimes(1);
  });
});
