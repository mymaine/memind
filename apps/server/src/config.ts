import { z } from 'zod';

// Treat empty strings in .env files as undefined so optional env entries like
// `AGENT_WALLET_ADDRESS=` don't trip regex validation. This mirrors the guard
// used in scripts/probe-x402.ts.
const emptyAsUndefined = (v: unknown): unknown =>
  typeof v === 'string' && v.trim() === '' ? undefined : v;

const envSchema = z.object({
  SERVER_PORT: z.coerce.number().default(4000),

  ANTHROPIC_API_KEY: z.preprocess(emptyAsUndefined, z.string().min(1).optional()),

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
});

export type AppConfig = {
  port: number;
  anthropic: { apiKey: string | undefined };
  pinata: { jwt: string | undefined };
  wallets: {
    agent: { privateKey: string | undefined; address: string | undefined };
    bscDeployer: { privateKey: string | undefined; address: string | undefined };
  };
  x402: { facilitatorUrl: string; network: string };
};

export function loadConfig(): AppConfig {
  const env = envSchema.parse(process.env);
  return {
    port: env.SERVER_PORT,
    anthropic: { apiKey: env.ANTHROPIC_API_KEY },
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
  };
}
