export interface ImageGroupDiscoveryRoute {
  key: string;
  platform: string;
  model: string;
}

export interface ImageGroupDiscoveryResult<T> {
  key: string;
  status: 'loaded' | 'failed';
  value: T | null;
}

export function startImageGroupDiscovery<T>(
  routes: ImageGroupDiscoveryRoute[],
  load: (route: ImageGroupDiscoveryRoute, signal: AbortSignal) => Promise<T>,
  onResult: (result: ImageGroupDiscoveryResult<T>) => void,
  timeoutMs: number,
): { done: Promise<void>; cancel: () => void } {
  const controllers = new Set<AbortController>();
  let cancelled = false;

  const done = Promise.allSettled(routes.map(async route => {
    const controller = new AbortController();
    controllers.add(controller);
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const value = await load(route, controller.signal);
      if (!cancelled) onResult({ key: route.key, status: 'loaded', value });
    } catch {
      if (!cancelled) onResult({ key: route.key, status: 'failed', value: null });
    } finally {
      clearTimeout(timeout);
      controllers.delete(controller);
    }
  })).then(() => undefined);

  return {
    done,
    cancel: () => {
      cancelled = true;
      controllers.forEach(controller => controller.abort());
      controllers.clear();
    },
  };
}
