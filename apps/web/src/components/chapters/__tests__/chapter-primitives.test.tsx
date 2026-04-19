/**
 * Tests for chapter primitives — Label / BigHeadline / Mono / Pill
 * (memind-scrollytelling-rebuild P0 Task 3).
 *
 * Ported from `docs/design/memind-handoff/project/components/chapters.jsx`
 * lines 11-34. These four primitives are shared across all 11 chapter
 * components and their output must match the CSS classes already ported
 * into `app/globals.css` (`.ch-label`, `.ch-label-num`, `.ch-headline`,
 * `.mono`, `.pill`, `.pill-dot`).
 *
 * vitest runs under `node` with no jsdom, matching the repo's established
 * pattern (see `sticky-stage.test.tsx`). We render via
 * `renderToStaticMarkup` and assert on regex / substrings.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Label, BigHeadline, Mono, Pill } from '../chapter-primitives.js';

describe('<Label>', () => {
  it('zero-pads single-digit chapter numbers to CH.0N', () => {
    const html = renderToStaticMarkup(<Label n={1}>Hero</Label>);
    expect(html).toMatch(/CH\.01/);
    expect(html).toMatch(/class="ch-label-num"/);
    expect(html).toMatch(/class="ch-label-bar"/);
    expect(html).toMatch(/class="ch-label-text"[^>]*>Hero</);
  });

  it('keeps two-digit chapter numbers intact (e.g. CH.11)', () => {
    const html = renderToStaticMarkup(<Label n={11}>Evidence</Label>);
    expect(html).toMatch(/CH\.11/);
    expect(html).not.toMatch(/CH\.011/);
  });
});

describe('<BigHeadline>', () => {
  it('defaults size to 120 and honours the override prop', () => {
    const htmlDefault = renderToStaticMarkup(<BigHeadline>HELLO</BigHeadline>);
    expect(htmlDefault).toMatch(/class="ch-headline"/);
    expect(htmlDefault).toMatch(/font-size:120px/);

    const htmlOverride = renderToStaticMarkup(<BigHeadline size={132}>BIG</BigHeadline>);
    expect(htmlOverride).toMatch(/font-size:132px/);
  });
});

describe('<Mono>', () => {
  it('renders with .mono class; dim prop adds fg-tertiary color', () => {
    const plain = renderToStaticMarkup(<Mono>hi</Mono>);
    expect(plain).toMatch(/class="mono"/);
    // no inline color when dim is false
    expect(plain).not.toMatch(/--fg-tertiary/);

    const dim = renderToStaticMarkup(<Mono dim>hi</Mono>);
    expect(dim).toMatch(/color:var\(--fg-tertiary\)/);
  });
});

describe('<Pill>', () => {
  it('renders a dot by default with the given color', () => {
    const html = renderToStaticMarkup(<Pill color="var(--chain-bnb)">BNB CHAIN</Pill>);
    expect(html).toMatch(/class="pill"/);
    expect(html).toMatch(/class="pill-dot"[^>]*style="background:var\(--chain-bnb\)/);
    expect(html).toMatch(/>BNB CHAIN</);
  });

  it('omits the dot when dot=false', () => {
    const html = renderToStaticMarkup(
      <Pill color="var(--chain-base)" dot={false}>
        BASE L2
      </Pill>,
    );
    expect(html).toMatch(/class="pill"/);
    expect(html).not.toMatch(/class="pill-dot"/);
  });
});
