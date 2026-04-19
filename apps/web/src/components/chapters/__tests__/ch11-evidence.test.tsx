/**
 * Tests for <Ch11Evidence /> — closing-evidence chapter of the
 * scrollytelling narrative (memind-scrollytelling-rebuild AC-MSR-9 ch11).
 *
 * Ports the interior-progress contract from
 * `docs/design/memind-handoff/project/components/chapters.jsx` Ch11Evidence
 * (lines 523-584), with two spec-mandated deltas:
 *
 *   1. On-chain pills MUST integrate real `runState.artifacts`. When the
 *      run has shipped >= 5 artifacts, the first 5 are rendered through
 *      `mapArtifactToEvidenceRow`. Otherwise we fall back to a 5-row
 *      FALLBACK table anchored on actual 2026-04-18 launch hashes.
 *   2. Engineering rows: the handoff's `gpt-4o` reference is replaced
 *      with `claude-sonnet-4.5 · 5s / autonomous` (we ship Claude via
 *      OpenRouter, not OpenAI). The `194 kB` bundle number is replaced
 *      with the static `≤ 230 kB budget` string (avoids drifting with
 *      every build).
 *
 * Ch11 is the only chapter that reads context, so tests that touch the
 * hook wrap the component in <RunStateProvider> + a publish helper.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Artifact, LogEvent } from '@hack-fourmeme/shared';
import type { RunState } from '@/hooks/useRun-state';
import { EMPTY_ASSISTANT_TEXT, EMPTY_TOOL_CALLS, IDLE_STATE } from '@/hooks/useRun-state';

// `renderToStaticMarkup` does not run React effects, so the usual
// <RunStateProvider>+usePublishRunState seed pattern never reaches the
// subtree on the first render. Mock the hook so each test can swap in
// whatever state it needs before importing the component.
const mockUseRunState = vi.fn<() => RunState>();
vi.mock('@/hooks/useRunStateContext', () => ({
  useRunState: () => mockUseRunState(),
}));

// Must be imported AFTER the mock call so the component picks up the
// mocked module.
const { Ch11Evidence, mapArtifactToEvidenceRow } = await import('../ch11-evidence.js');

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

describe('<Ch11Evidence> fallback behaviour', () => {
  it('when runState has < 5 artifacts, renders all 5 fallback pills', () => {
    const html = renderToStaticMarkup(<Ch11Evidence p={1} />);
    // Fallback hashes anchored on actual 2026-04-18 launch data.
    expect(html).toContain('0x4E39d254..74444');
    expect(html).toContain('0x760ff53f..760c9b');
    expect(html).toContain('bafkrei..peq4');
    expect(html).toContain('0xa812..9fc4');
    expect(html).toContain('bafkrei..abcd');
    // 5 ev-pill rows (plus 3 eng rows = 8 total pills). Use a filter to
    // strip `ev-pill-eng` from the count.
    const onchainPills = html.match(/class="ev-pill"[^>]/g) ?? [];
    expect(onchainPills.length).toBe(5);
  });

  it('renders the MEMIND wordmark + sunglasses glyph in the closing card', () => {
    const html = renderToStaticMarkup(<Ch11Evidence p={1} />);
    expect(html).toContain('MEMIND');
    expect(html).toMatch(/data-mood="sunglasses"/);
    expect(html).toContain('open the demo');
    expect(html).toContain('see the code');
  });

  it('"see the code" renders as an external link to the repo (UAT issue #1)', () => {
    // UAT: the two closing CTAs must be clickable. `see the code` opens a
    // new tab to the repo on GitHub. Assert the <a> with target=_blank +
    // rel=noopener exists; URL precise host is not the assertion target
    // (URL is configurable at deploy), but it MUST be an absolute http(s).
    const html = renderToStaticMarkup(<Ch11Evidence p={1} />);
    expect(html).toMatch(/<a[^>]*href="https?:\/\/[^"]*github[^"]*"[^>]*target="_blank"/);
    expect(html).toMatch(/rel="noopener noreferrer"/);
  });

  it('"open the demo" renders a button (clickable target for scroll-to-top)', () => {
    // UAT: clicking `open the demo` loops back to Ch1 so the judge can
    // re-watch or start a new run. SSR asserts the button is present; the
    // onClick handler runs at runtime only (jsdom-less vitest can't fire it).
    const html = renderToStaticMarkup(<Ch11Evidence p={1} />);
    expect(html).toMatch(/<button[^>]*class="cta cta-primary"[^>]*>[^<]*open the demo/);
  });
});

describe('<Ch11Evidence> real-data binding', () => {
  it('when runState has 0 artifacts, renders all 5 fallback pills (unchanged baseline)', () => {
    // Already covered by the fallback-behaviour suite above; asserted here
    // again alongside the new padding cases so the 0-artifact branch sits
    // next to the 2/5 mixed branch for easy comparison.
    mockUseRunState.mockReturnValue(makeRunning([]));
    const html = renderToStaticMarkup(<Ch11Evidence p={1} />);
    const onchainPills = html.match(/class="ev-pill"[^>]/g) ?? [];
    expect(onchainPills.length).toBe(5);
    expect(html).toContain('0x4E39d254..74444');
  });

  it('when runState has 2 real artifacts, renders 2 real + 3 fallback pills (UAT 2026-04-20)', () => {
    // UAT fix: pre-fix the threshold was >=5, so any real run under 5
    // artifacts silently rendered 100% fallback hashes, undercutting the
    // live-demo story. Post-fix: real artifacts come first, fallback pads
    // the tail so the grid is always 5 pills but reads as "mostly real".
    const realArtifacts: Artifact[] = [
      {
        kind: 'bsc-token',
        chain: 'bsc-mainnet',
        address: '0x1111111111111111111111111111111111111111',
        explorerUrl: 'https://bscscan.com/token/0x1111111111111111111111111111111111111111',
      },
      {
        kind: 'token-deploy-tx',
        chain: 'bsc-mainnet',
        txHash: '0x2222222222222222222222222222222222222222222222222222222222222222',
        explorerUrl: 'https://bscscan.com/tx/0x2222',
      },
    ];
    mockUseRunState.mockReturnValue(makeRunning(realArtifacts));
    const html = renderToStaticMarkup(<Ch11Evidence p={1} />);
    // Both real hashes present.
    expect(html).toContain('0x11111111..1111');
    expect(html).toContain('0x22222222..2222');
    // First 3 fallback hashes come after (pad to 5 total).
    expect(html).toContain('0x4E39d254..74444');
    expect(html).toContain('0x760ff53f..760c9b');
    expect(html).toContain('bafkrei..peq4');
    // The 4th / 5th fallback hashes MUST NOT appear — we only pad 3.
    expect(html).not.toContain('0xa812..9fc4');
    expect(html).not.toContain('bafkrei..abcd');
    // Still exactly 5 pills rendered.
    const onchainPills = html.match(/class="ev-pill"[^>]/g) ?? [];
    expect(onchainPills.length).toBe(5);
  });

  it('when runState has >= 5 artifacts, renders the real hashes instead of fallback', () => {
    const realArtifacts: Artifact[] = [
      {
        kind: 'bsc-token',
        chain: 'bsc-mainnet',
        address: '0x1111111111111111111111111111111111111111',
        explorerUrl: 'https://bscscan.com/token/0x1111111111111111111111111111111111111111',
      },
      {
        kind: 'token-deploy-tx',
        chain: 'bsc-mainnet',
        txHash: '0x2222222222222222222222222222222222222222222222222222222222222222',
        explorerUrl: 'https://bscscan.com/tx/0x2222',
      },
      {
        kind: 'lore-cid',
        cid: 'bafkreirealcidvalue1234567890',
        gatewayUrl: 'https://pinata.mypinata.cloud/ipfs/bafkreirealcidvalue1234567890',
        author: 'narrator',
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
        cid: 'bafkreisecondcidvalue9999',
        gatewayUrl: 'https://pinata.mypinata.cloud/ipfs/bafkreisecondcidvalue9999',
        author: 'creator',
      },
    ];
    mockUseRunState.mockReturnValue(makeRunning(realArtifacts));
    const html = renderToStaticMarkup(<Ch11Evidence p={1} />);
    // Real hashes show up (truncated as first10..last4 of the raw value)
    expect(html).toContain('0x11111111..1111');
    expect(html).toContain('0x22222222..2222');
    expect(html).toContain('bafkreirea..7890');
    // Fallback hashes must NOT appear
    expect(html).not.toContain('0x4E39d254..74444');
    expect(html).not.toContain('bafkrei..peq4');
  });
});

describe('<Ch11Evidence> engineering row fact corrections', () => {
  it('brain.tick row reads "claude-sonnet-4.5 · 5s / autonomous" (not gpt-4o)', () => {
    const html = renderToStaticMarkup(<Ch11Evidence p={1} />);
    expect(html).toContain('claude-sonnet-4.5 \u00b7 5s / autonomous');
    // Regression guard: the handoff's gpt-4o wording MUST be gone.
    expect(html).not.toMatch(/gpt-4o/i);
  });

  it('bundle row states the budget, not the "194 kB" live number', () => {
    const html = renderToStaticMarkup(<Ch11Evidence p={1} />);
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
