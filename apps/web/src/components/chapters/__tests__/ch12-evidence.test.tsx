/**
 * Tests for <Ch12Evidence /> — rebuilt 2026-04-20 around a chain-partitioned
 * tab view + a clickable hash-link model.
 *
 * Contract (new):
 *
 *   1. Four tabs — BNB / BASE / IPFS / X — each surface up to 5 rows.
 *      A tab shows real artifacts first (routed by `tabForArtifact`) and
 *      pads the tail with `FALLBACK_ONCHAIN_TABS[tab]` so every tab
 *      always looks populated.
 *   2. Each row is an `<a>` with `href` to the matching explorer
 *      (BscScan / Basescan / Pinata / Twitter), `target="_blank"`, and
 *      `rel="noopener noreferrer"`. Heartbeat rows are the one exception
 *      — they carry no external URL and render as `<div>`.
 *   3. The meme-image cover (left-column card) pulls from the latest
 *      `meme-image` artifact; a placeholder SVG + `sample` badge lands
 *      when no real image is present.
 *   4. Engineering rows (PixelHumanGlyph / bundle / brain.tick) still
 *      surface under the main evidence block.
 *
 * Ch11 reads `useRunState`, so the mock pattern from the previous
 * revision is preserved.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Artifact, LogEvent } from '@hack-fourmeme/shared';
import type { RunState } from '@/hooks/useRun-state';
import { EMPTY_ASSISTANT_TEXT, EMPTY_TOOL_CALLS, IDLE_STATE } from '@/hooks/useRun-state';

const mockUseRunState = vi.fn<() => RunState>();
vi.mock('@/hooks/useRunStateContext', () => ({
  useRunState: () => mockUseRunState(),
  // Persistence migration adds a hydration fetch inside <Ch12Evidence>. The
  // mirror surface is not relevant to these DOM-shape tests, so we hand
  // back no-op stubs to keep the component happy when it mounts under SSR.
  useRunStateMirror: () => ({
    pushLog: () => {
      /* no-op */
    },
    pushArtifact: () => {
      /* no-op */
    },
    resetMirror: () => {
      /* no-op */
    },
  }),
}));

const { Ch12Evidence, mapArtifactToEvidenceRow } = await import('../ch12-evidence.js');

function makeRunning(artifacts: Artifact[], logs: LogEvent[] = []): RunState {
  return {
    phase: 'running',
    logs,
    artifacts,
    toolCalls: EMPTY_TOOL_CALLS,
    assistantText: EMPTY_ASSISTANT_TEXT,
    runId: 'run_test',
    error: null,
  };
}

beforeEach(() => {
  mockUseRunState.mockReturnValue(IDLE_STATE);
});

describe('<Ch12Evidence> tab shell', () => {
  it('renders exactly four tabs — BNB / BASE / IPFS / X', () => {
    const html = renderToStaticMarkup(<Ch12Evidence p={1} />);
    const tabs = html.match(/class="ev-tab(?: ev-tab-active)?"/g) ?? [];
    expect(tabs.length).toBe(4);
    // First render defaults to BNB being the active tab.
    expect(html).toMatch(/class="ev-tab ev-tab-active"[^>]*>BNB</);
    expect(html).toContain('>BASE<');
    expect(html).toContain('>IPFS<');
    expect(html).toContain('>X<');
  });

  it('each tab panel renders at most 5 rows (canonical fallback seeds 9 total DOM rows)', () => {
    // Non-active tab panels stay in the DOM (opacity:0, pointer-events:none)
    // so the cross-fade is purely CSS. Fallback is pre-recorded real
    // demo-run evidence: 4 BNB + 2 BASE + 2 IPFS + 1 X = 9 rows. No
    // synthetic padding, so tabs render whatever real seeds exist rather
    // than forcing every tab to 5.
    const html = renderToStaticMarkup(<Ch12Evidence p={1} />);
    const rows = html.match(/class="ev-pill ev-pill-link"/g) ?? [];
    expect(rows.length).toBe(9);
  });

  it('every evidence row is an <a> with target=_blank + rel=noopener (clickable hash)', () => {
    const html = renderToStaticMarkup(<Ch12Evidence p={1} />);
    // Count all <a class="ev-pill ev-pill-link" ...> occurrences — each
    // MUST carry target="_blank" and rel="noopener noreferrer".
    const links =
      html.match(
        /<a class="ev-pill ev-pill-link" href="[^"]+" target="_blank" rel="noopener noreferrer"/g,
      ) ?? [];
    expect(links.length).toBe(9);
  });
});

