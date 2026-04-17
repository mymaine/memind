import { z } from 'zod';

// Treat empty strings in .env files as undefined so optional env entries like
// `AGENT_WALLET_ADDRESS=` don't trip regex validation. This mirrors the guard
// used in scripts/probe-x402.ts.
const emptyAsUndefined = (v: unknown): unknown =>
  typeof v === 'string' && v.trim() === '' ? undefined : v;

const envSchema = z.object({
  SERVER_PORT: z.coerce.number().default(4000),

  ANTHROPIC_API_KEY: z.preprocess(emptyAsUndefined, z.string().min(1).optional()),
  // Dual-name transition: Phase 3 routes Anthropic SDK calls through
  // OpenRouter's Anthropic-compatible gateway. The key is the same secret,
  // just named differently depending on whose docs you follow. Both names
  // are accepted; demos read `openrouter.apiKey ?? anthropic.apiKey`.
  OPENROUTER_API_KEY: z.preprocess(emptyAsUndefined, z.string().min(1).optional()),

  PINATA_JWT: z.preprocess(emptyAsUndefined, z.string().min(1).optional()),

  AGENT_WALLET_PRIVATE_KEY: z.preprocess(
    emptyAsUndefined,
    z
      .string()
      .regex(/^0x[a-fA-F0-9]{64}$/)
      .optional(),
  ),
  AGENT_WALLET_ADDRESS: z.preprocess(
    emptyAsUndefined,
    z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/)
      .optional(),
  ),

  BSC_DEPLOYER_PRIVATE_KEY: z.preprocess(
    emptyAsUndefined,
    z
      .string()
      .regex(/^0x[a-fA-F0-9]{64}$/)
      .optional(),
  ),
  BSC_DEPLOYER_ADDRESS: z.preprocess(
    emptyAsUndefined,
    z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/)
      .optional(),
  ),

  X402_FACILITATOR_URL: z.string().url().default('https://x402.org/facilitator'),
  X402_NETWORK: z.string().default('eip155:84532'),

  // BSC mainnet RPC for read-path tools (check_token_status, etc).
  BSC_RPC_URL: z.string().url().default('https://bsc-dataseed.binance.org'),

  // Heartbeat agent tick interval. Production default 60s; demo-accelerated
  // recordings override via env (e.g. HEARTBEAT_INTERVAL_MS=15000).
  HEARTBEAT_INTERVAL_MS: z.coerce.number().int().positive().default(60_000),

  // X (Twitter) API credentials. OAuth 1.0a User Context is required for
  // POST /2/tweets; the bearer token is retained for read paths (e.g.
  // mentions lookup as a stretch goal).
  X_API_KEY: z.preprocess(emptyAsUndefined, z.string().min(1).optional()),
  X_API_KEY_SECRET: z.preprocess(emptyAsUndefined, z.string().min(1).optional()),
  X_ACCESS_TOKEN: z.preprocess(emptyAsUndefined, z.string().min(1).optional()),
  X_ACCESS_TOKEN_SECRET: z.preprocess(emptyAsUndefined, z.string().min(1).optional()),
  X_BEARER_TOKEN: z.preprocess(emptyAsUndefined, z.string().min(1).optional()),
  // Optional handle used to build canonical tweet URLs. Fallback to
  // https://x.com/i/web/status/<id> when unset.
  X_HANDLE: z.preprocess(emptyAsUndefined, z.string().min(1).optional()),
});

export type AppConfig = {
  port: number;
  // Dual-name transition (Phase 2 → Phase 3): `anthropic.apiKey` is the
  // historical slot (env `ANTHROPIC_API_KEY`), `openrouter.apiKey` is the
  // current slot (env `OPENROUTER_API_KEY`). Both point at the same secret
  // because Phase 3 routes Anthropic SDK calls through OpenRouter's
  // Anthropic-compatible gateway. Callers should prefer
  // `openrouter.apiKey ?? anthropic.apiKey` and fail fast when both are
  // undefined. Kept as separate fields so Phase 2 callers that still read
  // `anthropic.apiKey` stay source-compatible.
  anthropic: { apiKey: string | undefined };
  openrouter: { apiKey: string | undefined };
  pinata: { jwt: string | undefined };
  wallets: {
    agent: { privateKey: string | undefined; address: string | undefined };
    bscDeployer: { privateKey: string | undefined; address: string | undefined };
  };
  x402: { facilitatorUrl: string; network: string };
  bsc: { rpcUrl: string };
  heartbeat: { intervalMs: number };
  x: {
    apiKey: string | undefined;
    apiKeySecret: string | undefined;
    accessToken: string | undefined;
    accessTokenSecret: string | undefined;
    bearerToken: string | undefined;
    handle: string | undefined;
  };
};

export function loadConfig(): AppConfig {
  const env = envSchema.parse(process.env);
  return {
    port: env.SERVER_PORT,
    anthropic: { apiKey: env.ANTHROPIC_API_KEY },
    openrouter: { apiKey: env.OPENROUTER_API_KEY },
    pinata: { jwt: env.PINATA_JWT },
    wallets: {
      agent: {
        privateKey: env.AGENT_WALLET_PRIVATE_KEY,
        address: env.AGENT_WALLET_ADDRESS,
      },
      bscDeployer: {
        privateKey: env.BSC_DEPLOYER_PRIVATE_KEY,
        address: env.BSC_DEPLOYER_ADDRESS,
      },
    },
    x402: {
      facilitatorUrl: env.X402_FACILITATOR_URL,
      network: env.X402_NETWORK,
    },
    bsc: { rpcUrl: env.BSC_RPC_URL },
    heartbeat: { intervalMs: env.HEARTBEAT_INTERVAL_MS },
    x: {
      apiKey: env.X_API_KEY,
      apiKeySecret: env.X_API_KEY_SECRET,
      accessToken: env.X_ACCESS_TOKEN,
      accessTokenSecret: env.X_ACCESS_TOKEN_SECRET,
      bearerToken: env.X_BEARER_TOKEN,
      handle: env.X_HANDLE,
    },
  };
}
