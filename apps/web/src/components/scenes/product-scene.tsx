'use client';

/**
 * Thin scene shell that routes to the correct product-grade panel based on
 * `kind`. The Home page mounts `kind='launch'` (LaunchPanel); the Market page
 * mounts `kind='order'` (OrderPanel). Keeping this as a one-screen delegate
 * means the 6-scene skeleton (Hero / Problem / Solution / Product / Vision /
 * Evidence) stays uniform across both routes without duplicating scroll-reveal
 * wiring.
 *
 * AC-P4.7-5 defines the inner panels' behavior; this shell only provides the
 * <section> wrapper with the scene-reveal class so useScrollReveal can stamp
 * `.scene--revealed` consistently with its siblings.
 */
import { useRef } from 'react';
import { LaunchPanel } from '@/components/product/launch-panel';
import { OrderPanel } from '@/components/product/order-panel';
import { useScrollReveal } from '@/hooks/useScrollReveal';

export type ProductSceneKind = 'launch' | 'order';

export interface ProductSceneProps {
  readonly kind: ProductSceneKind;
  /** Deterministic reveal for tests — skips IntersectionObserver. */
  readonly freeze?: boolean;
  readonly className?: string;
}

export function ProductScene(props: ProductSceneProps): React.ReactElement {
  const { kind, freeze = false, className } = props;
  const sectionRef = useRef<HTMLElement>(null);
  const revealed = useScrollReveal(sectionRef);
  const isRevealed = freeze || revealed;

  return (
    <section
      ref={sectionRef}
      aria-label={kind === 'launch' ? 'Launch' : 'Order'}
      className={`scene${isRevealed ? ' scene--revealed' : ''}${className ? ' ' + className : ''}`}
    >
      {kind === 'launch' ? <LaunchPanel /> : <OrderPanel />}
    </section>
  );
}
