import { describe, it, expect, vi } from 'vitest';
import { encodePaymentResponseHeader } from '@x402/core/http';
import type { SettleResponse } from '@x402/core/types';
import {
  createXFetchLoreTool,
  xFetchLoreInputSchema,
  xFetchLoreOutputSchema,
} from './x-fetch-lore.js';

/**
 * Unit tests for the x402_fetch_lore tool.
 *
 * Strategy: bypass the real x402 plumbing via the `fetchWithPaymentImpl` DI
 * seam so each test controls exactly what the wrapped fetch returns. Header
 * values are produced with the real `encodePaymentResponseHeader` from
 * @x402/core/http so the decoder round-trip is also exercised.
 */

const FAKE_TX = '0x' + 'ab'.repeat(32);
const FAKE_NETWORK = 'eip155:84532';
const FAKE_URL = 'http://localhost:4000/lore/0x1111111111111111111111111111111111111111';
const FAKE_PRIVATE_KEY = ('0x' + '11'.repeat(32)) as `0x${string}`;

function settlementHeader(txHash: string, network = FAKE_NETWORK): string {
  const settle: SettleResponse = {
    success: true,
    transaction: txHash as `0x${string}`,
    network: network as SettleResponse['network'],
    payer: ('0x' + '22'.repeat(20)) as `0x${string}`,
  };
  return encodePaymentResponseHeader(settle);
}

function mockResponse(args: {
  status?: number;
  body?: unknown;
  headerName?: 'PAYMENT-RESPONSE' | 'X-PAYMENT-RESPONSE' | null;
  headerValue?: string;
  textBody?: string;
}): Response {
  const headers = new Headers();
  if (args.headerName && args.headerValue !== undefined) {
    headers.set(args.headerName, args.headerValue);
  }
  const status = args.status ?? 200;
  if (args.textBody !== undefined) {
    return new Response(args.textBody, { status, headers });
  }
  if (status === 200 && args.body !== undefined) {
    headers.set('content-type', 'application/json');
    return new Response(JSON.stringify(args.body), { status, headers });
  }
  return new Response(null, { status, headers });
}

describe('xFetchLoreInputSchema', () => {
  it('accepts a valid http URL', () => {
    expect(xFetchLoreInputSchema.safeParse({ url: FAKE_URL }).success).toBe(true);
  });

  it('rejects a non-URL string', () => {
    expect(xFetchLoreInputSchema.safeParse({ url: 'not-a-url' }).success).toBe(false);
  });
});

describe('xFetchLoreOutputSchema', () => {
  it('rejects a non-64-hex settlementTxHash', () => {
    const bad = {
      body: { hello: 'world' },
      settlementTxHash: '0xtoo-short',
      network: FAKE_NETWORK,
      baseSepoliaExplorerUrl: 'https://sepolia.basescan.org/tx/0xabc',
    };
    expect(xFetchLoreOutputSchema.safeParse(bad).success).toBe(false);
  });
});

