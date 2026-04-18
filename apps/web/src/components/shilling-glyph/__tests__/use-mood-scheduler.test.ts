/**
 * The mood scheduler is a pure controller that decides when to play one of the
 * five `idle` micro-animations (blink / wink / smirk-amp / glitch-shiver /
 * cursor-pulse). The React hook is a thin wrapper; keeping the logic in a
 * controller lets us test deterministically without jsdom or fake DOM.
 *
 * We mock:
 *   - Math.random substitutes via `random: () => number`
 *   - setTimeout/clearTimeout substitutes via `schedule / cancel`
 *
 * Spec recap:
 *   - micros are drawn from a weighted pool — blink + wink are common,
 *     smirk-amp is middle, glitch-shiver + cursor-pulse are rarer
 *   - next delay is a uniform random in [rangeMs[0], rangeMs[1]]
 *   - stop() clears any pending timer and does not fire any setter afterwards
 */
import { describe, it, expect, vi } from 'vitest';
import {
  pickMicroAnimation,
  pickNextDelayMs,
  MICRO_ANIMATIONS,
  createMoodScheduler,
} from '../use-mood-scheduler.js';

describe('MICRO_ANIMATIONS', () => {
  it('contains the five canonical idle micro actions', () => {
    expect([...MICRO_ANIMATIONS].sort()).toEqual(
      ['blink', 'wink', 'smirk-amp', 'glitch-shiver', 'cursor-pulse'].sort(),
    );
  });
});

describe('pickMicroAnimation', () => {
  it('returns blink for the low end of the [0,1) random range (blink heaviest weight)', () => {
    // Weighted pick: blink should occupy the leftmost slot.
    expect(pickMicroAnimation(0)).toBe('blink');
    expect(pickMicroAnimation(0.05)).toBe('blink');
  });

  it('returns glitch-shiver for the top end (smallest weight — rightmost slot)', () => {
    // 0.999 falls inside the last bucket regardless of exact weights.
    expect(pickMicroAnimation(0.999)).toBe('glitch-shiver');
  });

  it('returns one of the declared micro animations for any valid rand', () => {
    for (let i = 0; i < 20; i += 1) {
      const r = i / 20; // 0, 0.05, 0.1 … 0.95
      const picked = pickMicroAnimation(r);
      expect(MICRO_ANIMATIONS).toContain(picked);
    }
  });
});

describe('pickNextDelayMs', () => {
  it('maps rand=0 to the low end of the range', () => {
    expect(pickNextDelayMs(0, [8000, 15000])).toBe(8000);
  });

  it('maps rand→1 to (just under) the high end of the range', () => {
    // rand strictly < 1; floor(low + rand*(high-low)) at rand=0.9999 should be
    // essentially high - 1.
    const delay = pickNextDelayMs(0.9999, [8000, 15000]);
    expect(delay).toBeGreaterThanOrEqual(14999);
    expect(delay).toBeLessThan(15000);
  });

  it('returns an integer', () => {
    const delay = pickNextDelayMs(0.321, [8000, 15000]);
    expect(Number.isInteger(delay)).toBe(true);
  });
});

describe('createMoodScheduler', () => {
  function makeDeps(overrides: Partial<Parameters<typeof createMoodScheduler>[0]> = {}) {
    type Pending = { cb: () => void; delay: number; id: number };
    const pending: Pending[] = [];
    let nextId = 1;
    const setMicro = vi.fn<(_micro: (typeof MICRO_ANIMATIONS)[number] | null) => void>();
    const schedule = vi.fn((cb: () => void, delay: number): number => {
      const id = nextId++;
      pending.push({ cb, delay, id });
      return id;
    });
    const cancel = vi.fn((id: number): void => {
      const idx = pending.findIndex((p) => p.id === id);
      if (idx >= 0) pending.splice(idx, 1);
    });
    // Deterministic random: returns pre-seeded values in order, then 0.
    const values = overrides.random as unknown as number[] | undefined;
    let rIdx = 0;
    const random = vi.fn(() => (values && rIdx < values.length ? (values[rIdx++] ?? 0) : 0));

    return {
      setMicro,
      schedule,
      cancel,
      random,
      pending,
      flushNext() {
        const p = pending.shift();
        if (p) p.cb();
      },
    };
  }

  it('does nothing until start() is called', () => {
    const d = makeDeps();
    const s = createMoodScheduler({
      rangeMs: [8000, 15000],
      microDurationMs: 400,
      setMicro: d.setMicro,
      schedule: d.schedule,
      cancel: d.cancel,
      random: d.random,
    });
    expect(d.schedule).not.toHaveBeenCalled();
    s.start();
    expect(d.schedule).toHaveBeenCalledTimes(1);
  });

  it('on the first fire sets a micro, then schedules its clear, then schedules the next fire', () => {
    const d = makeDeps();
    d.random.mockReturnValueOnce(0.5); // first trigger delay mid-range
    d.random.mockReturnValueOnce(0.0); // first micro pick = blink
    d.random.mockReturnValueOnce(0.5); // next trigger delay mid-range

    const s = createMoodScheduler({
      rangeMs: [8000, 15000],
      microDurationMs: 400,
      setMicro: d.setMicro,
      schedule: d.schedule,
      cancel: d.cancel,
      random: d.random,
    });
    s.start();
    // First scheduled timer = wait for trigger.
    expect(d.schedule).toHaveBeenCalledTimes(1);
    // Fire the trigger.
    d.flushNext();
    // Now: setMicro called with a micro; a clear timer + a next trigger timer scheduled.
    expect(d.setMicro).toHaveBeenCalledTimes(1);
    expect(d.setMicro).toHaveBeenLastCalledWith('blink');
    // Two follow-up timers: clear-micro (400ms) and next-trigger (delay).
    expect(d.schedule).toHaveBeenCalledTimes(3);
  });

  it('clears the micro after microDurationMs', () => {
    const d = makeDeps();
    d.random.mockReturnValueOnce(0.5).mockReturnValueOnce(0.0).mockReturnValueOnce(0.5);
    const s = createMoodScheduler({
      rangeMs: [8000, 15000],
      microDurationMs: 400,
      setMicro: d.setMicro,
      schedule: d.schedule,
      cancel: d.cancel,
      random: d.random,
    });
    s.start();
    d.flushNext(); // trigger
    // pending: [clear, nextTrigger]
    expect(d.pending[0]?.delay).toBe(400);
    d.flushNext(); // clear
    expect(d.setMicro).toHaveBeenLastCalledWith(null);
  });

  it('stop() cancels any pending timer and setMicro is not called again after stop', () => {
    const d = makeDeps();
    const s = createMoodScheduler({
      rangeMs: [8000, 15000],
      microDurationMs: 400,
      setMicro: d.setMicro,
      schedule: d.schedule,
      cancel: d.cancel,
      random: d.random,
    });
    s.start();
    s.stop();
    expect(d.cancel).toHaveBeenCalled();
    // Flushing any stale timer after stop() must not invoke setMicro.
    const before = d.setMicro.mock.calls.length;
    d.flushNext();
    expect(d.setMicro.mock.calls.length).toBe(before);
  });
});
