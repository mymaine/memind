/**
 * Day 1 Phase 1 Task 4 — Pinata IPFS probe.
 *
 * Goal: upload a small markdown file to Pinata public IPFS via the official
 * `pinata` v2 SDK (JWT auth), then fetch it back through the public gateway and
 * verify byte-for-byte round-trip.
 *
 * SDK note: legacy `@pinata/sdk` v2.1.0 is deprecated upstream in favour of the
 * new `pinata` package (v2.5+), which aligns with our `.env.example`'s
 * PINATA_JWT. Gateway is optional — a dedicated Pinata gateway gives faster and
 * more reliable reads, but the public `gateway.pinata.cloud` works for a probe.
 *
 * Fallback (not executed here): if Pinata is unreachable during demo, fall back
 * to local filesystem + fake hash.
 */

import { config as loadDotenv } from 'dotenv';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PinataSDK } from 'pinata';

// Load .env.local from repo root (script runs from anywhere via pnpm probe:pinata).
const repoRoot = resolve(fileURLToPath(import.meta.url), '../..');
loadDotenv({ path: resolve(repoRoot, '.env.local') });

const PUBLIC_GATEWAY = 'https://gateway.pinata.cloud';

async function main(): Promise<void> {
  const jwt = process.env.PINATA_JWT;
  if (!jwt || jwt.trim() === '') {
    console.error(
      '[probe-pinata] missing PINATA_JWT in .env.local — copy .env.example and set your Pinata JWT (https://app.pinata.cloud/developers/api-keys).',
    );
    process.exit(1);
  }

  // Optional custom gateway host (domain only, no scheme). Falls back to public gateway.
  const gatewayHost = process.env.PINATA_GATEWAY?.trim() || 'gateway.pinata.cloud';

  const pinata = new PinataSDK({
    pinataJwt: jwt,
    pinataGateway: gatewayHost,
  });

  // Build a deterministic markdown payload so we can verify round-trip equality.
  const timestamp = new Date().toISOString();
  const markdown = `# Test Lore\n\nAgent Swarm pinata probe at ${timestamp}\n`;
  const fileName = `probe-pinata-${timestamp.replace(/[:.]/g, '-')}.md`;
  const file = new File([markdown], fileName, { type: 'text/markdown' });

  console.info(`[probe-pinata] uploading ${fileName} (${markdown.length} bytes) ...`);
  const upload = await pinata.upload.public.file(file);
  const cid = upload.cid;
  if (!cid) {
    console.error('[probe-pinata] upload succeeded but response had no CID:', upload);
    process.exit(1);
  }

  const publicGatewayUrl = `${PUBLIC_GATEWAY}/ipfs/${cid}`;
  console.info(`[probe-pinata] CID: ${cid}`);
  console.info(`[probe-pinata] gateway URL: ${publicGatewayUrl}`);

  // Verify round-trip via the public gateway (not the SDK's dedicated gateway),
  // because AC1 requires the lore to be openable via public IPFS for users.
  console.info('[probe-pinata] fetching back via public gateway ...');
  const res = await fetch(publicGatewayUrl);
  if (!res.ok) {
    console.error(`[probe-pinata] gateway fetch failed: HTTP ${res.status} ${res.statusText}`);
    process.exit(1);
  }
  const fetched = await res.text();
  if (fetched !== markdown) {
    console.error('[probe-pinata] round-trip mismatch');
    console.error('  expected:', JSON.stringify(markdown));
    console.error('  received:', JSON.stringify(fetched));
    process.exit(1);
  }

  console.info('[probe-pinata] round-trip verified: gateway content matches upload');
  console.info('[probe-pinata] PASS');
}

main().catch((err: unknown) => {
  console.error('[probe-pinata] unexpected error:', err);
  process.exit(1);
});
