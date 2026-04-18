/**
 * runShillMarketDemo — orchestrator for the Phase 4.6 shilling market.
 *
 * Stub — filled in by the green commit that follows the red-test commit.
 * Kept as a tiny module so `shill-market.test.ts` can import its types and
 * fail loudly when the real implementation is missing.
 */
import type Anthropic from '@anthropic-ai/sdk';
import type { ShillerAgentOutput } from '../agents/market-maker.js';
import type { AppConfig } from '../config.js';
import type { LoreStore } from '../state/lore-store.js';
import type { ShillOrderStore } from '../state/shill-order-store.js';
import type { RunStore } from './store.js';

export interface RunShillMarketDemoArgs {
  tokenAddr: string;
  tokenSymbol?: string;
  creatorBrief?: string;
}

export type RunShillerPhaseFn = (deps: {
  anthropic: Anthropic;
  config: AppConfig;
  store: RunStore;
  runId: string;
  orderId: string;
  tokenAddr: string;
  tokenSymbol?: string;
  loreSnippet: string;
  creatorBrief?: string;
}) => Promise<ShillerAgentOutput>;

export type CreatorPaymentPhaseFn = (deps: {
  config: AppConfig;
  store: RunStore;
  runId: string;
  shillOrderStore: ShillOrderStore;
  tokenAddr: string;
  creatorBrief?: string;
}) => Promise<{ orderId: string; paidTxHash: string; paidAmountUsdc: string }>;

export interface RunShillMarketDemoDeps {
  config: AppConfig;
  anthropic: Anthropic;
  store: RunStore;
  runId: string;
  args: RunShillMarketDemoArgs;
  shillOrderStore: ShillOrderStore;
  loreStore: LoreStore;
  runShillerImpl?: RunShillerPhaseFn;
  creatorPaymentImpl?: CreatorPaymentPhaseFn;
}

export const stubCreatorPaymentPhase: CreatorPaymentPhaseFn = () => {
  throw new Error('runShillMarketDemo: stubCreatorPaymentPhase not implemented');
};

export async function runShillMarketDemo(_deps: RunShillMarketDemoDeps): Promise<void> {
  throw new Error('runShillMarketDemo: not implemented');
}
