import { describe, expect, it } from 'vitest';

import type { ImageGroup } from '../api';
import { getModelConfig } from './modelConfig';
import {
  buildModelRouteOptions,
  formatImageGroupLabel,
  formatModelRouteGroupLabel,
  modelRouteOptionValue,
  parseModelRouteOptionValue,
  withImageGroupPrices,
} from './modelRoutes';

function imageGroup(overrides: Partial<ImageGroup> = {}): ImageGroup {
  return {
    id: 12,
    name: 'Adobe',
    platform: 'openai',
    rate_multiplier: 1,
    effective_rate: 0.65,
    ...overrides,
  };
}

describe('model route option values', () => {
  it('round-trips a model route and group ID', () => {
    const value = modelRouteOptionValue('openai:gemini-3.1-flash-image', 12);

    expect(parseModelRouteOptionValue(value)).toEqual({
      modelKey: 'openai:gemini-3.1-flash-image',
      groupId: 12,
    });
  });

  it.each([
    '',
    'openai:gemini-3.1-flash-image',
    '|12',
    'openai:gemini-3.1-flash-image|0',
    'openai:gemini-3.1-flash-image|-1',
    'openai:gemini-3.1-flash-image|12abc',
  ])('rejects malformed option value %j', value => {
    expect(parseModelRouteOptionValue(value)).toBeNull();
  });
});

describe('model route labels', () => {
  it('shows the configured group note and effective multiplier', () => {
    expect(formatImageGroupLabel(imageGroup({ note: '低价线路' })))
      .toBe('Adobe · 低价线路 · ×0.65');
  });

  it('does not invent a token multiplier for fixed-price image groups', () => {
    expect(formatImageGroupLabel(imageGroup({
      rate_multiplier: 3,
      effective_rate: 3,
      fixed_image_prices: { '1k': 0.08, '2k': 0.12, '4k': 0.15, currency: 'CNY' },
    }))).toBe('Adobe · 1K ¥0.08 / 2K ¥0.12 / 4K ¥0.15');
  });

  it('does not present a generic multiplier as the model route image price', () => {
    const group = imageGroup({
      rate_multiplier: 3,
      effective_rate: 3,
      note: '固定价：1K ¥0.08，2K ¥0.12，4K ¥0.15。',
    });

    expect(formatImageGroupLabel(group)).toContain('×3');
    expect(formatModelRouteGroupLabel(group))
      .toBe('Adobe · 固定价：1K ¥0.08，2K ¥0.12，4K ¥0.15。');
  });

  it('builds distinct Azure-compatible and Google official options for the same upstream model ID', () => {
    const azure = getModelConfig('openai:gemini-3.1-flash-image');
    const official = getModelConfig('gemini:gemini-3.1-flash-image');
    expect(azure).toBeDefined();
    expect(official).toBeDefined();
    if (!azure || !official) throw new Error('expected both Gemini routes');

    const options = buildModelRouteOptions(
      [azure, official],
      model => model.platform === 'openai'
        ? [imageGroup({ name: 'Azure Gemini' })]
        : [imageGroup({ id: 24, name: 'Google 官方', platform: 'gemini', effective_rate: 1 })],
    );

    expect(options.map(option => option.value)).toEqual([
      'openai:gemini-3.1-flash-image|12',
      'gemini:gemini-3.1-flash-image|24',
    ]);
    expect(options.map(option => option.label)).toEqual([
      'Banana 2 · Azure Gemini',
      'Banana 2 · Google 官方',
    ]);
  });

  it('applies exact fixed prices only to the selected group without mutating the registry', () => {
    const base = getModelConfig('openai:gpt-image-2');
    expect(base).toBeDefined();
    if (!base) throw new Error('expected gpt-image-2');

    const priced = withImageGroupPrices(base, imageGroup({
      fixed_image_prices: { '1k': 0, '2k': 0.12, '4k': 0.15, currency: 'CNY' },
    }));
    expect(priced).not.toBe(base);
    expect(priced.sizes.find(size => size.tier === '1K')).toMatchObject({ price: 0, currency: 'CNY', showPrice: true });
    expect(priced.sizes.find(size => size.tier === '2K')).toMatchObject({ price: 0.12, currency: 'CNY', showPrice: true });
    expect(base.sizes.find(size => size.tier === '1K')?.showPrice).not.toBe(true);

    const otherGroup = withImageGroupPrices(base, imageGroup({
      id: 13,
      fixed_image_prices: { '1k': 0.2, currency: 'CNY' },
    }));
    expect(otherGroup.sizes.find(size => size.tier === '1K')).toMatchObject({ price: 0.2, currency: 'CNY', showPrice: true });
    expect(priced.sizes.find(size => size.tier === '1K')?.price).toBe(0);
  });

  it('defaults legacy fixed image prices without a currency to CNY balance units', () => {
    const base = getModelConfig('openai:gpt-image-2');
    expect(base).toBeDefined();
    if (!base) throw new Error('expected gpt-image-2');

    const priced = withImageGroupPrices(base, imageGroup({
      fixed_image_prices: { '1k': 0.08 },
    }));
    expect(priced.sizes.find(size => size.tier === '1K')).toMatchObject({
      price: 0.08,
      currency: 'CNY',
      showPrice: true,
    });
    expect(formatImageGroupLabel(imageGroup({
      fixed_image_prices: { '1k': 0.08 },
    }))).toBe('Adobe · 1K ¥0.08');
    expect(formatModelRouteGroupLabel(imageGroup({
      fixed_image_prices: { '1k': 0.08 },
    }))).toBe('Adobe · 1K ¥0.08');
  });
});
