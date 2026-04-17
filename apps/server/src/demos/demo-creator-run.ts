/**
 * Phase 2 Task 7 — end-to-end Creator agent demo run.
 *
 * Loads .env.local, constructs the Anthropic SDK pointed at OpenRouter
 * (the project's LLM gateway), plus Replicate / Pinata clients, registers
 * the four Creator tools, and invokes runCreatorAgent with a user-supplied
 * theme. On success prints BSC mainnet tx hash, IPFS CID, and the local
 * meme image path for judges to inspect.
 *
 * Usage (from repo root):
 *   pnpm --filter @hack-fourmeme/server demo:creator -- "meme about BNB 2026"
 *
 * Cost per run (approx): OpenRouter Claude $0.03 + Replicate $0.003 + BSC
 * gas $0.08. This DOES deploy a real token on BSC mainnet — the HBNB2026-
 * prefix guard in narrative + deployer zod schemas keeps the token clearly
 * labelled as a hackathon demo.
 */

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI } from '@google/genai';
import { PinataSDK } from 'pinata';
import { z } from 'zod';

import { ToolRegistry } from '../tools/registry.js';
import { runCreatorAgent } from '../agents/creator.js';
import { createNarrativeTool } from '../tools/narrative.js';
import { createImageTool } from '../tools/image.js';
import { createLoreTool } from '../tools/lore.js';
import { createOnchainDeployerTool } from '../tools/deployer.js';

const repoRoot = resolve(fileURLToPath(import.meta.url), '../../../../..');
loadDotenv({ path: resolve(repoRoot, '.env.local') });

// OpenRouter Anthropic-compatible gateway — all Anthropic SDK calls route here.
// Note: the SDK itself appends /v1/messages, so baseURL must stop before /v1.
// Real endpoint hit at runtime: https://openrouter.ai/api/v1/messages
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api';
const MODEL = 'anthropic/claude-sonnet-4-5';

const envSchema = z.object({
  OPENROUTER_API_KEY: z.string().min(1),
  GOOGLE_API_KEY: z.string().min(1),
  PINATA_JWT: z.string().min(1),
  BSC_DEPLOYER_PRIVATE_KEY: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
});

async function main(): Promise<void> {
  const theme = process.argv[2] ?? 'a meme celebrating BNB Chain 2026 agentic commerce';

  const envResult = envSchema.safeParse(process.env);
  if (!envResult.success) {
    console.error('[demo] missing or invalid env vars in .env.local:');
    for (const issue of envResult.error.issues) {
      console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
    }
    process.exit(1);
  }
  const env = envResult.data;

  const anthropic = new Anthropic({
    apiKey: env.OPENROUTER_API_KEY,
    baseURL: OPENROUTER_BASE_URL,
  });
  const gemini = new GoogleGenAI({ apiKey: env.GOOGLE_API_KEY });
  const pinata = new PinataSDK({
    pinataJwt: env.PINATA_JWT,
    pinataGateway: 'gateway.pinata.cloud',
  });

  const registry = new ToolRegistry();
  registry.register(createNarrativeTool({ client: anthropic, model: MODEL }));
  registry.register(createImageTool({ client: gemini }));
  registry.register(createLoreTool({ anthropic, pinata, model: MODEL }));
  // four-meme-ai CLI's bundled tsx loader breaks on Node 25, so pin the
  // subprocess to Node 22 via Homebrew's keg-only install.
  registry.register(
    createOnchainDeployerTool({
      privateKey: env.BSC_DEPLOYER_PRIVATE_KEY,
      nodeBinPath: '/opt/homebrew/opt/node@22/bin',
    }),
  );

  console.info(`[demo] theme:   ${theme}`);
  console.info(`[demo] gateway: ${OPENROUTER_BASE_URL}`);
  console.info(`[demo] model:   ${MODEL}`);
  console.info(
    `[demo] tools:   ${registry
      .list()
      .map((t) => t.name)
      .join(', ')}`,
  );
  console.info('[demo] starting Creator agent loop ...\n');

  const started = Date.now();
  const { result, loop } = await runCreatorAgent({
    client: anthropic,
    registry,
    theme,
    model: MODEL,
    onLog: (e) => {
      const ts = e.ts.slice(11, 19);
      console.info(`[${ts}] ${e.agent}.${e.tool} [${e.level}] ${e.message}`);
    },
  });
  const elapsedSec = ((Date.now() - started) / 1000).toFixed(1);

  console.info('\n════════════════════════════════════════════════');
  console.info(' Creator agent run complete');
  console.info('════════════════════════════════════════════════');
  console.info(`  elapsed:    ${elapsedSec}s`);
  console.info(
    `  tool calls: ${loop.toolCalls.length} (${loop.toolCalls.filter((c) => c.isError).length} errored)`,
  );
  console.info(`  stop:       ${loop.stopReason}`);
  console.info('');
  console.info('  Token (BSC mainnet):');
  console.info(`    address:    ${result.tokenAddr}`);
  console.info(`    deploy tx:  ${result.tokenDeployTx}`);
  console.info(`    bscscan:    https://bscscan.com/token/${result.tokenAddr}`);
  console.info(`    tx view:    https://bscscan.com/tx/${result.tokenDeployTx}`);
  console.info('');
  console.info('  Lore (Pinata IPFS):');
  console.info(`    CID:        ${result.loreIpfsCid}`);
  console.info(`    gateway:    https://gateway.pinata.cloud/ipfs/${result.loreIpfsCid}`);
  console.info('');
  console.info('  Metadata:');
  console.info(`    name:       ${result.metadata.name}`);
  console.info(`    symbol:     ${result.metadata.symbol}`);
  console.info(`    image:      ${result.metadata.imageLocalPath}`);
  if (result.metadata.imageIpfsCid !== undefined) {
    console.info(`    image CID:  ${result.metadata.imageIpfsCid}`);
  }
  console.info('');
}

main().catch((err: unknown) => {
  console.error('[demo] FAIL', err);
  process.exit(1);
});
