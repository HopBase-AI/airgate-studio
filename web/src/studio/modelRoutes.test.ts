import { describe, expect, it } from 'vitest';

import type { ImageGroup } from '../api';
import { getModelConfig, MODEL_REGISTRY, type ModelConfig } from './modelConfig';
import {
  buildModelRouteOptions,
  compareModelRoutePricing,
  formatImageGroupLabel,
  formatModelRouteLabel,
  imageGroupChannel,
  imageGroupPricing,
  localizeRouteLabel,
  modelRouteOptionValue,
  parseModelRouteOptionValue,
  sanitizeVendorTokens,
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

// 生产分组快照（规范 §3「标签词汇对照」）：组名故意保留描述后缀与供应商词，
// 断言它们不会漏进行标签。
const GROUP_15 = imageGroup({ id: 15, name: 'GPT Image 全系', platform: 'openai', rate_multiplier: 5.1, effective_rate: 5.1 });
const GROUP_18 = imageGroup({
  id: 18,
  name: 'Azure Gemini 全系(含生图)',
  platform: 'openai',
  rate_multiplier: 5.1,
  effective_rate: 5.1,
  note: 'Azure 中继，固定张价',
  fixed_image_prices: { '1k': 0.4, '2k': 0.8, '4k': 1.6, currency: 'CNY' },
});
const GROUP_23 = imageGroup({ id: 23, name: 'Gemini 官方直连', platform: 'gemini', rate_multiplier: 5.1, effective_rate: 5.1 });
// 组 34 故意不带 channel：生产 groups.list 今天不透传 channel，靠 platform=gemini 认 official。
const GROUP_34 = imageGroup({ id: 34, name: 'Gemini 生图（Banana 系）', platform: 'gemini', rate_multiplier: 4.76, effective_rate: 4.76 });
const GROUP_24 = imageGroup({ id: 24, name: 'Seedream 生图分组', platform: 'seedance', rate_multiplier: 4.62, effective_rate: 4.62 });
const GROUP_21 = imageGroup({ id: 21, name: 'Dreamina 海外｜Seedance 2.0/2.5 · Seedream 5.0 pro', platform: 'seedance', rate_multiplier: 4.8, effective_rate: 4.8 });

const PRODUCTION_GROUPS: Record<string, ImageGroup[]> = {
  'openai:gpt-image-2': [GROUP_15],
  'openai:gpt-image-2.5-flare': [GROUP_15],
  'openai:gpt-image-2.5-sunburst': [GROUP_15],
  'openai:gemini-2.5-flash-image': [GROUP_18],
  'openai:gemini-3-pro-image': [GROUP_18],
  'openai:gemini-3.1-flash-image': [GROUP_18],
  'openai:gemini-3.1-flash-lite-image': [GROUP_18],
  'gemini:gemini-2.5-flash-image': [GROUP_34, GROUP_23],
  'gemini:gemini-3-pro-image': [GROUP_23, GROUP_34],
  'gemini:gemini-3.1-flash-image': [GROUP_23, GROUP_34],
  'gemini:gemini-3.1-flash-lite-image': [GROUP_23, GROUP_34],
  'seedance:seedream-5-0-pro': [GROUP_24, GROUP_21],
};

function productionGroups(model: ModelConfig): ImageGroup[] {
  return PRODUCTION_GROUPS[model.routeKey] ?? [];
}

function mustModel(routeKey: string): ModelConfig {
  const model = getModelConfig(routeKey);
  if (!model) throw new Error(`expected ${routeKey} in registry`);
  return model;
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

describe('vendor token sanitizing', () => {
  it('strips upstream channel brands from display text', () => {
    expect(sanitizeVendorTokens('Azure Gemini 支持生图')).toBe('Gemini 支持生图');
    expect(sanitizeVendorTokens('Adobe Image (GPT Image 2.0)')).toBe('Image (GPT Image 2.0)');
    expect(sanitizeVendorTokens('Dreamina 海外｜Seedance 2.0/2.5 · Seedream 5.0 pro'))
      .toBe('海外｜Seedance 2.0/2.5 · Seedream 5.0 pro');
    expect(sanitizeVendorTokens('BytePlus 官方渠道，支持 Seedream 5.0 Pro 生图'))
      .toBe('官方渠道，支持 Seedream 5.0 Pro 生图');
    expect(sanitizeVendorTokens('MiniMax H3 官方直连')).toBe('H3 官方直连');
    expect(sanitizeVendorTokens('MiniMax H3 Max 官方直连')).toBe('H3 Max 官方直连');
  });

  it('leaves neutral text untouched', () => {
    expect(sanitizeVendorTokens('Gemini 官方直连')).toBe('Gemini 官方直连');
    expect(sanitizeVendorTokens('Seedance 2.0 国内（Doubao）')).toBe('Seedance 2.0 国内（Doubao）');
  });
});

describe('group selector labels', () => {
  it('keeps configured group notes out of the visible label and hides vendor names', () => {
    expect(formatImageGroupLabel(imageGroup({ note: '低价线路' })))
      .toBe('Group 12 · ×0.65');
  });

  it('does not invent a token multiplier for fixed-price image groups', () => {
    expect(formatImageGroupLabel(imageGroup({
      rate_multiplier: 3,
      effective_rate: 3,
      fixed_image_prices: { '1k': 0.08, '2k': 0.12, '4k': 0.15, currency: 'CNY' },
    }))).toBe('Group 12');
  });
});

describe('image group channel (R2 / R5)', () => {
  it('uses the backend channel field when present, case-insensitively', () => {
    expect(imageGroupChannel(imageGroup({ name: 'Gemini 生图(Banana 系)', channel: 'official' }))).toBe('official');
    expect(imageGroupChannel(imageGroup({ name: 'Gemini 官方直连', channel: 'Standard' }))).toBe('standard');
    expect(imageGroupChannel(imageGroup({ name: 'Seedance 国内', channel: 'domestic' }))).toBe('domestic');
  });

  it('treats unknown or missing channels as standard', () => {
    expect(imageGroupChannel(imageGroup({ name: 'GPT Image 全系' }))).toBe('standard');
    expect(imageGroupChannel(imageGroup({ name: 'GPT Image 全系', channel: 'vip' }))).toBe('standard');
    expect(imageGroupChannel(imageGroup({ name: 'Azure Gemini 全系(含生图)' }))).toBe('standard');
  });

  it('treats every platform=gemini group as the Google official channel until ops fill the field', () => {
    expect(imageGroupChannel(GROUP_34)).toBe('official');
    expect(imageGroupChannel(GROUP_23)).toBe('official');
    expect(imageGroupChannel(imageGroup({ name: 'Gemini 生图（Banana 系）', platform: 'Gemini' }))).toBe('official');
    // 显式 channel 仍是权威，platform 只是兜底。
    expect(imageGroupChannel(imageGroup({ name: 'Gemini 生图（Banana 系）', platform: 'gemini', channel: 'standard' }))).toBe('standard');
  });

  it('falls back to recognising 官方直连 in the group name as a secondary signal', () => {
    expect(imageGroupChannel(imageGroup({ name: 'Gemini 官方直连', platform: 'openai' }))).toBe('official');
    expect(imageGroupChannel(imageGroup({ name: 'Google Official', platform: 'openai' }))).toBe('official');
  });

  it('only ever appends the closed 官方直连 qualifier to the model name', () => {
    const banana = mustModel('gemini:gemini-3.1-flash-image');
    expect(formatModelRouteLabel(banana, GROUP_23)).toBe('Banana 2 · 官方直连');
    expect(formatModelRouteLabel(banana, GROUP_34)).toBe('Banana 2 · 官方直连');
    expect(formatModelRouteLabel(mustModel('openai:gemini-3.1-flash-image'), GROUP_18)).toBe('Banana 2');
    expect(formatModelRouteLabel(mustModel('openai:gpt-image-2'), GROUP_15)).toBe('GPT Image 2');
    expect(formatModelRouteLabel(mustModel('seedance:seedream-5-0-pro'), GROUP_21)).toBe('Seedream 5.0 Pro');
  });
});

describe('image group pricing (R4)', () => {
  it('reports the 1K fixed price when the group has fixed image prices', () => {
    expect(imageGroupPricing(GROUP_18)).toEqual({ kind: 'fixed', price: 0.4, currency: 'CNY' });
    expect(imageGroupPricing(imageGroup({ fixed_image_prices: { '2k': 0.12 } })))
      .toEqual({ kind: 'fixed', price: 0.12, currency: 'CNY' });
  });

  it('reports the effective rate for usage-billed groups', () => {
    expect(imageGroupPricing(GROUP_15)).toEqual({ kind: 'rate', rate: 5.1 });
    expect(imageGroupPricing(imageGroup({ fixed_image_prices: { currency: 'CNY' }, effective_rate: 4.62 })))
      .toEqual({ kind: 'rate', rate: 4.62 });
  });

  it('orders fixed prices before usage billing and cheaper first within a kind', () => {
    const fixedCheap = { kind: 'fixed' as const, price: 0.2, currency: 'CNY' };
    const fixedDear = { kind: 'fixed' as const, price: 0.4, currency: 'CNY' };
    const rateCheap = { kind: 'rate' as const, rate: 4.76 };
    const rateDear = { kind: 'rate' as const, rate: 5.1 };
    expect(compareModelRoutePricing(fixedCheap, fixedDear)).toBeLessThan(0);
    expect(compareModelRoutePricing(rateDear, rateCheap)).toBeGreaterThan(0);
    expect(compareModelRoutePricing(rateCheap, fixedDear)).toBeGreaterThan(0);
    expect(compareModelRoutePricing(fixedDear, rateCheap)).toBeLessThan(0);
  });
});

describe('model route options on the production snapshot', () => {
  const options = buildModelRouteOptions(MODEL_REGISTRY, productionGroups);
  const labels = options.map(option => option.label);

  it('keeps one row per offering with a closed qualifier vocabulary', () => {
    for (const option of options) {
      const expected = option.channel === 'official'
        ? `${option.modelName} · 官方直连`
        : option.modelName;
      expect(option.label).toBe(expected);
    }
    expect(labels.some(label => /[()（）]/.test(label))).toBe(false);
    expect(labels.some(label => /azure|adobe|dreamina|byteplus|全系|含生图|生图分组/i.test(label))).toBe(false);
    expect(labels.some(label => /专线|通道/.test(label))).toBe(false);
  });

  it('never repeats a label: same model + same qualifier keeps only the cheaper offering', () => {
    expect(new Set(labels).size).toBe(labels.length);
    // 组 23 与 34 同为官方直连、模型重叠，只留 ×4.76 的组 34。
    const bananaOfficial = options.filter(option => option.modelName === 'Banana 2' && option.channel === 'official');
    expect(bananaOfficial).toHaveLength(1);
    expect(bananaOfficial[0].groupId).toBe(34);
    // 组 24 与 21 同为标准通道，只留 ×4.62 的组 24。
    const seedream = options.filter(option => option.modelName === 'Seedream 5.0 Pro');
    expect(seedream).toHaveLength(1);
    expect(seedream[0]).toMatchObject({ groupId: 24, pricing: { kind: 'rate', rate: 4.62 } });
  });

  it('keeps offerings of the same model adjacent with the fixed-price relay before official', () => {
    const banana2 = options
      .map((option, index) => ({ option, index }))
      .filter(({ option }) => option.modelName === 'Banana 2');
    expect(banana2.map(({ option }) => option.label)).toEqual(['Banana 2', 'Banana 2 · 官方直连']);
    expect(banana2[1].index - banana2[0].index).toBe(1);
    expect(banana2[0].option.pricing).toEqual({ kind: 'fixed', price: 0.4, currency: 'CNY' });
    expect(banana2[1].option.pricing).toEqual({ kind: 'rate', rate: 4.76 });
  });

  it('keeps the cheaper official group 34 over 23 and leaves relay group 18 as the standard row (no channel field)', () => {
    // 与生产一致：三组都不带 channel，名字里只有组 23 含「官方直连」。
    const relay = { ...GROUP_18, channel: undefined };
    const official51 = { ...GROUP_23, channel: undefined };
    const official476 = { ...GROUP_34, channel: undefined };
    const rows = buildModelRouteOptions(MODEL_REGISTRY, model => {
      if (model.routeKey === 'openai:gemini-3-pro-image') return [relay];
      if (model.routeKey === 'gemini:gemini-3-pro-image') return [official51, official476];
      return [];
    });

    expect(rows.map(row => [row.label, row.groupId])).toEqual([
      ['Banana Pro', 18],
      ['Banana Pro · 官方直连', 34],
    ]);
    expect(rows[0]).toMatchObject({ channel: 'standard', pricing: { kind: 'fixed', price: 0.4, currency: 'CNY' } });
    expect(rows[1]).toMatchObject({ channel: 'official', pricing: { kind: 'rate', rate: 4.76 } });
    expect(rows.some(row => row.groupId === 23)).toBe(false);
  });

  it('labels the GPT Image family by model name only, never by the group name', () => {
    const gpt = options.filter(option => option.family === 'gpt-image');
    expect(gpt.map(option => option.label)).toEqual(['GPT Image 2', 'GPT Image 2.5', 'GPT Image 2.5 Max']);
    expect(gpt.every(option => option.pricing.kind === 'rate' && option.pricing.rate === 5.1)).toBe(true);
  });

  it('follows registry order when no popularity data is available', () => {
    const firstOfEachModel = Array.from(new Map(options.map(option => [option.modelName, option])).keys());
    const registryOrder = Array.from(new Set(
      MODEL_REGISTRY.filter(model => productionGroups(model).length > 0).map(model => model.name),
    ));
    expect(firstOfEachModel).toEqual(registryOrder);
  });

  it('exposes the sanitized group note as option metadata, not in the label', () => {
    const relay = options.find(option => option.groupId === 18);
    expect(relay?.description).toBe('中继，固定张价');
    expect(relay?.label).toBe('Nano Banana');
  });
});

describe('model route popularity ordering (R3)', () => {
  it('sorts models by users_30d descending and appends models without data in registry order', () => {
    const groupsForModel = (model: ModelConfig): ImageGroup[] => {
      if (model.routeKey === 'openai:gpt-image-2') return [{ ...GROUP_15, users_30d: 120 }];
      if (model.routeKey === 'openai:gemini-3-pro-image') return [{ ...GROUP_18, users_30d: 40 }];
      if (model.routeKey === 'gemini:gemini-3-pro-image') return [{ ...GROUP_34, users_30d: 300 }];
      if (model.routeKey === 'seedance:seedream-5-0-pro') return [GROUP_24];
      if (model.routeKey === 'openai:gpt-image-2.5-flare') return [{ ...GROUP_15, users_30d: 200 }];
      return [];
    };

    const options = buildModelRouteOptions(MODEL_REGISTRY, groupsForModel);

    expect(options.map(option => option.label)).toEqual([
      'Banana Pro',
      'Banana Pro · 官方直连',
      'GPT Image 2.5',
      'GPT Image 2',
      'Seedream 5.0 Pro',
    ]);
  });
});

describe('route label localization', () => {
  const t = (key: string, options?: Record<string, unknown>) => {
    if (key === 'playground.studio_route_official') return 'Official';
    return typeof options?.defaultValue === 'string' ? options.defaultValue : key;
  };

  it('keeps the Chinese qualifier for zh UIs and localizes it elsewhere', () => {
    expect(localizeRouteLabel('Banana 2 · 官方直连', t, 'zh')).toBe('Banana 2 · 官方直连');
    expect(localizeRouteLabel('Banana 2 · 官方直连', t, 'zh-HK')).toBe('Banana 2 · 官方直连');
    expect(localizeRouteLabel('Banana 2 · 官方直连', t, 'en')).toBe('Banana 2 · Official');
    expect(localizeRouteLabel('Banana 2', t, 'en')).toBe('Banana 2');
  });
});

describe('fixed image route pricing', () => {
  it('applies exact prices only to the selected group without mutating the registry', () => {
    const base = mustModel('openai:gpt-image-2');

    const priced = withImageGroupPrices(base, imageGroup({
      fixed_image_prices: { '1k': 0, '2k': 0.12, '4k': 0.15, currency: 'CNY' },
    }));
    expect(priced).not.toBe(base);
    expect(priced.sizes.find(size => size.tier === '1K')).toMatchObject({ price: 0, currency: 'CNY', showPrice: true });
    expect(priced.sizes.find(size => size.tier === '2K')).toMatchObject({ price: 0.12, currency: 'CNY', showPrice: true });
    expect(base.sizes.find(size => size.tier === '1K')?.showPrice).not.toBe(true);
    expect(base.sizes.find(size => size.tier === '1K')?.price).toBeUndefined();

    const otherGroup = withImageGroupPrices(base, imageGroup({
      id: 13,
      fixed_image_prices: { '1k': 0.2, currency: 'CNY' },
    }));
    expect(otherGroup.sizes.find(size => size.tier === '1K')).toMatchObject({ price: 0.2, currency: 'CNY', showPrice: true });
    expect(priced.sizes.find(size => size.tier === '1K')?.price).toBe(0);
  });

  it('defaults legacy fixed prices without a currency to CNY balance units', () => {
    const base = mustModel('openai:gpt-image-2');

    const priced = withImageGroupPrices(base, imageGroup({
      fixed_image_prices: { '1k': 0.08 },
    }));
    expect(priced.sizes.find(size => size.tier === '1K')).toMatchObject({
      price: 0.08,
      currency: 'CNY',
      showPrice: true,
    });
  });

  it('leaves usage-billed groups without any per-tier price', () => {
    const base = mustModel('seedance:seedream-5-0-pro');
    const unchanged = withImageGroupPrices(base, GROUP_24);
    expect(unchanged).toBe(base);
    expect(unchanged.sizes.every(size => size.price === undefined && size.showPrice !== true)).toBe(true);
  });
});
