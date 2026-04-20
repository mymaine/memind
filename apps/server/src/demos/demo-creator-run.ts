/**
 * Phase 2 Task 7 — end-to-end Creator agent demo run.
 *
 * Loads .env.local, constructs the Anthropic SDK pointed at OpenRouter
 * (the project's LLM gateway), plus Gemini (image gen) and Pinata (IPFS)
 * clients, registers the four Creator tools, and invokes runCreatorAgent
 * with a user-supplied theme. On success prints BSC mainnet tx hash, IPFS
 * CID, and the local meme image path for users to inspect.
 *
 * Usage (from repo root):
 *   pnpm --filter @hack-fourmeme/server demo:creator -- "meme about BNB 2026"
 *
 * Cost per run (approx): OpenRouter Claude $0.03 + Gemini Flash Image
 * $0.04 + BSC gas $0.08. This DOES deploy a real token on BSC mainnet —
 * the HBNB2026- prefix guard in narrative + deployer zod schemas keeps the
 * token clearly labelled as a hackathon demo.
 */

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI } from '@google/genai';
import { PinataSDK } from 'pinata';
import { z } from 'zod';

import { loadConfig } from '../config.js';
import { ToolRegistry } from '../tools/registry.js';
import { runCreatorAgent } from '../agents/creator.js';
import { createNarrativeTool } from '../tools/narrative.js';
import { createImageTool } from '../tools/image.js';
import { createLoreTool } from '../tools/lore.js';
import { createOnchainDeployerTool } from '../tools/deployer.js';
import { AnchorLedger } from '../state/anchor-ledger.js';
import { anchorChapterOne } from '../chain/anchor-tx.js';

const repoRoot = resolve(fileURLToPath(import.meta.url), '../../../../..');
loadDotenv({ path: resolve(repoRoot, '.env.local') });

// OpenRouter Anthropic-compatible gateway — all Anthropic SDK calls route here.
// Note: the SDK itself appends /v1/messages, so baseURL must stop before /v1.
// Real endpoint hit at runtime: https://openrouter.ai/api/v1/messages
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api';
const MODEL = 'anthropic/claude-sonnet-4-5';

// Only the env vars AppConfig does not cover live here (image generation,
// Pinata JWT is present in AppConfig but re-validated for a crisp demo error,
// BSC deployer key). The OpenRouter secret is resolved via AppConfig so both
// OPENROUTER_API_KEY (preferred) and ANTHROPIC_API_KEY (legacy) work.
const envSchema = z.object({
  GOOGLE_API_KEY: z.string().min(1),
  PINATA_JWT: z.string().min(1),
  BSC_DEPLOYER_PRIVATE_KEY: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
});

async function main(): Promise<void> {
  const theme = process.argv[2] ?? 'a meme celebrating BNB Chain 2026 agentic commerce';

  const config = loadConfig();
  const openrouterKey = config.openrouter.apiKey ?? config.anthropic.apiKey;
  if (openrouterKey === undefined || openrouterKey.trim() === '') {
    console.error(
      '[demo] OPENROUTER_API_KEY (preferred) or ANTHROPIC_API_KEY missing from .env.local',
    );
    process.exit(1);
    return;
  }

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
    apiKey: openrouterKey,
    baseURL: OPENROUTER_BASE_URL,
  });
  const gemini = new GoogleGenAI({ apiKey: env.GOOGLE_API_KEY });
  const pinata = new PinataSDK({
    pinataJwt: env.PINATA_JWT,
    pinataGateway: 'gateway.pinata.cloud',
  });

  const registry = new ToolRegistry();
  registry.register(createNarrativeTool({ client: anthropic, model: MODEL }));
  registry.register(createImageTool({ client: gemini, pinata }));
  registry.register(createLoreTool({ anthropic, pinata, model: MODEL }));
  registry.register(createOnchainDeployerTool({ privateKey: env.BSC_DEPLOYER_PRIVATE_KEY }));

  // AC3 layer-1 anchor ledger — gives the `demo:creator` CLI the same
  // `lore-anchor` artifact surface the long-lived HTTP server produces. CLI is
  // short-lived so in-memory ledger is sufficient.
  const anchorLedger = new AnchorLedger();
  const anchorEnabled = process.env.ANCHOR_ON_CHAIN === 'true';
  console.info(`[anchor] on-chain anchor layer: ${anchorEnabled ? 'enabled' : 'disabled'}`);

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

  const printLog = (e: {
    ts: string;
    agent: string;
    tool: string;
    level: string;
    message: string;
  }): void => {
    const ts = e.ts.slice(11, 19);
    console.info(`[${ts}] ${e.agent}.${e.tool} [${e.level}] ${e.message}`);
  };

  const started = Date.now();
  const { result, loop } = await runCreatorAgent({
    client: anthropic,
    registry,
    theme,
    model: MODEL,
    onLog: printLog,
  });
  const elapsedSec = ((Date.now() - started) / 1000).toFixed(1);

  // AC3 — anchor Chapter 1 symmetrically with the `runCreatorPhase` path so
  // the CLI produces the same on-chain evidence surface. Layer-1 always runs
  // when the ledger is wired; layer-2 is gated inside `anchorChapterOne` by
  // `ANCHOR_ON_CHAIN`. Non-fatal by contract — a failure here never breaks
  // the CLI's summary print.
  // `env.BSC_DEPLOYER_PRIVATE_KEY` is already validated non-empty + 0x-hex by
  // `envSchema`, so we only need to guard the lore CID here.
  if (result.loreIpfsCid !== '') {
    await anchorChapterOne({
      anchorLedger,
      tokenAddr: result.tokenAddr,
      loreCid: result.loreIpfsCid,
      bscDeployerPrivateKey: env.BSC_DEPLOYER_PRIVATE_KEY as `0x${string}`,
      onArtifact: (artifact) => {
        // Surface the anchor artifacts alongside the log stream so the CLI
        // transcript matches what the dashboard's left column would render.
        if (artifact.kind === 'lore-anchor') {
          const layer = artifact.onChainTxHash !== undefined ? 'layer-2' : 'layer-1';
          const tail =
            artifact.onChainTxHash !== undefined
              ? ` tx=${artifact.onChainTxHash} ${artifact.explorerUrl ?? ''}`
              : '';
          console.info(
            `[anchor] ${layer} ${artifact.anchorId} chapter=${artifact.chapterNumber.toString()} cid=${artifact.loreCid}${tail}`,
          );
        }
      },
      onLog: printLog,
    });
  }

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
