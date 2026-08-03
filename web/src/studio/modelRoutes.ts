import type { ImageGroup } from '../api';
import type { ModelConfig } from './modelConfig';

const ROUTE_VALUE_SEPARATOR = '|';

export interface ModelRouteOption {
  value: string;
  label: string;
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
  const parts = [group.name.trim() || `Group ${group.id}`];
  const note = group.note?.trim();
  if (note && !parts[0].includes(note)) parts.push(note);
  if (group.rate_multiplier > 0 && group.effective_rate > 0) {
    parts.push(`×${trimRate(group.effective_rate)}`);
  }
  return parts.join(' · ');
}

export function buildModelRouteOptions(
  models: ModelConfig[],
  groupsForModel: (model: ModelConfig) => ImageGroup[],
): ModelRouteOption[] {
  return models.flatMap(model => groupsForModel(model).map(group => ({
    value: modelRouteOptionValue(model.routeKey, group.id),
    label: `${model.name} · ${formatImageGroupLabel(group)}`,
    modelKey: model.routeKey,
    groupId: group.id,
  })));
}

function trimRate(rate: number): string {
  return Number.isInteger(rate) ? String(rate) : rate.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}
