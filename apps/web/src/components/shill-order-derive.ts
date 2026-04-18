/**
 * Pure selector + merge for the Shilling Market panel (AC-P4.6-4).
 *
 * The SSE artifact stream appends `shill-order` entries (queued → processing →
 * done/failed) and at most one `shill-tweet` per orderId. The panel wants a
 * single row per orderId reflecting the latest known status, with the tweet
 * (when posted) merged in. Keeping this logic outside React lets us test it
 * without a DOM and lets the timeline / tx surfaces reuse it later.
 */
import type { Artifact } from '@hack-fourmeme/shared';

export type ShillOrderStatus = 'queued' | 'processing' | 'done' | 'failed';

export interface ShillOrderRowView {
  orderId: string;
  targetTokenAddr: string;
  status: ShillOrderStatus;
  paidTxHash: string;
  paidAmountUsdc: string;
  creatorBrief?: string;
  /** Latest shill-order artifact ts (when multiple for same orderId). */
  ts: string;
  /** Populated when a matching shill-tweet artifact exists. */
  tweet?: { tweetId: string; tweetUrl: string; tweetText: string; ts: string };
}

/** Collect + dedupe + merge. Last shill-order wins on status; shill-tweet by orderId. */
export function collectShillOrderRows(_artifacts: readonly Artifact[]): ShillOrderRowView[] {
  throw new Error('collectShillOrderRows: not implemented');
}
