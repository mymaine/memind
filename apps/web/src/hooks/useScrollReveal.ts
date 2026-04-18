'use client';

/**
 * One-way reveal latch powered by IntersectionObserver.
 *
 * Backs AC-P4.7-8 (scene containers fade + translate in on first entry and
 * stay revealed forever). The hook returns false on the initial render to
 * keep SSR and hydration aligned, attaches an observer in a post-mount
 * effect, flips to true on the first isIntersecting entry, and disconnects
 * the observer immediately — once a scene has entered, it never resets.
 */
import { useEffect, useState, type RefObject } from 'react';

export const DEFAULT_REVEAL_ROOT_MARGIN = '-10% 0px';
export const DEFAULT_REVEAL_THRESHOLD = 0;

export interface UseScrollRevealOptions {
  readonly rootMargin?: string;
  readonly threshold?: number | readonly number[];
}

export interface RevealControllerDeps {
  readonly observerFactory: (
    callback: IntersectionObserverCallback,
    options?: IntersectionObserverInit,
  ) => IntersectionObserver;
  readonly setHasEntered: (value: boolean) => void;
  readonly rootMargin: string;
  readonly threshold: number | readonly number[];
}

export interface RevealController {
  /** Attach the observer to a concrete element. Safe to call at most once. */
  readonly observe: (target: Element) => void;
  /** Tear down the observer. Safe to call multiple times or without observe. */
  readonly dispose: () => void;
}

/**
 * Pure controller around the IntersectionObserver lifecycle. React hook plugs
 * real IO + setState; tests inject a stub observer and a setState spy.
 */
export function createRevealController(deps: RevealControllerDeps): RevealController {
  let observer: IntersectionObserver | null = null;
  let latched = false;

  return {
    observe(target) {
      if (observer) return;
      // IntersectionObserverInit's threshold is `number | number[]`; clone the
      // readonly tuple into a mutable copy so TS is happy without mutating.
      const threshold: number | number[] =
        typeof deps.threshold === 'number' ? deps.threshold : [...deps.threshold];
      observer = deps.observerFactory(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting && !latched) {
              latched = true;
              deps.setHasEntered(true);
              observer?.disconnect();
              observer = null;
              return;
            }
          }
        },
        { rootMargin: deps.rootMargin, threshold },
      );
      observer.observe(target);
    },
    dispose() {
      if (observer) {
        observer.disconnect();
        observer = null;
      }
    },
  };
}

export function useScrollReveal<T extends Element>(
  ref: RefObject<T | null>,
  options?: UseScrollRevealOptions,
): boolean {
  const [hasEntered, setHasEntered] = useState(false);

  // Destructure to keep the effect dep list on primitives, so passing a fresh
  // options object every render does not rebuild the observer.
  const rootMargin = options?.rootMargin ?? DEFAULT_REVEAL_ROOT_MARGIN;
  const threshold = options?.threshold ?? DEFAULT_REVEAL_THRESHOLD;
  const thresholdKey = Array.isArray(threshold) ? threshold.join(',') : String(threshold);

  useEffect(() => {
    // SSR guard: bail on the server where window / IO are undefined.
    if (typeof window === 'undefined' || typeof IntersectionObserver === 'undefined') {
      return;
    }
    const el = ref.current;
    if (!el) return;

    const controller = createRevealController({
      observerFactory: (cb, opts) => new IntersectionObserver(cb, opts),
      setHasEntered,
      rootMargin,
      threshold,
    });
    controller.observe(el);
    return () => {
      controller.dispose();
    };
    // thresholdKey folds the array case into a primitive so React compares by value.
  }, [ref, rootMargin, thresholdKey, threshold]);

  return hasEntered;
}
