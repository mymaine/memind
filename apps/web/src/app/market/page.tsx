'use client';

/**
 * /market — Shilling Market route (AC-P4.6-4).
 *
 * Creator-facing surface: enter a target token address + optional brief, pay
 * 0.01 USDC over x402, watch the Shiller agent post a promotional tweet.
 * Layout follows the mockup in docs/features/shilling-market.md:
 *   left  — order form (sticky inputs)
 *   right — ShillOrderPanel (active + completed orders) + LogPanel (SSE)
 *
 * Reuses `useRun()` so this page shares its run lifecycle semantics with the
 * root `/` dashboard; the only divergence is `kind: 'shill-market'`.
 */
import { useCallback, useMemo, useState } from 'react';
import type { CreateRunRequest } from '@hack-fourmeme/shared';
import { LogPanel } from '@/components/log-panel';
import { ShillOrderPanel } from '@/components/shill-order-panel';
import { EMPTY_ASSISTANT_TEXT, EMPTY_TOOL_CALLS } from '@/hooks/useRun-state';
import { useRun } from '@/hooks/useRun';

// Demo defaults — chosen so a cold viewer on demo day can click "Order Shill"
// without typing anything and still see a realistic target. Mirrors the
// convention used by preset-texts on the root dashboard.
const DEFAULT_TOKEN_ADDR = '0x4E39d254c716D88Ae52D9cA136F0a029c5F74444';
const DEFAULT_TOKEN_SYMBOL = 'HBNB2026-DemoToken';

const EVM_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const TOKEN_SYMBOL_MAX = 32;
const CREATOR_BRIEF_MAX = 200;

interface FormValidation {
  ok: boolean;
  /** Message when NOT ok, keyed to the failing field. */
  reason: string | null;
}

function validateForm(
  tokenAddr: string,
  tokenSymbol: string,
  creatorBrief: string,
): FormValidation {
  if (!EVM_ADDRESS_RE.test(tokenAddr)) {
    return { ok: false, reason: 'Token address must match 0x + 40 hex chars' };
  }
  if (tokenSymbol.length > TOKEN_SYMBOL_MAX) {
    return { ok: false, reason: `Symbol must be ≤ ${TOKEN_SYMBOL_MAX.toString()} chars` };
  }
  if (creatorBrief.length > CREATOR_BRIEF_MAX) {
    return {
      ok: false,
      reason: `Creator brief must be ≤ ${CREATOR_BRIEF_MAX.toString()} chars`,
    };
  }
  return { ok: true, reason: null };
}

