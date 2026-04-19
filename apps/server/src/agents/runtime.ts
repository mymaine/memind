import type Anthropic from '@anthropic-ai/sdk';
import type {
  ContentBlock,
  ContentBlockParam,
  Message,
  MessageParam,
  RawMessageStreamEvent,
  TextBlock,
  ToolResultBlockParam,
  ToolUseBlock,
} from '@anthropic-ai/sdk/resources/messages/messages.js';
import type { AgentId, LogEvent } from '@hack-fourmeme/shared';
import type { ToolRegistry } from '../tools/registry.js';
import { createStreamEventMapper } from './_stream-map.js';

/**
 * Generic agent loop used by Creator / Narrator / Market-maker. Each call owns
 * its own message history so concurrent agents do not share state.
 *
 * V2-P2: each turn now drives `client.messages.stream` instead of
 * `messages.create`. We forward the three stream-level events the dashboard
 * cares about (`tool_use:start`, `tool_use:end`, `assistant:delta`) through
 * dedicated callbacks while keeping the existing coarse `onLog` summary as a
 * companion layer.
 */
export interface RunAgentLoopParams {
  client: Anthropic;
  model: string;
  registry: ToolRegistry;
  systemPrompt: string;
  /**
   * Single user turn convenience seed. Callers that only run a single-shot
   * agent (Creator / Narrator / Market-maker / Heartbeat) pass the prompt
   * here and the loop seeds `messages` with one `{role: 'user', content}`
   * entry. Multi-turn callers should use `initialMessages` instead (the
   * Brain's conversational surface needs the full `[user, assistant, user]`
   * chain so the LLM sees real conversation history via the Anthropic
   * messages API — not a folded-string pseudo-history).
   *
   * Exactly one of `userInput` / `initialMessages` must be provided. Passing
   * both is a caller bug (the loop throws early so drift surfaces fast).
   */
  userInput?: string;
  /**
   * Multi-turn conversation seed. When present, the loop skips the
   * single-shot `userInput` path and uses this message list as-is for the
   * first Anthropic `messages.stream` call. The final message MUST have
   * `role: 'user'` (the loop appends its own assistant + tool-result turns
   * as the conversation advances).
   *
   * UAT fix (2026-04-20): fixes the "brain forgets prior turns" bug. The
   * previous implementation folded the prior transcript into a single user
   * string (`[user] foo\n[assistant] bar\n[user] baz`), which the model
   * treated as a quoted block rather than authoritative conversation state.
   */
  initialMessages?: ReadonlyArray<MessageParam>;
  /** Hard ceiling on tool_use rounds. Throws when exceeded. Default: 12. */
  maxTurns?: number;
  /** Stream every loop action (turn start, tool invoke, error, final) to caller. */
  onLog?: (event: LogEvent) => void;
  /** Fine-grained event: tool invocation opened (spinner). */
  onToolUseStart?: (event: RuntimeToolUseStart) => void;
  /** Fine-grained event: tool invocation finished (result or error). */
  onToolUseEnd?: (event: RuntimeToolUseEnd) => void;
  /** Fine-grained event: one chunk of assistant free-form text. */
  onAssistantDelta?: (event: RuntimeAssistantDelta) => void;
  /** Agent identity used purely for log / event attribution. */
  agentId?: AgentId;
  /** Max tokens per streamed turn. Default: 2048. */
  maxTokens?: number;
}

export interface RuntimeToolUseStart {
  agent: AgentId;
  toolName: string;
  toolUseId: string;
  input: Record<string, unknown>;
  ts: string;
}

export interface RuntimeToolUseEnd {
  agent: AgentId;
  toolName: string;
  toolUseId: string;
  output: Record<string, unknown>;
  isError: boolean;
  ts: string;
}

export interface RuntimeAssistantDelta {
  agent: AgentId;
  delta: string;
  ts: string;
}

export interface ToolCallTrace {
  name: string;
  input: unknown;
  output: unknown;
  isError: boolean;
}

export interface AgentLoopResult {
  finalText: string;
  toolCalls: ToolCallTrace[];
  trace: LogEvent[];
  stopReason: Message['stop_reason'];
}

const DEFAULT_MAX_TURNS = 12;
const DEFAULT_MAX_TOKENS = 2048;

/**
 * Minimal surface of `MessageStream` we consume. Declared locally so fakes in
 * unit tests can stand in for the concrete SDK class without pulling its full
 * EventEmitter shape.
 */