describe('createXFetchLoreTool.execute', () => {
  it('happy path: 200 + PAYMENT-RESPONSE header → returns body, tx, network, explorer url', async () => {
    const body = { chapter: 1, text: 'ancient prose', ipfsCid: 'bafyFAKE' };
    const fetchWithPaymentImpl = vi.fn(async () =>
      mockResponse({
        status: 200,
        body,
        headerName: 'PAYMENT-RESPONSE',
        headerValue: settlementHeader(FAKE_TX),
      }),
    );

    const tool = createXFetchLoreTool({
      agentPrivateKey: FAKE_PRIVATE_KEY,
      rpcUrl: 'https://sepolia.base.org',
      fetchWithPaymentImpl,
    });

    const out = await tool.execute({ url: FAKE_URL });
    expect(out.body).toEqual(body);
    expect(out.settlementTxHash).toBe(FAKE_TX);
    expect(out.network).toBe(FAKE_NETWORK);
    expect(out.baseSepoliaExplorerUrl).toBe(`https://sepolia.basescan.org/tx/${FAKE_TX}`);
    expect(fetchWithPaymentImpl).toHaveBeenCalledTimes(1);
    const call = fetchWithPaymentImpl.mock.calls[0] as unknown as [
      unknown,
      { method?: string } | undefined,
    ];
    expect(call[0]).toBe(FAKE_URL);
    expect(call[1]?.method).toBe('GET');
  });

  it('header fallback: X-PAYMENT-RESPONSE instead of PAYMENT-RESPONSE still decodes', async () => {
    const fetchWithPaymentImpl = vi.fn(async () =>
      mockResponse({
        status: 200,
        body: { ok: true },
        headerName: 'X-PAYMENT-RESPONSE',
        headerValue: settlementHeader(FAKE_TX),
      }),
    );

    const tool = createXFetchLoreTool({
      agentPrivateKey: FAKE_PRIVATE_KEY,
      rpcUrl: 'https://sepolia.base.org',
      fetchWithPaymentImpl,
    });

    const out = await tool.execute({ url: FAKE_URL });
    expect(out.settlementTxHash).toBe(FAKE_TX);
  });

  it('throws when settlement header is missing', async () => {
    const fetchWithPaymentImpl = vi.fn(async () =>
      mockResponse({
        status: 200,
        body: { ok: true },
        headerName: null,
      }),
    );

    const tool = createXFetchLoreTool({
      agentPrivateKey: FAKE_PRIVATE_KEY,
      rpcUrl: 'https://sepolia.base.org',
      fetchWithPaymentImpl,
    });

    await expect(tool.execute({ url: FAKE_URL })).rejects.toThrow(/PAYMENT-RESPONSE/);
  });

  it('throws on non-200 status, including a body snippet in the message', async () => {
    const fetchWithPaymentImpl = vi.fn(async () =>
      mockResponse({
        status: 402,
        textBody: 'still unpaid: payment rejected by facilitator',
      }),
    );

    const tool = createXFetchLoreTool({
      agentPrivateKey: FAKE_PRIVATE_KEY,
      rpcUrl: 'https://sepolia.base.org',
      fetchWithPaymentImpl,
    });

    await expect(tool.execute({ url: FAKE_URL })).rejects.toThrow(/402/);
    await expect(tool.execute({ url: FAKE_URL })).rejects.toThrow(/payment rejected/);
  });

  it('explorer URL uses sepolia.basescan.org/tx/<hash>', async () => {
    const tx = '0x' + 'cd'.repeat(32);
    const fetchWithPaymentImpl = vi.fn(async () =>
      mockResponse({
        status: 200,
        body: { ok: true },
        headerName: 'PAYMENT-RESPONSE',
        headerValue: settlementHeader(tx),
      }),
    );

    const tool = createXFetchLoreTool({
      agentPrivateKey: FAKE_PRIVATE_KEY,
      rpcUrl: 'https://sepolia.base.org',
      fetchWithPaymentImpl,
    });

    const out = await tool.execute({ url: FAKE_URL });
    expect(out.baseSepoliaExplorerUrl).toBe(`https://sepolia.basescan.org/tx/${tx}`);
  });

  it('rejects invalid input via zod before calling the network seam', async () => {
    const fetchWithPaymentImpl = vi.fn(async () =>
      mockResponse({ status: 200, body: { ok: true }, headerName: null }),
    );
    const tool = createXFetchLoreTool({
      agentPrivateKey: FAKE_PRIVATE_KEY,
      rpcUrl: 'https://sepolia.base.org',
      fetchWithPaymentImpl,
    });

    await expect(tool.execute({ url: 'not-a-url' })).rejects.toThrow();
    expect(fetchWithPaymentImpl).not.toHaveBeenCalled();
  });

  it('uses a non-default network string when provided', async () => {
    const customNetwork = 'eip155:8453';
    const fetchWithPaymentImpl = vi.fn(async () =>
      mockResponse({
        status: 200,
        body: { ok: true },
        headerName: 'PAYMENT-RESPONSE',
        headerValue: settlementHeader(FAKE_TX, customNetwork),
      }),
    );

    const tool = createXFetchLoreTool({
      agentPrivateKey: FAKE_PRIVATE_KEY,
      rpcUrl: 'https://sepolia.base.org',
      network: customNetwork,
      fetchWithPaymentImpl,
    });

    const out = await tool.execute({ url: FAKE_URL });
    expect(out.network).toBe(customNetwork);
  });
});
