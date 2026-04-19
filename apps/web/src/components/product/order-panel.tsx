'use client';

/**
 * OrderPanel — the productised Market run surface (AC-P4.7-5).
 *
 * Composes five states around the `useRun()` lifecycle, mapped through the
 * pure `deriveOrderState` reducer:
 *
 *   idle       → "Step 2 · Order a shill" overline + self-contained form
 *                (tokenAddr / tokenSymbol / creatorBrief / submit).
 *   processing → "Processing · paying via x402" overline + <RunProgress>
 *                4-step indicator (paying / queued / drafting / posted);
 *                form inputs go read-only.
 *   posted     → "Done · posted on X" overline + <TweetPreviewCard /> +
 *                x402 settlement pill (shill-tweet is surfaced inline via
 *                TweetPreviewCard and is filtered out of pills) +
 *                "Order another" secondary button.
 *   failed     → "Skipped by shiller" warning-tinted overline + skip
 *                message + x402 pill (still visible because settlement
 *                landed before the skip) + "Order another".
 *   error      → "Error" overline + danger-tinted error banner +
 *                "Order another".
 *
 * Composition model:
 *   - The panel is stateful + hook-driven. Tests drive it by passing a
 *     `runController` shaped like `UseRunResult`; production code omits the
 *     prop so `useRun()` takes over.
 *   - Form validation (EVM-address regex, symbol/brief length caps) is
 *     self-contained so the panel drops into a page without needing the
 *     caller to fork /market/page.tsx's validation.
 *   - `Order another` calls the injected / hooked `resetRun()` — the hook
 *     helper closes the SSE, nulls refs, and pushes IDLE_STATE so the
 *     panel naturally re-renders in the `idle` branch. Form state is
 *     preserved across reset so a creator can tweak one field and fire
 *     another order.
 *
 * Structural guarantee: `<section id="order">` is always the outer wrapper
 * so the HeroScene SECONDARY CTA (`/market#order`) keeps anchoring
 * regardless of the live state.
 */
import { useCallback, useMemo, useState, type FormEvent, type ReactElement } from 'react';
import type { Artifact, CreateRunRequest } from '@hack-fourmeme/shared';
import { EMPTY_ASSISTANT_TEXT, EMPTY_TOOL_CALLS } from '@/hooks/useRun-state';
import { useRun, type UseRunResult } from '@/hooks/useRun';
import { deriveOrderState, type OrderPanelState } from './derive-order-state';
import { ResultPills } from './result-pills';
import { RunProgress, type RunProgressStep } from './run-progress';
import { TweetPreviewCard } from './tweet-preview-card';

export interface OrderPanelProps {
  /**
   * Optional `useRun()` injection for tests. Omit in production so the
   * panel hooks into the real SSE lifecycle.
   */
  readonly runController?: UseRunResult;
  /** Prefill token address; persists across `Order another` resets. */
  readonly initialTokenAddr?: string;
  readonly initialSymbol?: string;
  readonly initialBrief?: string;
  readonly className?: string;
}

// ── Demo defaults ──────────────────────────────────────────────────────
// Mirrors /market/page.tsx so a cold viewer on demo day can click
// "Order Shill" without typing anything and still land a realistic run.
const DEFAULT_TOKEN_ADDR = '0x4E39d254c716D88Ae52D9cA136F0a029c5F74444';
const DEFAULT_TOKEN_SYMBOL = 'HBNB2026-DemoToken';

const EVM_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const TOKEN_SYMBOL_MAX = 32;
const CREATOR_BRIEF_MAX = 200;

