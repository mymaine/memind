/**
 * ShillOrderStore — in-memory stub.
 *
 * Red-phase placeholder for TDD. Real implementation lands in the green commit.
 * Every method throws so the accompanying test file fails on semantics rather
 * than on a missing module or TypeError from undefined class members.
 */
export type ShillOrderStatus = 'queued' | 'processing' | 'done' | 'failed';

export interface ShillOrderEntry {
  orderId: string;
  targetTokenAddr: string;
  creatorBrief?: string;
  paidTxHash: string;
  paidAmountUsdc: string;
  status: ShillOrderStatus;
  ts: string;
  tweetId?: string;
  tweetUrl?: string;
  errorMessage?: string;
}

export interface EnqueueInput {
  orderId: string;
  targetTokenAddr: string;
  creatorBrief?: string;
  paidTxHash: string;
  paidAmountUsdc: string;
  ts: string;
}

export class ShillOrderStore {
  enqueue(_input: EnqueueInput): ShillOrderEntry {
    throw new Error('not implemented');
  }

  pullPending(): ShillOrderEntry[] {
    throw new Error('not implemented');
  }

  markDone(_orderId: string, _meta: { tweetId: string; tweetUrl: string }): ShillOrderEntry {
    throw new Error('not implemented');
  }

  markFailed(_orderId: string, _errorMessage: string): ShillOrderEntry {
    throw new Error('not implemented');
  }

  getById(_orderId: string): ShillOrderEntry | undefined {
    throw new Error('not implemented');
  }

  findByTokenAddr(_targetTokenAddr: string): ShillOrderEntry[] {
    throw new Error('not implemented');
  }

  size(): number {
    throw new Error('not implemented');
  }

  clear(): void {
    throw new Error('not implemented');
  }
}
