// End-to-end test for heartbeat tick to chat bubble rendering.
//
// This file uses the `.e2e.test.ts` suffix (not `.test.ts`) so a future
// test-runner split can filter on the naming convention alone. The vitest
// config include pattern also matches this suffix, so nothing additional
// is required today.
//
// Scope: exercises `buildHeartbeatTurn` against realistic
// `HeartbeatTickEvent` payloads as if they came straight off the server's
// SSE bus. Each scenario asserts the exact rendered `turn.content`
// Markdown string so any future copy drift is a conscious choice — this
// is the contract surface the user sees in the BrainChat bubble.
//
// Fixtures `makeSnapshot` / `makeTickEvent` are intentionally copied from
// `useBrainChat-state.test.ts` (kept minimal) — the two files live side
// by side and drift would surface immediately in code review.
import { describe, it, expect } from 'vitest';
import type { Artifact, HeartbeatSessionState, HeartbeatTickEvent } from '@hack-fourmeme/shared';
import { buildHeartbeatTurn } from './useBrainChat-state.js';

function makeSnapshot(overrides: Partial<HeartbeatSessionState> = {}): HeartbeatSessionState {
  return {
    tokenAddr: '0x0000000000000000000000000000000000000001',
    intervalMs: 30_000,
    startedAt: '2026-04-20T00:00:00.000Z',
    running: true,
    maxTicks: 5,
    tickCount: 3,
    successCount: 2,
    errorCount: 0,
    skippedCount: 0,
    lastTickAt: '2026-04-20T00:01:30.000Z',
    lastTickId: 'tick-3',
    lastAction: 'post',
    lastError: null,
    ...overrides,
  };
}

function makeTickEvent(
  overrides: Partial<HeartbeatTickEvent> & {
    snapshotOverrides?: Partial<HeartbeatSessionState>;
  } = {},
): HeartbeatTickEvent {
  const { snapshotOverrides, ...rest } = overrides;
  return {
    tokenAddr: '0x0000000000000000000000000000000000000001',
    snapshot: makeSnapshot(snapshotOverrides),
    delta: {
      tickId: 'tick-3',
      tickAt: '2026-04-20T00:01:30.000Z',
      success: true,
      action: 'idle',
    },
    emittedAt: '2026-04-20T00:01:30.100Z',
    ...rest,
  };
}

