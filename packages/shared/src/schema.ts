import { z } from 'zod';

export const agentIdSchema = z.enum(['creator', 'narrator', 'market-maker']);
export type AgentId = z.infer<typeof agentIdSchema>;

export const agentStatusSchema = z.enum(['idle', 'running', 'done', 'error']);
export type AgentStatus = z.infer<typeof agentStatusSchema>;

export const chainSchema = z.enum(['bsc-testnet', 'base-sepolia', 'ipfs']);
export type Chain = z.infer<typeof chainSchema>;

export const txRefSchema = z.object({
  chain: chainSchema,
  hash: z.string(),
  label: z.string().optional(),
  explorerUrl: z.string().url(),
});
export type TxRef = z.infer<typeof txRefSchema>;

export const logEventSchema = z.object({
  ts: z.string().datetime(),
  agent: agentIdSchema,
  tool: z.string(),
  level: z.enum(['debug', 'info', 'warn', 'error']),
  message: z.string(),
  meta: z.record(z.unknown()).optional(),
});
export type LogEvent = z.infer<typeof logEventSchema>;

export const createRequestSchema = z.object({
  theme: z.string().min(3).max(280),
});
export type CreateRequest = z.infer<typeof createRequestSchema>;

export const tokenMetadataSchema = z.object({
  name: z.string(),
  symbol: z.string(),
  description: z.string(),
  imageLocalPath: z.string(),
  imageIpfsCid: z.string().optional(),
});
export type TokenMetadata = z.infer<typeof tokenMetadataSchema>;

export const creatorResultSchema = z.object({
  tokenAddr: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  tokenDeployTx: z.string(),
  loreIpfsCid: z.string(),
  metadata: tokenMetadataSchema,
});
export type CreatorResult = z.infer<typeof creatorResultSchema>;
