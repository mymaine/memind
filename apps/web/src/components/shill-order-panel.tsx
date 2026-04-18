'use client';

/**
 * ShillOrderPanel — AC-P4.6-4 Dashboard Shill Order Panel.
 *
 * Consumes the SSE artifact stream and renders the active + completed shill
 * orders as a single list with status pills and (when posted) an "View on X"
 * pill linking to the promotional tweet. Mirrors AnchorLedgerPanel's shape so
 * the dashboard reads as one visual system.
 */
import type { Artifact } from '@hack-fourmeme/shared';
import {
  collectShillOrderRows,
  type ShillOrderRowView,
  type ShillOrderStatus,
} from './shill-order-derive';

// MVP: the x402 handler stubs the paid-tx hash with 64 zeros before the
// settle path is wired end-to-end. Detect that sentinel so we render a
// placeholder instead of a broken explorer link during demos.
const STUB_PAID_TX = `0x${'0'.repeat(64)}`;

function shortHex(hex: string, head = 6, tail = 4): string {
  if (hex.length <= head + tail + 1) return hex;
  return `${hex.slice(0, head)}…${hex.slice(-tail)}`;
}

function statusPillClass(status: ShillOrderStatus): string {
  // Border + text carry the semantic colour; bg stays surface for density.
  // Keep a single-class-per-status shape so the panel is trivially restyled.
  if (status === 'queued') {
    return 'border-border-default text-fg-tertiary';
  }
  if (status === 'processing') {
    return 'border-[color:var(--color-warning)] text-[color:var(--color-warning)]';
  }
  if (status === 'done') {
    return 'border-accent text-accent-text';
  }
  // failed
  return 'border-[color:var(--color-danger)] text-[color:var(--color-danger)]';
}

function statusLabel(status: ShillOrderStatus): string {
  if (status === 'processing') return 'processing';
  if (status === 'queued') return 'queued';
  if (status === 'done') return 'done';
  return 'failed';
}

function ShillOrderRow({ row }: { row: ShillOrderRowView }): React.ReactElement {
  const paidTxStub = row.paidTxHash === STUB_PAID_TX;
  const paidTxShort = paidTxStub ? '0x0000…pending' : shortHex(row.paidTxHash, 6, 4);
  const tokenShort = shortHex(row.targetTokenAddr, 6, 4);
  const orderIdShort = shortHex(row.orderId, 8, 4);

  return (
    <li
      className="flex flex-col gap-1.5 rounded-[var(--radius-card)] border border-border-default bg-bg-surface px-3 py-2 text-[12px]"
      aria-label={`shill order ${row.orderId}`}
    >
      <div className="flex flex-wrap items-center gap-2 font-[family-name:var(--font-mono)]">
        <span className="text-fg-tertiary" title={`orderId ${row.orderId}`}>
          {orderIdShort}
        </span>
        <span
          className="rounded-[var(--radius-card)] border border-[color:var(--color-chain-bnb)] px-1.5 py-0.5 text-[11px] text-[color:var(--color-chain-bnb)]"
          title={row.targetTokenAddr}
        >
          {tokenShort}
        </span>
        <span className="text-fg-secondary">paid</span>
        <span className="text-fg-primary">{row.paidAmountUsdc} USDC</span>
        {paidTxStub ? (
          // No explorer link: the MVP handler has not settled yet so the hash
          // is the 0x000… sentinel. Show the placeholder to keep row layout
          // stable without shipping a broken anchor.
          <span className="text-fg-tertiary" title="Payment tx pending settlement">
            {paidTxShort}
          </span>
        ) : (
          <a
            href={`https://sepolia.basescan.org/tx/${row.paidTxHash}`}
            target="_blank"
            rel="noreferrer noopener"
            className="rounded-[var(--radius-card)] border border-[color:var(--color-chain-base)] px-1.5 py-0.5 text-[11px] text-[color:var(--color-chain-base)] hover:[filter:drop-shadow(0_0_4px_currentColor)]"
            title={`BaseScan ${row.paidTxHash}`}
          >
            tx {paidTxShort}
          </a>
        )}
        <span
          role="status"
          aria-live="polite"
          className={`ml-auto rounded-[var(--radius-card)] border px-1.5 py-0.5 text-[11px] uppercase tracking-[0.5px] ${statusPillClass(row.status)}`}
        >
          {statusLabel(row.status)}
        </span>
      </div>

      {row.creatorBrief !== undefined && row.creatorBrief.length > 0 ? (
        <p className="font-[family-name:var(--font-sans-body)] text-[12px] italic text-fg-secondary">
          “{row.creatorBrief}”
        </p>
      ) : null}

      {row.tweet !== undefined ? (
        <div className="flex flex-col gap-1 border-t border-border-default pt-1.5">
          <blockquote className="font-[family-name:var(--font-sans-body)] text-[12px] leading-[1.5] text-fg-primary">
            {row.tweet.tweetText}
          </blockquote>
          <a
            href={row.tweet.tweetUrl}
            target="_blank"
            rel="noreferrer noopener"
            aria-label="Open shill tweet on X"
            className="w-fit rounded-[var(--radius-card)] border border-accent px-1.5 py-0.5 font-[family-name:var(--font-mono)] text-[11px] text-accent-text hover:[filter:drop-shadow(0_0_4px_currentColor)]"
          >
            View on X ↗
          </a>
        </div>
      ) : null}
    </li>
  );
}

export function ShillOrderPanel({ artifacts }: { artifacts: Artifact[] }): React.ReactElement {
  const rows = collectShillOrderRows(artifacts);

  return (
    <section
      aria-label="Shilling Market — Active Orders"
      className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border-default bg-bg-primary p-4"
    >
      <header className="flex items-center justify-between">
        <span className="font-[family-name:var(--font-sans-display)] text-[13px] font-semibold uppercase tracking-[0.5px] text-fg-tertiary">
          Shilling Market — Active Orders ({rows.length})
        </span>
        <span className="font-[family-name:var(--font-mono)] text-[11px] text-fg-tertiary">
          0.01 USDC per shill · base-sepolia
        </span>
      </header>

      {rows.length === 0 ? (
        <p className="text-[13px] text-fg-secondary">
          No orders yet — submit a shill to see activity.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <ShillOrderRow key={row.orderId} row={row} />
          ))}
        </ul>
      )}
    </section>
  );
}
