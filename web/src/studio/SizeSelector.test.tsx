import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { SizeSelector } from './SizeSelector';
import type { SizeOption } from './modelConfig';

const seedreamSizes: SizeOption[] = [
  { value: '1024x1024', label: '1024x1024', tier: '1K', price: 0.045, showPrice: true },
  { value: '2048x2048', label: '2048x2048', tier: '2K', price: 0.09, showPrice: true },
];

describe('SizeSelector pricing', () => {
  it.each([
    ['1024x1024', '$0.045/张'],
    ['2048x2048', '$0.09/张'],
  ])('renders the selected Seedream price for %s', (value, expectedPrice) => {
    const html = renderToStaticMarkup(
      <SizeSelector value={value} sizes={seedreamSizes} onChange={() => undefined} />,
    );

    expect(html).toContain(expectedPrice);
  });

  it('does not expose dormant prices for models without showPrice', () => {
    const html = renderToStaticMarkup(
      <SizeSelector
        value="1024x1024"
        sizes={[{ value: '1024x1024', label: '1024x1024', tier: '1K', price: 0.1 }]}
        onChange={() => undefined}
      />,
    );

    expect(html).not.toContain('$0.1/张');
  });
});
