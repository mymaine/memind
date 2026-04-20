import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import type { Artifact } from '@hack-fourmeme/shared';
import { createPool, resolveDatabaseUrl } from '../db/pool.js';
import { ensureSchema } from '../db/schema.js';
import { resetDb } from '../db/reset.js';
import { ArtifactLogStore } from './artifact-log-store.js';

/**
 * Integration tests for `ArtifactLogStore`. Both backends (pg + memory) are
 * exercised: pg when `DATABASE_URL` / `TEST_DATABASE_URL` is reachable, and
 * the memory ring buffer unconditionally so contributors without docker can
 * still see the dedupe logic working.
 */

const hasDatabaseUrl = resolveDatabaseUrl() !== undefined;

function artifact(partial: Partial<Artifact> = {}): Artifact {
  return {
    kind: 'bsc-token',
    chain: 'bsc-mainnet',
    address: '0x1111111111111111111111111111111111111111',
    explorerUrl: 'https://bscscan.com/token/0x1111111111111111111111111111111111111111',
    ...partial,
  } as Artifact;
}

describe('ArtifactLogStore (memory backend)', () => {
  let store: ArtifactLogStore;

  beforeEach(() => {
    store = new ArtifactLogStore({ memoryBufferSize: 5 });
  });

  it('append + listRecent round-trips ordered newest-first', async () => {
    await store.append(
      artifact({
        kind: 'lore-cid',
        cid: 'bafkrei-1',
        gatewayUrl: 'https://gateway.pinata.cloud/ipfs/bafkrei-1',
        author: 'creator',
      } as Artifact),
    );
    await store.append(
      artifact({
        kind: 'lore-cid',
        cid: 'bafkrei-2',
        gatewayUrl: 'https://gateway.pinata.cloud/ipfs/bafkrei-2',
        author: 'narrator',
      } as Artifact),
    );

    const rows = await store.listRecent(5);
    expect(rows.map((r) => (r.kind === 'lore-cid' ? r.cid : ''))).toEqual([
      'bafkrei-2',
      'bafkrei-1',
    ]);
  });

  it('immutable kinds dedupe on natural_key (DO NOTHING)', async () => {
    const tx = `0x${'a'.repeat(64)}` as `0x${string}`;
    const first: Artifact = {
      kind: 'token-deploy-tx',
      chain: 'bsc-mainnet',
      txHash: tx,
      explorerUrl: `https://bscscan.com/tx/${tx}`,
      label: 'first',
    };
    const second: Artifact = { ...first, label: 'second' };
    await store.append(first);
    await store.append(second);
    const rows = await store.listRecent(5);
    const tokens = rows.filter((r) => r.kind === 'token-deploy-tx');
    expect(tokens).toHaveLength(1);
    // DO NOTHING means the first writer's label wins.
    expect(tokens[0]?.label).toBe('first');
  });

  it('shill-order upgrades status in place (DO UPDATE)', async () => {
    const base: Artifact = {
      kind: 'shill-order',
      orderId: 'ord-1',
      targetTokenAddr: '0x1111111111111111111111111111111111111111',
      paidTxHash: `0x${'0'.repeat(64)}`,
      paidAmountUsdc: '0.01',
      status: 'queued',
      ts: '2026-04-20T00:00:00.000Z',
    };
    await store.append(base);
    await store.append({ ...base, status: 'processing' });
    await store.append({ ...base, status: 'done' });
    const rows = await store.listRecent(5);
    const orders = rows.filter((r) => r.kind === 'shill-order');
    expect(orders).toHaveLength(1);
    expect(orders[0]?.kind === 'shill-order' ? orders[0].status : undefined).toBe('done');
  });

  it('heartbeat-tick entries stack even when identical', async () => {
    const tick: Artifact = {
      kind: 'heartbeat-tick',
      tickNumber: 1,
      totalTicks: 5,
      decisions: ['check_status'],
    };
    await store.append(tick);
    await store.append(tick);
    await store.append(tick);
    const rows = await store.listRecent(5);
    expect(rows.filter((r) => r.kind === 'heartbeat-tick')).toHaveLength(3);
  });

  it('respects the ring buffer cap', async () => {
    for (let i = 0; i < 8; i += 1) {
      await store.append({
        kind: 'heartbeat-tick',
        tickNumber: i + 1,
        totalTicks: 8,
        decisions: [`tick_${String(i)}`],
      });
    }
    const rows = await store.listRecent(100);
    expect(rows).toHaveLength(5);
  });
});

describe.skipIf(!hasDatabaseUrl)('ArtifactLogStore (pg backend)', () => {
  let pool: Pool;
  let store: ArtifactLogStore;

  beforeAll(async () => {
    pool = createPool();
    await ensureSchema(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await resetDb(pool, { ...process.env, NODE_ENV: 'test' });
    store = new ArtifactLogStore({ pool });
  });

  it('round-trips an artifact through pg', async () => {
    const art: Artifact = {
      kind: 'lore-cid',
      cid: 'bafkrei-pg-1',
      gatewayUrl: 'https://gateway.pinata.cloud/ipfs/bafkrei-pg-1',
      author: 'narrator',
      chapterNumber: 2,
    };
    await store.append(art, 'run-abc');
    const rows = await store.listRecent(10);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(art);
  });

  it('shill-order DO UPDATE keeps a single row with the latest status', async () => {
    const base: Artifact = {
      kind: 'shill-order',
      orderId: 'pg-ord-1',
      targetTokenAddr: '0x1111111111111111111111111111111111111111',
      paidTxHash: `0x${'0'.repeat(64)}`,
      paidAmountUsdc: '0.01',
      status: 'queued',
      ts: '2026-04-20T00:00:00.000Z',
    };
    await store.append(base);
    await store.append({ ...base, status: 'done' });
    const rows = await store.listRecent(10);
    const orders = rows.filter((r) => r.kind === 'shill-order');
    expect(orders).toHaveLength(1);
    expect(orders[0]?.kind === 'shill-order' ? orders[0].status : undefined).toBe('done');
  });

  it('heartbeat-tick null-key inserts stack rather than dedupe', async () => {
    const tick: Artifact = {
      kind: 'heartbeat-tick',
      tickNumber: 1,
      totalTicks: 5,
      decisions: ['check_status'],
    };
    await store.append(tick);
    await store.append(tick);
    const rows = await store.listRecent(10);
    expect(rows.filter((r) => r.kind === 'heartbeat-tick')).toHaveLength(2);
  });
});
