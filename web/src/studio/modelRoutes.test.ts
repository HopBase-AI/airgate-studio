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
  it('keeps configured group notes out of the visible label', () => {
    expect(formatImageGroupLabel(imageGroup({ note: '低价线路' })))
      .toBe('Adobe · ×0.65');
  });

  it('does not invent a token multiplier for fixed-price image groups', () => {
    expect(formatImageGroupLabel(imageGroup({
      rate_multiplier: 3,
      effective_rate: 3,
      fixed_image_prices: { '1k': 0.08, '2k': 0.12, '4k': 0.15, currency: 'CNY' },
    }))).toBe('Adobe');
  });

  it('keeps generic multipliers out of compact route labels', () => {
    const group = imageGroup({
      rate_multiplier: 3,
      effective_rate: 3,
      note: '固定价：1K ¥0.08，2K ¥0.12，4K ¥0.15。',
    });

    expect(formatImageGroupLabel(group)).toContain('×3');
    expect(formatModelRouteGroupLabel(group)).toBe('Adobe');
  });

  it('builds concise Azure and official options for the same upstream model ID', () => {
    const azure = getModelConfig('openai:gemini-3.1-flash-image');
    const official = getModelConfig('gemini:gemini-3.1-flash-image');
    expect(azure).toBeDefined();
    expect(official).toBeDefined();
    if (!azure || !official) throw new Error('expected both Gemini routes');

    const options = buildModelRouteOptions(
      [azure, official],
      model => model.platform === 'openai'
        ? [imageGroup({ name: 'Azure Gemini 支持生图' })]
        : [imageGroup({ id: 24, name: 'Gemini 官方直连', platform: 'gemini', effective_rate: 1 })],
    );

    expect(options.map(option => option.value)).toEqual([
      'openai:gemini-3.1-flash-image|12',
      'gemini:gemini-3.1-flash-image|24',
    ]);
    expect(options.map(option => option.label)).toEqual([
      'Banana 2 · Azure',
      'Banana 2 · 官方直连',
    ]);
  });

  it('removes redundant image capability wording from channel names', () => {
    expect(formatModelRouteGroupLabel(imageGroup({ name: 'Azure Gemini 支持生图' })))
      .toBe('Azure');
    expect(formatModelRouteGroupLabel(imageGroup({ name: 'Gemini 官方直连' })))
      .toBe('官方直连');
    expect(formatModelRouteGroupLabel(imageGroup({ name: 'Seedream 生图分组' })))
      .toBe('Seedream');
  });

  it('does not repeat a group name that only adds a trailing version zero', () => {
    const model = getModelConfig('openai:gpt-image-2');
    expect(model).toBeDefined();
    if (!model) throw new Error('expected GPT Image route');

    const [option] = buildModelRouteOptions(
      [model],
      () => [imageGroup({ name: 'GPT Image 2.0' })],
    );

    expect(option.label).toBe('GPT Image 2');
  });

  it('keeps a long group note available as option metadata', () => {
    const model = getModelConfig('openai:gpt-image-2');
    expect(model).toBeDefined();
    if (!model) throw new Error('expected GPT Image route');
    const note = 'Azure Gemini 主线路; Banana 2 / Pro 生图备用。';

    const [option] = buildModelRouteOptions([model], () => [imageGroup({ note })]);

    expect(option.label).toBe('GPT Image 2 · Adobe');
    expect(option.description).toBe(note);
    expect(option.label).not.toContain(note);
  });
});

describe('fixed image route pricing', () => {
  it('applies exact prices only to the selected group without mutating the registry', () => {
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

  it('defaults legacy fixed prices without a currency to CNY balance units', () => {
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
  });
});