export default function MarketPage(): React.ReactElement {
  const { state, startRun } = useRun();

  const [tokenAddr, setTokenAddr] = useState(DEFAULT_TOKEN_ADDR);
  const [tokenSymbol, setTokenSymbol] = useState(DEFAULT_TOKEN_SYMBOL);
  const [creatorBrief, setCreatorBrief] = useState('');

  const validation = useMemo(
    () => validateForm(tokenAddr, tokenSymbol, creatorBrief),
    [tokenAddr, tokenSymbol, creatorBrief],
  );

  const running = state.phase === 'running';
  const disabled = running || !validation.ok;

  const onSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (disabled) return;
      const params: Record<string, string> = { tokenAddr };
      // Only forward optional fields when the user actually provided them —
      // keeps the server's zod-parsed params object minimal.
      if (tokenSymbol.length > 0) params.tokenSymbol = tokenSymbol;
      if (creatorBrief.length > 0) params.creatorBrief = creatorBrief;
      const input: CreateRunRequest = { kind: 'shill-market', params };
      await startRun(input);
    },
    [disabled, tokenAddr, tokenSymbol, creatorBrief, startRun],
  );

  const artifacts = state.phase === 'idle' ? [] : state.artifacts;
  const logs = state.phase === 'idle' ? [] : state.logs;
  const toolCalls = state.phase === 'idle' ? EMPTY_TOOL_CALLS : state.toolCalls;
  const assistantText = state.phase === 'idle' ? EMPTY_ASSISTANT_TEXT : state.assistantText;

  return (
    <main className="mx-auto flex min-h-[calc(100vh-56px)] max-w-[1400px] flex-col gap-5 px-6 py-4">
      {/* Shared <Header /> is mounted at the layout level (V4.7-P1 Task 4);
          the page-level "Shilling Market" header block lived here before
          and has been removed. Market-hero narrative lands in V4.7-P4. */}
      <div className="grid grid-cols-1 gap-5 md:grid-cols-[360px_1fr]">
        <section
          aria-label="Order form"
          className="flex h-fit flex-col gap-3 rounded-[var(--radius-card)] border border-border-default bg-bg-primary p-4"
        >
          <header className="font-[family-name:var(--font-sans-display)] text-[13px] font-semibold uppercase tracking-[0.5px] text-fg-tertiary">
            Order a shill
          </header>
          <form onSubmit={onSubmit} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1">
              <span className="font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.5px] text-fg-tertiary">
                Token address
              </span>
              <input
                id="market-tokenAddr"
                type="text"
                value={tokenAddr}
                onChange={(e) => setTokenAddr(e.target.value.trim())}
                disabled={running}
                aria-invalid={!EVM_ADDRESS_RE.test(tokenAddr)}
                className="rounded-[var(--radius-default)] border border-border-default bg-bg-surface px-3 py-2 font-[family-name:var(--font-mono)] text-[12px] text-fg-primary placeholder:text-fg-tertiary focus:border-2 focus:border-accent focus:outline-none disabled:opacity-60"
                placeholder="0x…"
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.5px] text-fg-tertiary">
                Symbol (optional)
              </span>
              <input
                id="market-tokenSymbol"
                type="text"
                value={tokenSymbol}
                onChange={(e) => setTokenSymbol(e.target.value)}
                disabled={running}
                maxLength={TOKEN_SYMBOL_MAX}
                className="rounded-[var(--radius-default)] border border-border-default bg-bg-surface px-3 py-2 font-[family-name:var(--font-mono)] text-[12px] text-fg-primary placeholder:text-fg-tertiary focus:border-2 focus:border-accent focus:outline-none disabled:opacity-60"
                placeholder="HBNB2026-Example"
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.5px] text-fg-tertiary">
                Creator brief (optional, ≤ {CREATOR_BRIEF_MAX.toString()} chars)
              </span>
              <textarea
                id="market-creatorBrief"
                value={creatorBrief}
                onChange={(e) => setCreatorBrief(e.target.value)}
                disabled={running}
                maxLength={CREATOR_BRIEF_MAX}
                rows={3}
                className="resize-none rounded-[var(--radius-default)] border border-border-default bg-bg-surface px-3 py-2 font-[family-name:var(--font-sans-body)] text-[13px] text-fg-primary placeholder:text-fg-tertiary focus:border-2 focus:border-accent focus:outline-none disabled:opacity-60"
                placeholder="Optional hook the shiller agent should work into the tweet."
              />
              <span className="self-end font-[family-name:var(--font-mono)] text-[10px] text-fg-tertiary">
                {creatorBrief.length.toString()}/{CREATOR_BRIEF_MAX.toString()}
              </span>
            </label>

            {validation.reason !== null ? (
              <p
                role="alert"
                className="rounded-[var(--radius-default)] border border-[color:var(--color-danger)] px-2 py-1 font-[family-name:var(--font-mono)] text-[11px] text-[color:var(--color-danger)]"
              >
                {validation.reason}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={disabled}
              aria-label="Submit shill order"
              className="rounded-[var(--radius-default)] border-2 border-accent bg-bg-surface px-4 py-2 font-[family-name:var(--font-sans-body)] text-[14px] font-semibold text-accent-text transition-opacity duration-150 hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {running ? 'Processing…' : 'Order Shill (0.01 USDC)'}
            </button>
          </form>

          {state.phase === 'error' ? (
            <div
              role="alert"
              className="rounded-[var(--radius-card)] border border-[color:var(--color-danger)] p-2 text-[13px] text-fg-primary"
            >
              <span className="font-[family-name:var(--font-mono)] text-fg-tertiary">error · </span>
              {state.error}
            </div>
          ) : null}
        </section>

        <section aria-label="Market feed" className="flex flex-col gap-4">
          <ShillOrderPanel artifacts={artifacts} />
          <LogPanel
            logs={logs}
            toolCalls={state.phase === 'idle' ? undefined : toolCalls}
            assistantText={state.phase === 'idle' ? undefined : assistantText}
          />
        </section>
      </div>

      <footer className="border-t border-border-default pt-2 text-[11px] text-fg-tertiary">
        <span className="font-[family-name:var(--font-mono)]">
          Four.Meme AI Sprint · Phase 4.6 Shilling Market · base-sepolia
        </span>
      </footer>
    </main>
  );
}
