import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProductScene } from './product-scene';

describe('ProductScene', () => {
  it('routes kind=launch to LaunchPanel (section aria-label=Launch, id=launch-panel present)', () => {
    const markup = renderToStaticMarkup(<ProductScene kind="launch" freeze />);
    expect(markup).toContain('aria-label="Launch"');
    expect(markup).toContain('id="launch-panel"');
  });

  it('routes kind=order to OrderPanel (section aria-label=Order, id=order present)', () => {
    const markup = renderToStaticMarkup(<ProductScene kind="order" freeze />);
    expect(markup).toContain('aria-label="Order"');
    expect(markup).toContain('id="order"');
  });

  it('applies scene + scene--revealed class when freeze=true', () => {
    const markup = renderToStaticMarkup(<ProductScene kind="launch" freeze />);
    expect(markup).toMatch(/class="scene scene--revealed/);
  });

  it('applies only scene class when freeze=false (SSR has no observer)', () => {
    const markup = renderToStaticMarkup(<ProductScene kind="launch" />);
    expect(markup).toContain('class="scene');
    expect(markup).not.toContain('scene--revealed');
  });

  it('appends user className', () => {
    const markup = renderToStaticMarkup(<ProductScene kind="launch" freeze className="extra" />);
    expect(markup).toContain('extra');
  });
});
