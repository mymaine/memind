import { z } from 'zod';
import { createPublicClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';
import { wrapFetchWithPayment } from '@x402/fetch';
import { x402Client } from '@x402/core/client';
import { decodePaymentResponseHeader } from '@x402/core/http';
import { ExactEvmScheme as ClientExactEvmScheme, toClientEvmSigner } from '@x402/evm';
import type { Network } from '@x402/core/types';
import type { AgentTool } from '@hack-fourmeme/shared';

/**
 * x402_fetch_lore tool
 * --------------------
 * Wraps `@x402/fetch` + `@x402/evm` + `@x402/core` v2 so an agent can GET a
 * URL, auto-pay USDC on 402 via EIP-3009 on Base Sepolia, and recover the
 * settlement tx hash from the response header.
 *
 * The full end-to-end wiring (server + client in one process) is demonstrated
 * in scripts/probe-x402.ts — this tool is the "client only" packaging of that
 * flow for the Market-maker agent.
 *
 * DI seams:
 *   - `fetchWithPaymentImpl`: test override. When provided, the factory
 *     skips x402Client construction entirely and calls the override directly.
 *     This avoids hitting the EVM signer path in unit tests without
 *     undermining the real factory's contract.
 *   - `network`, `rpcUrl`: safe defaults for Base Sepolia; callers may
 *     override (e.g. Base mainnet) without changing the tool.
 *
 * The x402 v2 client learns the facilitator URL from the server's 402
 * response header, so we intentionally do not accept a `facilitatorUrl` here
 * — wiring one would be dead configuration.
 */

export const xFetchLoreInputSchema = z.object({
  url: z.string().url(),
});
export type XFetchLoreInput = z.infer<typeof xFetchLoreInputSchema>;

export const xFetchLoreOutputSchema = z.object({
  body: z.record(z.unknown()),
  settlementTxHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  network: z.string(),
  baseSepoliaExplorerUrl: z.string().url(),
});
export type XFetchLoreOutput = z.infer<typeof xFetchLoreOutputSchema>;

const DEFAULT_NETWORK: Network = 'eip155:84532';
const DEFAULT_RPC_URL = 'https://sepolia.base.org';
const EXPLORER_BASE = 'https://sepolia.basescan.org/tx/';

/**
 * Fetch wrapper signature produced by `wrapFetchWithPayment`. We derive it
 * from `typeof fetch` so we don't need the DOM lib to resolve `RequestInfo`
 * — this keeps the tool's tsconfig surface minimal (node types only).
 */
export type FetchWithPaymentImpl = typeof fetch;

export interface CreateXFetchLoreToolConfig {
  /** EOA private key that will sign the EIP-3009 USDC authorization. */
  agentPrivateKey: `0x${string}`;
  /** Base Sepolia JSON-RPC URL. Default: https://sepolia.base.org. */
  rpcUrl?: string;
  /** CAIP-2 network id. Default: eip155:84532 (Base Sepolia). */
  network?: string;
  /**
   * Test seam. When provided, replaces the real `wrapFetchWithPayment`
   * pipeline entirely so unit tests don't have to instantiate viem clients
   * or the x402 scheme. Production callers never set this.
   */
  fetchWithPaymentImpl?: FetchWithPaymentImpl;
}

/**
 * Factory returning an AgentTool that calls a x402-protected URL, auto-pays
 * the 402 challenge, and returns the decoded body + settlement metadata.
 *
 * Note: we deliberately do NOT read any environment variables here. All
 * secrets and endpoints are passed in by the caller so a single process can
 * spin up multiple tools with different signers (e.g. per-agent wallets).
 */
export function createXFetchLoreTool(
  cfg: CreateXFetchLoreToolConfig,
): AgentTool<XFetchLoreInput, XFetchLoreOutput> {
  const network = (cfg.network ?? DEFAULT_NETWORK) as Network;
  const fetchWithPaymentImpl: FetchWithPaymentImpl =
    cfg.fetchWithPaymentImpl ?? buildRealFetchWithPayment(cfg, network);

  return {
    name: 'x402_fetch_lore',
    description:
      'Call a URL that is guarded by the x402 payment protocol on Base Sepolia. On 402, ' +
      'automatically sign an EIP-3009 USDC authorization and retry. Returns the decoded ' +
      'JSON body, the settlement transaction hash, the network id, and a basescan explorer ' +
      'URL for the tx. Use this to purchase agent-priced resources such as a lore chapter.',
    inputSchema: xFetchLoreInputSchema,
    outputSchema: xFetchLoreOutputSchema,
    async execute(input) {
      const parsed = xFetchLoreInputSchema.parse(input);

      const response = await fetchWithPaymentImpl(parsed.url, { method: 'GET' });
      if (response.status !== 200) {
        const snippet = await safeTextSnippet(response, 240);
        throw new Error(
          `x402_fetch_lore: expected HTTP 200 after payment, got ${response.status.toString()} — ${snippet}`,
        );
      }

      // Headers: prefer PAYMENT-RESPONSE, fall back to X-PAYMENT-RESPONSE.
      // The canonical v2 spec header is `PAYMENT-RESPONSE`; some intermediaries
      // (and the probe) observed the `X-` prefix still in the wild.
      const paymentHeader =
        response.headers.get('PAYMENT-RESPONSE') ?? response.headers.get('X-PAYMENT-RESPONSE');
      if (!paymentHeader) {
        throw new Error(
          'x402_fetch_lore: response missing PAYMENT-RESPONSE header — settlement did not complete',
        );
      }

      const settlement = decodePaymentResponseHeader(paymentHeader);
      const txHash = settlement.transaction;
      if (!txHash || !/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
        throw new Error(
          `x402_fetch_lore: settlement response has no valid transaction hash (got ${JSON.stringify(
            txHash,
          )})`,
        );
      }

      const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;

      return xFetchLoreOutputSchema.parse({
        body,
        settlementTxHash: txHash,
        network: settlement.network ?? network,
        baseSepoliaExplorerUrl: `${EXPLORER_BASE}${txHash}`,
      });
    },
  };
}

/**
 * Build the real `wrapFetchWithPayment` pipeline. Mirrors scripts/probe-x402.ts:
 * public client → viem signer → x402Client → wrapped fetch. Isolated in its
 * own helper so the factory can skip it entirely when tests inject
 * `fetchWithPaymentImpl`.
 */
function buildRealFetchWithPayment(
  cfg: CreateXFetchLoreToolConfig,
  network: Network,
): FetchWithPaymentImpl {
  // Note: facilitatorUrl is deliberately NOT a tool-level config knob. The
  // x402 v2 client reads the facilitator from the server's 402 response, so
  // accepting a caller-provided URL here would be misleading dead config.
  const rpcUrl = cfg.rpcUrl ?? DEFAULT_RPC_URL;

  const account = privateKeyToAccount(cfg.agentPrivateKey);
  const publicClient = createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) });
  const signer = toClientEvmSigner(account, publicClient);
  const client = new x402Client().register(network, new ClientExactEvmScheme(signer));
  return wrapFetchWithPayment(fetch, client);
}

/**
 * Read a bounded prefix of the response body as text for diagnostic error
 * messages. Catches body-consumption errors (body already read, network
 * aborted, etc.) so we never mask the original non-200 cause.
 */
async function safeTextSnippet(response: Response, max: number): Promise<string> {
  try {
    const text = await response.text();
    const trimmed = text.trim();
    return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
  } catch {
    return '<body unreadable>';
  }
}
