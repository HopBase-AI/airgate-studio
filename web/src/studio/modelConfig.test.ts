import { describe, expect, it } from 'vitest';

import {
  getModelConfig,
  IMG2IMG_MODEL_REGISTRY,
  INPAINT_MODEL_REGISTRY,
  isNewlyLaunchedModel,
  MODEL_FAMILY_LABELS,
  MODEL_REGISTRY,
  modelRouteKey,
  NEW_MODEL_PIN_WINDOW_DAYS,
  type ModelConfig,
  type ModelFamily,
} from './modelConfig';

function mustModel(routeKey: string): ModelConfig {
  const model = getModelConfig(routeKey);
  if (!model) throw new Error(`expected ${routeKey} in registry`);
  return model;
}

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

  // 空系列只会长出一个点不出东西的 chip（grok 就是这么来的：组 38 有三个
  // grok-imagine-image* 型号，但它们按 resolution 分档、没有 WxH，工作坊发不出去）。
  it('never declares a family without a model behind it', () => {
    const families = new Set(MODEL_REGISTRY.map(model => model.family));

    for (const family of Object.keys(MODEL_FAMILY_LABELS) as ModelFamily[]) {
      expect(families.has(family)).toBe(true);
    }
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

describe('Seedream 5.0 Lite / 4.5', () => {
  // 上游（gateway-seedance images.go）对这两个型号的输出像素下限是 min4KOutputPixels
  // = 3,686,400，上限 max4KOutputPixels = 16,777,216；低于下限上游直接 400，
  // 所以注册表不能给它们 1K 档。
  const MIN_PIXELS = 3_686_400;
  const MAX_PIXELS = 16_777_216;

  it.each(['seedream-5-0-lite', 'seedream-4-5'])('registers %s within the upstream pixel window', id => {
    const model = mustModel(`seedance:${id}`);

    expect(model).toMatchObject({
      id,
      platform: 'seedance',
      family: 'seedream',
      defaultSize: '2048x2048',
      // 与 5.0 Pro 同源：支持参考图，但上游拒绝传统 mask，所以不进局部重绘面板。
      supportsImg2Img: true,
      supportsInpaint: false,
    });
    expect(model.sizes.map(size => size.value)).toEqual(['2048x2048', '3840x2160', '2160x3840']);
    for (const size of model.sizes) {
      const [width, height] = size.value.split('x').map(Number);
      expect(width * height).toBeGreaterThanOrEqual(MIN_PIXELS);
      expect(width * height).toBeLessThanOrEqual(MAX_PIXELS);
    }
    expect(model.sizes.some(size => size.value === model.defaultSize)).toBe(true);
  });

  it('keeps them out of mask-based inpainting and inside image-to-image', () => {
    for (const id of ['seedream-5-0-lite', 'seedream-4-5']) {
      expect(IMG2IMG_MODEL_REGISTRY.some(model => model.id === id)).toBe(true);
      expect(INPAINT_MODEL_REGISTRY.some(model => model.id === id)).toBe(false);
    }
  });
});

describe('new model pin marker (launchedAt)', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const LAUNCH = Date.parse('2026-09-10T00:00:00Z');

  it('marks the GPT Image 2.5 pair as newly launched on launch day', () => {
    for (const routeKey of ['openai:gpt-image-2.5-flare', 'openai:gpt-image-2.5-sunburst']) {
      const model = mustModel(routeKey);
      expect(model.launchedAt).toBe('2026-09-10');
      expect(isNewlyLaunchedModel(model, LAUNCH)).toBe(true);
    }
  });

  it('expires the pin after the fixed window, leaving the date in place as a record', () => {
    const flare = mustModel('openai:gpt-image-2.5-flare');
    const windowMs = NEW_MODEL_PIN_WINDOW_DAYS * DAY;

    expect(isNewlyLaunchedModel(flare, LAUNCH + windowMs - 1)).toBe(true);
    expect(isNewlyLaunchedModel(flare, LAUNCH + windowMs)).toBe(false);
    expect(isNewlyLaunchedModel(flare, LAUNCH + 10 * windowMs)).toBe(false);
    // 过期后仍保留日期：它是上线时间档案，不需要谁回来清理。
    expect(flare.launchedAt).toBe('2026-09-10');
  });

  it('pins a model announced with a future launch date', () => {
    const flare = mustModel('openai:gpt-image-2.5-flare');

    expect(isNewlyLaunchedModel(flare, LAUNCH - 7 * DAY)).toBe(true);
  });

  it('treats a missing or malformed date as not new', () => {
    const base = mustModel('openai:gpt-image-2');

    expect(base.launchedAt).toBeUndefined();
    expect(isNewlyLaunchedModel(base, LAUNCH)).toBe(false);
    expect(isNewlyLaunchedModel({ ...base, launchedAt: '2026/09/10' }, LAUNCH)).toBe(false);
    expect(isNewlyLaunchedModel({ ...base, launchedAt: '  ' }, LAUNCH)).toBe(false);
  });

  it('only pins the two models the team marked, never the whole registry', () => {
    const pinned = MODEL_REGISTRY.filter(model => isNewlyLaunchedModel(model, LAUNCH)).map(model => model.id);

    expect(pinned).toEqual(['gpt-image-2.5-flare', 'gpt-image-2.5-sunburst']);
  });
});
