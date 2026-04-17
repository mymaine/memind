import { z } from 'zod';

export const agentIdSchema = z.enum(['creator', 'narrator', 'market-maker', 'heartbeat']);
export type AgentId = z.infer<typeof agentIdSchema>;

export const agentStatusSchema = z.enum(['idle', 'running', 'done', 'error']);
export type AgentStatus = z.infer<typeof agentStatusSchema>;

// `bsc-testnet` retained for probe compatibility only; production path is `bsc-mainnet`
// per docs/decisions/2026-04-18-bsc-mainnet-pivot.md.
export const chainSchema = z.enum(['bsc-mainnet', 'bsc-testnet', 'base-sepolia', 'ipfs']);
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

// ---------------------------------------------------------------------------
// Artifacts — discriminated union of the five pill kinds shown in the web
// dashboard. Server-side demo orchestrators emit these through the SSE stream
// so the client renders the correct chain color + explorer link for each kind.
// See docs/decisions/2026-04-20-sse-and-runs-api.md for the shape rationale.
// ---------------------------------------------------------------------------

const evmAddressRegex = /^0x[a-fA-F0-9]{40}$/;
const evmTxHashRegex = /^0x[a-fA-F0-9]{64}$/;

export const bscTokenArtifactSchema = z.object({
  kind: z.literal('bsc-token'),
  chain: z.literal('bsc-mainnet'),
  address: z.string().regex(evmAddressRegex),
  explorerUrl: z.string().url(),
  label: z.string().optional(),
});

export const tokenDeployTxArtifactSchema = z.object({
  kind: z.literal('token-deploy-tx'),
  chain: z.literal('bsc-mainnet'),
  txHash: z.string().regex(evmTxHashRegex),
  explorerUrl: z.string().url(),
  label: z.string().optional(),
});

export const loreCidArtifactSchema = z.object({
  kind: z.literal('lore-cid'),
  cid: z.string().min(1),
  gatewayUrl: z.string().url(),
  author: z.enum(['creator', 'narrator']),
  chapterNumber: z.number().int().positive().optional(),
  label: z.string().optional(),
});

export const x402TxArtifactSchema = z.object({
  kind: z.literal('x402-tx'),
  chain: z.literal('base-sepolia'),
  txHash: z.string().regex(evmTxHashRegex),
  explorerUrl: z.string().url(),
  amountUsdc: z.string(), // decimal encoded as string to avoid float drift
  label: z.string().optional(),
});

export const tweetUrlArtifactSchema = z.object({
  kind: z.literal('tweet-url'),
  url: z.string().url(),
  tweetId: z.string().min(1),
  label: z.string().optional(),
});

export const artifactSchema = z.discriminatedUnion('kind', [
  bscTokenArtifactSchema,
  tokenDeployTxArtifactSchema,
  loreCidArtifactSchema,
  x402TxArtifactSchema,
  tweetUrlArtifactSchema,
]);
export type Artifact = z.infer<typeof artifactSchema>;
export type ArtifactKind = Artifact['kind'];

// ---------------------------------------------------------------------------
// Runs API — POST /api/runs + GET /api/runs/:id + GET /api/runs/:id/events.
// Phase 4 scope-limits `kind` to `a2a` only; `creator` and `heartbeat` slots
// are reserved for a follow-up without breaking the wire format.
// ---------------------------------------------------------------------------

export const runKindSchema = z.enum(['creator', 'a2a', 'heartbeat']);
export type RunKind = z.infer<typeof runKindSchema>;

export const runStatusSchema = z.enum(['pending', 'running', 'done', 'error']);
export type RunStatus = z.infer<typeof runStatusSchema>;

export const createRunRequestSchema = z.object({
  kind: runKindSchema,
  params: z.record(z.unknown()).optional(),
});
export type CreateRunRequest = z.infer<typeof createRunRequestSchema>;

export const createRunResponseSchema = z.object({
  runId: z.string().min(1),
});
export type CreateRunResponse = z.infer<typeof createRunResponseSchema>;

export const runSnapshotSchema = z.object({
  runId: z.string().min(1),
  kind: runKindSchema,
  status: runStatusSchema,
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().optional(),
  artifacts: z.array(artifactSchema),
  logs: z.array(logEventSchema),
  errorMessage: z.string().optional(),
});
export type RunSnapshot = z.infer<typeof runSnapshotSchema>;

// ---------------------------------------------------------------------------
// SSE event payloads — each corresponds to an `event: <name>` field on the
// wire. Clients use EventSource.addEventListener(<name>, ...) to dispatch.
// A heartbeat comment line (`: ping`) is sent periodically by the server but
// carries no data payload and is invisible to EventSource handlers.
// ---------------------------------------------------------------------------

export const logEventPayloadSchema = logEventSchema;
export type LogEventPayload = LogEvent;

export const artifactEventPayloadSchema = artifactSchema;
export type ArtifactEventPayload = Artifact;

export const statusEventPayloadSchema = z.object({
  runId: z.string().min(1),
  status: runStatusSchema,
  errorMessage: z.string().optional(),
});
export type StatusEventPayload = z.infer<typeof statusEventPayloadSchema>;

export type SseEventName = 'log' | 'artifact' | 'status';