describe('heartbeat tick → chat bubble (e2e)', () => {
  it('post + tweet-url + reason → tweet link with reason suffix', () => {
    const tweet: Artifact = {
      kind: 'tweet-url',
      url: 'https://x.com/memind/status/123',
      tweetId: '123',
    };
    const event = makeTickEvent({
      delta: {
        tickId: 'tick-3',
        tickAt: '2026-04-20T00:01:30.000Z',
        success: true,
        action: 'post',
        reason: 'hype cycle momentum',
      },
      artifacts: [tweet],
    });
    const turn = buildHeartbeatTurn('e2e-1', event);
    expect(turn.content).toBe(
      'Heartbeat tick 3/5: posted tweet [link](https://x.com/memind/status/123) — hype cycle momentum',
    );
  });

  it('post + no tweet-url artifact (degraded) → bare "posted tweet" with reason', () => {
    // Degraded path: persona signalled `action=post` but no tweet-url
    // artifact landed on the delta (e.g. X API outage, artifact filter
    // misbehaved). Bubble still reads naturally.
    const event = makeTickEvent({
      delta: {
        tickId: 'tick-3',
        tickAt: '2026-04-20T00:01:30.000Z',
        success: true,
        action: 'post',
        reason: 'X',
      },
      artifacts: [],
    });
    const turn = buildHeartbeatTurn('e2e-2', event);
    expect(turn.content).toBe('Heartbeat tick 3/5: posted tweet — X');
  });

  it('extend_lore + lore-cid + chapterNumber → Chapter N Markdown link', () => {
    const lore: Artifact = {
      kind: 'lore-cid',
      cid: 'bafy...',
      gatewayUrl: 'https://gateway.pinata.cloud/ipfs/bafy...',
      author: 'narrator',
      chapterNumber: 4,
    };
    const event = makeTickEvent({
      delta: {
        tickId: 'tick-3',
        tickAt: '2026-04-20T00:01:30.000Z',
        success: true,
        action: 'extend_lore',
        reason: 'Y',
      },
      artifacts: [lore],
    });
    const turn = buildHeartbeatTurn('e2e-3', event);
    expect(turn.content).toBe(
      'Heartbeat tick 3/5: wrote Chapter 4 ([ipfs://bafy...](https://gateway.pinata.cloud/ipfs/bafy...)) — Y',
    );
  });

  it('extend_lore + lore-cid without chapterNumber → falls back to "new chapter"', () => {
    // Narrator adapter can omit chapterNumber when the LoreStore is empty
    // / not wired; the bubble must degrade to a generic "new chapter"
    // label instead of rendering "Chapter undefined".
    const lore: Artifact = {
      kind: 'lore-cid',
      cid: 'bafy...',
      gatewayUrl: 'https://gateway.pinata.cloud/ipfs/bafy...',
      author: 'narrator',
    };
    const event = makeTickEvent({
      delta: {
        tickId: 'tick-3',
        tickAt: '2026-04-20T00:01:30.000Z',
        success: true,
        action: 'extend_lore',
        reason: 'Y',
      },
      artifacts: [lore],
    });
    const turn = buildHeartbeatTurn('e2e-4', event);
    expect(turn.content).toBe(
      'Heartbeat tick 3/5: wrote new chapter ([ipfs://bafy...](https://gateway.pinata.cloud/ipfs/bafy...)) — Y',
    );
  });

  it('idle + reason → "idle — <reason>" so the no-op explains itself', () => {
    const event = makeTickEvent({
      delta: {
        tickId: 'tick-3',
        tickAt: '2026-04-20T00:01:30.000Z',
        success: true,
        action: 'idle',
        reason: 'waiting for marketcap',
      },
      artifacts: [],
    });
    const turn = buildHeartbeatTurn('e2e-5', event);
    expect(turn.content).toBe('Heartbeat tick 3/5: idle — waiting for marketcap');
  });

  it('idle + "no reason provided" sentinel → no em-dash suffix (collapses)', () => {
    // The persona parser emits this sentinel when the LLM's final text
    // lacks a `reason` field. The bubble must treat it as "no reason"
    // so the UI stays clean instead of leaking internal scaffolding.
    const event = makeTickEvent({
      delta: {
        tickId: 'tick-3',
        tickAt: '2026-04-20T00:01:30.000Z',
        success: true,
        action: 'idle',
        reason: 'no reason provided',
      },
      artifacts: [],
    });
    const turn = buildHeartbeatTurn('e2e-6', event);
    expect(turn.content).toBe('Heartbeat tick 3/5: idle');
  });

  it('error tick → "failed: <message>" with server-supplied error text', () => {
    const event = makeTickEvent({
      delta: {
        tickId: 'tick-3',
        tickAt: '2026-04-20T00:01:30.000Z',
        success: false,
        error: 'rate limited',
      },
      artifacts: [],
      snapshotOverrides: { lastError: 'rate limited' },
    });
    const turn = buildHeartbeatTurn('e2e-7', event);
    expect(turn.content).toBe('Heartbeat tick 3/5 failed: rate limited');
  });

  it('auto-stop (cap hit) → appends " — loop auto-stopped at cap" to any body', () => {
    const event = makeTickEvent({
      delta: {
        tickId: 'tick-5',
        tickAt: '2026-04-20T00:02:30.000Z',
        success: true,
        action: 'idle',
        reason: 'Z',
      },
      artifacts: [],
      snapshotOverrides: { tickCount: 5, running: false },
    });
    const turn = buildHeartbeatTurn('e2e-8', event);
    expect(turn.content).toBe('Heartbeat tick 5/5: idle — Z — loop auto-stopped at cap');
  });

  it('unparseable delta (success=true, no action, no reason) → neutral "ok" fallback', () => {
    // Heartbeat persona parser returns null when the LLM final text is
    // unparseable; the invoke layer then omits both `action` and
    // `reason` on the recorded delta. The bubble must degrade to a
    // neutral "ok" body instead of fabricating an action.
    const event = makeTickEvent({
      delta: {
        tickId: 'tick-3',
        tickAt: '2026-04-20T00:01:30.000Z',
        success: true,
      },
      artifacts: [],
    });
    const turn = buildHeartbeatTurn('e2e-9', event);
    expect(turn.content).toBe('Heartbeat tick 3/5: ok');
  });
});
