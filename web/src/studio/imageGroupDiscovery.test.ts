import { afterEach, describe, expect, it, vi } from 'vitest';

import { startImageGroupDiscovery } from './imageGroupDiscovery';

afterEach(() => vi.useRealTimers());

describe('image group discovery', () => {
  it('publishes healthy routes immediately and isolates failures and timeouts', async () => {
    vi.useFakeTimers();
    const results: Array<{ key: string; status: string; value: string[] | null }> = [];
    const discovery = startImageGroupDiscovery<string[]>(
      [
        { key: 'healthy', platform: 'openai', model: 'gpt-image-2' },
        { key: 'failed', platform: 'gemini', model: 'bad-model' },
        { key: 'hung', platform: 'gemini', model: 'slow-model' },
      ],
      (route, signal) => {
        if (route.key === 'healthy') return Promise.resolve(['group-42']);
        if (route.key === 'failed') return Promise.reject(new Error('upstream unavailable'));
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
        });
      },
      result => results.push(result),
      100,
    );

    await vi.advanceTimersByTimeAsync(0);
    expect(results).toEqual(expect.arrayContaining([
      { key: 'healthy', status: 'loaded', value: ['group-42'] },
      { key: 'failed', status: 'failed', value: null },
    ]));
    expect(results.some(result => result.key === 'hung')).toBe(false);

    await vi.advanceTimersByTimeAsync(100);
    await discovery.done;
    expect(results).toContainEqual({ key: 'hung', status: 'failed', value: null });
    expect(results.find(result => result.key === 'healthy')?.value).toEqual(['group-42']);
  });

  it('does not publish late results after cancellation', async () => {
    let resolveLoad: ((value: string[]) => void) | undefined;
    const results: unknown[] = [];
    const discovery = startImageGroupDiscovery<string[]>(
      [{ key: 'route', platform: 'openai', model: 'gpt-image-2' }],
      () => new Promise(resolve => { resolveLoad = resolve; }),
      result => results.push(result),
      1000,
    );

    discovery.cancel();
    resolveLoad?.(['group-42']);
    await discovery.done;
    expect(results).toEqual([]);
  });
});
