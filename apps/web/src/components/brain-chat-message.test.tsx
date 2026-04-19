/**
 * Red tests for `<BrainChatMessage />` — the per-turn renderer for the
 * BrainChat transcript (BRAIN-P4 Task 2 / AC-BRAIN-5).
 *
 * Uses `renderToStaticMarkup` because the repo runs vitest in node (no
 * jsdom, see vitest.config.ts). We inspect the rendered HTML string for
 * structural markers (data-role attributes, aria-labels, class fragments,
 * known copy strings) rather than simulating DOM events.
 *
 * Five covered cases from the brief:
 *   1. user role — data-role="user" + right-aligned class fragment + content
 *   2. assistant empty content — renders without crashing (empty bubble)
 *   3. assistant with tool-use-start brainEvent (agent=brain) — pill shown
 *      with friendly persona name + "invoking" verb
 *   4. assistant with nested persona-log brainEvent — sub-block visible with
 *      agent name + message (rendered indented)
 *   5. assistant with persona-artifact brainEvent — artifact pill visible
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Artifact } from '@hack-fourmeme/shared';
import { BrainChatMessage } from './brain-chat-message.js';
import type { BrainChatTurn } from '@/hooks/useBrainChat-state';

function userTurn(content: string): BrainChatTurn {
  return { id: 'u1', role: 'user', content };
}

function assistantTurn(
  content: string,
  brainEvents: BrainChatTurn['brainEvents'] = [],
): BrainChatTurn {
  return { id: 'a1', role: 'assistant', content, brainEvents };
}

describe('<BrainChatMessage /> — user role (case 1)', () => {
  it('renders data-role="user" + right-aligned bubble + content text', () => {
    const out = renderToStaticMarkup(<BrainChatMessage turn={userTurn('Launch $NYAN now')} />);
    expect(out).toContain('data-role="user"');
    expect(out).toContain('Launch $NYAN now');
    // Tailwind utility fragment for right-alignment. Both self-end and
    // justify-end survive the message; either signals a user bubble that is
    // anchored on the right. We assert at least one of these fragments is
    // present so future tweaks to the exact utility do not break the test
    // as long as the right-aligned semantics stay.
    expect(out).toMatch(/self-end|justify-end|ml-auto/);
  });
});

describe('<BrainChatMessage /> — assistant empty content (case 2)', () => {
  it('renders an empty-content assistant bubble without crashing', () => {
    // A freshly-seeded assistant turn (content='' brainEvents=[]) is the
    // state the hook lands in between user submit and the first SSE event.
    // The component must render deterministic markup in this state so the
    // "assistant is thinking" pulse can be visible in subsequent updates.
    const out = renderToStaticMarkup(<BrainChatMessage turn={assistantTurn('', [])} />);
    expect(out).toContain('data-role="assistant"');
    // Pending pulse / "thinking" hint shown while content is empty — spec
    // AC-BRAIN-10 describes the typewriter effect; empty content is the
    // pre-stream state so we surface a small affordance.
    expect(out).toMatch(/thinking|…|waiting|pending/i);
  });
});

describe('<BrainChatMessage /> — tool-use-start pill (case 3)', () => {
  it('renders a pill for a brain-level invoke_creator tool use start', () => {
    const out = renderToStaticMarkup(
      <BrainChatMessage
        turn={assistantTurn('', [
          {
            kind: 'tool-use-start',
            agent: 'brain',
            toolName: 'invoke_creator',
            toolUseId: 'tu-1',
            input: { theme: 'BNB 2026' },
          },
        ])}
      />,
    );
    // Friendly pill copy per spec: "🔧 invoking Creator persona..." — we
    // check for the verb + the persona name derived from the tool name.
    expect(out).toMatch(/invoking/i);
    expect(out).toContain('Creator');
  });
});

describe('<BrainChatMessage /> — nested persona-log sub-block (case 4)', () => {
  it('renders a persona-log event with agent name + message in an indented sub-block', () => {
    const out = renderToStaticMarkup(
      <BrainChatMessage
        turn={assistantTurn('', [
          {
            kind: 'persona-log',
            agent: 'creator',
            tool: 'onchain_deployer',
            message: 'submitting deploy tx',
            level: 'info',
          },
        ])}
      />,
    );
    expect(out).toContain('creator');
    expect(out).toContain('submitting deploy tx');
    // The indent is the spec's visual: spec calls for "persona 子區塊縮進 +
    // 不同邊框色". We assert the event is wrapped in a container that carries
    // a left-border class fragment (border-l-… tokens), mirroring
    // timeline-view AGENT_TONE conventions.
    expect(out).toMatch(/border-l-/);
  });
});

describe('<BrainChatMessage /> — persona-artifact (case 5)', () => {
  it('renders a persona-artifact brainEvent (lore-cid) with IPFS label + CID fragment', () => {
    const artifact: Artifact = {
      kind: 'lore-cid',
      cid: 'bafylorechapter',
      gatewayUrl: 'https://gateway.pinata.cloud/ipfs/bafylorechapter',
      author: 'narrator',
      chapterNumber: 2,
    };
    const out = renderToStaticMarkup(
      <BrainChatMessage
        turn={assistantTurn('', [
          {
            kind: 'persona-artifact',
            agent: 'narrator',
            artifact,
          },
        ])}
      />,
    );
    // We reuse `describeArtifact` from `@/lib/artifact-view.ts` for the
    // pill copy, so the "IPFS" chainLabel + short CID fragment should be
    // present in the markup.
    expect(out).toContain('IPFS');
    expect(out).toContain('bafylor'); // cid head slice
  });
});

describe('<BrainChatMessage /> — ordering', () => {
  it('renders multiple brainEvents in the order they arrived', () => {
    // Not one of the five AC cases but a critical invariant: the UI must
    // render events in wire order so "tool_use:start → persona-log →
    // tool_use:end" reads like a narrative.
    const out = renderToStaticMarkup(
      <BrainChatMessage
        turn={assistantTurn('Deploying...', [
          {
            kind: 'tool-use-start',
            agent: 'brain',
            toolName: 'invoke_creator',
            toolUseId: 'tu-1',
            input: {},
          },
          {
            kind: 'persona-log',
            agent: 'creator',
            tool: 'narrative_generator',
            message: 'first stanza drafted',
            level: 'info',
          },
          {
            kind: 'tool-use-end',
            agent: 'brain',
            toolName: 'invoke_creator',
            toolUseId: 'tu-1',
            output: { tokenAddr: '0xabc' },
            isError: false,
          },
        ])}
      />,
    );
    // Assert event1 appears before event2, event2 before event3 in the
    // raw HTML output (strIndexOf preserves document order).
    const idxStart = out.indexOf('Creator');
    const idxLog = out.indexOf('first stanza drafted');
    // The tool-use-end pill surfaces an "ok" or "done" marker per spec;
    // we accept either so minor copy tweaks do not break the test.
    const idxEnd = out.search(/\bok\b|\bdone\b|completed/i);
    expect(idxStart).toBeGreaterThanOrEqual(0);
    expect(idxLog).toBeGreaterThanOrEqual(0);
    expect(idxEnd).toBeGreaterThanOrEqual(0);
    expect(idxStart).toBeLessThan(idxLog);
    expect(idxLog).toBeLessThan(idxEnd);
  });
});
