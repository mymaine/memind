/**
 * Red tests for /market (immersive-single-page P1 Task 1 / AC-ISP-1).
 *
 * The immersive pivot collapses /market into the single-page surface. The
 * route remains published to preserve outbound links but becomes a thin
 * redirect shell pointing to `/#order-shill` — the new section hosting the
 * order demo on the main page.
 *
 * Testing strategy: mock `next/navigation`'s `redirect` with a throwing
 * spy (mirrors the real runtime behaviour — `redirect` throws to abort
 * render) and assert the page calls it with the right target.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

// Shared spy captured by the mock factory below; each test resets it.
const redirectSpy = vi.fn((url: string) => {
  // Match Next's real behaviour: redirect throws a sentinel so the render
  // pipeline unwinds. Any non-Error throw is fine for our assertion.
  throw new Error(`NEXT_REDIRECT:${url}`);
});

vi.mock('next/navigation', () => ({
  redirect: (url: string) => redirectSpy(url),
}));

beforeEach(() => {
  redirectSpy.mockClear();
});

describe('/market redirect shell', () => {
  it('calls redirect("/#order-shill") when rendered', async () => {
    const { default: MarketPage } = await import('./page.js');
    expect(() => MarketPage()).toThrow(/NEXT_REDIRECT/);
    expect(redirectSpy).toHaveBeenCalledTimes(1);
    expect(redirectSpy).toHaveBeenCalledWith('/#order-shill');
  });
});
