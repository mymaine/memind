'use client';

/**
 * HeartbeatSection — dashboard wrapper that owns the independent run
 * lifecycle for `{kind:'heartbeat', tokenAddress}`. A SECOND `useRun`
 * instance is used so the a2a flow's state and the heartbeat flow's state
 * never collide (per docs/features/dashboard-v2.md: the tokenAddress input
 * is deliberately separate — users paste the BSC address from a previous
 * a2a run's BscScan pill).
 *
 * Layout:
 *   - tokenAddress input + Run button row
 *   - HeartbeatPanel below, fed the local useRun's artifacts + phase.
 */
import { useState } from 'react';
import { HeartbeatPanel } from './heartbeat-panel';
import { useRun } from '@/hooks/useRun';

const EVM_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

export function HeartbeatSection(): React.ReactElement {
  const { state, startRun } = useRun();
  const [tokenAddress, setTokenAddress] = useState('');
  const [error, setError] = useState<string | null>(null);
  // V2-P5: collapsed-by-default so the a2a main view fits 1920x960 single-
  // screen. Users click the header to expand when they need heartbeat.
  const [expanded, setExpanded] = useState(false);

  const trimmed = tokenAddress.trim();
  const isValid = EVM_ADDRESS_REGEX.test(trimmed);
  const isRunning = state.phase === 'running';

  const handleRun = async (): Promise<void> => {
    if (!isValid || isRunning) return;
    setError(null);
    try {
      await startRun({ kind: 'heartbeat', params: { tokenAddress: trimmed } });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'unknown error');
    }
  };

  return (
    <section
      aria-label="Heartbeat section"
      className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border-default bg-bg-primary p-4"
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="flex items-center gap-2">
          <span
            aria-hidden
            className={`font-[family-name:var(--font-mono)] text-[12px] text-fg-tertiary transition-transform ${expanded ? 'rotate-90' : ''}`}
          >
            {'>'}
          </span>
          <span className="font-[family-name:var(--font-sans-display)] text-[13px] font-semibold uppercase tracking-[0.5px] text-fg-tertiary">
            Heartbeat — independent run
          </span>
        </span>
        <span className="font-[family-name:var(--font-mono)] text-[11px] text-fg-tertiary">
          3 ticks · 10s · {expanded ? 'click to collapse' : 'click to expand'}
        </span>
      </button>

      {!expanded ? null : (
        <>
          <form
            className="flex flex-col gap-2 md:flex-row md:items-center"
            onSubmit={(e) => {
              e.preventDefault();
              void handleRun();
            }}
          >
            <input
              type="text"
              value={tokenAddress}
              onChange={(e) => {
                setTokenAddress(e.target.value);
              }}
              placeholder="BSC token address (0x…)"
              disabled={isRunning}
              aria-label="BSC token address"
              className="flex-1 rounded-[var(--radius-card)] border border-border-default bg-bg-primary px-3 py-2 font-[family-name:var(--font-mono)] text-[13px] text-fg-primary outline-none focus:border-accent"
            />
            <button
              type="submit"
              disabled={!isValid || isRunning}
              className="rounded-[var(--radius-card)] border border-accent bg-accent/10 px-4 py-2 font-[family-name:var(--font-sans-display)] text-[13px] uppercase tracking-[0.5px] text-accent transition-colors hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isRunning ? 'Running …' : 'Run heartbeat'}
            </button>
          </form>

          {state.phase === 'error' ? (
            <div
              role="alert"
              className="rounded-[var(--radius-card)] border border-[color:var(--color-danger)] p-3 text-[13px] text-fg-primary"
            >
              <span className="font-[family-name:var(--font-mono)] text-fg-tertiary">
                heartbeat error ·{' '}
              </span>
              {state.error}
            </div>
          ) : null}
          {error !== null ? (
            <div
              role="alert"
              className="rounded-[var(--radius-card)] border border-[color:var(--color-danger)] p-3 text-[13px] text-fg-primary"
            >
              <span className="font-[family-name:var(--font-mono)] text-fg-tertiary">
                dispatch error ·{' '}
              </span>
              {error}
            </div>
          ) : null}

          <HeartbeatPanel
            artifacts={state.phase === 'idle' ? [] : state.artifacts}
            phase={state.phase}
            tokenAddress={state.phase === 'idle' ? (isValid ? trimmed : null) : trimmed || null}
          />
        </>
      )}
    </section>
  );
}
