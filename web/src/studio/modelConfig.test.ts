import { describe, expect, it } from 'vitest';

import {
  IMG2IMG_MODEL_REGISTRY,
  INPAINT_MODEL_REGISTRY,
  MODEL_REGISTRY,
} from './modelConfig';

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
    expect(seedream?.sizes.map(({ value, tier, price }) => ({ value, tier, price }))).toEqual([
      { value: '1024x1024', tier: '1K', price: 0.045 },
      { value: '2048x2048', tier: '2K', price: 0.09 },
    ]);
  });
});
