import type { ImageGroup } from '../api';
import type { ModelConfig } from './modelConfig';

const ROUTE_VALUE_SEPARATOR = '|';

export interface ModelRouteOption {
  value: string;
  label: string;
  description?: string;
  modelKey: string;
  groupId: number;
}

export function modelRouteOptionValue(modelKey: string, groupId: number): string {
  return `${modelKey}${ROUTE_VALUE_SEPARATOR}${groupId}`;
}

export function parseModelRouteOptionValue(value: string): { modelKey: string; groupId: number } | null {
  const separatorIndex = value.lastIndexOf(ROUTE_VALUE_SEPARATOR);
  if (separatorIndex <= 0) return null;
  const modelKey = value.slice(0, separatorIndex);
  const rawGroupId = value.slice(separatorIndex + 1);
  if (!modelKey || !/^[1-9]\d*$/.test(rawGroupId)) return null;
  const groupId = Number(rawGroupId);
  if (!Number.isSafeInteger(groupId)) return null;
  return { modelKey, groupId };
}

export function formatImageGroupLabel(group: ImageGroup): string {
  const parts = [imageGroupDisplayName(group)];
  if (group.rate_multiplier > 0 && group.effective_rate > 0) {
    parts.push(`×${trimRate(group.effective_rate)}`);
  }
  return parts.join(' · ');
}

// Keep route labels compact. Group notes can contain full model catalogs and
// pricing prose; CustomSelect exposes that text as a tooltip instead of putting
// it in every option. The generic effective rate is also not an image price
// when a group uses per-resolution fixed pricing.
export function formatModelRouteGroupLabel(group: ImageGroup): string {
  return imageGroupDisplayName(group);
}

export function buildModelRouteOptions(
  models: ModelConfig[],
  groupsForModel: (model: ModelConfig) => ImageGroup[],
): ModelRouteOption[] {
  return models.flatMap(model => groupsForModel(model).map(group => ({
    value: modelRouteOptionValue(model.routeKey, group.id),
    label: `${model.name} · ${formatModelRouteGroupLabel(group)}`,
    description: group.note?.trim() || undefined,
    modelKey: model.routeKey,
    groupId: group.id,
  })));
}

function imageGroupDisplayName(group: ImageGroup): string {
  return group.name.trim() || `Group ${group.id}`;
}

function trimRate(rate: number): string {
  return Number.isInteger(rate) ? String(rate) : rate.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}