interface StreamHandle extends AsyncIterable<RawMessageStreamEvent> {
  finalMessage(): Promise<Message>;
}

/**
 * Run an agent loop until the model emits `stop_reason: 'end_turn'` or we hit
 * `maxTurns`. Tool errors are fed back to the model via `is_error: true` so it
 * can recover; only unrecoverable problems (model-side errors, max turns,
 * missing tool registration) throw.
 */
export async function runAgentLoop(params: RunAgentLoopParams): Promise<AgentLoopResult> {
  const {
    client,
    model,
    registry,
    systemPrompt,
    userInput,
    initialMessages,
    maxTurns = DEFAULT_MAX_TURNS,
    onLog,
    onToolUseStart,
    onToolUseEnd,
    onAssistantDelta,
    agentId = 'creator',
    maxTokens = DEFAULT_MAX_TOKENS,
  } = params;

  // Input-shape contract: exactly one of the two seeding paths must be set.
  // Passing neither (or both) is a caller bug that would otherwise manifest
  // as an empty / duplicated prompt only after the first Anthropic call.
  if (userInput === undefined && (initialMessages === undefined || initialMessages.length === 0)) {
    throw new Error('runAgentLoop: supply either `userInput` or a non-empty `initialMessages`');
  }
  if (userInput !== undefined && initialMessages !== undefined && initialMessages.length > 0) {
    throw new Error('runAgentLoop: pass `userInput` OR `initialMessages`, not both');
  }
  if (initialMessages !== undefined && initialMessages.length > 0) {
    const last = initialMessages[initialMessages.length - 1];
    if (!last || last.role !== 'user') {
      throw new Error('runAgentLoop: the final entry in `initialMessages` must have role="user"');
    }
  }

  const trace: LogEvent[] = [];
  const toolCalls: ToolCallTrace[] = [];

  const emit = (event: Omit<LogEvent, 'ts' | 'agent'>): void => {
    const full: LogEvent = {
      ts: new Date().toISOString(),
      agent: agentId,
      ...event,
    };
    trace.push(full);
    if (onLog) onLog(full);
  };

  // Seed the mutable messages array with either the single-shot user prompt
  // (legacy single-agent callers) or the full multi-turn chain (Brain meta-
  // agent). `initialMessages` is copied so the caller's array is never
  // mutated when the loop appends assistant / tool_result turns.
  const messages: MessageParam[] =
    initialMessages !== undefined && initialMessages.length > 0
      ? [...initialMessages]
      : [{ role: 'user', content: userInput as string }];
  const anthropicTools = registry.toAnthropicTools();

  emit({
    tool: 'runtime',
    level: 'info',
    message: `loop start (model=${model}, tools=${anthropicTools.length}, maxTurns=${maxTurns})`,
    meta: userInput !== undefined ? { userInput } : { seedTurns: messages.length },
  });

  for (let turn = 0; turn < maxTurns; turn++) {
    emit({
      tool: 'runtime',
      level: 'debug',
      message: `turn ${turn + 1} requesting completion`,
    });

    // Streaming call — `messages.stream` returns a `MessageStream`. We consume
    // chunks via `for await` for fine-grained events and then await
    // `finalMessage()` for the authoritative tool_use blocks + stop_reason.
    const stream = client.messages.stream({
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      tools: anthropicTools,
      messages,
    }) as unknown as StreamHandle;

    const mapper = createStreamEventMapper();
    const pendingToolStarts: RuntimeToolUseStart[] = [];

    try {
      for await (const chunk of stream) {
        mapper(chunk, (mapped) => {
          if (mapped.type === 'assistant:delta') {
            if (onAssistantDelta) {
              onAssistantDelta({
                agent: agentId,
                delta: mapped.delta,
                ts: new Date().toISOString(),
              });
            }
            return;
          }
          // tool_use:start — buffer and fire the callback right away so the
          // UI can render a spinner the moment the tool block closes.
          const startEvent: RuntimeToolUseStart = {
            agent: agentId,
            toolName: mapped.toolName,
            toolUseId: mapped.toolUseId,
            input: mapped.input,
            ts: new Date().toISOString(),
          };
          pendingToolStarts.push(startEvent);
          if (onToolUseStart) onToolUseStart(startEvent);
        });
      }
    } catch (err) {
      // Network / upstream stream failure — we cannot recover mid-turn.
      const message = err instanceof Error ? err.message : String(err);
      emit({
        tool: 'runtime',
        level: 'error',
        message: `stream failed: ${message}`,
      });
      throw err;
    }

    const response = await stream.finalMessage();

    emit({
      tool: 'runtime',
      level: 'debug',
      message: `turn ${turn + 1} stop_reason=${response.stop_reason ?? 'null'}`,
      meta: { stopReason: response.stop_reason },
    });

    // Append assistant turn to history so subsequent tool_result references resolve.
    messages.push({ role: 'assistant', content: response.content });

    if (response.stop_reason !== 'tool_use') {
      const finalText = collectText(response.content);
      emit({
        tool: 'runtime',
        level: 'info',
        message: `loop end stop_reason=${response.stop_reason ?? 'null'}`,
      });
      return {
        finalText,
        toolCalls,
        trace,
        stopReason: response.stop_reason,
      };
    }

    // Execute every tool_use block in parallel and splice results back.
    const toolUses = response.content.filter(isToolUseBlock);
    const toolResults = await Promise.all(
      toolUses.map((block) =>
        executeToolBlock(block, registry, emit, toolCalls, agentId, onToolUseEnd),
      ),
    );

    const toolResultContent: ContentBlockParam[] = toolResults;
    messages.push({ role: 'user', content: toolResultContent });

    // `pendingToolStarts` is intentionally not cross-checked against
    // `toolUses`: Anthropic's `finalMessage()` is the authoritative source
    // for the execute loop; our start events are a dashboard affordance.
    void pendingToolStarts;
  }

  emit({
    tool: 'runtime',
    level: 'error',
    message: `loop exceeded maxTurns=${maxTurns}`,
  });
  throw new Error(`runAgentLoop: exceeded maxTurns=${maxTurns}`);
}

