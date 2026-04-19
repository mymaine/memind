/**
 * Canonical 11-chapter registry for the Memind scrollytelling surface
 * (memind-scrollytelling-rebuild §架構總圖).
 *
 * Only `id` + `title` live here — chapter React components are wired up in
 * `app/page.tsx` next to the placeholder/real comp mapping so this registry
 * stays dependency-free and tree-shake-friendly. TOC / Watermark /
 * StickyStage / page.tsx all iterate this single source of truth so
 * reorders or renames only touch one file.
 *
 * Chapter order is spec-mandated (see AC-MSR-1 + Roadmap table); do not
 * reshuffle without updating the spec + anchor-jump tests.
 */

export interface ChapterMeta {
  readonly id: string;
  readonly title: string;
}

export const CHAPTER_META: readonly ChapterMeta[] = [
  { id: 'hero', title: 'PAY USDC. GET TWEETS.' },
  { id: 'problem', title: 'THE GRAVEYARD' },
  { id: 'solution', title: 'THE FIX' },
  { id: 'brain-architecture', title: 'BRAIN ARCHITECTURE' },
  { id: 'launch-demo', title: 'LAUNCH DEMO' },
  { id: 'order-shill', title: 'SHILL DEMO' },
  { id: 'heartbeat-demo', title: 'HEARTBEAT' },
  { id: 'take-rate', title: 'TAKE RATE' },
  { id: 'sku-matrix', title: 'SKU MATRIX' },
  { id: 'phase-map', title: 'PHASE MAP' },
  { id: 'evidence', title: 'EVIDENCE' },
] as const;

/**
 * Slot vertical height in viewport units — must match `SLOT_VH` in
 * `app/page.tsx` + `components/sticky-stage.tsx`. Anchor jumps reuse this
 * constant so every entry point (TOC click, `/market` redirect landing on
 * `/#order-shill`, in-page `<a href="#evidence">`) computes the same
 * mid-hold scroll target.
 */
export const SLOT_VH = 2.2;

/**
 * Pure hash → chapter index resolver. Strips the leading `#` from a URL
 * hash, looks it up in CHAPTER_META, and returns the zero-based chapter
 * index, or `null` when the hash is empty / unknown. Kept as a pure
 * function so the anchor-jump behaviour is node-testable without spinning
 * up jsdom or coupling to `window.location`.
 */
export function resolveChapterIndexFromHash(hash: string): number | null {
  const id = hash.replace(/^#/, '');
  if (id.length === 0) return null;
  const idx = CHAPTER_META.findIndex((m) => m.id === id);
  return idx >= 0 ? idx : null;
}

/**
 * Pure mid-hold scroll target for a given chapter index and viewport
 * height — mirrors app.jsx:onJump. Lands at 30% into the slot so the
 * chapter is already past the fade-in curve and fully visible on arrival.
 */
export function chapterScrollTarget(idx: number, vh: number): number {
  const slotPx = SLOT_VH * vh;
  return idx * slotPx + slotPx * 0.3;
}
