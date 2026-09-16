import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ModelRouteSelect, ModelRouteSelectHeader } from './ModelRouteSelect';
import {
  MODEL_FAMILY_FILTER_STORAGE_KEY,
  availableModelFamilies,
  filterModelRouteOptions,
  formatModelRoutePricing,
  isDiscountedModelRoutePricing,
  readFamilyFilter,
  writeFamilyFilter,
} from './modelRouteFilter';
import type { ModelRouteOption } from './modelRoutes';
import { modelSelectorStringsFor } from './modelSelectorStrings';

function option(overrides: Partial<ModelRouteOption> & Pick<ModelRouteOption, 'modelName' | 'modelId' | 'family'>): ModelRouteOption {
  const groupId = overrides.groupId ?? 1;
  const channel = overrides.channel ?? 'standard';
  const label = overrides.label ?? (channel === 'official' ? `${overrides.modelName} · 官方直连` : overrides.modelName);
  return {
    value: `openai:${overrides.modelId}|${groupId}`,
    label,
    modelKey: `openai:${overrides.modelId}`,
    groupId,
    channel,
    pricing: { kind: 'rate', rate: 0.75 },
    ...overrides,
  };
}

// 与规范 §3 效果稿同一份候选（顺序即热度/注册表顺序，筛选不得改变）。
const OPTIONS: ModelRouteOption[] = [
  option({ modelName: 'GPT Image 2', modelId: 'gpt-image-2', family: 'gpt-image', groupId: 15 }),
  option({ modelName: 'Seedream 5.0 Pro', modelId: 'seedream-5-0-pro', family: 'seedream', groupId: 24, pricing: { kind: 'rate', rate: 0.68 } }),
  option({ modelName: 'Banana Pro', modelId: 'gemini-3-pro-image', family: 'banana', groupId: 18, pricing: { kind: 'fixed', price: 0.06, currency: 'USD' } }),
  option({ modelName: 'Banana Pro', modelId: 'gemini-3-pro-image', family: 'banana', groupId: 34, channel: 'official', pricing: { kind: 'rate', rate: 0.7 } }),
  option({ modelName: 'Nano Banana', modelId: 'gemini-2.5-flash-image', family: 'banana', groupId: 18, pricing: { kind: 'fixed', price: 0.06, currency: 'USD' } }),
  option({ modelName: 'gpt-image-2.5-flare', modelId: 'gpt-image-2.5-flare', family: 'gpt-image', groupId: 15 }),
  option({ modelName: 'gpt-image-2.5-sunburst', modelId: 'gpt-image-2.5-sunburst', family: 'gpt-image', groupId: 15 }),
];

class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null { return this.store.get(key) ?? null; }
  setItem(key: string, value: string): void { this.store.set(key, value); }
  removeItem(key: string): void { this.store.delete(key); }
}

describe('model route filtering (R6)', () => {
  it('lists only families that currently have an offering, in registry family order', () => {
    expect(availableModelFamilies(OPTIONS)).toEqual(['gpt-image', 'banana', 'seedream']);
    expect(availableModelFamilies(OPTIONS.filter(o => o.family === 'banana'))).toEqual(['banana']);
    expect(availableModelFamilies([])).toEqual([]);
  });

  it('matches the model display name, model ID and family name case-insensitively', () => {
    expect(filterModelRouteOptions(OPTIONS, 'BANANA', null).map(o => o.label))
      .toEqual(['Banana Pro', 'Banana Pro · 官方直连', 'Nano Banana']);
    expect(filterModelRouteOptions(OPTIONS, 'gpt-image-2.5', null).map(o => o.modelId))
      .toEqual(['gpt-image-2.5-flare', 'gpt-image-2.5-sunburst']);
    expect(filterModelRouteOptions(OPTIONS, 'gpt image', null).map(o => o.label))
      .toEqual(['GPT Image 2', 'gpt-image-2.5-flare', 'gpt-image-2.5-sunburst']);
    expect(filterModelRouteOptions(OPTIONS, '  seedream ', null).map(o => o.label))
      .toEqual(['Seedream 5.0 Pro']);
  });

  it('does not match on the qualifier or group data', () => {
    expect(filterModelRouteOptions(OPTIONS, '官方直连', null)).toEqual([]);
    expect(filterModelRouteOptions(OPTIONS, '34', null)).toEqual([]);
  });

  it('applies the family chip and the search together without reordering', () => {
    expect(filterModelRouteOptions(OPTIONS, '', 'banana').map(o => o.value))
      .toEqual(OPTIONS.filter(o => o.family === 'banana').map(o => o.value));
    expect(filterModelRouteOptions(OPTIONS, 'pro', 'banana').map(o => o.label))
      .toEqual(['Banana Pro', 'Banana Pro · 官方直连']);
    expect(filterModelRouteOptions(OPTIONS, 'pro', 'gpt-image')).toEqual([]);
    expect(filterModelRouteOptions(OPTIONS, '', null)).toEqual(OPTIONS);
  });

  it('remembers the family chip in sessionStorage and ignores unknown values', () => {
    const storage = new MemoryStorage();
    expect(readFamilyFilter(storage)).toBeNull();

    writeFamilyFilter(storage, 'banana');
    expect(storage.getItem(MODEL_FAMILY_FILTER_STORAGE_KEY)).toBe('banana');
    expect(readFamilyFilter(storage)).toBe('banana');

    writeFamilyFilter(storage, null);
    expect(storage.getItem(MODEL_FAMILY_FILTER_STORAGE_KEY)).toBeNull();

    storage.setItem(MODEL_FAMILY_FILTER_STORAGE_KEY, 'not-a-family');
    expect(readFamilyFilter(storage)).toBeNull();
    expect(readFamilyFilter(null)).toBeNull();
    expect(readFamilyFilter({ getItem: () => { throw new Error('blocked'); } })).toBeNull();
  });
});

