import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type {
  AnyAgentTool,
  Artifact,
  AssistantDeltaEventPayload,
  LogEvent,
  Persona,
  PersonaRunContext,
  ToolUseEndEventPayload,
  ToolUseStartEventPayload,
} from '@hack-fourmeme/shared';
import { ToolRegistry } from '../tools/registry.js';
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

Your ONLY responsibility per invocation: call the \`extend_lore\` tool exactly once, then report the result.

Rules:
- Call \`extend_lore\` exactly once. Do not call any other tool.
- The runtime injects tokenAddr, tokenName, tokenSymbol, previousChapters, and targetChapterNumber from server-side state before the tool executes — any values you pass for those fields will be overridden, so pass placeholders if needed.
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

/**
 * Narrator-scoped fields the wrapper forcibly injects into every `extend_lore`
 * call. These are the server-side authoritative values; whatever the LLM
 * placed in its `tool_use.input` for the same fields is discarded.
 */
interface ExtendLoreInjection {
  tokenAddr: string;
  tokenName: string;
  tokenSymbol: string;
  previousChapters: string[];
  targetChapterNumber: number;
}

/**
 * Build a throwaway `ToolRegistry` for one narrator invocation. The returned
 * registry contains every tool from `baseRegistry`, EXCEPT that `extend_lore`
 * (if present) is swapped for a wrapper whose `execute` overrides chapter
 * metadata with the injection values before delegating to the underlying
 * tool. The wrapper's name / description / input & output schemas are
 * identical to the original so the Anthropic tools payload the LLM sees does
 * not change.
 *
 * Why a new registry instead of mutating `baseRegistry`: `ToolRegistry` is a
 * process-wide singleton shared by every agent in the run (creator, heartbeat,
 * CLI demos). Mutating it would corrupt those callers. A per-run copy keeps
 * the injection narrator-local.
 */
function buildNarratorSubRegistryWithInjector(args: {
  baseRegistry: ToolRegistry;
  tokenAddr: string;
  tokenName: string;
  tokenSymbol: string;
  previousChapters: string[];
  targetChapterNumber: number;
}): ToolRegistry {
  const { baseRegistry } = args;
  const injection: ExtendLoreInjection = {
    tokenAddr: args.tokenAddr,
    tokenName: args.tokenName,
    tokenSymbol: args.tokenSymbol,
    // Shallow copy: the caller's array may be mutated between registry build
    // and the deferred LLM-driven execute. A one-time slice is cheap and
    // guarantees the injection is a stable snapshot.
    previousChapters: [...args.previousChapters],
    targetChapterNumber: args.targetChapterNumber,
  };

  const subRegistry = new ToolRegistry();
  for (const tool of baseRegistry.list()) {
    if (tool.name === 'extend_lore') {
      subRegistry.register(wrapExtendLoreWithInjector(tool, injection));
    } else {
      subRegistry.register(tool);
    }
  }
  return subRegistry;
}

/**
 * Wrap an `extend_lore` tool so its `execute()` receives the injection values
 * regardless of what the LLM supplied. We also wrap the `inputSchema` with a
 * `z.any().transform(...)` that replaces the LLM-supplied fields with the
 * injection values during schema parse — crucially this means
 * `runAgentLoop`'s `ToolCallTrace.input` reflects the INJECTED values, not
 * the raw LLM input. Downstream guards (`pickExtendLoreCall`, the optional
 * `calledAddr` hallucination check) therefore observe a fully-authoritative
 * trace and keep passing even when the LLM attempted to pass wrong values.
 *
 * Output schema is preserved by reference so the existing
 * `expectExtendLoreOutput` narrowing works unchanged.
 */
function wrapExtendLoreWithInjector(
  original: AnyAgentTool,
  injection: ExtendLoreInjection,
): AnyAgentTool {
  // The transform runs BEFORE execute() in runAgentLoop's flow, so by the
  // time the runtime records `ToolCallTrace.input` the values are already
  // overridden. We chain off the ORIGINAL inputSchema (not `z.any()`) so
  // `ToolRegistry.toAnthropicTools()` — which drills through `ZodEffects`
  // via `unwrapEffects` until it finds the root `ZodObject` — keeps producing
  // the exact same JSON Schema for the LLM. In other words: the LLM sees
  // the normal `extend_lore` shape, but whatever values it fills in are
  // unconditionally replaced with the injection before `execute()` runs.
  //
  // Pre-parse guard: the LLM sometimes returns `tokenAddr` in a format that
  // fails the original schema's `/^0x[a-fA-F0-9]{40}$/` regex (truncated,
  // lower/upper mix, missing prefix). We tolerate that by short-circuiting
  // the parse — call the outer transform against a safe placeholder so the
  // injection values still land. This keeps the wrapper's contract ("runtime
  // always wins over LLM input") intact regardless of LLM behaviour.
  const injectedSchema = z.preprocess((input: unknown) => {
    // Pass through whatever shape the LLM sent so the inner schema has
    // something to chew on; the transform below will overwrite everything
    // anyway. If the LLM sent a non-object (null / string / etc.), fall
    // back to a minimal valid payload assembled from the injection.
    if (typeof input !== 'object' || input === null) {
      return {
        tokenAddr: injection.tokenAddr,
        tokenName: injection.tokenName,
        tokenSymbol: injection.tokenSymbol,
        previousChapters: injection.previousChapters,
        targetChapterNumber: injection.targetChapterNumber,
      };
    }
    // Always stuff the injection into the object BEFORE schema validation
    // so the regex on tokenAddr passes even when the LLM supplied garbage.
    return {
      ...(input as Record<string, unknown>),
      tokenAddr: injection.tokenAddr,
      tokenName: injection.tokenName,
      tokenSymbol: injection.tokenSymbol,
      previousChapters: injection.previousChapters,
      targetChapterNumber: injection.targetChapterNumber,
    };
  }, original.inputSchema) as unknown as AnyAgentTool['inputSchema'];

  return {
    name: original.name,
    description: original.description,
    inputSchema: injectedSchema,
    outputSchema: original.outputSchema,
    async execute(input: unknown): Promise<unknown> {
      // `input` is already transformed (runtime parsed it through
      // `injectedSchema` before calling execute). We still delegate to the
      // original tool so its own validation + side effects (LLM prompt,
      // Pinata upload) run exactly as they would unwrapped.
      return original.execute(input);
    },
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

  // We deliberately omit prior chapter bodies from the prompt — the wrapper
  // alone supplies them to `execute()`, keeping this LLM turn cheap and
  // preventing the "N prior chapters attached" framing that historically
  // made the model hallucinate chapter summaries. The user-facing instruction
  // is a plain call-the-tool directive; we do NOT explain the wrapper because
  // the LLM does not need to know it exists.
  const userInput =
    `Call \`extend_lore\` exactly once for token ${tokenAddr}. ` +
    'The server supplies all canonical chapter metadata; pass your best-effort values and proceed.';

  // Build a per-run sub-registry in which `extend_lore` is replaced by a
  // wrapper that force-overrides the LLM-supplied fields with the authoritative
  // values from this runtime scope. The wrapper exposes the same name /
  // description / schema pair so the model cannot tell it is wrapped; all it
  // sees is the normal tool.
  //
  // Why override rather than trust the LLM: chapter-to-chapter continuity
  // needs `previousChapters` (the actual prose of every prior chapter) to
  // reach `extend_lore`'s execute path. Prior implementations relied on the
  // system prompt telling the LLM to forward those values verbatim, but the
  // runtime never placed the bodies into the LLM's context, so the model had
  // nothing to forward and silently sent `[]` — causing every "continuation"
  // to be generated under the FIRST_CHAPTER_SYSTEM_PROMPT. Wrapping guarantees
  // the correct values land regardless of LLM behaviour.
  const narratorSubRegistry = buildNarratorSubRegistryWithInjector({
    baseRegistry: registry,
    tokenAddr,
    tokenName,
    tokenSymbol,
    previousChapters,
    targetChapterNumber: chapterNumber,
  });

  const loop = await runAgentLoop({
    client,
    model,
    registry: narratorSubRegistry,
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

  // Belt-and-suspenders hallucination guard. With the wrapper injection the
  // trace input's `tokenAddr` is ALREADY the runtime value (the injected
  // schema transform runs before runtime records the trace), so this check
  // should pass unconditionally under normal operation. We keep it because
  // the cost is one comparison and it would immediately surface any future
  // refactor that bypasses the sub-registry or drops the schema transform.
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
