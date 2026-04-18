---
summary: '2026-04-18 decision — the Creator/Narrator/Market-maker agent runtime uses the Anthropic SDK native tool-use path and a self-built minimal tool registry, instead of forking an external agent runtime'
read_when:
  - Before building the Phase 2 agent runtime
  - When later considering a third-party agent framework
  - When revisiting why apps/server/src/agents/ has no external runtime dependency
status: locked
---

# Anthropic SDK Native Tool Use (skip the external runtime fork)

**Decision date**: 2026-04-18
**Phase**: 1 Day 1 (before probe dispatch)
**Direction lock reference**: (internal roadmap, not public) originally planned Day 1 Task 1 as forking an external dynamic sub-agent + tool registry.

## Why we gave up on forking

1. **The candidate upstream framework was not a drop-in module**: on inspection it turned out to be a general-purpose monorepo rather than a dedicated agent toolkit, so reuse would require cherry-picking agent-specific code with unclear scope.
2. **Cross-repo dependency risk**: a hackathon submission must be self-contained, and copying upstream code drags in unaudited dependencies and can break the quality toolchain.
3. **Anthropic SDK native capability is sufficient**: `messages.create` natively supports the `tools` parameter plus the `tool_use` / `tool_result` content block loop; the plan/execute logic for Creator/Narrator/Market-maker fits clearly in ~50 lines.
4. **A self-built tool interface already lives at `packages/shared/src/tool.ts`**: the generic `AgentTool<TInput, TOutput>` interface, combined with zod schemas for runtime validation, is enough.
5. **Hackathon time value**: forking and debugging cross-repo dependencies is ~2–3h; writing the runtime from scratch is ~1–1.5h and fully under control.

## Decision

- The agent runtime calls `@anthropic-ai/sdk` `messages.create` directly and loops on `while (stop_reason !== 'end_turn')` to process `tool_use` content blocks.
- The tool registry is a `Map<string, AgentTool<any, any>>`; each tool is exported from its own file under `apps/server/src/tools/`.
- Do not introduce Eliza / ai16z / LangChain / Mastra or any other third-party agent framework.
- If post-demo work requires more complex agent orchestration (sub-agents, tree planning), re-evaluate then.

## Alternatives considered and rejected

1. **Fork the upstream framework candidate**
   - Rejected: scope, dependency, and time risks per #1–3 above.
2. **ElizaOS / ai16z**
   - Rejected: heavy plugin architecture, new learning curve — net negative under hackathon time pressure.
3. **Mastra / LangGraph**
   - Rejected: similar learning cost; Mastra has been shipping frequent breaking changes.

## Risks accepted

- No dynamic sub-agent dispatch: Creator/Narrator/Market-maker are three standalone agent instances and do not spawn each other. The demo requires "three agents trading" rather than "an agent spawning sub-agents", so this is fine.
- No built-in memory or context compression: a demo run completes in a few minutes; the context window is sufficient.
- If we later switch to a framework, every tool already conforms to `AgentTool<TInput, TOutput>` and does not need rewriting.

## Follow-up actions

- Phase 2 Task 1: implement the `apps/server/src/agents/creator.ts` runtime (`runAgent(tools, systemPrompt, userInput) → { finalAnswer, trace, toolCalls[] }`).
- Phase 2 Tasks 2–5: implement each tool against the `AgentTool` interface, placed under `apps/server/src/tools/`.
- Phase 3 Tasks 1–2: Narrator / Market-maker reuse the same runtime, swapping the tool set and system prompt.
