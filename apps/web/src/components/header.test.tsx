/**
 * Tests for the rewritten <Header /> surface (memind-scrollytelling-rebuild
 * AC-MSR-3 TopBar).
 *
 * The old Header was a Tailwind-styled slim nav with a GitHub icon + Home
 * link. It has been replaced by a design-spec TopBar carrying a brand mark
 * + wordmark + meme x mind tag on the left, and a mono progress indicator
 * (NN/MM + 120px progress bar) plus a <BrainIndicator /> on the right.
 *
 * <HeaderView /> is the pure presentational piece (node-testable via
 * renderToStaticMarkup); <Header /> is the client shell that forwards
 * props to the view.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Header, HeaderView } from './header.js';
import { IDLE_STATE } from '@/hooks/useRun-state';

function render(props: Partial<Parameters<typeof HeaderView>[0]> = {}): string {
  return renderToStaticMarkup(
    <HeaderView
      activeIdx={0}
      total={11}
      progress={0}
      runState={IDLE_STATE}
      onBrainClick={() => {}}
      {...props}
    />,
  );
}

describe('<HeaderView /> TopBar', () => {
  it('mounts under the .topbar shell class with brand + nav regions', () => {
    const out = render();
    expect(out).toMatch(/<header[^>]*class="topbar"/);
    expect(out).toContain('topbar-brand');
    expect(out).toContain('topbar-nav');
  });

  it('surfaces the MEMIND wordmark and meme x mind tag', () => {
    const out = render();
    expect(out).toContain('MEMIND');
    expect(out).toContain('meme × mind');
  });

  it('formats the progress counter as zero-padded NN/MM (01/11 at idx=0)', () => {
    const out = render({ activeIdx: 0, total: 11 });
    expect(out).toMatch(/01\s*\/\s*11/);
  });

  it('renders a GitHub jump-off anchor at the far-right of the TopBar', () => {
    const out = render();
    expect(out).toMatch(/class="topbar-github"/);
    expect(out).toContain('https://github.com/mymaine/memind');
    expect(out).toMatch(/target="_blank"/);
    expect(out).toMatch(/rel="noopener noreferrer"/);
    expect(out).toMatch(/aria-label="View source on GitHub"/);
  });

  it('renders the zero-padded counter for a later chapter (03/11 at idx=2)', () => {
    const out = render({ activeIdx: 2, total: 11 });
    expect(out).toMatch(/03\s*\/\s*11/);
  });

  it('sizes the progress fill bar off the progress prop (width % mirrors 0..1)', () => {
    const out = render({ progress: 0.25 });
    // Fill mounts as `.topbar-progress-fill` with inline width:25%.
    expect(out).toMatch(/topbar-progress-fill[^>]*style="width:\s*25(?:\.0)?%/);
  });

  it('mounts a <BrainIndicator /> button carrying the TOKEN BRAIN label', () => {
    const out = render();
    expect(out).toContain('TOKEN BRAIN');
    expect(out).toMatch(/<button[^>]*class="brain-ind"/);
  });

  it('wires onBrainClick through to the BrainIndicator without invoking it at render time', () => {
    const onBrainClick = vi.fn();
    renderToStaticMarkup(
      <HeaderView
        activeIdx={0}
        total={11}
        progress={0}
        runState={IDLE_STATE}
        onBrainClick={onBrainClick}
      />,
    );
    // Static render does not fire click events; we only assert the handler
    // is not accidentally called during the render phase.
    expect(onBrainClick).not.toHaveBeenCalled();
  });
});

describe('<Header /> export contract', () => {
  it('exports a function component so the page shell can mount it', () => {
    expect(typeof Header).toBe('function');
  });
});
