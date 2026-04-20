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

describe('<BrainChatMessage /> — UAT fixes', () => {
  it('renders final assistant content BELOW the nested events (content-last)', () => {
    // Fix #3: the final markdown answer is the last thing the reader sees in
    // the bubble. Events come first, then the Brain-authored reply.
    const out = renderToStaticMarkup(
      <BrainChatMessage
        turn={assistantTurn('Token deployed at 0xabc.', [
          {
            kind: 'tool-use-start',
            agent: 'brain',
            toolName: 'invoke_creator',
            toolUseId: 'tu-1',
            input: {},
          },
          {
            kind: 'tool-use-end',
            agent: 'brain',
            toolName: 'invoke_creator',
            toolUseId: 'tu-1',
            output: {},
            isError: false,
          },
        ])}
      />,
    );
    const idxTool = out.indexOf('Creator');
    const idxAnswer = out.indexOf('Token deployed at 0xabc');
    expect(idxTool).toBeGreaterThanOrEqual(0);
    expect(idxAnswer).toBeGreaterThanOrEqual(0);
    expect(idxTool).toBeLessThan(idxAnswer);
  });

  it('renders **bold** markdown as <strong> via react-markdown', () => {
    // Fix #4: raw `**HBNB2026-CHAIN**` used to surface literally. With the
    // react-markdown mount the bold marker becomes a real <strong> tag.
    const out = renderToStaticMarkup(
      <BrainChatMessage turn={assistantTurn('**HBNB2026-CHAIN** is live.', [])} />,
    );
    expect(out).toContain('<strong>HBNB2026-CHAIN</strong>');
    expect(out).not.toContain('**HBNB2026-CHAIN**');
  });

  it('renders markdown list items as <li> entries', () => {
    const out = renderToStaticMarkup(
      <BrainChatMessage turn={assistantTurn('- chain: BSC\n- token: HBNB2026', [])} />,
    );
    expect(out).toContain('<li>chain: BSC</li>');
    expect(out).toContain('<li>token: HBNB2026</li>');
  });

  it('compresses consecutive brain thinking deltas into a single bubble', () => {
    // Fix #1: 15 delta events must not spawn 15 "thinking" blocks.
    const out = renderToStaticMarkup(
      <BrainChatMessage
        turn={assistantTurn('', [
          { kind: 'assistant-delta', agent: 'creator', delta: 'ana' },
          { kind: 'assistant-delta', agent: 'creator', delta: 'lysing ' },
          { kind: 'assistant-delta', agent: 'creator', delta: 'theme' },
        ])}
      />,
    );
    // The merged label is the concatenated delta text.
    expect(out).toContain('analysing theme');
    // Only one "creator · thinking" heading — count occurrences.
    const heading = 'creator · thinking';
    const occurrences = out.split(heading).length - 1;
    expect(occurrences).toBe(1);
  });

  it('hides info/debug runtime-noise logs from the transcript entirely (UX fix 2026-04-21)', () => {
    // Runtime noise used to render as a closed <details> toggle, which still
    // left a visible summary row for every SDK loop emission. The new rule is
    // stricter: info/debug-level runtime chatter is filtered upstream by
    // `groupBrainChatEvents` so the transcript stays focused on real work.
    // The left-side LogsDrawer still streams raw SSE for debugging.
    const out = renderToStaticMarkup(
      <BrainChatMessage
        turn={assistantTurn('done.', [
          {
            kind: 'persona-log',
            agent: 'brain',
            tool: 'runtime',
            message: 'loop start',
            level: 'info',
          },
          {
            kind: 'persona-log',
            agent: 'creator',
            tool: 'runtime',
            message: 'turn 1 stop_reason=tool_use',
            level: 'info',
          },
        ])}
      />,
    );
    // Nothing from the runtime chatter survives in the rendered bubble.
    expect(out).not.toMatch(/<details\b/);
    expect(out).not.toMatch(/runtime log/i);
    expect(out).not.toContain('stop_reason');
    expect(out).not.toContain('loop start');
  });

  it('keeps warn/error runtime logs so real failures remain visible', () => {
    // Level-based escape hatch: a warn/error log from the runtime tool (e.g.
    // `stream failed: …`, `loop exceeded maxTurns`) must render so the user
    // can see why a run stalled.
    const out = renderToStaticMarkup(
      <BrainChatMessage
        turn={assistantTurn('', [
          {
            kind: 'persona-log',
            agent: 'brain',
            tool: 'runtime',
            message: 'stream failed: upstream timeout',
            level: 'error',
          },
        ])}
      />,
    );
    expect(out).toContain('stream failed: upstream timeout');
    expect(out).toContain('var(--color-danger)');
  });
});