interface FormValidation {
  readonly ok: boolean;
  readonly reason: string | null;
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

// ── Style tokens (mirror LaunchPanel) ──────────────────────────────────
const OVERLINE_CLASS =
  'font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.5px] text-fg-tertiary';

const SECTION_CLASS =
  'flex flex-col gap-4 rounded-[var(--radius-card)] border border-border-default bg-bg-surface p-6';

const SECONDARY_BUTTON_CLASS =
  'inline-flex items-center justify-center rounded-[var(--radius-default)] border border-border-default bg-transparent px-4 py-2 font-[family-name:var(--font-sans-body)] text-[13px] font-medium text-fg-primary transition-colors duration-150 hover:border-accent';

const INPUT_CLASS =
  'rounded-[var(--radius-default)] border border-border-default bg-bg-primary px-3 py-2 font-[family-name:var(--font-mono)] text-[12px] text-fg-primary placeholder:text-fg-tertiary focus:border-2 focus:border-accent focus:outline-none disabled:opacity-60';

const TEXTAREA_CLASS =
  'resize-none rounded-[var(--radius-default)] border border-border-default bg-bg-primary px-3 py-2 font-[family-name:var(--font-sans-body)] text-[13px] text-fg-primary placeholder:text-fg-tertiary focus:border-2 focus:border-accent focus:outline-none disabled:opacity-60';

const LABEL_CLASS =
  'font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.5px] text-fg-tertiary';

const PRIMARY_BUTTON_CLASS =
  'rounded-[var(--radius-default)] border-2 border-accent bg-bg-surface px-4 py-2 font-[family-name:var(--font-sans-body)] text-[14px] font-semibold text-accent-text transition-opacity duration-150 hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-40';

/**
 * Map the reduced processing-state step statuses to the shape RunProgress
 * expects. Order is locked to the shill-market orchestrator emit sequence
 * (spec §Product-in-Action): Paying → Queued → Drafting → Posted.
 */
function toProgressSteps(steps: {
  paying: 'idle' | 'running' | 'done';
  queued: 'idle' | 'running' | 'done';
  drafting: 'idle' | 'running' | 'done';
  posted: 'idle' | 'running' | 'done';
}): readonly RunProgressStep[] {
  return [
    { key: 'paying', label: 'Paying', status: steps.paying },
    { key: 'queued', label: 'Queued', status: steps.queued },
    { key: 'drafting', label: 'Drafting', status: steps.drafting },
    { key: 'posted', label: 'Posted', status: steps.posted },
  ];
}

/**
 * The pill row for posted / failed surfaces only shows the x402 settlement
 * receipt. `isPillArtifact` already excludes shill-order / shill-tweet, so
 * the rendered set is narrowed to x402 kinds emitted by this flow; passing
 * the raw artifact list avoids duplicating the filter here and keeps the
 * component honest if a future kind lands in the flow.
 */
function runArtifacts(controller: UseRunResult): readonly Artifact[] {
  return controller.state.phase === 'idle' ? [] : controller.state.artifacts;
}

// ── Sub-views ──────────────────────────────────────────────────────────

interface IdleFormProps {
  readonly tokenAddr: string;
  readonly tokenSymbol: string;
  readonly creatorBrief: string;
  readonly includeFourMemeUrl: boolean;
  readonly validation: FormValidation;
  readonly onTokenAddrChange: (v: string) => void;
  readonly onTokenSymbolChange: (v: string) => void;
  readonly onCreatorBriefChange: (v: string) => void;
  readonly onIncludeFourMemeUrlChange: (v: boolean) => void;
  readonly onSubmit: (e: FormEvent) => void;
}

function IdleForm(props: IdleFormProps): ReactElement {
  const {
    tokenAddr,
    tokenSymbol,
    creatorBrief,
    includeFourMemeUrl,
    validation,
    onTokenAddrChange,
    onTokenSymbolChange,
    onCreatorBriefChange,
    onIncludeFourMemeUrlChange,
    onSubmit,
  } = props;
  const disabled = !validation.ok;
  return (
    <>
      <span className={OVERLINE_CLASS}>Step 2 · Order a shill</span>
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className={LABEL_CLASS}>Token address</span>
          <input
            id="order-tokenAddr"
            type="text"
            value={tokenAddr}
            onChange={(e) => {
              onTokenAddrChange(e.target.value.trim());
            }}
            aria-invalid={!EVM_ADDRESS_RE.test(tokenAddr)}
            className={INPUT_CLASS}
            placeholder="0x…"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className={LABEL_CLASS}>Symbol (optional)</span>
          <input
            id="order-tokenSymbol"
            type="text"
            value={tokenSymbol}
            onChange={(e) => {
              onTokenSymbolChange(e.target.value);
            }}
            maxLength={TOKEN_SYMBOL_MAX}
            className={INPUT_CLASS}
            placeholder="HBNB2026-Example"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className={LABEL_CLASS}>
            Creator brief (optional, ≤ {CREATOR_BRIEF_MAX.toString()} chars)
          </span>
          <textarea
            id="order-creatorBrief"
            value={creatorBrief}
            onChange={(e) => {
              onCreatorBriefChange(e.target.value);
            }}
            maxLength={CREATOR_BRIEF_MAX}
            rows={3}
            className={TEXTAREA_CLASS}
            placeholder="Optional hook the shiller agent should work into the tweet."
          />
          <span className="self-end font-[family-name:var(--font-mono)] text-[10px] text-fg-tertiary">
            {creatorBrief.length.toString()}/{CREATOR_BRIEF_MAX.toString()}
          </span>
        </label>

        <fieldset className="flex flex-col gap-2">
          <legend className={LABEL_CLASS}>Tweet mode</legend>
          <label className="flex items-start gap-2 text-[13px]">
            <input
              type="radio"
              name="tweetMode"
              value="safe"
              checked={!includeFourMemeUrl}
              onChange={() => {
                onIncludeFourMemeUrlChange(false);
              }}
            />
            <span>
              <span className="block font-medium text-fg-primary">Safe mode (recommended)</span>
              <span className="block text-fg-tertiary">
                Tweet body only — no URL, no raw address. Works during X&apos;s 7-day crypto-address
                cooldown.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-[13px]">
            <input
              type="radio"
              name="tweetMode"
              value="with-url"
              checked={includeFourMemeUrl}
              onChange={() => {
                onIncludeFourMemeUrlChange(true);
              }}
            />
            <span>
              <span className="block font-medium text-fg-primary">
                With four.meme click-through URL
              </span>
              <span className="block text-fg-tertiary">
                Appends https://four.meme/token/&lt;addr&gt; so readers land on the sponsor page.{' '}
                <strong>
                  Blocked by X during the 7-day cooldown after OAuth token regeneration
                </strong>{' '}
                — use once the cooldown clears.
              </span>
            </span>
          </label>
        </fieldset>

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
          data-testid="order-submit"
          className={PRIMARY_BUTTON_CLASS}
        >
          Order Shill · 0.01 USDC
        </button>

        <p className={`${LABEL_CLASS} normal-case tracking-normal`}>
          Tweet will appear here after settlement
        </p>
      </form>
    </>
  );
}

interface ProcessingViewProps {
  readonly state: Extract<OrderPanelState, { kind: 'processing' }>;
  readonly tokenAddr: string;
  readonly tokenSymbol: string;
  readonly creatorBrief: string;
}

/**
 * Read-only form shadow + RunProgress. Keeping the form mounted (rather
 * than swapping in a blank panel) means the user sees their inputs
 * reflected while the run streams; the boolean `disabled` attribute is
 * the single knob that blocks edits.
 */
function ProcessingView(props: ProcessingViewProps): ReactElement {
  const { state, tokenAddr, tokenSymbol, creatorBrief } = props;
  return (
    <>
      <span className={OVERLINE_CLASS}>Processing · paying via x402</span>
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className={LABEL_CLASS}>Token address</span>
          <input
            type="text"
            value={tokenAddr}
            readOnly
            disabled
            aria-disabled="true"
            className={INPUT_CLASS}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={LABEL_CLASS}>Symbol</span>
          <input
            type="text"
            value={tokenSymbol}
            readOnly
            disabled
            aria-disabled="true"
            className={INPUT_CLASS}
          />
        </label>
        {creatorBrief.length > 0 ? (
          <label className="flex flex-col gap-1">
            <span className={LABEL_CLASS}>Creator brief</span>
            <textarea
              value={creatorBrief}
              readOnly
              disabled
              aria-disabled="true"
              rows={3}
              className={TEXTAREA_CLASS}
            />
          </label>
        ) : null}
      </div>
      <RunProgress steps={toProgressSteps(state.steps)} latestToolUse={state.latestToolUse} />
    </>
  );
}

interface PostedViewProps {
  readonly state: Extract<OrderPanelState, { kind: 'posted' }>;
  readonly artifacts: readonly Artifact[];
  readonly onReset: () => void;
}

function PostedView(props: PostedViewProps): ReactElement {
  const { state, artifacts, onReset } = props;
  return (
    <>
      <span className={OVERLINE_CLASS}>Done · posted on X</span>
      <TweetPreviewCard
        body={state.shillTweetArtifact.tweetText}
        postedAt={state.shillTweetArtifact.ts}
        tweetUrl={state.shillTweetArtifact.tweetUrl}
        handle="shiller_x"
        animated
      />
      <ResultPills artifacts={artifacts} />
      <div>
        <button
          type="button"
          onClick={onReset}
          data-testid="order-another"
          className={SECONDARY_BUTTON_CLASS}
        >
          Order another
        </button>
      </div>
    </>
  );
}

interface FailedViewProps {
  readonly state: Extract<OrderPanelState, { kind: 'failed' }>;
  readonly artifacts: readonly Artifact[];
  readonly onReset: () => void;
}

function FailedView(props: FailedViewProps): ReactElement {
  const { state, artifacts, onReset } = props;
  return (
    <>
      <span className={`${OVERLINE_CLASS} text-[color:var(--color-warning)]`}>
        Skipped by shiller
      </span>
      <div
        role="alert"
        className="rounded-[var(--radius-card)] border border-[color:var(--color-warning)] p-2 text-[13px] text-fg-primary"
      >
        <span className="font-[family-name:var(--font-mono)] text-fg-tertiary">skip · </span>
        {state.message}
      </div>
      <ResultPills artifacts={artifacts} />
      <div>
        <button
          type="button"
          onClick={onReset}
          data-testid="order-another"
          className={SECONDARY_BUTTON_CLASS}
        >
          Order another
        </button>
      </div>
    </>
  );
}

interface ErrorViewProps {
  readonly state: Extract<OrderPanelState, { kind: 'error' }>;
  readonly onReset: () => void;
}

function ErrorView(props: ErrorViewProps): ReactElement {
  const { state, onReset } = props;
  return (
    <>
      <span className={`${OVERLINE_CLASS} text-[color:var(--color-danger)]`}>Error</span>
      <div
        role="alert"
        className="rounded-[var(--radius-card)] border border-[color:var(--color-danger)] p-2 text-[13px] text-fg-primary"
      >
        <span className="font-[family-name:var(--font-mono)] text-fg-tertiary">error · </span>
        {state.message}
      </div>
      <div>
        <button
          type="button"
          onClick={onReset}
          data-testid="order-another"
          className={SECONDARY_BUTTON_CLASS}
        >
          Order another
        </button>
      </div>
    </>
  );
}

// ── Public component ───────────────────────────────────────────────────

export function OrderPanel({
  runController,
  initialTokenAddr = DEFAULT_TOKEN_ADDR,
  initialSymbol = DEFAULT_TOKEN_SYMBOL,
  initialBrief = '',
  className,
}: OrderPanelProps): ReactElement {
  // Rules-of-hooks require an unconditional hook call; we always call
  // `useRun()` even when the caller injects a controller (tests pass
  // `runController` and never exercise the hook's live path).
  const hookResult = useRun();
  const controller = runController ?? hookResult;
  const { state: runState, startRun, resetRun } = controller;

  // Form state stays inside the panel and persists across `Order another`
  // resets — `resetRun()` only clears the SSE lifecycle, not this.
  const [tokenAddr, setTokenAddr] = useState<string>(initialTokenAddr);
  const [tokenSymbol, setTokenSymbol] = useState<string>(initialSymbol);
  const [creatorBrief, setCreatorBrief] = useState<string>(initialBrief);
  // Tweet-mode toggle (2026-04-19). Defaults to safe mode (URL-free tweet)
  // because demo-day falls inside X's 7-day post-OAuth cooldown — any
  // URL-bearing post would be blocked. The `with-url` option stays available
  // for judges / post-cooldown flows: the sponsor click-through path was the
  // original design and the radio keeps that story visible in the UI.
  const [includeFourMemeUrl, setIncludeFourMemeUrl] = useState<boolean>(false);

  const validation = useMemo<FormValidation>(
    () => validateForm(tokenAddr, tokenSymbol, creatorBrief),
    [tokenAddr, tokenSymbol, creatorBrief],
  );

  const orderState = useMemo<OrderPanelState>(
    () =>
      deriveOrderState({
        phase: runState.phase,
        artifacts: runState.phase === 'idle' ? [] : runState.artifacts,
        toolCalls: runState.phase === 'idle' ? EMPTY_TOOL_CALLS : runState.toolCalls,
        assistantText: runState.phase === 'idle' ? EMPTY_ASSISTANT_TEXT : runState.assistantText,
        logs: runState.phase === 'idle' ? [] : runState.logs,
        error: runState.phase === 'error' ? runState.error : null,
      }),
    [runState],
  );

  const onSubmit = useCallback(
    async (e: FormEvent): Promise<void> => {
      e.preventDefault();
      if (!validation.ok) return;
      // Only forward optional fields when the user actually provided them —
      // keeps the server's zod-parsed params object minimal. For the tweet-
      // mode toggle, only attach when the user opted into the URL path;
      // safe mode is the route-layer default so we skip the key to keep the
      // payload quiet.
      const params: Record<string, string | boolean> = { tokenAddr };
      if (tokenSymbol.length > 0) params.tokenSymbol = tokenSymbol;
      if (creatorBrief.length > 0) params.creatorBrief = creatorBrief;
      if (includeFourMemeUrl) params.includeFourMemeUrl = true;
      const input: CreateRunRequest = { kind: 'shill-market', params };
      await startRun(input);
    },
    [validation, tokenAddr, tokenSymbol, creatorBrief, includeFourMemeUrl, startRun],
  );

  const containerClass = `${SECTION_CLASS} ${className ?? ''}`.trim();
  const artifacts = runArtifacts(controller);

  return (
    <section id="order" className={containerClass}>
      {orderState.kind === 'idle' ? (
        <IdleForm
          tokenAddr={tokenAddr}
          tokenSymbol={tokenSymbol}
          creatorBrief={creatorBrief}
          includeFourMemeUrl={includeFourMemeUrl}
          validation={validation}
          onTokenAddrChange={setTokenAddr}
          onTokenSymbolChange={setTokenSymbol}
          onCreatorBriefChange={setCreatorBrief}
          onIncludeFourMemeUrlChange={setIncludeFourMemeUrl}
          onSubmit={(e) => {
            void onSubmit(e);
          }}
        />
      ) : null}

      {orderState.kind === 'processing' ? (
        <ProcessingView
          state={orderState}
          tokenAddr={tokenAddr}
          tokenSymbol={tokenSymbol}
          creatorBrief={creatorBrief}
        />
      ) : null}

      {orderState.kind === 'posted' ? (
        <PostedView state={orderState} artifacts={artifacts} onReset={resetRun} />
      ) : null}

      {orderState.kind === 'failed' ? (
        <FailedView state={orderState} artifacts={artifacts} onReset={resetRun} />
      ) : null}

      {orderState.kind === 'error' ? <ErrorView state={orderState} onReset={resetRun} /> : null}
    </section>
  );
}
