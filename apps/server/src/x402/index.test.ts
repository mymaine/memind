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
import { registerX402Routes } from './index.js';

// Load .env.local from the repo root so AGENT_WALLET_PRIVATE_KEY is available
// when running `pnpm test` from any workspace package.
loadDotenv({ path: resolve(import.meta.dirname, '../../../../.env.local') });

const hasAgentWallet =
  typeof process.env.AGENT_WALLET_PRIVATE_KEY === 'string' &&
  /^0x[a-fA-F0-9]{64}$/.test(process.env.AGENT_WALLET_PRIVATE_KEY);

describe('registerX402Routes', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(() => {
    if (!hasAgentWallet) return;

    const config = loadConfig();
    const app = express();
    app.use(express.json({ limit: '1mb' }));
    registerX402Routes(app, config);

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
});
