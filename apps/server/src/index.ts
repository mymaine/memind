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
import { LoreStore } from './state/lore-store.js';
import { AnchorLedger } from './state/anchor-ledger.js';
import { ShillOrderStore } from './state/shill-order-store.js';
import { HeartbeatSessionStore } from './state/heartbeat-session-store.js';
import { ArtifactLogStore } from './state/artifact-log-store.js';
import { RunStore } from './runs/store.js';
import { registerRunRoutes } from './runs/routes.js';
import { createRealCreatorPaymentPhase } from './runs/shill-market.js';
import { HeartbeatEventBus } from './runs/heartbeat-events.js';
import { getPool, logPoolSummary } from './db/pool.js';
import { ensureSchema } from './db/schema.js';

// OpenRouter Anthropic-compatible gateway — same endpoint the demo CLIs use.
// Centralised here so the long-lived HTTP server holds a single Anthropic
// client for every run dispatched through POST /api/runs.
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api';

const config = loadConfig();

async function main(): Promise<void> {
  // Stand up the pg pool and run every CREATE TABLE IF NOT EXISTS before
  // any store is constructed. `ensureSchema` also flips any ghost
  // `heartbeat_sessions.running=true` rows back to false so UI reads don't
  // show phantom loops from the previous process. A live database is
  // required — the in-memory fallback was retired at the end of the
  // Postgres migration (see docs/features/persistence/postgres-migration.md).
  const pool = getPool();
  await ensureSchema(pool);
  await logPoolSummary(pool);

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '2mb' }));

  // Module-scope state shared between the x402 `/lore/:addr` handler and the
  // Narrator agent (which runs inside `runA2ADemo`). Both sides MUST see the
  // same LoreStore instance so an agent-upserted chapter is what a paying
  // caller reads back.
  const loreStore = new LoreStore({ pool });
  const runStore = new RunStore();
  // AC3 layer 1 anchor ledger — one shared instance so the Narrator phase
  // records commitments and any subsequent read endpoint can surface them.
  const anchorLedger = new AnchorLedger({ pool });
  // Shill-market order queue — shared between the x402 /shill/:tokenAddr
  // endpoint (producer) and the shill-market orchestrator (consumer). Dashboard
  // runs must see the same instance so POST /api/runs { kind: 'shill-market' }
  // does not 500 out at the routes guard.
  const shillOrderStore = new ShillOrderStore({ pool });
  // Live tick event bus — fan-out surface for the SSE endpoint at
  // `/api/heartbeats/:tokenAddr/events`. Constructed before the session
  // store so the store's `onAfterTick` hook can reference it in a closure.
  const heartbeatEventBus = new HeartbeatEventBus();
  // Long-lived heartbeat session registry — one instance for the process so
  // `/heartbeat <addr> <intervalMs>` on one brain-chat run and
  // `/heartbeat-stop <addr>` on a later run hit the same map of timers. The
  // `onAfterTick` hook fans every tick (scheduled, immediate, overlap-skip,
  // error) into the shared event bus so web clients see live updates.
  const heartbeatSessionStore = new HeartbeatSessionStore({
    pool,
    onAfterTick: (snapshot, delta) => {
      heartbeatEventBus.emit(snapshot.tokenAddr, {
        tokenAddr: snapshot.tokenAddr,
        snapshot,
        delta,
        ...(delta.artifacts !== undefined && delta.artifacts.length > 0
          ? { artifacts: delta.artifacts }
          : {}),
        emittedAt: new Date().toISOString(),
      });
    },
  });
  // Artifacts log — Ch12 evidence hydration backend.
  const artifactLogStore = new ArtifactLogStore({ pool });
  // Thread the artifacts writer into the RunStore so `pushArtifact` performs
  // its fire-and-forget append alongside the SSE broadcast.
  runStore.setArtifactLog(artifactLogStore);

  // Anthropic client. Uses the same key resolution the demos use so POST
  // /api/runs fails fast if neither key is configured.
  const openrouterKey = config.openrouter.apiKey ?? config.anthropic.apiKey ?? '';
  const anthropic = new Anthropic({
    apiKey: openrouterKey,
    baseURL: OPENROUTER_BASE_URL,
  });

  registerHealthRoutes(app);
  registerX402Routes(app, config, { loreStore, shillOrderStore });
  // Dashboard shill-market runs get a real `@x402/fetch` payment phase so the
  // settlement artifact carries a genuine Base Sepolia USDC tx hash. Falls back
  // gracefully to the stub if `AGENT_WALLET_PRIVATE_KEY` is not set — the
  // orchestrator's own default is the stub, so missing key == stub behaviour.
  const agentPrivateKey = config.wallets.agent.privateKey;
  const shillCreatorPaymentImpl =
    agentPrivateKey !== undefined && agentPrivateKey.startsWith('0x')
      ? createRealCreatorPaymentPhase({
          agentPrivateKey: agentPrivateKey as `0x${string}`,
          serverPort: config.port,
        })
      : undefined;
  registerRunRoutes(app, {
    config,
    anthropic,
    runStore,
    loreStore,
    anchorLedger,
    shillOrderStore,
    heartbeatSessionStore,
    heartbeatEventBus,
    artifactLogStore,
    ...(shillCreatorPaymentImpl !== undefined ? { shillCreatorPaymentImpl } : {}),
  });

  // Bind to 0.0.0.0 so Railway/containerised proxies can reach the app.
  // Express's default host is 127.0.0.1, which is only reachable from inside
  // the container.
  app.listen(config.port, '0.0.0.0', () => {
    console.info(`[server] listening on 0.0.0.0:${config.port}`);
    console.info(`[server] x402 network: ${config.x402.network}`);
    console.info(`[server] facilitator: ${config.x402.facilitatorUrl}`);
    // AC3 — surface the on-chain anchor layer's state at boot so operators
    // can verify at a glance whether layer 2 is active for this run.
    const anchorEnabled = process.env.ANCHOR_ON_CHAIN === 'true';
    console.info(`[anchor] on-chain anchor layer: ${anchorEnabled ? 'enabled' : 'disabled'}`);
  });
}

void main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[server] fatal boot error: ${message}`);
  process.exit(1);
});
