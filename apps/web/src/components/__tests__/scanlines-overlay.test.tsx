/**
 * Tests for `<ScanlinesOverlay />` (memind-scrollytelling-rebuild
 * AC-MSR-13). Keeps parity with the Tweaks panel control surface: the
 * overlay only mounts when `enabled=true`, and always carries
 * `aria-hidden` because it is decorative.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ScanlinesOverlay } from '../scanlines-overlay.js';

describe('<ScanlinesOverlay />', () => {
  it('renders the overlay div when enabled=true', () => {
    const html = renderToStaticMarkup(<ScanlinesOverlay enabled />);
    expect(html).toMatch(/<div[^>]*class="scanlines-overlay"/);
  });

  it('renders nothing when enabled=false', () => {
    const html = renderToStaticMarkup(<ScanlinesOverlay enabled={false} />);
    expect(html).toBe('');
  });

  it('marks the decorative overlay aria-hidden for assistive tech', () => {
    const html = renderToStaticMarkup(<ScanlinesOverlay enabled />);
    expect(html).toMatch(/aria-hidden="true"/);
  });
});