async function executeToolBlock(
  block: ToolUseBlock,
  registry: ToolRegistry,
  emit: (event: Omit<LogEvent, 'ts' | 'agent'>) => void,
  toolCalls: ToolCallTrace[],
  agentId: AgentId,
  onToolUseEnd: ((event: RuntimeToolUseEnd) => void) | undefined,
): Promise<ToolResultBlockParam> {
  const toolName = block.name;
  emit({
    tool: toolName,
    level: 'info',
    message: `invoke tool ${toolName}`,
    meta: { toolUseId: block.id, input: block.input },
  });

  try {
    const tool = registry.get(toolName);
    const parsedInput = tool.inputSchema.parse(block.input);
    const output = await tool.execute(parsedInput);
    // Validate output as well — surfaces contract violations early.
    const parsedOutput = tool.outputSchema.parse(output);

    toolCalls.push({
      name: toolName,
      input: parsedInput,
      output: parsedOutput,
      isError: false,
    });
    emit({
      tool: toolName,
      level: 'info',
      message: `tool ${toolName} ok`,
      meta: { toolUseId: block.id },
    });
    if (onToolUseEnd) {
      onToolUseEnd({
        agent: agentId,
        toolName,
        toolUseId: block.id,
        // `parsedOutput` is `unknown` from the tool registry's perspective.
        // We coerce to a record for the SSE payload shape; non-object outputs
        // are wrapped so the wire contract stays uniform.
        output: toOutputRecord(parsedOutput),
        isError: false,
        ts: new Date().toISOString(),
      });
    }
    return {
      type: 'tool_result',
      tool_use_id: block.id,
      content: JSON.stringify(parsedOutput),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    toolCalls.push({
      name: toolName,
      input: block.input,
      output: { error: message },
      isError: true,
    });
    emit({
      tool: toolName,
      level: 'error',
      message: `tool ${toolName} failed: ${message}`,
      meta: { toolUseId: block.id },
    });
    if (onToolUseEnd) {
      onToolUseEnd({
        agent: agentId,
        toolName,
        toolUseId: block.id,
        output: { error: message },
        isError: true,
        ts: new Date().toISOString(),
      });
    }
    return {
      type: 'tool_result',
      tool_use_id: block.id,
      content: JSON.stringify({ error: message }),
      is_error: true,
    };
  }
}

function toOutputRecord(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) return {};
  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return { value };
}

function isToolUseBlock(block: ContentBlock): block is ToolUseBlock {
  return block.type === 'tool_use';
}

function isTextBlock(block: ContentBlock): block is TextBlock {
  return block.type === 'text';
}

function collectText(content: ContentBlock[]): string {
  return content
    .filter(isTextBlock)
    .map((block) => block.text)
    .join('\n')
    .trim();
}
