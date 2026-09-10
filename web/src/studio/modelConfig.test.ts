import { describe, expect, it } from 'vitest';

import {
  getModelConfig,
  IMG2IMG_MODEL_REGISTRY,
  INPAINT_MODEL_REGISTRY,
  MODEL_FAMILY_LABELS,
  MODEL_REGISTRY,
  modelRouteKey,
} from './modelConfig';

describe('image model routes', () => {
  it('keeps every route key unique', () => {
    const routeKeys = MODEL_REGISTRY.map(model => model.routeKey);

    expect(new Set(routeKeys).size).toBe(routeKeys.length);
  });

  it('registers OpenAI-compatible and Google official routes for each Gemini model', () => {
    const geminiModelIds = new Set(
      MODEL_REGISTRY
        .filter(model => model.id.startsWith('gemini-'))
        .map(model => model.id),
    );

    for (const modelId of geminiModelIds) {
      expect(getModelConfig(modelRouteKey('openai', modelId))?.platform).toBe('openai');
      expect(getModelConfig(modelRouteKey('gemini', modelId))?.platform).toBe('gemini');
    }
  });

  it('resolves legacy model IDs with an optional preferred platform', () => {
    expect(getModelConfig('gemini-3.1-flash-image')?.platform).toBe('openai');
    expect(getModelConfig('gemini-3.1-flash-image', 'gemini')?.routeKey)
      .toBe('gemini:gemini-3.1-flash-image');
  });
});

describe('model families (R6)', () => {
  it('assigns every registry entry a family with a display label', () => {
    for (const model of MODEL_REGISTRY) {
      expect(MODEL_FAMILY_LABELS[model.family]).toBeTruthy();
    }
    expect(MODEL_REGISTRY.filter(model => model.family === 'gpt-image').map(model => model.id))
      .toEqual(['gpt-image-2', 'gpt-image-2.5-flare', 'gpt-image-2.5-sunburst']);
    expect(MODEL_REGISTRY.filter(model => model.id.startsWith('gemini-')).every(model => model.family === 'banana')).toBe(true);
    expect(getModelConfig('seedance:seedream-5-0-pro')?.family).toBe('seedream');
  });

  it('keeps family labels free of vendor words', () => {
    for (const label of Object.values(MODEL_FAMILY_LABELS)) {
      expect(label).not.toMatch(/azure|adobe|google|openai|byteplus|dreamina/i);
    }
  });
});

describe('GPT Image 2.5', () => {
  it('registers flare as GPT Image 2.5 and sunburst as GPT Image 2.5 Max with the GPT Image 2 contract', () => {
    const base = getModelConfig('openai:gpt-image-2');
    const flare = getModelConfig('openai:gpt-image-2.5-flare');
    const sunburst = getModelConfig('openai:gpt-image-2.5-sunburst');
    expect(base).toBeDefined();
    expect(flare).toMatchObject({ id: 'gpt-image-2.5-flare', name: 'GPT Image 2.5', platform: 'openai', family: 'gpt-image' });
    expect(sunburst).toMatchObject({ id: 'gpt-image-2.5-sunburst', name: 'GPT Image 2.5 Max', platform: 'openai', family: 'gpt-image' });
    for (const model of [flare, sunburst]) {
      expect(model?.sizes).toEqual(base?.sizes);
      expect(model?.defaultSize).toBe(base?.defaultSize);
      expect(model?.supportsImg2Img).toBe(true);
      expect(model?.supportsInpaint).toBe(true);
    }
  });
});

describe('registry pricing (R4)', () => {
  // 每张价只能来自分组的 fixed_image_prices；注册表任何尺寸都不得写死单价。
  it('never hardcodes a per-image price on any registry size', () => {
    for (const model of MODEL_REGISTRY) {
      for (const size of model.sizes) {
        expect(size.price).toBeUndefined();
        expect(size.showPrice).not.toBe(true);
      }
    }
  });

  it('matches the Seedream Pro 1K/2K size contract without a display price', () => {
    const seedream = MODEL_REGISTRY.find(model => model.id === 'seedream-5-0-pro');

    expect(seedream?.defaultSize).toBe('2048x2048');
    expect(seedream?.sizes.map(({ value, tier }) => ({ value, tier }))).toEqual([
      { value: '1024x1024', tier: '1K' },
      { value: '2048x2048', tier: '2K' },
    ]);
  });
});

describe('image editing model capabilities', () => {
  it('keeps every Gemini image model available for image-to-image', () => {
    const geminiModels = MODEL_REGISTRY.filter(model => model.id.startsWith('gemini-'));

    expect(geminiModels.length).toBeGreaterThan(0);
    expect(geminiModels.every(model => model.supportsImg2Img)).toBe(true);
    expect(IMG2IMG_MODEL_REGISTRY.filter(model => model.id.startsWith('gemini-')))
      .toHaveLength(geminiModels.length);
  });

  it('only exposes the GPT Image family in mask-based inpainting', () => {
    expect(INPAINT_MODEL_REGISTRY.map(model => model.id))
      .toEqual(['gpt-image-2', 'gpt-image-2.5-flare', 'gpt-image-2.5-sunburst']);
    expect(INPAINT_MODEL_REGISTRY.every(model => model.supportsInpaint)).toBe(true);
  });

  // 官方能力表把「单/多图生图」列为 Seedream 5.0 Pro 的支持项，「交互编辑」
  // 也只走标注 + 坐标而非 mask，所以图生图必须暴露、局部重绘必须不暴露。
  it('exposes Seedream for image-to-image but never for mask-based inpainting', () => {
    expect(IMG2IMG_MODEL_REGISTRY.some(model => model.id === 'seedream-5-0-pro')).toBe(true);
    expect(INPAINT_MODEL_REGISTRY.some(model => model.id === 'seedream-5-0-pro')).toBe(false);
  });
});
