import type { z } from 'zod';
import type { AnyAgentTool } from './tool.js';

/**
 * `Persona<TInput, TOutput>` is the explicit "persona" contract for the Brain
 * positioning locked in `docs/decisions/2026-04-19-brain-agent-positioning.md`.
 *
 * It intentionally mirrors the shape of `AgentTool<TInput, TOutput>` (see
 * `./tool.ts`): a narrow identity, a human-readable description, paired zod
 * schemas, and a single async entry-point. What `AgentTool` is to a single
 * tool invocation, `Persona` is to an entire agent run.
 *
 * Scope notes:
 *
 *  (a) This interface makes the "pluggable persona" claim TRUE in code. It is
 *      not a rewrite of the existing `runXxxAgent(...)` functions — each
 *      `apps/server/src/agents/*.ts` file ships a thin adapter constant
 *      (`creatorPersona`, `narratorPersona`, etc.) whose `run(...)` method
 *      forwards to the runner without changing it.
 *
 *  (b) The `agents/` directory is NOT renamed. The decision doc forbids it:
 *      the pitch surface (UI / README / narrative-copy / demo script) uses
 *      *persona* vocabulary while the code keeps *agent* for continuity.
 *
 *  (c) New SKUs (Launch Boost / Community Ops / Alpha Feed) ship as new
 *      `Persona` entries plugged into the same runtime — not as new
 *      products. That is why `PersonaId` is a narrow union: adding a new
 *      persona requires an explicit identity extension plus an adapter.
 *
 * This interface carries zero runtime dependencies beyond `zod` (already
 * present in `@hack-fourmeme/shared`).
 */

export type PersonaId = 'creator' | 'narrator' | 'market-maker' | 'shiller' | 'heartbeat';

/**
 * Shared runtime dependencies passed to every persona's `run(...)` call.
 *
 * The shape is kept tight on purpose: every existing agent runner needs at
 * least the Anthropic client and the tool registry, so both are required.
 * Persona-specific extras (e.g. the Narrator's `LoreStore`) live on the
 * persona's own `TInput` payload so the context remains uniform.
 *
 * `client` and `registry` are typed as `unknown` here to avoid pulling
 * Anthropic SDK and server-side registry types into `@hack-fourmeme/shared`.
 * Adapters in `apps/server/src/agents/*.ts` widen the type at the call site
 * with a local cast, which is where the concrete types already live.
 */
export interface PersonaRunContext {
  /** Anthropic client (`@anthropic-ai/sdk`). Typed as unknown to avoid SDK import. */
  client: unknown;
  /** Tool registry. Typed as unknown to avoid a server-side import here. */
  registry: unknown;
  /**
   * Open slot for persona-specific runtime dependencies that do not belong on
   * the per-call `TInput` payload (e.g. the Narrator's `LoreStore`, which is
   * process-wide and not parameterised per run). Adapters narrow the type at
   * the call site. Keeping this escape hatch explicit avoids forcing every
   * adapter to put process-wide singletons on its input schema.
   */
  [extra: string]: unknown;
}

export interface Persona<TInput, TOutput> {
  id: PersonaId;
  description: string;
  inputSchema: z.ZodType<TInput>;
  outputSchema: z.ZodType<TOutput>;
  run(input: TInput, ctx: PersonaRunContext): Promise<TOutput>;
}

/**
 * Helper type for collections / registries that hold personas of mixed
 * `TInput` / `TOutput`. Mirrors `AnyAgentTool` from `./tool.ts`.
 */
export type AnyPersona = Persona<unknown, unknown>;

// `AnyAgentTool` is re-exported intentionally so callers that handle both
// layers (tool registry + persona registry) can import both shapes from the
// same module path and keep the mirroring explicit in downstream imports.
export type { AnyAgentTool };
