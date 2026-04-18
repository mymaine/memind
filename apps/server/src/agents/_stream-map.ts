/**
 * Pure mapping from Anthropic `RawMessageStreamEvent` chunks to the three
 * runtime-level events the dashboard cares about:
 *
 *   - tool_use:start   — when the model opens a `tool_use` content block;
 *                        emitted once the block closes so the buffered JSON
 *                        deltas can be parsed into a real object.
 *   - assistant:delta  — each `text_delta` from a text block, forwarded live.
 *   - (tool_use:end is NOT produced here — it fires *after* the server runs
 *      the actual tool, which happens outside this mapper.)
 *
 * Design notes:
 *   - We map per-block-index because the SDK interleaves deltas for multiple
 *     open blocks. The mapper keeps an internal `Map<index, BlockState>`.
 *   - `input_json_delta` chunks accumulate into a string we only parse on
 *     `content_block_stop`. That matches the official docs (partials are not
 *     guaranteed to be valid JSON mid-stream) and sidesteps OpenRouter quirks
 *     where whitespace-only deltas sometimes arrive.
 *   - Parse failure is non-fatal: we emit a `{ _raw: '<acc>' }` placeholder so
 *     the UI can still render a spinner + tool name chip. The runtime will
 *     use the canonical ToolUseBlock from `finalMessage()` for the actual
 *     tool invocation, so this escape hatch never leaks into execution.
 *   - We intentionally ignore `message_start` / `message_delta` /
 *     `message_stop`: the runtime drives assistant message history from the
 *     final `Message`, not from per-chunk envelopes.
 */
import type { RawMessageStreamEvent } from '@anthropic-ai/sdk/resources/messages/messages.js';

export type StreamMappedEvent =
  | {
      type: 'tool_use:start';
      toolUseId: string;
      toolName: string;
      input: Record<string, unknown>;
    }
  | {
      type: 'assistant:delta';
      delta: string;
    };

interface ToolUseBlockState {
  kind: 'tool_use';
  id: string;
  name: string;
  jsonBuffer: string;
}

interface TextBlockState {
  kind: 'text';
}

type BlockState = ToolUseBlockState | TextBlockState;

export type StreamEventMapper = (
  chunk: RawMessageStreamEvent,
  emit: (ev: StreamMappedEvent) => void,
) => void;

export function createStreamEventMapper(): StreamEventMapper {
  const blocks = new Map<number, BlockState>();

  return (chunk, emit) => {
    switch (chunk.type) {
      case 'content_block_start': {
        const block = chunk.content_block;
        if (block.type === 'tool_use') {
          blocks.set(chunk.index, {
            kind: 'tool_use',
            id: block.id,
            name: block.name,
            jsonBuffer: '',
          });
        } else if (block.type === 'text') {
          blocks.set(chunk.index, { kind: 'text' });
        }
        // Other block kinds (thinking, redacted_thinking, ...) are ignored —
        // the runtime does not surface them to the dashboard today.
        return;
      }

      case 'content_block_delta': {
        const state = blocks.get(chunk.index);
        if (!state) return;
        if (chunk.delta.type === 'text_delta' && state.kind === 'text') {
          const delta = chunk.delta.text;
          if (delta.length > 0) emit({ type: 'assistant:delta', delta });
          return;
        }
        if (chunk.delta.type === 'input_json_delta' && state.kind === 'tool_use') {
          state.jsonBuffer += chunk.delta.partial_json;
          return;
        }
        return;
      }

      case 'content_block_stop': {
        const state = blocks.get(chunk.index);
        if (!state) return;
        blocks.delete(chunk.index);
        if (state.kind !== 'tool_use') return;

        let input: Record<string, unknown>;
        if (state.jsonBuffer === '') {
          // No deltas arrived — the model chose to invoke the tool with an
          // empty object. Anthropic surfaces this as `input: {}` in the
          // final Message, so we mirror it here.
          input = {};
        } else {
          try {
            const parsed: unknown = JSON.parse(state.jsonBuffer);
            if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
              input = parsed as Record<string, unknown>;
            } else {
              input = { _raw: state.jsonBuffer };
            }
          } catch {
            // Lossy fallback — see file-level docstring.
            input = { _raw: state.jsonBuffer };
          }
        }

        emit({
          type: 'tool_use:start',
          toolUseId: state.id,
          toolName: state.name,
          input,
        });
        return;
      }

      default:
        // message_start / message_delta / message_stop intentionally ignored.
        return;
    }
  };
}
