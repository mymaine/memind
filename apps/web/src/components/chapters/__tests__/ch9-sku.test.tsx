/**
 * Tests for <Ch9SKU /> — SKU matrix chapter of the scrollytelling narrative
 * (memind-scrollytelling-rebuild AC-MSR-9 ch9).
 *
 * Ports the interior-progress contract from the design handoff:
 *
 *   - Four SKU cards (BRAIN.BASIC / BRAIN.PRO / PERSONA.MINT /
 *     SHILL.CREDITS) appear staggered. Each card uses
 *     `appear = clamp((p - i*0.1) * 2)` for opacity + a 0.94 -> 1.0 scale
 *     via `lerp(0.94, 1, appear)`.
 *   - Tier class matches the handoff: free / pro / item / bundle.
 *   - Price text: "$0" / "$4.99/mo" / "$1.20" / "$6.40".
 *
 * vitest runs without jsdom; render via `renderToStaticMarkup` + regex.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Ch9SKU } from '../ch9-sku.js';

describe('<Ch9SKU>', () => {
  it('renders exactly four SKU cards with their codes', () => {
    const html = renderToStaticMarkup(<Ch9SKU p={1} />);
    const cards = html.match(/class="sku-card"/g) ?? [];
    expect(cards.length).toBe(4);
    expect(html).toContain('SKU-01');
    expect(html).toContain('SKU-02');
    expect(html).toContain('SKU-03');
    expect(html).toContain('SKU-04');
  });

  it('at p=0 every card has opacity:0 (first card too, since (0-0)*2 = 0)', () => {
    const html = renderToStaticMarkup(<Ch9SKU p={0} />);
    // All four cards should carry the `opacity:0` style. Use a tolerant
    // match on the sku-card style attribute.
    const opacities = html.match(/class="sku-card"[^>]*style="opacity:0/g) ?? [];
    expect(opacities.length).toBe(4);
  });

  it('applies the correct tier class to each card (free / pro / item / bundle)', () => {
    const html = renderToStaticMarkup(<Ch9SKU p={1} />);
    expect(html).toContain('sku-tier sku-tier-free');
    expect(html).toContain('sku-tier sku-tier-pro');
    expect(html).toContain('sku-tier sku-tier-item');
    expect(html).toContain('sku-tier sku-tier-bundle');
  });

  it('renders the canonical prices for each SKU', () => {
    const html = renderToStaticMarkup(<Ch9SKU p={1} />);
    expect(html).toContain('$0');
    expect(html).toContain('$4.99/mo');
    expect(html).toContain('$1.20');
    expect(html).toContain('$6.40');
  });

  it('renders the four SKU product names', () => {
    const html = renderToStaticMarkup(<Ch9SKU p={1} />);
    expect(html).toContain('BRAIN.BASIC');
    expect(html).toContain('BRAIN.PRO');
    expect(html).toContain('PERSONA.MINT');
    expect(html).toContain('SHILL.CREDITS');
  });
});
