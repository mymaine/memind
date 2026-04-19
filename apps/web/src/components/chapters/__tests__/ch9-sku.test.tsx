/**
 * Tests for <Ch9SKU /> — SKU matrix chapter of the scrollytelling narrative.
 *
 * Interior-progress contract:
 *
 *   - Four SKU cards (SHILL.ORDER live + BRAIN.BASIC / BRAIN.PRO /
 *     PERSONA.MINT planned) appear staggered. Each card uses
 *     `appear = clamp((p - i*0.1) * 2)` for opacity + a 0.94 -> 1.0 scale
 *     via `lerp(0.94, 1, appear)`.
 *   - Tier class: bundle / free / pro / item.
 *   - Status class: live (SHILL.ORDER only) / planned (the other three).
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
    const opacities = html.match(/class="sku-card"[^>]*style="opacity:0/g) ?? [];
    expect(opacities.length).toBe(4);
  });

  it('applies the correct tier class to each card (bundle / free / pro / item)', () => {
    const html = renderToStaticMarkup(<Ch9SKU p={1} />);
    expect(html).toContain('sku-tier sku-tier-bundle');
    expect(html).toContain('sku-tier sku-tier-free');
    expect(html).toContain('sku-tier sku-tier-pro');
    expect(html).toContain('sku-tier sku-tier-item');
  });

  it('marks SHILL.ORDER as live and the other three as planned', () => {
    const html = renderToStaticMarkup(<Ch9SKU p={1} />);
    // Exactly one live chip + three planned chips.
    const liveCount = (html.match(/class="sku-status sku-status-live"/g) ?? []).length;
    const plannedCount = (html.match(/class="sku-status sku-status-planned"/g) ?? []).length;
    expect(liveCount).toBe(1);
    expect(plannedCount).toBe(3);
    // data-sku-status attribute is the stable test hook.
    expect(html).toContain('data-sku-status="live"');
    const plannedAttrs = (html.match(/data-sku-status="planned"/g) ?? []).length;
    expect(plannedAttrs).toBe(3);
  });

  it('renders the live SHILL.ORDER price at the real /shill endpoint rate', () => {
    const html = renderToStaticMarkup(<Ch9SKU p={1} />);
    expect(html).toContain('$0.01 / order');
    // Old fabricated prices MUST be gone so the chapter does not undersell
    // or overstate what is actually shipped.
    expect(html).not.toContain('$4.99/mo');
    expect(html).not.toContain('$1.20');
    expect(html).not.toContain('$6.40');
  });

  it('renders the four SKU product names', () => {
    const html = renderToStaticMarkup(<Ch9SKU p={1} />);
    expect(html).toContain('SHILL.ORDER');
    expect(html).toContain('BRAIN.BASIC');
    expect(html).toContain('BRAIN.PRO');
    expect(html).toContain('PERSONA.MINT');
  });
});
