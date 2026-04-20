/**
 * Red tests for `<BrainChat />` (BRAIN-P4 Task 3).
 *
 * Same renderToStaticMarkup pattern as launch-panel.test.tsx — the component
 * exposes an optional `controller` prop (typed as `UseBrainChatResult`) so
 * tests drive it without spinning up React runtime / fetch / EventSource.
 *
 * Three covered cases from the brief:
 *   1. renders the list of turns — user + assistant bubbles both appear
 *   2. input + send button mark-up is present and bound to controller.send
 *      (asserts on a <form> element + <textarea> name + the button copy)
 *   3. error state renders a banner carrying the error message
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { UseBrainChatResult } from '@/hooks/useBrainChat';
import type { BrainChatStatus, BrainChatTurn } from '@/hooks/useBrainChat-state';
import { BrainChat } from './brain-chat.js';

function noopAsync(): Promise<void> {
  return Promise.resolve();
}
function noop(): void {
  /* no-op */
}

function makeController(overrides: {
  turns?: readonly BrainChatTurn[];
  status?: BrainChatStatus;
  errorMessage?: string | null;
}): UseBrainChatResult {
  return {
    turns: overrides.turns ?? [],
    status: overrides.status ?? 'idle',
    errorMessage: overrides.errorMessage ?? null,
    send: noopAsync,
    reset: noop,
    appendLocalAssistant: noop,
    appendTurn: noop,
  };
}

describe('<BrainChat /> — turns render (case 1)', () => {
  it('renders a user turn + assistant turn in transcript order', () => {
    const out = renderToStaticMarkup(
      <BrainChat
        scope="launch"
        controller={makeController({
          turns: [
            { id: 'u1', role: 'user', content: 'Launch a meme about BNB' },
            { id: 'a1', role: 'assistant', content: 'Deploying now…', brainEvents: [] },
          ],
        })}
      />,
    );
    expect(out).toContain('Launch a meme about BNB');
    expect(out).toContain('Deploying now…');
    expect(out).toContain('data-role="user"');
    expect(out).toContain('data-role="assistant"');
  });
});

describe('<BrainChat /> — input + send button (case 2)', () => {
  it('renders a <form> with a textarea + send button when idle', () => {
    const out = renderToStaticMarkup(
      <BrainChat scope="launch" controller={makeController({ status: 'idle' })} />,
    );
    // The form must be a real <form> so pressing Enter inside the textarea
    // submits via the browser's native submit event.
    expect(out).toMatch(/<form\b/);
    expect(out).toMatch(/<textarea\b/);
    // Send CTA copy kept short and uppercase; we accept several synonyms.
    expect(out).toMatch(/send|ask|submit/i);
  });

  it('disables the textarea + send button while the hook is streaming', () => {
    const out = renderToStaticMarkup(
      <BrainChat
        scope="launch"
        controller={makeController({
          status: 'streaming',
          turns: [{ id: 'u1', role: 'user', content: 'Launch a meme' }],
        })}
      />,
    );
    // Both the textarea and the button must surface the disabled attribute
    // so the user cannot fire a concurrent run while SSE is still open.
    expect(out).toMatch(/<textarea\b[^>]*disabled/);
    expect(out).toMatch(/<button\b[^>]*disabled[^>]*>/);
  });

  it('empty transcript + idle status surfaces the suggestion chips', () => {
    // AC-BRAIN-9: when turns.length === 0 the space above the input row
    // shows the suggestion chips for the current scope.
    const out = renderToStaticMarkup(
      <BrainChat scope="order" controller={makeController({ turns: [] })} />,
    );
    // Chip copy derives from chipsForScope('order'); at least one identifying
    // fragment must survive into the final markup.
    expect(out).toMatch(/shill|order|pitch/i);
  });
});

describe('<BrainChat /> — error banner (case 3)', () => {
  it('renders an error banner containing the errorMessage text', () => {
    const out = renderToStaticMarkup(
      <BrainChat
        scope="launch"
        controller={makeController({
          status: 'error',
          errorMessage: 'brain-chat orchestrator blew up',
        })}
      />,
    );
    expect(out).toContain('brain-chat orchestrator blew up');
    // Banner role so assistive tech announces the error.
    expect(out).toMatch(/role="alert"|role="status"/);
  });
});

describe('<BrainChat /> — no controller (SSR fallback)', () => {
  it('falls back to useBrainChat() and renders idle markup without crashing', () => {
    // The component is a client island; useBrainChat's initial state is
    // EMPTY_BRAIN_CHAT_STATE, so the idle markup should render on the
    // server-side transform. Asserts on the presence of the form (which
    // appears unconditionally in the idle path).
    const out = renderToStaticMarkup(<BrainChat scope="global" />);
    expect(out).toMatch(/<form\b/);
    expect(out).toMatch(/<textarea\b/);
  });
});

