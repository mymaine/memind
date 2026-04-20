/**
 * Day 1 Phase 1 Task 2 — x402 hello world probe (server + client in-process).
 *
 * Goal: spin up an Express server that guards GET /weather with the x402 v2
 * `paymentMiddleware`, then call it from the same process using `@x402/fetch`'s
 * payment-wrapped fetch. The client pays 0.001 USDC on Base Sepolia through
 * the public x402.org facilitator; on success we decode the X-PAYMENT-RESPONSE
 * header and print the Base Sepolia tx hash so it can be verified at
 * https://sepolia.basescan.org/tx/<hash>.
 *
 * Implementation notes:
 *   - The x402 runtime packages (@x402/core, @x402/evm, @x402/express,
 *     @x402/fetch, viem, express, zod) live only in `apps/server/node_modules`
 *     and are not hoisted to the repo root. This script therefore imports them
 *     via relative paths into that workspace's node_modules — no root-level
 *     package.json changes, no tsc surface impact (scripts/ is outside the
 *     workspace-level `pnpm -r typecheck`).
 *   - Server and client run in the same Node process. The Base Sepolia
 *     settlement is real; both sides just happen to share memory for the probe.
 */

import 'dotenv/config';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { z } from '../apps/server/node_modules/zod/index.js';

// x402 server side
import express from '../apps/server/node_modules/express/index.js';
import { paymentMiddleware } from '../apps/server/node_modules/@x402/express/dist/esm/index.mjs';
import {
  HTTPFacilitatorClient,
  x402ResourceServer,
} from '../apps/server/node_modules/@x402/core/dist/esm/server/index.mjs';
import { ExactEvmScheme as ServerExactEvmScheme } from '../apps/server/node_modules/@x402/evm/dist/esm/exact/server/index.mjs';

// x402 client side
import { wrapFetchWithPayment } from '../apps/server/node_modules/@x402/fetch/dist/esm/index.mjs';
import { x402Client } from '../apps/server/node_modules/@x402/core/dist/esm/client/index.mjs';
import {
  ExactEvmScheme as ClientExactEvmScheme,
  toClientEvmSigner,
} from '../apps/server/node_modules/@x402/evm/dist/esm/index.mjs';
import { decodePaymentResponseHeader } from '../apps/server/node_modules/@x402/core/dist/esm/http/index.mjs';

// viem
import { createPublicClient, http } from '../apps/server/node_modules/viem/_esm/index.js';
import { privateKeyToAccount } from '../apps/server/node_modules/viem/_esm/accounts/index.js';
import { baseSepolia } from '../apps/server/node_modules/viem/_esm/chains/index.js';

// Load .env.local from repo root (probe can run from any cwd via `pnpm probe:x402`).
const repoRoot = resolve(fileURLToPath(import.meta.url), '../..');
loadDotenv({ path: resolve(repoRoot, '.env.local') });

const PORT = 4021;
const NETWORK = 'eip155:84532' as const;
const ROUTE = 'GET /weather';
const PRICE = '$0.001';
const FACILITATOR_URL = 'https://www.x402.org/facilitator';

const envSchema = z.object({
  AGENT_WALLET_PRIVATE_KEY: z
    .string()
    .regex(/^0x[a-fA-F0-9]{64}$/, 'must be a 0x-prefixed 64-hex-char private key'),
  // Optional: if omitted or empty we derive payTo from the private key (self-pay works for probe).
  AGENT_WALLET_ADDRESS: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/)
      .optional(),
  ),
});

function parseEnvOrExit(): z.infer<typeof envSchema> {
  const parsed = envSchema.safeParse(process.env);
  if (parsed.success) return parsed.data;
  console.error('[probe-x402] missing or invalid env vars in .env.local:');
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
  }
  console.error('[probe-x402] see .env.example for the expected shape.');
  process.exit(1);
}

async function main(): Promise<void> {
  const env = parseEnvOrExit();
  const privateKey = env.AGENT_WALLET_PRIVATE_KEY as `0x${string}`;
  const account = privateKeyToAccount(privateKey);
  const payTo = (env.AGENT_WALLET_ADDRESS ?? account.address) as `0x${string}`;

  console.info(`[probe-x402] payer  = ${account.address}`);
  console.info(`[probe-x402] payTo  = ${payTo}`);
  console.info(`[probe-x402] network= ${NETWORK} (Base Sepolia)`);
  console.info(`[probe-x402] price  = ${PRICE}`);

  // --- Server: Express + x402 paymentMiddleware guards GET /weather. ---
  const facilitator = new HTTPFacilitatorClient({ url: FACILITATOR_URL });
  const resourceServer = new x402ResourceServer(facilitator).register(
    NETWORK,
    new ServerExactEvmScheme(),
  );

  const app = express();
  app.use(
    paymentMiddleware(
      {
        [ROUTE]: {
          accepts: { scheme: 'exact', network: NETWORK, price: PRICE, payTo },
          description: 'x402 hello world weather resource',
          mimeType: 'application/json',
        },
      },
      resourceServer,
    ),
  );
  app.get('/weather', (_req, res) => {
    res.json({ forecast: 'sunny', tempC: 24, source: 'x402 hello world probe' });
  });

  const server = app.listen(PORT);
  await new Promise<void>((r) => server.once('listening', () => r()));
  console.info(`[probe-x402] server listening on http://localhost:${PORT}`);

  try {
    // --- Client: x402Client + ExactEvmScheme signs EIP-3009 USDC on Base Sepolia. ---
    const publicClient = createPublicClient({ chain: baseSepolia, transport: http() });
    const signer = toClientEvmSigner(account, publicClient);
    const client = new x402Client().register(NETWORK, new ClientExactEvmScheme(signer));
    const payingFetch = wrapFetchWithPayment(fetch, client);

    console.info('[probe-x402] requesting /weather (expect 402 → pay → 200) ...');
    const response = await payingFetch(`http://localhost:${PORT}/weather`);
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`expected 200 after payment, got ${response.status}: ${body}`);
    }
    const body: unknown = await response.json();
    console.info('[probe-x402] payload:', body);

    const paymentHeader =
      response.headers.get('X-PAYMENT-RESPONSE') ?? response.headers.get('PAYMENT-RESPONSE');
    if (!paymentHeader) {
      throw new Error('response missing X-PAYMENT-RESPONSE header — settlement did not complete');
    }
    const settlement = decodePaymentResponseHeader(paymentHeader);
    const txHash = settlement.transaction;
    if (!txHash) throw new Error(`settlement response has no transaction hash: ${paymentHeader}`);

    console.info(`[probe-x402] settlement success on ${settlement.network}`);
    console.info(`[probe-x402] tx hash: ${txHash}`);
    console.info(`[probe-x402] verify:  https://sepolia.basescan.org/tx/${txHash}`);
    console.info('[probe-x402] PASS');
  } finally {
    server.close();
  }
}

main().catch((err: unknown) => {
  console.error('[probe-x402] FAIL', err);
  process.exit(1);
});
