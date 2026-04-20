/**
 * <FooterCredit /> — fixed bottom-left build credit.
 *
 * Single line of mono text sitting in the bottom-left safe area. Anchors
 * the author handle to X (twitter.com). Kept intentionally minimal so it
 * never competes with the scrollytelling stage; the LogsDrawer (dev-only,
 * hidden unless `D` is pressed) is the only surface that overlaps this
 * corner, and it fully occludes the credit when open — acceptable because
 * the drawer is not part of the demo view.
 */
import type { ReactElement } from 'react';

export function FooterCredit(): ReactElement {
  return (
    <div
      className="mono"
      style={{
        position: 'fixed',
        left: '50%',
        bottom: 12,
        transform: 'translateX(-50%)',
        zIndex: 100,
        fontSize: 11,
        letterSpacing: 1,
        color: 'var(--fg-tertiary)',
        opacity: 0.75,
        pointerEvents: 'auto',
        whiteSpace: 'nowrap',
      }}
    >
      {'// built by '}
      <a
        href="https://x.com/maineou"
        target="_blank"
        rel="noopener noreferrer"
        style={{
          color: 'inherit',
          textDecoration: 'none',
          borderBottom: '1px dotted currentColor',
        }}
      >
        @maine
      </a>
    </div>
  );
}
