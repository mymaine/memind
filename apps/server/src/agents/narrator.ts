import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type {
  Artifact,
  AssistantDeltaEventPayload,
  LogEvent,
  Persona,
  PersonaRunContext,
  ToolUseEndEventPayload,
  ToolUseStartEventPayload,
} from '@hack-fourmeme/shared';
import type { ToolRegistry } from '../tools/registry.js';
import type { LoreStore } from '../state/lore-store.js';
import { type AnchorLedger, computeAnchorId, computeContentHash } from '../state/anchor-ledger.js';
import {
  runAgentLoop,
  type RuntimeAssistantDelta,
  type RuntimeToolUseEnd,
  type RuntimeToolUseStart,
  type ToolCallTrace,
} from './runtime.js';

/**
 * Narrator Agent — the "archivist" of the three-agent swarm.
 *
 * Narrator owns exactly one responsibility: produce the next lore chapter for
 * a given token (via the `extend_lore` tool), then persist the result into a
 * LoreStore so the x402 `/lore/:tokenAddr` endpoint can serve it to paying
 * callers. It does NOT post to X, deploy tokens, or pay x402 invoices — those
 * belong to Creator (Phase 2), the X tool chain (Wave 1), and Market-maker
 * (parallel Wave 2), respectively.
 *
 * The agent is intentionally a thin wrapper around runAgentLoop:
 *   - System prompt forces a single `extend_lore` call and a short sign-off.
 *   - After the loop ends, we pull the tool call trace, assert exactly one
 *     successful `extend_lore` result, and upsert it into the store.
 *   - Errors (no call, failed call) surface as thrown Errors so callers can
 *     decide whether to retry.
 */

export interface RunNarratorAgentParams {
  client: Anthropic;
  /** Must contain an `extend_lore` tool. */
  registry: ToolRegistry;
  /** Where the produced chapter is written. */
  store: LoreStore;
  tokenAddr: string;
  tokenName: string;
  tokenSymbol: string;
  /** Prior chapter bodies (oldest first). Empty means this is chapter 1. */
  previousChapters?: string[];
  /** Override the default chapter number (previousChapters.length + 1). */
  targetChapterNumber?: number;
  model?: string;
  maxTurns?: number;
  onLog?: (event: LogEvent) => void;
  /** V2-P2 streaming hooks — forwarded to runAgentLoop. */
  onToolUseStart?: (event: RuntimeToolUseStart) => void;
  onToolUseEnd?: (event: RuntimeToolUseEnd) => void;
  onAssistantDelta?: (event: RuntimeAssistantDelta) => void;
  /**
   * AC3 anchor hook. When `anchorLedger` is supplied, the Narrator appends a
   * ledger entry after the LoreStore upsert and (if `onArtifact` is also
   * supplied) emits a `lore-anchor` artifact carrying the keccak256
   * commitment. Both are optional: callers that don't need anchor evidence
   * (Phase 2 demos, narrator unit fixtures) may omit them and the happy path
   * is unchanged. The optional layer-2 BSC self-tx memo is invoked
   * separately (see `apps/server/src/chain/anchor-tx.ts`).
   */
  anchorLedger?: AnchorLedger;
  onArtifact?: (artifact: Artifact) => void;
}

export interface NarratorAgentOutput {
  tokenAddr: string;
  chapterNumber: number;
  ipfsHash: string;
  ipfsUri: string;
  chapterText: string;
  toolCalls: ToolCallTrace[];
}

const DEFAULT_MODEL = 'anthropic/claude-sonnet-4-5';

const NARRATOR_SYSTEM_PROMPT = `You are Narrator Agent, the archivist of the Four.Meme three-agent swarm. You are patient, archive-minded, and preserve timeline continuity across every token's saga.

Your ONLY responsibility per invocation: call the \`extend_lore\` tool exactly once with the token inputs the caller provides, then report the result.

Rules:
- Call \`extend_lore\` exactly once. Do not call any other tool.
- Pass the supplied tokenAddr, tokenName, tokenSymbol, previousChapters, and targetChapterNumber verbatim — do not invent alternatives.
- After the tool returns, reply with a short plain-text acknowledgement referencing the chapter number and ipfsHash. No JSON, no code fences.
- Do not post to X, do not touch on-chain state, do not attempt any action outside the single tool call above.`;

/**
 * Extract the final, successful `extend_lore` call from a loop trace. There
 * should be exactly one. We throw on any deviation so the caller learns early
 * instead of silently persisting an empty / errored chapter.
 */
function pickExtendLoreCall(toolCalls: ToolCallTrace[]): ToolCallTrace {
  const matches = toolCalls.filter((c) => c.name === 'extend_lore');
  if (matches.length === 0) {
    throw new Error(
      'runNarratorAgent: agent loop terminated without invoking extend_lore — ' +
        'the Narrator must always call extend_lore exactly once per run.',
    );
  }
  // Prefer the last call in case the model retried; the final one wins.
  const last = matches[matches.length - 1]!;
  if (last.isError) {
    const detail =
      typeof last.output === 'object' &&
      last.output !== null &&
      'error' in last.output &&
      typeof (last.output as { error: unknown }).error === 'string'
        ? (last.output as { error: string }).error
        : 'unknown error';
    throw new Error(`runNarratorAgent: extend_lore failed: ${detail}`);
  }
  return last;
}