describe('model route price column (R4)', () => {
  // USD 账本：倍率即折数比例（0.75 = 7.5 折），固定价缺省 $，API 明示 CNY 才是 ¥。
  it('renders fixed prices as per-image and usage billing as the discount off the official price', () => {
    const zh = modelSelectorStringsFor('zh-CN');
    expect(formatModelRoutePricing({ kind: 'fixed', price: 0.045, currency: 'USD' }, zh)).toBe('$0.045/张');
    expect(formatModelRoutePricing({ kind: 'fixed', price: 0.4, currency: 'CNY' }, zh)).toBe('¥0.4/张');
    expect(formatModelRoutePricing({ kind: 'rate', rate: 0.75 }, zh)).toBe('约 7.5 折');
    expect(formatModelRoutePricing({ kind: 'rate', rate: 0.7 }, zh)).toBe('约 7.0 折');

    const en = modelSelectorStringsFor('en-US');
    expect(formatModelRoutePricing({ kind: 'fixed', price: 0.4, currency: 'CNY' }, en)).toBe('¥0.4/image');
    expect(formatModelRoutePricing({ kind: 'fixed', price: 0.045, currency: 'USD' }, en)).toBe('$0.045/image');
    expect(formatModelRoutePricing({ kind: 'rate', rate: 0.75 }, en)).toBe('≈25% off');

    expect(formatModelRoutePricing({ kind: 'rate', rate: 0.75 }, modelSelectorStringsFor('zh-HK'))).toBe('約 7.5 折');
    expect(formatModelRoutePricing({ kind: 'rate', rate: 0.75 }, modelSelectorStringsFor('ja'))).toBe('約25%オフ');
    expect(formatModelRoutePricing({ kind: 'rate', rate: 0.75 }, modelSelectorStringsFor('es'))).toBe('≈25% de descuento');
  });

  it('never shows the raw multiplier: official price at or above 10 折, nothing for an invalid rate', () => {
    const zh = modelSelectorStringsFor('zh');
    expect(formatModelRoutePricing({ kind: 'rate', rate: 1 }, zh)).toBe('官方价');
    expect(formatModelRoutePricing({ kind: 'rate', rate: 0.999 }, zh)).toBe('官方价');
    expect(formatModelRoutePricing({ kind: 'rate', rate: 1.2 }, zh)).toBe('官方价 ×1.2');
    expect(formatModelRoutePricing({ kind: 'rate', rate: 0.05 }, zh)).toBe('约 0.50 折');
    expect(formatModelRoutePricing({ kind: 'rate', rate: 0 }, zh)).toBe('');
  });

  it('styles only discounted usage billing as a discount badge', () => {
    expect(isDiscountedModelRoutePricing({ kind: 'rate', rate: 0.75 })).toBe(true);
    expect(isDiscountedModelRoutePricing({ kind: 'rate', rate: 1 })).toBe(false);
    expect(isDiscountedModelRoutePricing({ kind: 'rate', rate: 0 })).toBe(false);
    expect(isDiscountedModelRoutePricing({ kind: 'fixed', price: 0.4, currency: 'CNY' })).toBe(false);
  });
});

describe('ModelRouteSelect rendering', () => {
  it('renders the search box and one chip per available family plus 全部', () => {
    const html = renderToStaticMarkup(
      <ModelRouteSelectHeader
        query=""
        onQueryChange={() => undefined}
        families={availableModelFamilies(OPTIONS)}
        family="banana"
        onFamilyChange={() => undefined}
        strings={modelSelectorStringsFor('zh')}
      />,
    );

    expect(html).toContain('placeholder="搜模型,如 banana / gpt-image-2.5 / seedream"');
    expect(html.match(/studio-model-family-chip/g)).toHaveLength(4);
    expect(html).toContain('>全部<');
    expect(html).toContain('data-family="banana"');
    expect(html).toContain('data-family="gpt-image"');
    expect(html).toContain('data-family="seedream"');
    expect(html).toMatch(/aria-pressed="true"[^>]*data-family="banana"/);
  });

  it('shows the selected offering on the trigger even when the current list is filtered', () => {
    const html = renderToStaticMarkup(
      <ModelRouteSelect
        value="openai:gemini-3-pro-image|34"
        options={OPTIONS}
        onChange={() => undefined}
        compact
      />,
    );

    expect(html).toContain('Banana Pro · Official');
    expect(html).toContain('约 7.0 折');
    expect(html).not.toContain('×0.7');
    expect(html).not.toContain('$0.06');
  });
});
