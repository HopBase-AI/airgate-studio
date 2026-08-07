import { modelRouteKey } from './modelConfig';
import type { GenerationRouteSnapshot } from './types';

export function buildGenerationRouteSnapshot(
  routeKey: string | undefined,
  platform: string | undefined,
  model: string | undefined,
  groupId: number | undefined,
  size: string | undefined,
): GenerationRouteSnapshot | null {
  const normalizedPlatform = platform?.trim() ?? '';
  const normalizedModel = model?.trim() ?? '';
  const normalizedSize = size?.trim() ?? '';
  if (!normalizedPlatform || !normalizedModel || !normalizedSize || !groupId || groupId <= 0) return null;

  const expectedRouteKey = modelRouteKey(normalizedPlatform, normalizedModel);
  const normalizedRouteKey = routeKey?.trim() || expectedRouteKey;
  if (normalizedRouteKey !== expectedRouteKey) return null;

  return {
    routeKey: normalizedRouteKey,
    platform: normalizedPlatform,
    model: normalizedModel,
    groupId,
    size: normalizedSize,
  };
}
