'use client';

import { useState } from 'react';
import type { Artifact } from '@hack-fourmeme/shared';

/**
 * Renders the Creator agent's meme-image artifact. Two variants:
 *   - status='ok'           → 256px square thumbnail loaded from gatewayUrl,
 *                             clickable to open the full image in a modal.
 *   - status='upload-failed' → placeholder card with the prompt + the Pinata
 *                              error message so the demo viewer understands
 *                              why the IPFS pill is missing without leaving
 *                              the dashboard.
 *
 * The component intentionally takes a single artifact (the most recent
 * meme-image emitted by the run) — the parent decides which one to show. We
 * never render multiple thumbnails because the Creator agent only generates
 * one image per run.
 */
type MemeImageArtifact = Extract<Artifact, { kind: 'meme-image' }>;

export function MemeImageCard({
  artifact,
}: {
  artifact: MemeImageArtifact | null;
}): React.ReactElement | null {
  const [showModal, setShowModal] = useState(false);

  if (!artifact) return null;

  // V2-P5 Task 3: always render in compact inline mode so the card sits next
  // to the run-view tab row without pushing the layout past 1920x960. Full
  // image opens in the modal via the existing click handler.
  if (artifact.status === 'upload-failed') {
    return (
      <article
        aria-label="meme image (upload failed)"
        data-testid="meme-image-card"
        data-status="upload-failed"
        className="flex items-center gap-2 rounded-[var(--radius-card)] border border-dashed border-[color:var(--color-danger)] bg-bg-primary px-2 py-1"
        title={`pinata: ${artifact.errorMessage ?? 'upload failed'}`}
      >
        <span className="font-[family-name:var(--font-mono)] text-[10px] uppercase tracking-[0.5px] text-[color:var(--color-danger)]">
          meme · upload failed
        </span>
        <span className="max-w-[200px] truncate text-[11px] text-fg-secondary">
          {artifact.prompt}
        </span>
      </article>
    );
  }

  // status === 'ok' — compact 64px thumbnail with the full image in a modal.
  return (
    <>
      <button
        type="button"
        onClick={() => setShowModal(true)}
        aria-label="meme image — click to enlarge"
        data-testid="meme-image-card"
        data-status="ok"
        className="group flex items-center gap-2 rounded-[var(--radius-card)] border border-border-default bg-bg-primary p-1 focus:outline-none focus:ring-2 focus:ring-accent"
        title={artifact.prompt}
      >
        <img
          src={artifact.gatewayUrl ?? ''}
          alt={artifact.prompt}
          width={56}
          height={56}
          className="h-[56px] w-[56px] rounded-[var(--radius-default)] object-cover transition-transform duration-200 group-hover:scale-[1.03]"
        />
        <div className="flex flex-col pr-2">
          <span className="font-[family-name:var(--font-mono)] text-[10px] uppercase tracking-[0.5px] text-[color:var(--color-chain-ipfs)]">
            meme · ipfs
          </span>
          <span className="max-w-[220px] truncate text-[11px] text-fg-secondary">
            {artifact.prompt}
          </span>
        </div>
      </button>

      {showModal ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="meme image full view"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
          onClick={() => setShowModal(false)}
        >
          <div
            className="flex max-h-full max-w-full flex-col items-center gap-3"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={artifact.gatewayUrl ?? ''}
              alt={artifact.prompt}
              className="max-h-[80vh] max-w-[80vw] rounded-[var(--radius-card)] border border-border-default object-contain"
            />
            <button
              type="button"
              onClick={() => setShowModal(false)}
              className="rounded-full border border-border-default bg-bg-surface px-4 py-1 font-[family-name:var(--font-mono)] text-[12px] uppercase tracking-[0.5px] text-fg-primary hover:border-accent"
            >
              close
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
