import type Anthropic from '@anthropic-ai/sdk';
import type {
  ContentBlock,
  ContentBlockParam,
  Message,
  MessageParam,
  TextBlock,
  ToolResultBlockParam,
  ToolUseBlock,
} from '@anthropic-ai/sdk/resources/messages/messages.js';
import type { AgentId, LogEvent } from '@hack-fourmeme/shared';
import type { ToolRegistry } from '../tools/registry.js';

/**
 * Generic agent loop used by Creator / Narrator / Market-maker. Each call owns
 * its own message history so concurrent agents do not share state.
 */
export interface RunAgentLoopParams {
  client: Anthropic;
  model: string;
  registry: ToolRegistry;
  systemPrompt: string;
  userInput: string;
  /** Hard ceiling on tool_use rounds. Throws when exceeded. Default: 12. */
  maxTurns?: number;
  /** Stream every loop action (turn start, tool invoke, error, final) to caller. */
  onLog?: (event: LogEvent) => void;
  /** Agent identity used purely for log attribution. */
  agentId?: AgentId;
  /** Max tokens per `messages.create` turn. Default: 2048. */
  maxTokens?: number;
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
    maxTurns = DEFAULT_MAX_TURNS,
    onLog,
    agentId = 'creator',
    maxTokens = DEFAULT_MAX_TOKENS,
  } = params;

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

  const messages: MessageParam[] = [{ role: 'user', content: userInput }];
  const anthropicTools = registry.toAnthropicTools();

  emit({
    tool: 'runtime',
    level: 'info',
    message: `loop start (model=${model}, tools=${anthropicTools.length}, maxTurns=${maxTurns})`,
    meta: { userInput },
  });

  for (let turn = 0; turn < maxTurns; turn++) {
    emit({
      tool: 'runtime',
      level: 'debug',
      message: `turn ${turn + 1} requesting completion`,
    });

    const response: Message = await client.messages.create({
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      tools: anthropicTools,
      messages,
    });

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
      toolUses.map((block) => executeToolBlock(block, registry, emit, toolCalls)),
    );

    const toolResultContent: ContentBlockParam[] = toolResults;
    messages.push({ role: 'user', content: toolResultContent });
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
    return {
      type: 'tool_result',
      tool_use_id: block.id,
      content: JSON.stringify({ error: message }),
      is_error: true,
    };
  }
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
