import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { config as loadDotenv } from 'dotenv';
import { resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';

import { createPublicClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';

import { wrapFetchWithPayment } from '@x402/fetch';
import { x402Client } from '@x402/core/client';
import { decodePaymentResponseHeader } from '@x402/core/http';
import { ExactEvmScheme as ClientExactEvmScheme, toClientEvmSigner } from '@x402/evm';

import { loadConfig } from '../config.js';
import { LoreStore } from '../state/lore-store.js';
import { ShillOrderStore } from '../state/shill-order-store.js';
import { createLoreHandler, createShillHandler, registerX402Routes } from './index.js';

// Load .env.local from the repo root so AGENT_WALLET_PRIVATE_KEY is available
// when running `pnpm test` from any workspace package.
loadDotenv({ path: resolve(import.meta.dirname, '../../../../.env.local') });

const hasAgentWallet =
  typeof process.env.AGENT_WALLET_PRIVATE_KEY === 'string' &&
  /^0x[a-fA-F0-9]{64}$/.test(process.env.AGENT_WALLET_PRIVATE_KEY);

describe('registerX402Routes', () => {
  let server: Server;
  let baseUrl: string;
  // Shared with the /shill/:tokenAddr integration test below so it can verify
  // the paid POST actually enqueued an order instead of relying on the handler
  // body alone.
  let sharedShillStore: ShillOrderStore;

  beforeAll(() => {
    if (!hasAgentWallet) return;

    const config = loadConfig();
    const app = express();
    app.use(express.json({ limit: '1mb' }));
    sharedShillStore = new ShillOrderStore();
    registerX402Routes(app, config, { shillOrderStore: sharedShillStore });

    server = app.listen(0); // Ephemeral port — avoids collision with dev server.
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    if (server) await new Promise<void>((r) => server.close(() => r()));
  });

  it.skipIf(!hasAgentWallet)(
    'returns 402 Payment Required when no payment header is attached',
    async () => {
      const response = await fetch(`${baseUrl}/metadata/0xtest`);
      expect(response.status).toBe(402);
      // The x402 middleware signals payment requirements via a base64 header
      // (PAYMENT-REQUIRED) — decodable with decodePaymentRequiredHeader — and
      // also sets content-type to application/json for the response body.
      expect(response.headers.get('content-type')).toMatch(/application\/json/);
    },
  );

  it.skipIf(!hasAgentWallet)(
    'registers the /lore route (hitting it without payment returns 402)',
    async () => {
      // Keep the paymentMiddleware contract intact for the real-settle test
      // below by confirming /lore is actually mounted behind the paywall.
      // Value-level handler behaviour (mock vs store-backed) is covered by
      // the unit tests further down using createLoreHandler directly — that
      // split lets us avoid paying USDC for three extra assertions while
      // still proving the route is wired.
      const response = await fetch(`${baseUrl}/lore/0xfeedbeef`);
      expect(response.status).toBe(402);
    },
  );

  it.skipIf(!hasAgentWallet)(
    'settles a real Base Sepolia USDC payment and returns 200 + tx hash',
    async () => {
      const privateKey = process.env.AGENT_WALLET_PRIVATE_KEY as `0x${string}`;
      const account = privateKeyToAccount(privateKey);

      const publicClient = createPublicClient({ chain: baseSepolia, transport: http() });
      const signer = toClientEvmSigner(account, publicClient);
      const client = new x402Client().register('eip155:84532', new ClientExactEvmScheme(signer));
      const payingFetch = wrapFetchWithPayment(fetch, client);

      const response = await payingFetch(`${baseUrl}/metadata/0xdeadbeef`);
      expect(response.ok).toBe(true);

      const body = (await response.json()) as {
        tokenAddr?: string;
        name?: string;
        symbol?: string;
        imageUrl?: string;
      };
      expect(body.tokenAddr).toBe('0xdeadbeef');
      expect(body.symbol).toBe('HBNB2026-MOCK');
      expect(body.imageUrl).toMatch(/^https?:\/\//);

      const paymentHeader =
        response.headers.get('X-PAYMENT-RESPONSE') ?? response.headers.get('PAYMENT-RESPONSE');
      expect(paymentHeader).toBeTruthy();
      if (!paymentHeader) return; // narrow for TS; unreachable after expect
      const settlement = decodePaymentResponseHeader(paymentHeader);
      expect(settlement.transaction).toMatch(/^0x[a-fA-F0-9]{64}$/);
    },
    120_000, // Real settlement can take 30–60s on Base Sepolia.
  );

  it.skipIf(!hasAgentWallet)(
    'settles a real Base Sepolia USDC payment for /shill/:tokenAddr and enqueues the order',
    async () => {
      const privateKey = process.env.AGENT_WALLET_PRIVATE_KEY as `0x${string}`;
      const account = privateKeyToAccount(privateKey);

      const publicClient = createPublicClient({ chain: baseSepolia, transport: http() });
      const signer = toClientEvmSigner(account, publicClient);
      const client = new x402Client().register('eip155:84532', new ClientExactEvmScheme(signer));
      const payingFetch = wrapFetchWithPayment(fetch, client);

      const targetTokenAddr = '0xdeadbeef';
      const response = await payingFetch(`${baseUrl}/shill/${targetTokenAddr}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ creatorBrief: 'integration-test' }),
      });
      expect(response.ok).toBe(true);

      const body = (await response.json()) as {
        orderId?: string;
        status?: string;
        targetTokenAddr?: string;
        estimatedReadyMs?: number;
      };
      expect(body.status).toBe('queued');
      expect(body.targetTokenAddr).toBe(targetTokenAddr);
      expect(typeof body.orderId).toBe('string');
      expect(body.orderId ?? '').toMatch(/[0-9a-f-]{36}/); // UUID-ish

      const paymentHeader =
        response.headers.get('X-PAYMENT-RESPONSE') ?? response.headers.get('PAYMENT-RESPONSE');
      expect(paymentHeader).toBeTruthy();
      if (!paymentHeader) return;
      const settlement = decodePaymentResponseHeader(paymentHeader);
      expect(settlement.transaction).toMatch(/^0x[a-fA-F0-9]{64}$/);

      // Proves the handler actually enqueued into the store wired at beforeAll.
      // Exact paidTxHash equality with the header is left to a follow-up task:
      // the handler runs before x402 settlement, so it can only see a stub hash
      // at enqueue time (see createShillHandler doc-comment for the full story).
      const stored = sharedShillStore.getById(body.orderId ?? '');
      expect(stored).toBeDefined();
      expect(stored?.targetTokenAddr).toBe(targetTokenAddr);
      expect(stored?.creatorBrief).toBe('integration-test');
      expect(stored?.status).toBe('queued');
    },
    120_000, // Real settlement can take 30–60s on Base Sepolia.
  );
});

/**
 * Value-level coverage for the /lore route's payload selection logic.
 *
 * These tests deliberately mount the handler on a bare express app without
 * paymentMiddleware. That split is intentional:
 *   - The paid-integration test above still proves the full x402 stack settles
 *     a real USDC payment on Base Sepolia (/metadata route → mock payload).
 *   - Adding store-vs-mock assertions here via a paying fetch would cost real
 *     testnet gas on every run with no additional integration value — the
 *     middleware is already exercised by the /metadata test.
 *   - The handler we test here is the *same* function mounted by
 *     `registerX402Routes`, so there is no risk of behaviour drift.
 */
describe('createLoreHandler', () => {
  function startHandlerApp(handler: ReturnType<typeof createLoreHandler>): {
    baseUrl: string;
    close: () => Promise<void>;
  } {
    const app = express();
    app.get('/lore/:tokenAddr', handler);
    const server = app.listen(0);
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;
    return {
      baseUrl,
      close: () => new Promise<void>((r) => server.close(() => r())),
    };
  }

  it('serves the mock payload when no loreStore is provided', async () => {
    const { baseUrl, close } = startHandlerApp(createLoreHandler({}));
    try {
      const response = await fetch(`${baseUrl}/lore/0xabc`);
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        tokenAddr?: string;
        lore?: string;
        ipfsCid?: string;
      };
      expect(body.tokenAddr).toBe('0xabc');
      expect(typeof body.lore).toBe('string');
      expect(body.lore ?? '').toMatch(/Mock lore/);
      expect(typeof body.ipfsCid).toBe('string');
    } finally {
      await close();
    }
  });

  it('serves the store-backed payload on a hit', async () => {
    const store = new LoreStore();
    const tokenAddr = '0x1234567890abcdef1234567890abcdef12345678';
    store.upsert({
      tokenAddr,
      chapterNumber: 3,
      chapterText: 'real narrator chapter three',
      ipfsHash: 'bafkrei-ch3',
      ipfsUri: 'https://gateway.pinata.cloud/ipfs/bafkrei-ch3',
      tokenName: 'HBNB2026-Fixture',
      tokenSymbol: 'HBNB2026-FIX',
      publishedAt: '2026-04-20T12:00:00.000Z',
    });

    const { baseUrl, close } = startHandlerApp(createLoreHandler({ loreStore: store }));
    try {
      // Request with mixed-case address to confirm the handler normalises.
      const response = await fetch(`${baseUrl}/lore/0x1234567890AbCdEf1234567890aBcDeF12345678`);
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        tokenAddr?: string;
        chapterNumber?: number;
        lore?: string;
        ipfsCid?: string;
        ipfsUri?: string;
        publishedAt?: string;
      };
      expect(body.tokenAddr).toBe(tokenAddr);
      expect(body.chapterNumber).toBe(3);
      expect(body.lore).toBe('real narrator chapter three');
      expect(body.ipfsCid).toBe('bafkrei-ch3');
      expect(body.ipfsUri).toBe('https://gateway.pinata.cloud/ipfs/bafkrei-ch3');
      expect(body.publishedAt).toBe('2026-04-20T12:00:00.000Z');
    } finally {
      await close();
    }
  });

  it('mock fallback: lowercases a mixed-case tokenAddr so responses match the store-hit branch', async () => {
    // The store-hit branch returns `entry.tokenAddr` (already lowercased by
    // LoreStore). The mock fallback previously echoed `req.params.tokenAddr`
    // verbatim, so identical requests could return different casings
    // depending on whether the store was warm. Lock both branches to
    // lowercase for contract symmetry.
    const { baseUrl, close } = startHandlerApp(createLoreHandler({}));
    try {
      const mixedCase = '0xAbCdEfAbCdEfAbCdEfAbCdEfAbCdEfAbCdEfAbCd';
      const response = await fetch(`${baseUrl}/lore/${mixedCase}`);
      expect(response.status).toBe(200);
      const body = (await response.json()) as { tokenAddr?: string; lore?: string };
      expect(body.tokenAddr).toBe(mixedCase.toLowerCase());
      expect(body.lore ?? '').toMatch(/Mock lore/);
    } finally {
      await close();
    }
  });

  it('falls back to the mock payload when the store has no entry for the token', async () => {
    const store = new LoreStore();
    const { baseUrl, close } = startHandlerApp(createLoreHandler({ loreStore: store }));
    try {
      const response = await fetch(`${baseUrl}/lore/0xmissingtoken`);
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        tokenAddr?: string;
        lore?: string;
        ipfsCid?: string;
        chapterNumber?: number;
      };
      expect(body.tokenAddr).toBe('0xmissingtoken');
      expect(body.lore ?? '').toMatch(/Mock lore/);
      expect(body.chapterNumber).toBeUndefined();
    } finally {
      await close();
    }
  });
});

/**
 * Value-level coverage for the /shill route's enqueue logic (Phase 4.6).
 *
 * Mirrors the `createLoreHandler` split: these tests mount the handler on a
 * bare express app without paymentMiddleware so we can assert the store
 * interaction cheaply. The paid-integration test above still proves the full
 * x402 stack settles a real USDC payment on Base Sepolia against /shill.
 */
describe('createShillHandler', () => {
  function startShillApp(handler: ReturnType<typeof createShillHandler>): {
    baseUrl: string;
    close: () => Promise<void>;
  } {
    const app = express();
    app.use(express.json({ limit: '1mb' }));
    app.post('/shill/:tokenAddr', handler);
    const server = app.listen(0);
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;
    return {
      baseUrl,
      close: () => new Promise<void>((r) => server.close(() => r())),
    };
  }

  it('enqueues the order into the provided store and returns 200 + orderId + status=queued', async () => {
    const store = new ShillOrderStore();
    const { baseUrl, close } = startShillApp(createShillHandler({ shillOrderStore: store }));
    try {
      const targetTokenAddr = '0xAbCdEfAbCdEfAbCdEfAbCdEfAbCdEfAbCdEfAbCd';
      const response = await fetch(`${baseUrl}/shill/${targetTokenAddr}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ creatorBrief: 'pump it' }),
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        orderId?: string;
        status?: string;
        targetTokenAddr?: string;
        estimatedReadyMs?: number;
      };
      expect(body.status).toBe('queued');
      // Handler normalises the token address to lowercase so downstream
      // consumers (Shiller agent, UI panel) never have to double-normalise.
      expect(body.targetTokenAddr).toBe(targetTokenAddr.toLowerCase());
      expect(typeof body.orderId).toBe('string');
      expect(body.orderId ?? '').toMatch(/[0-9a-f-]{36}/);
      expect(typeof body.estimatedReadyMs).toBe('number');

      const stored = store.getById(body.orderId ?? '');
      expect(stored).toBeDefined();
      expect(stored?.targetTokenAddr).toBe(targetTokenAddr.toLowerCase());
      expect(stored?.creatorBrief).toBe('pump it');
      expect(stored?.status).toBe('queued');
      // Without the paymentMiddleware stack in play the handler cannot read a
      // real settlement header — it falls back to a stub tx hash so the store
      // contract (non-empty paidTxHash) stays satisfied. The integration test
      // above still proves real settlement works end-to-end.
      expect(stored?.paidTxHash).toMatch(/^0x[0-9a-f]{64}$/);
      expect(stored?.paidAmountUsdc).toBe('0.01');
    } finally {
      await close();
    }
  });

  it('returns 200 with a generated orderId even when no shillOrderStore is wired', async () => {
    const { baseUrl, close } = startShillApp(createShillHandler({}));
    try {
      const response = await fetch(`${baseUrl}/shill/0xdeadbeef`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ creatorBrief: 'no-store' }),
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        orderId?: string;
        status?: string;
        targetTokenAddr?: string;
      };
      expect(body.status).toBe('queued');
      expect(body.targetTokenAddr).toBe('0xdeadbeef');
      expect(typeof body.orderId).toBe('string');
      expect(body.orderId ?? '').toMatch(/[0-9a-f-]{36}/);
    } finally {
      await close();
    }
  });
});