describe('<Ch12Evidence> real-data binding', () => {
  it('empty runState seeds tabs with canonical real-demo fallback, no sample chips', () => {
    mockUseRunState.mockReturnValue(makeRunning([]));
    const html = renderToStaticMarkup(<Ch12Evidence p={1} />);
    // Fallback is real demo-run evidence, not synthetic — the `sample`
    // chip is reserved for the meme cover placeholder case.
    const sampleBadges = html.match(/class="ev-sample mono">sample</g) ?? [];
    expect(sampleBadges.length).toBe(0);
  });

  it('real artifacts route to the matching tab + win the first slot', () => {
    const realArtifacts: Artifact[] = [
      {
        kind: 'bsc-token',
        chain: 'bsc-mainnet',
        address: '0x1111111111111111111111111111111111111111',
        explorerUrl: 'https://bscscan.com/token/0x1111111111111111111111111111111111111111',
      },
      {
        kind: 'x402-tx',
        chain: 'base-sepolia',
        txHash: '0x3333333333333333333333333333333333333333333333333333333333333333',
        explorerUrl: 'https://sepolia.basescan.org/tx/0x3333',
        amountUsdc: '0.01',
      },
      {
        kind: 'lore-cid',
        cid: 'bafkreirealcidvalue1234567890',
        gatewayUrl: 'https://pinata.mypinata.cloud/ipfs/bafkreirealcidvalue1234567890',
        author: 'narrator',
      },
    ];
    mockUseRunState.mockReturnValue(makeRunning(realArtifacts));
    const html = renderToStaticMarkup(<Ch12Evidence p={1} />);
    // All three real hashes render (each in its correct tab panel).
    expect(html).toContain('0x11111111..1111');
    expect(html).toContain('0x33333333..3333');
    expect(html).toContain('bafkreirea..7890');
    // Canonical fallback carries no `sample` chip (real demo-run seeds),
    // so a partial live run never introduces one.
    const sampleBadges = html.match(/class="ev-sample mono">sample</g) ?? [];
    expect(sampleBadges.length).toBe(0);
  });

  it('BNB tab pads to 5 when a real artifact is present; other tabs show fallback count', () => {
    const realArtifacts: Artifact[] = [
      {
        kind: 'bsc-token',
        chain: 'bsc-mainnet',
        address: '0x1111111111111111111111111111111111111111',
        explorerUrl: 'https://bscscan.com/token/0x1111111111111111111111111111111111111111',
      },
    ];
    mockUseRunState.mockReturnValue(makeRunning(realArtifacts));
    const html = renderToStaticMarkup(<Ch12Evidence p={1} />);
    // BNB: 1 real + 4 fallback = 5. BASE 2, IPFS 2, X 1 (fallback only).
    const rows = html.match(/class="ev-pill ev-pill-link"/g) ?? [];
    expect(rows.length).toBe(10);
    // The real BNB artifact is present; the remaining 4 BNB rows come
    // from FALLBACK_ONCHAIN_TABS.BNB.
    expect(html).toContain('0x11111111..1111');
  });
});

