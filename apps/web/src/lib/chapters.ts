/**
 * Canonical 11-chapter registry for the Memind scrollytelling surface
 * (memind-scrollytelling-rebuild §架構總圖).
 *
 * Only `id` + `title` live here — chapter React components are wired up in
 * `app/page.tsx` next to the placeholder/real comp mapping so this registry
 * stays dependency-free and tree-shake-friendly. TOC / Watermark /
 * ascii-backdrop / page.tsx all iterate this single source of truth so
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