describe('<BrainChatMessage /> — UAT 2026-04-20 fixes', () => {
  it('renders meme-image artifact as a clickable <img> thumbnail linking to gatewayUrl', () => {
    // UAT fix #1: successful meme-image artifacts must surface a thumbnail
    // (not just a text pill) so users can preview the Creator output inline.
    const artifact: Artifact = {
      kind: 'meme-image',
      status: 'ok',
      cid: 'bafybeihmemeimage',
      gatewayUrl: 'https://gateway.pinata.cloud/ipfs/bafybeihmemeimage',
      prompt: 'A cyberpunk cat riding a BNB chain',
      label: 'HBNB2026-CYBER meme',
    };
    const out = renderToStaticMarkup(
      <BrainChatMessage
        turn={assistantTurn('', [
          {
            kind: 'persona-artifact',
            agent: 'creator',
            artifact,
          },
        ])}
      />,
    );
    // The <a> wraps the row and targets a new tab with hardened rel.
    expect(out).toMatch(
      /<a[^>]*href="https:\/\/gateway\.pinata\.cloud\/ipfs\/bafybeihmemeimage"[^>]*target="_blank"[^>]*rel="noreferrer noopener"/,
    );
    // The <img> has the same gatewayUrl as src and an accessible alt.
    expect(out).toMatch(
      /<img[^>]*src="https:\/\/gateway\.pinata\.cloud\/ipfs\/bafybeihmemeimage"[^>]*alt="A cyberpunk cat riding a BNB chain"/,
    );
    // Helper hint tells the user they can click to enlarge.
    expect(out).toMatch(/click to enlarge/i);
  });

  it('renders Markdown URLs with target="_blank" + rel="noopener noreferrer"', () => {
    // UAT fix #2: links inside the Brain's final Markdown answer must open
    // in a new tab so clicking a BSCScan / IPFS URL never unloads the demo.
    const out = renderToStaticMarkup(
      <BrainChatMessage
        turn={assistantTurn('See [the token](https://bscscan.com/token/0xabc) for details.', [])}
      />,
    );
    // `react-markdown` renders the anchor; our `components.a` override adds
    // the new-tab hardening. Assert on the combined attribute pair so a
    // future override drop breaks this test.
    expect(out).toMatch(
      /<a[^>]*href="https:\/\/bscscan\.com\/token\/0xabc"[^>]*target="_blank"[^>]*rel="noopener noreferrer"/,
    );
  });
});

describe('<BrainChatMessage /> — heartbeat bubble', () => {
  it('renders data-role="heartbeat", the status chip, and the shortened tokenAddr', () => {
    const turn: BrainChatTurn = {
      id: 'hb-1',
      role: 'heartbeat',
      content: 'Heartbeat tick 3/5: idle',
      heartbeat: {
        tokenAddr: '0xabcdef1234567890abcdef1234567890abcd4444',
        tickId: 'tick-3',
        tickNumber: 3,
        maxTicks: 5,
        success: true,
        action: 'idle',
        tickAt: '2026-04-20T00:01:30.000Z',
        running: true,
      },
    };
    const out = renderToStaticMarkup(<BrainChatMessage turn={turn} />);
    expect(out).toContain('data-role="heartbeat"');
    expect(out).toMatch(/heartbeat\s*·\s*tick 3\/5/);
    // Shortened tokenAddr chip (0xabcd…4444).
    expect(out).toContain('0xabcd');
    expect(out).toContain('4444');
    // Left-aligned (mr-auto) matches the assistant bubble layout.
    expect(out).toMatch(/mr-auto|self-start/);
    // Markdown content rendered.
    expect(out).toContain('Heartbeat tick 3/5: idle');
  });

  it('surfaces an auto-stopped marker when snapshot.running=false', () => {
    const turn: BrainChatTurn = {
      id: 'hb-2',
      role: 'heartbeat',
      content: 'Heartbeat tick 5/5: idle — loop auto-stopped at cap',
      heartbeat: {
        tokenAddr: '0xabcdef1234567890abcdef1234567890abcd4444',
        tickId: 'tick-5',
        tickNumber: 5,
        maxTicks: 5,
        success: true,
        action: 'idle',
        tickAt: '2026-04-20T00:02:30.000Z',
        running: false,
      },
    };
    const out = renderToStaticMarkup(<BrainChatMessage turn={turn} />);
    expect(out).toMatch(/auto-stopped/i);
  });

  it('renders markdown links inside the heartbeat content (tweet / IPFS)', () => {
    const turn: BrainChatTurn = {
      id: 'hb-3',
      role: 'heartbeat',
      content: 'Heartbeat tick 3/5: posted tweet [link](https://x.com/memind/status/123)',
      heartbeat: {
        tokenAddr: '0xabcdef1234567890abcdef1234567890abcd4444',
        tickId: 'tick-3',
        tickNumber: 3,
        maxTicks: 5,
        success: true,
        action: 'post',
        tickAt: '2026-04-20T00:01:30.000Z',
        running: true,
      },
    };
    const out = renderToStaticMarkup(<BrainChatMessage turn={turn} />);
    expect(out).toMatch(/<a[^>]*href="https:\/\/x\.com\/memind\/status\/123"[^>]*target="_blank"/);
  });

  it('renders an error-tone chip for failed ticks', () => {
    const turn: BrainChatTurn = {
      id: 'hb-4',
      role: 'heartbeat',
      content: 'Heartbeat tick 3/5 failed: rate limited',
      heartbeat: {
        tokenAddr: '0xabcdef1234567890abcdef1234567890abcd4444',
        tickId: 'tick-3',
        tickNumber: 3,
        maxTicks: 5,
        success: false,
        action: null,
        error: 'rate limited',
        tickAt: '2026-04-20T00:01:30.000Z',
        running: true,
      },
    };
    const out = renderToStaticMarkup(<BrainChatMessage turn={turn} />);
    // We use the danger colour var for error ticks.
    expect(out).toContain('var(--color-danger)');
  });

  it('renders a neutral chip for overlap-skipped ticks (not red failure)', () => {
    // Overlap-skipped ticks are scheduler fire attempts that landed while a
    // prior tick was still running — the loop is making progress and the
    // user has nothing to act on. The bubble must NOT show the red danger
    // tone; we label the chip "skipped · overlap" in the neutral tertiary
    // tone so the transcript reads accurately.
    const turn: BrainChatTurn = {
      id: 'hb-skip',
      role: 'heartbeat',
      content: 'Heartbeat tick 3/5: skipped (overlap — prior tick still running)',
      heartbeat: {
        tokenAddr: '0xabcdef1234567890abcdef1234567890abcd4444',
        tickId: 'overlap_abc',
        tickNumber: 3,
        maxTicks: 5,
        success: false,
        action: null,
        error: 'overlap-skipped',
        skipped: true,
        tickAt: '2026-04-20T00:01:30.000Z',
        running: true,
      },
    };
    const out = renderToStaticMarkup(<BrainChatMessage turn={turn} />);
    // No red danger tone on a skip.
    expect(out).not.toContain('var(--color-danger)');
    // Must NOT read as a failure.
    expect(out).not.toMatch(/\bfailed\b/);
    // Must surface the neutral "skipped · overlap" label.
    expect(out.toLowerCase()).toContain('skipped');
    expect(out.toLowerCase()).toContain('overlap');
    expect(out).toContain('data-skipped="true"');
  });
});