describe('<Ch12Evidence> meme cover', () => {
  it('no meme-image artifact → placeholder SVG + sample badge', () => {
    mockUseRunState.mockReturnValue(makeRunning([]));
    const html = renderToStaticMarkup(<Ch12Evidence p={1} />);
    // Placeholder is an inline data: SVG URL so we don't need next.config
    // domain allow-listing.
    expect(html).toMatch(/class="ev-meme-frame"/);
    expect(html).toMatch(/src="data:image\/svg\+xml/);
    expect(html).toMatch(/class="ev-meme-badge mono"[^>]*>sample</);
  });

  it('real meme-image artifact → real <img src> + no sample badge on the cover', () => {
    const realArtifacts: Artifact[] = [
      {
        kind: 'meme-image',
        cid: 'bafkreimemeimgrealcidvaluerealcidvalue1234',
        gatewayUrl: 'https://pinata.mypinata.cloud/ipfs/bafkreimemeimgrealcidvaluerealcidvalue1234',
        status: 'ok',
        prompt: 'a glitchy frog staring at the moon',
      },
    ];
    mockUseRunState.mockReturnValue(makeRunning(realArtifacts));
    const html = renderToStaticMarkup(<Ch12Evidence p={1} />);
    // The cover `<img>` carries class="ev-meme-img" AND an https://
    // Pinata source. Assert each separately since attribute order is not
    // guaranteed by renderToStaticMarkup.
    expect(html).toMatch(/<img[^>]*class="ev-meme-img"/);
    expect(html).toContain(
      'src="https://pinata.mypinata.cloud/ipfs/bafkreimemeimgrealcidvaluerealcidvalue1234"',
    );
    // The cover card loses its `sample` badge when a real image is shown.
    expect(html).not.toMatch(/class="ev-meme-badge mono"[^>]*>sample</);
  });
});

describe('<Ch12Evidence> closing card', () => {
  it('renders the MEMIND wordmark + sunglasses glyph', () => {
    const html = renderToStaticMarkup(<Ch12Evidence p={1} />);
    expect(html).toContain('MEMIND');
    expect(html).toMatch(/data-mood="sunglasses"/);
    expect(html).toContain('open the demo');
    expect(html).toContain('see the code');
  });

  it('"see the code" renders as an external GitHub link', () => {
    const html = renderToStaticMarkup(<Ch12Evidence p={1} />);
    expect(html).toMatch(/<a[^>]*href="https?:\/\/[^"]*github[^"]*"[^>]*target="_blank"/);
    expect(html).toMatch(/rel="noopener noreferrer"/);
  });

  it('"open the demo" renders a button', () => {
    const html = renderToStaticMarkup(<Ch12Evidence p={1} />);
    expect(html).toMatch(/<button[^>]*class="cta cta-primary"[^>]*>[^<]*open the demo/);
  });
});

describe('<Ch12Evidence> engineering rows', () => {
  it('brain.tick row reads "60s · autonomous" with no model or provider leak', () => {
    const html = renderToStaticMarkup(<Ch12Evidence p={1} />);
    expect(html).toContain('60s \u00b7 autonomous');
    expect(html).not.toMatch(/claude|sonnet|opus|haiku|gpt|openrouter|anthropic/i);
  });

  it('bundle row states the budget, not the "194 kB" live number', () => {
    const html = renderToStaticMarkup(<Ch12Evidence p={1} />);
    expect(html).toContain('230 kB');
    expect(html).not.toContain('194 kB');
  });
});

describe('mapArtifactToEvidenceRow', () => {
  it('maps `bsc-token` to BNB chain + chain-bnb color', () => {
    const row = mapArtifactToEvidenceRow({
      kind: 'bsc-token',
      chain: 'bsc-mainnet',
      address: '0x4E39d25400000000000000000000000000074444',
      explorerUrl: 'https://bscscan.com/token/0x4E39d25400000000000000000000000000074444',
    });
    expect(row.kind).toBe('bnb');
    expect(row.color).toBe('var(--chain-bnb)');
    expect(row.hash).toMatch(/^0x4E39d254/);
  });

  it('maps `x402-tx` to BASE chain + chain-base color', () => {
    const row = mapArtifactToEvidenceRow({
      kind: 'x402-tx',
      chain: 'base-sepolia',
      txHash: '0xa812000000000000000000000000000000000000000000000000000000009fc4',
      explorerUrl: 'https://sepolia.basescan.org/tx/0xa812',
      amountUsdc: '0.01',
    });
    expect(row.kind).toBe('base');
    expect(row.color).toBe('var(--chain-base)');
  });

  it('maps `lore-cid` to IPFS chain + chain-ipfs color', () => {
    const row = mapArtifactToEvidenceRow({
      kind: 'lore-cid',
      cid: 'bafkreiexampleciddeadbeefpeq4',
      gatewayUrl: 'https://pinata.mypinata.cloud/ipfs/bafkreiexampleciddeadbeefpeq4',
      author: 'narrator',
    });
    expect(row.kind).toBe('ipfs');
    expect(row.color).toBe('var(--chain-ipfs)');
  });
});
