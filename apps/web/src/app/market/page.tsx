/**
 * /market — redirect shell (immersive-single-page P1 Task 1 / AC-ISP-1).
 *
 * The immersive single-page pivot collapses /market into the main page.
 * The route stays published so outbound links and bookmarks do not 404,
 * but the page is a thin redirect shell targeting the new
 * `#order-shill` section on the home page (spec AC-ISP-2 section order).
 *
 * This is a server component — no `'use client'`, no hooks — so
 * `redirect()` from next/navigation runs during render and short-circuits
 * the response with a 307. The previous 6-scene client implementation is
 * retired entirely.
 */
import { redirect } from 'next/navigation';

export default function MarketPage(): never {
  redirect('/#order-shill');
}
