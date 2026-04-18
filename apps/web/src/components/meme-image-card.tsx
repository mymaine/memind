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

  if (artifact.status === 'upload-failed') {
    return (
      <article
        aria-label="meme image (upload failed)"
        data-testid="meme-image-card"
        data-status="upload-failed"
        className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-dashed border-[color:var(--color-danger)] bg-bg-primary p-3"
      >
        <header className="flex items-center justify-between">
          <span className="font-[family-name:var(--font-sans-display)] text-[12px] font-semibold uppercase tracking-[0.5px] text-fg-tertiary">
            meme image
          </span>
          <span className="font-[family-name:var(--font-mono)] text-[10px] uppercase tracking-[0.5px] text-[color:var(--color-danger)]">
            upload failed
          </span>
        </header>
        <p className="line-clamp-2 text-[12px] text-fg-secondary">{artifact.prompt}</p>
        <p
          className="font-[family-name:var(--font-mono)] text-[11px] text-[color:var(--color-danger)]"
          title={artifact.errorMessage}
        >
          pinata: {artifact.errorMessage}
        </p>
      </article>
    );
  }

  // status === 'ok' — render the actual thumbnail loaded from the IPFS gateway.
  return (
    <>
      <article
        aria-label="meme image"
        data-testid="meme-image-card"
        data-status="ok"
        className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-border-default bg-bg-primary p-3"
      >
        <header className="flex items-center justify-between">
          <span className="font-[family-name:var(--font-sans-display)] text-[12px] font-semibold uppercase tracking-[0.5px] text-fg-tertiary">
            meme image
          </span>
          <span className="font-[family-name:var(--font-mono)] text-[10px] uppercase tracking-[0.5px] text-[color:var(--color-chain-ipfs)]">
            ipfs
          </span>
        </header>
        <button
          type="button"
          onClick={() => setShowModal(true)}
          className="group block overflow-hidden rounded-[var(--radius-card)] border border-border-default focus:outline-none focus:ring-2 focus:ring-accent"
          aria-label="enlarge meme image"
        >
          {/*
            Native <img>: the dashboard runs in a sandbox dev server with no
            Next/Image loader configured for arbitrary IPFS gateways. The
            artifact schema enforces an http(s) gatewayUrl so loading is safe.
            Cap at 256px per AC-V2-2; preserve aspect with object-contain.
          */}
          <img
            src={artifact.gatewayUrl ?? ''}
            alt={artifact.prompt}
            width={256}
            height={256}
            className="h-[256px] w-full object-contain transition-transform duration-200 group-hover:scale-[1.02]"
          />
        </button>
        <p className="line-clamp-2 text-[12px] text-fg-secondary" title={artifact.prompt}>
          {artifact.prompt}
        </p>
      </article>

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
