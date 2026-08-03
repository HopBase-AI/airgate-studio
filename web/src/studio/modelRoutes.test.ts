import { describe, expect, it } from 'vitest';

import type { ImageGroup } from '../api';
import { getModelConfig } from './modelConfig';
import {
  buildModelRouteOptions,
  formatImageGroupLabel,
  formatModelRouteGroupLabel,
  modelRouteOptionValue,
  parseModelRouteOptionValue,
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
    expect(formatImageGroupLabel(imageGroup({ rate_multiplier: 0, effective_rate: 1 })))
      .toBe('Adobe');
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

  it('builds distinct Adobe and Google official options for the same upstream model ID', () => {
    const adobe = getModelConfig('openai:gemini-3.1-flash-image');
    const official = getModelConfig('gemini:gemini-3.1-flash-image');
    expect(adobe).toBeDefined();
    expect(official).toBeDefined();
    if (!adobe || !official) throw new Error('expected both Gemini routes');

    const options = buildModelRouteOptions(
      [adobe, official],
      model => model.platform === 'openai'
        ? [imageGroup()]
        : [imageGroup({ id: 24, name: 'Google 官方', platform: 'gemini', effective_rate: 1 })],
    );

    expect(options.map(option => option.value)).toEqual([
      'openai:gemini-3.1-flash-image|12',
      'gemini:gemini-3.1-flash-image|24',
    ]);
    expect(options.map(option => option.label)).toEqual([
      'Banana 2 · Adobe',
      'Banana 2 · Google 官方',
    ]);
  });
});
