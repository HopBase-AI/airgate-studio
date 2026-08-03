import { describe, expect, it } from 'vitest';

import {
  getModelConfig,
  IMG2IMG_MODEL_REGISTRY,
  INPAINT_MODEL_REGISTRY,
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

describe('image editing model capabilities', () => {
  it('keeps every Gemini image model available for image-to-image', () => {
    const geminiModels = MODEL_REGISTRY.filter(model => model.id.startsWith('gemini-'));

    expect(geminiModels.length).toBeGreaterThan(0);
    expect(geminiModels.every(model => model.supportsImg2Img)).toBe(true);
    expect(IMG2IMG_MODEL_REGISTRY.filter(model => model.id.startsWith('gemini-')))
      .toHaveLength(geminiModels.length);
  });

  it('does not expose Gemini models in mask-based inpainting', () => {
    expect(INPAINT_MODEL_REGISTRY.map(model => model.id)).toEqual(['gpt-image-2']);
    expect(INPAINT_MODEL_REGISTRY.every(model => model.supportsInpaint)).toBe(true);
  });

  it('keeps Seedream out of editing modes', () => {
    expect(IMG2IMG_MODEL_REGISTRY.some(model => model.id === 'seedream-5-0-pro')).toBe(false);
    expect(INPAINT_MODEL_REGISTRY.some(model => model.id === 'seedream-5-0-pro')).toBe(false);
  });

  it('matches the Seedream Pro 1K/2K size and pricing contract', () => {
    const seedream = MODEL_REGISTRY.find(model => model.id === 'seedream-5-0-pro');

    expect(seedream?.defaultSize).toBe('2048x2048');
    expect(seedream?.sizes.map(({ value, tier, price, showPrice }) => ({ value, tier, price, showPrice }))).toEqual([
      { value: '1024x1024', tier: '1K', price: 0.045, showPrice: true },
      { value: '2048x2048', tier: '2K', price: 0.09, showPrice: true },
    ]);
  });
});
