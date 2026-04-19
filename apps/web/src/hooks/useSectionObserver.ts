'use client';

/**
 * Track which top-level section is currently the viewer's "primary" target,
 * driving the sticky left-side TOC active highlight
 * (immersive-single-page P1 Task 2 / AC-ISP-3).
 *
 * Signal source: one IntersectionObserver watches every section whose `id`
 * appears in the supplied list. Every entries batch, we update a running
 * map of `id → intersectionRatio` and pick the id with the largest ratio as
 * active. "Active" is a single-winner decision so the TOC highlight never
 * flickers between two partially-visible sections — IntersectionObserver
 * reports discrete change events, so picking the latest largest ratio from
 * the persistent map mirrors what the user sees pixel-for-pixel.
 *
 * Split into `createSectionObserverController` (framework-free, testable
 * with a stub IntersectionObserver) and `useSectionObserver` (React shell
 * that plumbs real IO + setState into it). Same split convention as
 * `useScrollReveal`.
 *
 * rootMargin default: `-56px 0px 0px 0px` offsets the header height so a
 * section is only counted once it clears the sticky Header — matches the
 * `scroll-margin-top: 56px` mental model elsewhere in the surface.
 */
import { useEffect, useState } from 'react';

export const DEFAULT_SECTION_OBSERVER_ROOT_MARGIN = '-56px 0px 0px 0px';
export const DEFAULT_SECTION_OBSERVER_THRESHOLDS: readonly number[] = [0, 0.1, 0.25, 0.5, 0.75, 1];

export interface SectionObserverControllerDeps {
  readonly observerFactory: (
    callback: IntersectionObserverCallback,
    options?: IntersectionObserverInit,
  ) => IntersectionObserver;
  readonly setActiveId: (id: string | null) => void;
  readonly getElementById: (id: string) => Element | null;
  readonly sectionIds: readonly string[];
  readonly rootMargin?: string;
  readonly thresholds?: readonly number[];
}

export interface SectionObserverController {
  /** Resolve every id, attach the observer, and start watching. */
  readonly start: () => void;
  /** Disconnect the observer. Safe to call multiple times. */
  readonly dispose: () => void;
}

/**
 * Pure controller around the IntersectionObserver + ratio map. The React
 * hook below plumbs real browser APIs into it; tests inject stubs to
 * exercise every branch without a DOM.
 */
export function createSectionObserverController(
  deps: SectionObserverControllerDeps,
): SectionObserverController {
  let observer: IntersectionObserver | null = null;
  const ratioById = new Map<string, number>();

  const rootMargin = deps.rootMargin ?? DEFAULT_SECTION_OBSERVER_ROOT_MARGIN;
  const thresholdSource = deps.thresholds ?? DEFAULT_SECTION_OBSERVER_THRESHOLDS;
  // IntersectionObserverInit's threshold is `number | number[]`; clone the
  // readonly tuple into a mutable copy so TS does not complain about the
  // readonly wrapper. Matches useScrollReveal's handling.
  const threshold: number[] = [...thresholdSource];

  function pickActive(): string | null {
    let bestId: string | null = null;
    let bestRatio = 0;
    for (const [id, ratio] of ratioById.entries()) {
      if (ratio > bestRatio) {
        bestRatio = ratio;
        bestId = id;
      }
    }
    return bestId;
  }

  return {
    start() {
      if (observer) return;
      observer = deps.observerFactory(
        (entries) => {
          for (const entry of entries) {
            const id = (entry.target as Element & { id?: string }).id;
            if (!id) continue;
            // Non-intersecting entries collapse to 0; otherwise we trust the
            // reported ratio. Storing zeros explicitly makes pickActive skip
            // them (the threshold `> 0` ignores them anyway) but keeps the
            // map shape stable for debugging.
            ratioById.set(id, entry.isIntersecting ? entry.intersectionRatio : 0);
          }
          deps.setActiveId(pickActive());
        },
        { rootMargin, threshold },
      );
      for (const id of deps.sectionIds) {
        const el = deps.getElementById(id);
        if (el) {
          observer.observe(el);
        }
      }
    },
    dispose() {
      if (observer) {
        observer.disconnect();
        observer = null;
      }
    },
  };
}

/**
 * React shell — observe the supplied section ids and return the currently
 * active id (or null if nothing is visible yet). SSR-safe: returns null on
 * the server render and hydrates the real value after mount.
 */
export function useSectionObserver(sectionIds: readonly string[]): string | null {
  const [activeId, setActiveId] = useState<string | null>(null);

  // Fold the id list into a stable primitive key so callers passing a fresh
  // array literal every render do not rebuild the observer unnecessarily.
  const sectionIdsKey = sectionIds.join(',');

  useEffect(() => {
    if (typeof window === 'undefined' || typeof IntersectionObserver === 'undefined') {
      return;
    }
    const controller = createSectionObserverController({
      observerFactory: (cb, opts) => new IntersectionObserver(cb, opts),
      setActiveId,
      getElementById: (id) => document.getElementById(id),
      sectionIds,
    });
    controller.start();
    return () => {
      controller.dispose();
    };
    // sectionIdsKey is the stable proxy for sectionIds — we intentionally
    // depend on the flattened key so we rebuild only when the set changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectionIdsKey]);

  return activeId;
}