describe('<BrainChat /> — initialDraft seed (AC-MSR-7)', () => {
  it('pre-fills the composer textarea with the provided initialDraft', () => {
    // BrainPanel injects `initialDraft="/launch "` when the Hero CTA opens
    // the panel; the textarea value must surface that text so the user
    // lands on the slash palette's `/launch` candidate row.
    const out = renderToStaticMarkup(
      <BrainChat
        scope="global"
        controller={makeController({ turns: [] })}
        initialDraft="/launch "
      />,
    );
    expect(out).toMatch(/<textarea\b[^>]*name="brain-chat-draft"[^>]*>\/launch\s*</);
  });

  it('omitting initialDraft keeps the textarea empty', () => {
    const out = renderToStaticMarkup(
      <BrainChat scope="global" controller={makeController({ turns: [] })} />,
    );
    expect(out).toMatch(/<textarea\b[^>]*name="brain-chat-draft"[^>]*><\/textarea>/);
  });
});

describe('<BrainChat /> — UAT fix #3 (auto-scroll transcript)', () => {
  it('marks the transcript scroll container with a stable testid', () => {
    // The transcript container receives a `ref` + effect that scrolls to
    // bottom on every event. We expose a testid so e2e / future unit tests
    // can target it without relying on class fragments.
    const out = renderToStaticMarkup(
      <BrainChat
        scope="launch"
        controller={makeController({
          turns: [{ id: 'a1', role: 'assistant', content: 'hi', brainEvents: [] }],
        })}
      />,
    );
    expect(out).toMatch(/data-testid="brain-chat-transcript"/);
    // Overflow-y-auto is what gives the element room to scroll; a future
    // refactor that drops the scroll container would silently regress the
    // UAT fix, so we pin the style token.
    expect(out).toMatch(/overflow-y-auto/);
  });
});

describe('<BrainChat /> — slash hint (BRAIN-P6 AC-BRAIN-15)', () => {
  it('shows "Type / for commands" hint under suggestions when transcript empty', () => {
    // The hint lives underneath the suggestion chips in the empty-state
    // block. We assert the literal copy surfaces so the user knows the
    // shortcut is available.
    const out = renderToStaticMarkup(
      <BrainChat scope="launch" controller={makeController({ turns: [] })} />,
    );
    expect(out).toMatch(/type\s*\/\s*for commands/i);
  });
});

describe('<BrainChat /> — heartbeat tick bubble integration', () => {
  it('renders heartbeat turns inline with assistant turns in wire order', () => {
    // Simulates the state after `/heartbeat <addr> <ms> <n>` landed a
    // background-started session and one tick event fired. The assistant
    // turn is the Brain's initial ack; the heartbeat turn is the first
    // tick summary that landed via the SSE stream.
    const out = renderToStaticMarkup(
      <BrainChat
        scope="global"
        controller={makeController({
          turns: [
            { id: 'u1', role: 'user', content: '/heartbeat 0xabc 30000 3' },
            {
              id: 'a1',
              role: 'assistant',
              content: 'Heartbeat loop started.',
              brainEvents: [
                {
                  kind: 'tool-use-start',
                  agent: 'brain',
                  toolName: 'invoke_heartbeat_tick',
                  toolUseId: 'tu-hb-1',
                  input: {
                    tokenAddr: '0xabcdef1234567890abcdef1234567890abcd4444',
                    intervalMs: 30_000,
                    maxTicks: 3,
                  },
                },
                {
                  kind: 'tool-use-end',
                  agent: 'brain',
                  toolName: 'invoke_heartbeat_tick',
                  toolUseId: 'tu-hb-1',
                  output: {
                    tokenAddr: '0xabcdef1234567890abcdef1234567890abcd4444',
                    mode: 'background-started',
                    running: true,
                    intervalMs: 30_000,
                    maxTicks: 3,
                    tickCount: 0,
                    successCount: 0,
                    errorCount: 0,
                    skippedCount: 0,
                  },
                  isError: false,
                },
              ],
            },
            {
              id: 'hb-1',
              role: 'heartbeat',
              content: 'Heartbeat tick 1/3: idle',
              heartbeat: {
                tokenAddr: '0xabcdef1234567890abcdef1234567890abcd4444',
                tickId: 'tick-1',
                tickNumber: 1,
                maxTicks: 3,
                success: true,
                action: 'idle',
                tickAt: '2026-04-20T00:01:00.000Z',
                running: true,
              },
            },
          ],
        })}
      />,
    );
    expect(out).toContain('data-role="user"');
    expect(out).toContain('data-role="assistant"');
    expect(out).toContain('data-role="heartbeat"');
    // Ordering: user < assistant < heartbeat.
    const idxUser = out.indexOf('data-role="user"');
    const idxAssistant = out.indexOf('data-role="assistant"');
    const idxHeartbeat = out.indexOf('data-role="heartbeat"');
    expect(idxUser).toBeGreaterThanOrEqual(0);
    expect(idxAssistant).toBeGreaterThan(idxUser);
    expect(idxHeartbeat).toBeGreaterThan(idxAssistant);
    // Tick chip text.
    expect(out).toMatch(/tick 1\/3/);
  });
});
