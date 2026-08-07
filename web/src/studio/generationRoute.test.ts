import { describe, expect, it } from 'vitest';

import { buildGenerationRouteSnapshot } from './generationRoute';

describe('generation route snapshots', () => {
  it('normalizes and preserves an exact provider, model, group, and size route', () => {
    expect(buildGenerationRouteSnapshot(
      'openai:gpt-image-2',
      ' openai ',
      ' gpt-image-2 ',
      42,
      ' 2048x2048 ',
    )).toEqual({
      routeKey: 'openai:gpt-image-2',
      platform: 'openai',
      model: 'gpt-image-2',
      groupId: 42,
      size: '2048x2048',
    });
  });

  it('derives the canonical route key for persisted legacy task fields', () => {
    expect(buildGenerationRouteSnapshot(undefined, 'gemini', 'gemini-3.1-flash-image', 7, '1024x1024'))
      .toMatchObject({ routeKey: 'gemini:gemini-3.1-flash-image', groupId: 7 });
  });

  it.each([
    ['missing platform', undefined, 'gpt-image-2', 42, '1024x1024'],
    ['missing model', 'openai', undefined, 42, '1024x1024'],
    ['missing group', 'openai', 'gpt-image-2', undefined, '1024x1024'],
    ['zero group', 'openai', 'gpt-image-2', 0, '1024x1024'],
    ['missing size', 'openai', 'gpt-image-2', 42, undefined],
  ])('fails closed for %s', (_name, platform, model, groupId, size) => {
    expect(buildGenerationRouteSnapshot(undefined, platform, model, groupId, size)).toBeNull();
  });

  it('rejects a route key that conflicts with platform and model', () => {
    expect(buildGenerationRouteSnapshot(
      'gemini:gpt-image-2',
      'openai',
      'gpt-image-2',
      42,
      '1024x1024',
    )).toBeNull();
  });
});
