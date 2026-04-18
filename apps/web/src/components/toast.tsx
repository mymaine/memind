'use client';

/**
 * Toast — minimal fixed-corner notification banner. V2-P5 Task 6 (AC-V2-9).
 *
 * Deliberately tiny: no 3rd-party deps (sonner / react-hot-toast banned by
 * spec), no queue (only one toast at a time; demo flow never surfaces more
 * than one), no enter/exit animation (just fade via opacity). The parent
 * owns the message state; this component handles its own 3s auto-dismiss
 * via an effect that watches `message`.
 */
import { useEffect, useState } from 'react';

export function Toast({
  message,
  onDismiss,
  durationMs = 3000,
}: {
  /** When non-null, the toast shows with this text; null hides it. */
  message: string | null;
  /** Called when the auto-dismiss timer fires so the parent can clear state. */
  onDismiss: () => void;
  durationMs?: number;
}): React.ReactElement | null {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (message === null) {
      setVisible(false);
      return;
    }
    setVisible(true);
    const t = setTimeout(() => {
      setVisible(false);
      onDismiss();
    }, durationMs);
    return () => {
      clearTimeout(t);
    };
    // onDismiss is stable when the parent wraps it in useCallback; intentionally
    // only re-run on message change to avoid resetting the timer mid-countdown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message, durationMs]);

  if (message === null || !visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed right-4 top-4 z-50 max-w-[360px] rounded-[var(--radius-card)] border border-[color:var(--color-danger)] bg-bg-surface px-4 py-2 font-[family-name:var(--font-sans-body)] text-[13px] text-fg-primary shadow-lg"
    >
      <span className="font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.5px] text-[color:var(--color-danger)]">
        conflict ·{' '}
      </span>
      {message}
    </div>
  );
}
