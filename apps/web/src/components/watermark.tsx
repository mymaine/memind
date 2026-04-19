/**
 * <Watermark /> - fixed bottom-right chapter stamp for the Memind
 * scrollytelling surface (memind-scrollytelling-rebuild AC-MSR-5).
 *
 * Ported from design-handoff `app.jsx` lines 362-368: a large mono counter
 * (`NN`) followed by a dim total (`/ MM`) and the current chapter title
 * in a smaller label below. Positioning + typography live in the ported
 * `.watermark` / `.watermark-title` CSS rules in globals.css.
 *
 * aria-hidden because the counter duplicates the TopBar progress
 * indicator + chapter label; exposing it to screen readers would double
 * the announcement budget without adding information.
 */
import type { ReactElement } from 'react';

export interface WatermarkProps {
  readonly activeIdx: number;
  readonly total: number;
  readonly title: string;
}

export function Watermark(props: WatermarkProps): ReactElement {
  const { activeIdx, total, title } = props;
  return (
    <div className="watermark mono" aria-hidden="true">
      {String(activeIdx + 1).padStart(2, '0')}{' '}
      <span style={{ color: 'var(--fg-tertiary)' }}>/ {String(total).padStart(2, '0')}</span>
      <div className="watermark-title">{title}</div>
    </div>
  );
}