describe('<BrainChatMessage /> — tool-use work mood glyph (UX fix 2026-04-21)', () => {
  it('renders a PixelHumanGlyph in work mood while a brain tool-use is in flight', () => {
    // The brain-level tool-use group (invoke_creator pending) must show the
    // pixel mascot in `work` mood instead of a plain "…" so users get a
    // visual heartbeat that the Memind is actively computing.
    const out = renderToStaticMarkup(
      <BrainChatMessage
        turn={assistantTurn('', [
          {
            kind: 'tool-use-start',
            agent: 'brain',
            toolName: 'invoke_creator',
            toolUseId: 'tu-1',
            input: {},
          },
        ])}
      />,
    );
    // PixelHumanGlyph renders an <svg> with data-mood="work" while running.
    expect(out).toMatch(/data-mood="work"/);
  });

  it('renders a work-mood glyph for persona sub-tool rows while they are pending', () => {
    // A persona-level tool-use nested under an open brain scope (e.g. creator
    // invoking narrative_generator) must also animate the work-mood glyph in
    // its status slot while pending.
    const out = renderToStaticMarkup(
      <BrainChatMessage
        turn={assistantTurn('', [
          {
            kind: 'tool-use-start',
            agent: 'brain',
            toolName: 'invoke_creator',
            toolUseId: 'tu-1',
            input: {},
          },
          {
            kind: 'tool-use-start',
            agent: 'creator',
            toolName: 'narrative_generator',
            toolUseId: 'tu-sub-1',
            input: {},
          },
        ])}
      />,
    );
    // Two pending glyphs: one for the outer brain scope + one for the nested
    // persona sub-tool. The split check lets the test stay stable if the
    // copy around the glyph changes.
    const count = out.split('data-mood="work"').length - 1;
    expect(count).toBeGreaterThanOrEqual(2);
  });

  it('drops the work-mood glyph once the tool-use group has ended', () => {
    // After tool-use-end the brain scope flips to an `ok` / `error` pill; no
    // work glyph should remain. The nested persona row finalised with a
    // check / cross glyph and drops work mood too.
    const out = renderToStaticMarkup(
      <BrainChatMessage
        turn={assistantTurn('done.', [
          {
            kind: 'tool-use-start',
            agent: 'brain',
            toolName: 'invoke_creator',
            toolUseId: 'tu-1',
            input: {},
          },
          {
            kind: 'tool-use-start',
            agent: 'creator',
            toolName: 'narrative_generator',
            toolUseId: 'tu-sub-1',
            input: {},
          },
          {
            kind: 'tool-use-end',
            agent: 'creator',
            toolName: 'narrative_generator',
            toolUseId: 'tu-sub-1',
            output: {},
            isError: false,
          },
          {
            kind: 'tool-use-end',
            agent: 'brain',
            toolName: 'invoke_creator',
            toolUseId: 'tu-1',
            output: {},
            isError: false,
          },
        ])}
      />,
    );
    expect(out).not.toMatch(/data-mood="work"/);
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
