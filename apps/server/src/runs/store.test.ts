import { describe, it, expect, beforeEach } from 'vitest';
import type { Artifact, LogEvent } from '@hack-fourmeme/shared';
import { RunStore, type RunEvent } from './store.js';

/**
 * RunStore unit coverage. Mirrors the scope of `LoreStore`'s tests but adds
 * event-bus semantics: live subscribers must see fan-out, and late
 * subscribers must see a replay of everything buffered so far plus the
 * current status.
 */

function makeLog(overrides: Partial<LogEvent> = {}): LogEvent {
  return {
    ts: '2026-04-20T10:00:00.000Z',
    agent: 'narrator',
    tool: 'orchestrator',
    level: 'info',
    message: 'hello',
    ...overrides,
  };
}

function makeArtifact(overrides: Partial<Artifact> = {}): Artifact {
  return {
    kind: 'lore-cid',
    cid: 'bafkreiabc',
    gatewayUrl: 'https://gateway.pinata.cloud/ipfs/bafkreiabc',
    author: 'narrator',
    chapterNumber: 1,
    ...overrides,
  } as Artifact;
}

describe('RunStore', () => {
  let store: RunStore;

  beforeEach(() => {
    store = new RunStore();
  });

  it('create() generates unique runIds and initialises pending status', () => {
    const a = store.create('a2a');
    const b = store.create('a2a');
    expect(a.runId).not.toBe(b.runId);
    expect(a.runId).toMatch(/^run_/);
    expect(a.status).toBe('pending');
    expect(a.logs).toEqual([]);
    expect(a.artifacts).toEqual([]);
    expect(typeof a.startedAt).toBe('string');
  });

  it('get() returns undefined for unknown runIds', () => {
    expect(store.get('run_missing')).toBeUndefined();
  });

  it('addLog and addArtifact append to the record and emit to live subscribers', () => {
    const record = store.create('a2a');
    const received: RunEvent[] = [];
    const unsub = store.subscribe(record.runId, (e) => received.push(e));

    // subscribe() replays current (empty) state + pending status.
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({
      type: 'status',
      data: { runId: record.runId, status: 'pending' },
    });

    const log = makeLog({ message: 'first' });
    store.addLog(record.runId, log);
    const artifact = makeArtifact();
    store.addArtifact(record.runId, artifact);

    expect(received).toHaveLength(3);
    expect(received[1]).toEqual({ type: 'log', data: log });
    expect(received[2]).toEqual({ type: 'artifact', data: artifact });

    // Stored on the record too.
    const fetched = store.get(record.runId);
    expect(fetched?.logs).toEqual([log]);
    expect(fetched?.artifacts).toEqual([artifact]);

    unsub();
    // After unsubscribe, further events do not reach the listener.
    store.addLog(record.runId, makeLog({ message: 'after unsub' }));
    expect(received).toHaveLength(3);
  });

  it('subscribe() replays buffered events in insertion order before live events', () => {
    const record = store.create('a2a');
    const log1 = makeLog({ message: 'one' });
    const log2 = makeLog({ message: 'two' });
    const artifact = makeArtifact();

    store.addLog(record.runId, log1);
    store.addArtifact(record.runId, artifact);
    store.addLog(record.runId, log2);
    store.setStatus(record.runId, 'running');

    const received: RunEvent[] = [];
    store.subscribe(record.runId, (e) => received.push(e));

    // Order: all logs (in order), then all artifacts (in order), then the
    // current status.
    expect(received).toHaveLength(4);
    expect(received[0]).toEqual({ type: 'log', data: log1 });
    expect(received[1]).toEqual({ type: 'log', data: log2 });
    expect(received[2]).toEqual({ type: 'artifact', data: artifact });
    expect(received[3]).toEqual({
      type: 'status',
      data: { runId: record.runId, status: 'running' },
    });
  });

  it("setStatus('done') emits a terminal status event to live subscribers", () => {
    const record = store.create('a2a');
    const received: RunEvent[] = [];
    store.subscribe(record.runId, (e) => received.push(e));
    // Drop the replayed pending-status event.
    received.length = 0;

    store.setStatus(record.runId, 'running');
    store.setStatus(record.runId, 'done');

    expect(received).toHaveLength(2);
    expect(received[0]).toEqual({
      type: 'status',
      data: { runId: record.runId, status: 'running' },
    });
    expect(received[1]).toEqual({
      type: 'status',
      data: { runId: record.runId, status: 'done' },
    });

    // Terminal transition stamps endedAt.
    expect(store.get(record.runId)?.endedAt).toBeDefined();
  });

  it('late subscribe to a completed run replays events + terminal status', () => {
    const record = store.create('a2a');
    const log = makeLog({ message: 'finished' });
    const artifact = makeArtifact();
    store.addLog(record.runId, log);
    store.addArtifact(record.runId, artifact);
    store.setStatus(record.runId, 'error', 'boom');

    const received: RunEvent[] = [];
    store.subscribe(record.runId, (e) => received.push(e));

    expect(received).toHaveLength(3);
    expect(received[0]).toEqual({ type: 'log', data: log });
    expect(received[1]).toEqual({ type: 'artifact', data: artifact });
    expect(received[2]).toEqual({
      type: 'status',
      data: { runId: record.runId, status: 'error', errorMessage: 'boom' },
    });
  });

  it('setStatus on an unknown runId is a no-op (no throw)', () => {
    expect(() => store.setStatus('run_missing', 'done')).not.toThrow();
  });

  it('clear() empties all records and emitters', () => {
    const record = store.create('a2a');
    store.addLog(record.runId, makeLog());

    store.clear();
    expect(store.get(record.runId)).toBeUndefined();
  });

  // ─── tryCreate: per-tokenAddress concurrency mutex (V2-P1 AC-V2-9) ──────────
  // Two runs against the same tokenAddress would race the LoreStore (both
  // narrators write `chapter N` for the same key) and corrupt the x402
  // /lore/:addr response. tryCreate enforces "one active run per tokenAddress"
  // by returning a 409-shape result when an active run already exists for the
  // requested address. Runs without a tokenAddress (e.g. the initial Creator
  // step that hasn't deployed yet) skip the mutex.

  it('tryCreate without tokenAddress always succeeds (no mutex)', () => {
    const a = store.tryCreate({ kind: 'a2a' });
    expect(a.ok).toBe(true);
    const b = store.tryCreate({ kind: 'a2a' });
    expect(b.ok).toBe(true);
  });

  it('tryCreate with a fresh tokenAddress succeeds and tags the record', () => {
    const result = store.tryCreate({ kind: 'a2a', tokenAddress: '0xAAA' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.record.tokenAddress).toBe('0xaaa');
      expect(result.record.status).toBe('pending');
    }
  });

  it('tryCreate returns 409 shape when an active run already holds the same tokenAddress', () => {
    const first = store.tryCreate({ kind: 'a2a', tokenAddress: '0xBeef' });
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error('first should be ok');

    const second = store.tryCreate({ kind: 'a2a', tokenAddress: '0xbeef' });
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.error).toBe('run_in_progress');
      expect(second.existingRunId).toBe(first.record.runId);
    }
  });

  it('tryCreate matches tokenAddress case-insensitively (EIP-55 mixed case)', () => {
    const first = store.tryCreate({
      kind: 'a2a',
      tokenAddress: '0x4E39d254c716D88Ae52D9cA136F0a029c5F74444',
    });
    expect(first.ok).toBe(true);

    const second = store.tryCreate({
      kind: 'a2a',
      tokenAddress: '0x4e39d254c716d88ae52d9ca136f0a029c5f74444',
    });
    expect(second.ok).toBe(false);
  });

  it('tryCreate releases the mutex once the prior run terminates (done)', () => {
    const first = store.tryCreate({ kind: 'a2a', tokenAddress: '0xCAFE' });
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error('unreachable');
    store.setStatus(first.record.runId, 'done');

    const second = store.tryCreate({ kind: 'a2a', tokenAddress: '0xCAFE' });
    expect(second.ok).toBe(true);
  });

  it('tryCreate releases the mutex once the prior run terminates (error)', () => {
    const first = store.tryCreate({ kind: 'a2a', tokenAddress: '0xDEAD' });
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error('unreachable');
    store.setStatus(first.record.runId, 'error', 'boom');

    const second = store.tryCreate({ kind: 'a2a', tokenAddress: '0xDEAD' });
    expect(second.ok).toBe(true);
  });

  it('tryCreate allows concurrent runs against different tokenAddresses', () => {
    const a = store.tryCreate({ kind: 'a2a', tokenAddress: '0xAAA' });
    const b = store.tryCreate({ kind: 'a2a', tokenAddress: '0xBBB' });
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
  });
});
