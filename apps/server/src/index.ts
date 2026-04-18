import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import express from 'express';
import cors from 'cors';
import Anthropic from '@anthropic-ai/sdk';
import { loadConfig } from './config.js';

// Load .env.local from the repo root — `import 'dotenv/config'` alone only
// reads `${cwd}/.env`, which is empty when the server is launched from
// `apps/server/` via `pnpm --filter ... dev`. This file lives at
// `apps/server/src/index.ts`, so 4 hops of `..` land on the repo root.
const repoRoot = resolve(fileURLToPath(import.meta.url), '../../../..');
loadDotenv({ path: resolve(repoRoot, '.env.local') });
import { registerHealthRoutes } from './routes/health.js';
import { registerX402Routes } from './x402/index.js';
import { registerAgentRoutes } from './agents/routes.js';
import { LoreStore } from './state/lore-store.js';
import { AnchorLedger } from './state/anchor-ledger.js';
import { RunStore } from './runs/store.js';
import { registerRunRoutes } from './runs/routes.js';

// OpenRouter Anthropic-compatible gateway — same endpoint the demo CLIs use.
// Centralised here so the long-lived HTTP server holds a single Anthropic
// client for every run dispatched through POST /api/runs.
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api';

const config = loadConfig();

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// Module-scope state shared between the x402 `/lore/:addr` handler and the
// Narrator agent (which runs inside `runA2ADemo`). Both sides MUST see the
// same LoreStore instance so an agent-upserted chapter is what a paying
// caller reads back. Same process, same Map.
const loreStore = new LoreStore();
const runStore = new RunStore();
// AC3 layer 1 anchor ledger — one shared instance so the Narrator phase
// records commitments and any subsequent read endpoint can surface them.
const anchorLedger = new AnchorLedger();

// Anthropic client. Uses the same key resolution the demos use so POST
// /api/runs fails fast if neither key is configured.
const openrouterKey = config.openrouter.apiKey ?? config.anthropic.apiKey ?? '';
const anthropic = new Anthropic({
  apiKey: openrouterKey,
  baseURL: OPENROUTER_BASE_URL,
});

registerHealthRoutes(app);
registerX402Routes(app, config, { loreStore });
registerAgentRoutes(app);
registerRunRoutes(app, { config, anthropic, runStore, loreStore, anchorLedger });

app.listen(config.port, () => {
  console.info(`[server] listening on :${config.port}`);
  console.info(`[server] x402 network: ${config.x402.network}`);
  console.info(`[server] facilitator: ${config.x402.facilitatorUrl}`);
});
