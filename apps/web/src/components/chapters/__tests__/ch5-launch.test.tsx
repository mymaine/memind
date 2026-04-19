/**
 * Tests for <Ch5Launch /> — scripted chat playback chapter
 * (memind-scrollytelling-rebuild AC-MSR-9 ch5).
 *
 * Ports the interior-progress contract from the design handoff. Ch5 does
 * NOT embed a real BrainChat — it is a scripted playback: given 6
 * pre-authored lines with timestamps `t ∈ [0, 0.78]`, each line becomes
 * visible once `p > t` and fades in via `fresh = clamp((p - t) * 20)`.
 *
 * vitest runs under `node` with no jsdom (matches every existing scene
 * test), so we render via `renderToStaticMarkup` + regex.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Ch5Launch } from '../ch5-launch.js';

describe('<Ch5Launch>', () => {
  it('at p=0 no scripted demo line is rendered (first line has t=0, needs p>0)', () => {
    const html = renderToStaticMarkup(<Ch5Launch p={0} />);
    // The first line { t: 0.00, who: 'user' } uses `cutoff > l.t` so at
    // p=0 it is NOT visible yet. No demo-line-* class should appear.
    expect(html).not.toMatch(/class="demo-line demo-line-/);
    // Header shell still renders.
    expect(html).toContain('chat://brain/glitchy');
  });

  it('at p=0.2 only the first user line is visible (t=0.00)', () => {
    const html = renderToStaticMarkup(<Ch5Launch p={0.2} />);
    // Only one demo-line element should be rendered. Count occurrences.
    const matches = html.match(/class="demo-line demo-line-/g) ?? [];
    expect(matches).toHaveLength(1);
    expect(html).toContain('/launch PEPESUPREME');
    // Second line (t=0.20) needs p > 0.20 strictly — not shown at p=0.2.
    expect(html).not.toContain('drafting metadata');
  });

  it('at p=0.5 four lines are visible (all t <= 0.48)', () => {
    const html = renderToStaticMarkup(<Ch5Launch p={0.5} />);
    const matches = html.match(/class="demo-line demo-line-/g) ?? [];
    expect(matches).toHaveLength(4);
    expect(html).toContain('/launch PEPESUPREME');
    expect(html).toContain('drafting metadata');
    // 2026-04-20: the scripted IPFS line now references the real Run #3
    // CID (QmWoMk..TVX7) and the factory line is scoped to BSC.
    expect(html).toContain('pinning lore ch.1 to IPFS');
    expect(html).toContain('QmWoMk..TVX7');
    expect(html).toContain('calling four.meme factory on BSC');
    // t=0.62 chain line should NOT appear yet. The real deploy-tx hash
    // (0x760f..760c9b) replaces the old placeholder 0x4f2a..c8d1.
    expect(html).not.toContain('0x760f..760c9b');
    expect(html).not.toContain('0x4f2a..c8d1');
  });

  it('at p=0.9 all six lines are visible', () => {
    const html = renderToStaticMarkup(<Ch5Launch p={0.9} />);
    const matches = html.match(/class="demo-line demo-line-/g) ?? [];
    expect(matches).toHaveLength(6);
    // Final brain confirmation: honest copy, no fictional "wallet funded
    // w/ 0.05 BNB" — that transfer never existed in deployer.ts.
    expect(html).toContain('$PEPESUPREME is live on BSC mainnet');
    expect(html).toContain('brain online');
    expect(html).not.toContain('wallet funded');
    // The chain row surfaces the real 2026-04-18 deploy tx.
    expect(html).toContain('0x760f..760c9b');
    expect(html).toContain('gas \u2248 0.05 BNB');
  });

  it('renders the side-panel spec rows with PEPESUPREME and 1,000,000,000 supply', () => {
    const html = renderToStaticMarkup(<Ch5Launch p={0.5} />);
    expect(html).toContain('PEPESUPREME');
    expect(html).toContain('1,000,000,000');
    expect(html).toContain('glitchy');
    expect(html).toContain('BNB');
    // Cost row now states ~$0.05 BNB gas (prefixed with $ sign).
    expect(html).toContain('~$0.05 BNB gas');
    // Time row added to reflect the real ~67s Creator run.
    expect(html).toContain('~67s');
    expect(html).toMatch(/class="spec-row"/);
  });

  it('mounts the pixel-human glyph with mood=type-keyboard', () => {
    const html = renderToStaticMarkup(<Ch5Launch p={0.3} />);
    expect(html).toMatch(/data-mood="type-keyboard"/);
    expect(html).toContain('brain is typing');
  });

  it('renders the brain-typing label with the animated dots span (UAT issue #8)', () => {
    // UAT: "brain is typing..." was a static string; viewers on a hold
    // window assumed the brain was frozen. The new AnimatedLabel ships
    // a demo-side-dots span that the client cycles via setInterval. SSR
    // emits it empty; the regression guard checks the shape is present.
    const html = renderToStaticMarkup(<Ch5Launch p={0.3} />);
    expect(html).toMatch(
      /class="demo-side-label">brain is typing<span class="demo-side-dots"[^>]*><\/span>/,
    );
  });
});
