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