interface ExtendLoreResultShape {
  chapterNumber: number;
  chapterText: string;
  ipfsHash: string;
  ipfsUri: string;
}

/**
 * Narrow the loosely-typed `output` field of a ToolCallTrace into the
 * `extend_lore` output shape. The tool's own zod outputSchema already runs
 * inside runAgentLoop, so by the time we reach here the object is guaranteed
 * to have these four fields; we re-check types defensively to fail loud on
 * any future contract drift.
 */
function expectExtendLoreOutput(output: unknown): ExtendLoreResultShape {
  if (typeof output !== 'object' || output === null) {
    throw new Error('runNarratorAgent: extend_lore returned non-object output');
  }
  const o = output as Record<string, unknown>;
  if (
    typeof o.chapterNumber !== 'number' ||
    typeof o.chapterText !== 'string' ||
    typeof o.ipfsHash !== 'string' ||
    typeof o.ipfsUri !== 'string'
  ) {
    throw new Error('runNarratorAgent: extend_lore output missing required fields');
  }
  return {
    chapterNumber: o.chapterNumber,
    chapterText: o.chapterText,
    ipfsHash: o.ipfsHash,
    ipfsUri: o.ipfsUri,
  };
}

export async function runNarratorAgent(
  params: RunNarratorAgentParams,
): Promise<NarratorAgentOutput> {
  const {
    client,
    registry,
    store,
    tokenAddr,
    tokenName,
    tokenSymbol,
    previousChapters = [],
    targetChapterNumber,
    model = DEFAULT_MODEL,
    maxTurns,
    onLog,
    onToolUseStart,
    onToolUseEnd,
    onAssistantDelta,
    anchorLedger,
    onArtifact,
  } = params;

  const chapterNumber = targetChapterNumber ?? previousChapters.length + 1;

  const userInput =
    `Extend the lore for token ${tokenName} (${tokenSymbol}) at ${tokenAddr}. ` +
    `Target chapter number ${chapterNumber.toString()}. ` +
    `${previousChapters.length.toString()} prior chapters attached.`;

  const loop = await runAgentLoop({
    client,
    model,
    registry,
    systemPrompt: NARRATOR_SYSTEM_PROMPT,
    userInput,
    maxTurns,
    onLog,
    onToolUseStart,
    onToolUseEnd,
    onAssistantDelta,
    agentId: 'narrator',
  });

  const call = pickExtendLoreCall(loop.toolCalls);

  // Guard against tool-input hallucination: the Narrator stores the chapter
  // under `params.tokenAddr`, but `call.output` ultimately derives from the
  // input the model fed to extend_lore. If the model rewrote that address
  // (even accidentally), chapter data for token B would be filed under key
  // A — a silent data-binding bug. Fail loud instead.
  const calledAddr = (() => {
    const input = call.input;
    if (typeof input !== 'object' || input === null) return undefined;
    const v = (input as Record<string, unknown>).tokenAddr;
    return typeof v === 'string' ? v : undefined;
  })();
  if (calledAddr === undefined || calledAddr.toLowerCase() !== tokenAddr.toLowerCase()) {
    throw new Error(
      `Narrator agent: extend_lore called with unexpected tokenAddr ` +
        `(expected ${tokenAddr}, got ${calledAddr ?? '<missing>'})`,
    );
  }

  const result = expectExtendLoreOutput(call.output);

  await store.upsert({
    tokenAddr,
    chapterNumber: result.chapterNumber,
    chapterText: result.chapterText,
    ipfsHash: result.ipfsHash,
    ipfsUri: result.ipfsUri,
    // Persist the caller-supplied name/symbol on every chapter so the Brain
    // orchestrator's `resolveTokenMeta` lookup can recover them from the
    // lore chain on later `/lore` / `/order` calls without a parallel
    // metadata store.
    tokenName,
    tokenSymbol,
    publishedAt: new Date().toISOString(),
  });

  // Return the normalised tokenAddr so the caller can trust it as a key.
  const stored = await store.getLatest(tokenAddr);
  if (!stored) {
    // Should be unreachable — we just upserted. Guard against a future
    // LoreStore bug rather than silently returning undefined.
    throw new Error('runNarratorAgent: upsert did not land — LoreStore contract violated');
  }

  // AC3 anchor layer 1: record the commitment in the ledger and optionally
  // fan it out to the SSE artifact stream so the dashboard can render it in
  // the Anchor Evidence panel. All failures must be non-fatal for the
  // narrator happy path — the anchor is evidence, not a gate.
  if (anchorLedger) {
    const anchorId = computeAnchorId(stored.tokenAddr, stored.chapterNumber);
    const contentHash = computeContentHash(stored.tokenAddr, stored.chapterNumber, stored.ipfsHash);
    const ts = new Date().toISOString();
    await anchorLedger.append({
      anchorId,
      tokenAddr: stored.tokenAddr,
      chapterNumber: stored.chapterNumber,
      loreCid: stored.ipfsHash,
      contentHash,
      ts,
    });
    if (onArtifact) {
      onArtifact({
        kind: 'lore-anchor',
        anchorId,
        tokenAddr: stored.tokenAddr,
        chapterNumber: stored.chapterNumber,
        loreCid: stored.ipfsHash,
        contentHash,
        ts,
      });
    }
  }

  return {
    tokenAddr: stored.tokenAddr,
    chapterNumber: stored.chapterNumber,
    ipfsHash: stored.ipfsHash,
    ipfsUri: stored.ipfsUri,
    chapterText: stored.chapterText,
    toolCalls: loop.toolCalls,
  };
}

// ---------------------------------------------------------------------------
// Persona adapter — Brain positioning (2026-04-19).
// ---------------------------------------------------------------------------
// `narratorPersona` wraps `runNarratorAgent` in the generic `Persona<TInput,
// TOutput>` contract. The runner's `store` dependency is threaded through
// the persona `TInput` (rather than the shared `PersonaRunContext`) because
// only the Narrator needs it; keeping the context uniform is a hard rule
// from the Persona interface. Output schema omits the `toolCalls` trace —
// callers that need it still use `runNarratorAgent` directly.
// ---------------------------------------------------------------------------

export const narratorPersonaInputSchema = z.object({
  tokenAddr: z.string().min(1),
  tokenName: z.string().min(1),
  tokenSymbol: z.string().min(1),
  previousChapters: z.array(z.string()).optional(),
  targetChapterNumber: z.number().int().positive().optional(),
  model: z.string().optional(),
  maxTurns: z.number().int().positive().optional(),
});
export type NarratorPersonaInput = z.input<typeof narratorPersonaInputSchema>;

export const narratorPersonaOutputSchema = z.object({
  tokenAddr: z.string(),
  chapterNumber: z.number().int().positive(),
  ipfsHash: z.string(),
  ipfsUri: z.string(),
  chapterText: z.string(),
});
export type NarratorPersonaOutput = z.infer<typeof narratorPersonaOutputSchema>;

export const narratorPersona: Persona<NarratorPersonaInput, NarratorPersonaOutput> = {
  id: 'narrator',
  description:
    'Narrator persona — extends a token lore timeline by calling extend_lore exactly once and upserting the chapter into the injected LoreStore.',
  inputSchema: narratorPersonaInputSchema,
  outputSchema: narratorPersonaOutputSchema,
  async run(input, ctx: PersonaRunContext) {
    const parsed = narratorPersonaInputSchema.parse(input);
    // The LoreStore is a process-wide singleton, so the adapter reads it off
    // the context's escape-hatch slot rather than demanding the caller pass
    // it on every run payload. Type-narrowed locally.
    const store = ctx.store as LoreStore | undefined;
    if (!store) {
      throw new Error(
        'narratorPersona.run: PersonaRunContext.store is required (LoreStore instance)',
      );
    }
    // Brain-driven runs wire their RunStore forwarders onto `ctx.*` so the
    // nested extend_lore loop + the `lore-anchor` artifact both reach the
    // FooterDrawer Logs/Artifacts tabs via SSE. Missing callbacks are a no-op.
    const onLog = ctx.onLog as ((event: LogEvent) => void) | undefined;
    const onArtifact = ctx.onArtifact as ((artifact: Artifact) => void) | undefined;
    const onToolUseStart = ctx.onToolUseStart as
      | ((event: ToolUseStartEventPayload) => void)
      | undefined;
    const onToolUseEnd = ctx.onToolUseEnd as ((event: ToolUseEndEventPayload) => void) | undefined;
    const onAssistantDelta = ctx.onAssistantDelta as
      | ((event: AssistantDeltaEventPayload) => void)
      | undefined;
    const out = await runNarratorAgent({
      client: ctx.client as Anthropic,
      registry: ctx.registry as ToolRegistry,
      store,
      tokenAddr: parsed.tokenAddr,
      tokenName: parsed.tokenName,
      tokenSymbol: parsed.tokenSymbol,
      ...(parsed.previousChapters !== undefined
        ? { previousChapters: parsed.previousChapters }
        : {}),
      ...(parsed.targetChapterNumber !== undefined
        ? { targetChapterNumber: parsed.targetChapterNumber }
        : {}),
      ...(parsed.model !== undefined ? { model: parsed.model } : {}),
      ...(parsed.maxTurns !== undefined ? { maxTurns: parsed.maxTurns } : {}),
      ...(onLog !== undefined ? { onLog } : {}),
      ...(onArtifact !== undefined ? { onArtifact } : {}),
      ...(onToolUseStart !== undefined ? { onToolUseStart } : {}),
      ...(onToolUseEnd !== undefined ? { onToolUseEnd } : {}),
      ...(onAssistantDelta !== undefined ? { onAssistantDelta } : {}),
    });
    return {
      tokenAddr: out.tokenAddr,
      chapterNumber: out.chapterNumber,
      ipfsHash: out.ipfsHash,
      ipfsUri: out.ipfsUri,
      chapterText: out.chapterText,
    };
  },
};
