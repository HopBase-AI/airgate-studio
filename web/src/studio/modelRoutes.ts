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
  if (!group.fixed_image_prices && group.rate_multiplier > 0 && group.effective_rate > 0) {
    parts.push(`×${trimRate(group.effective_rate)}`);
  }
  return parts.join(' · ');
}

// Keep route labels compact. Group notes can contain full model catalogs and
// pricing prose; CustomSelect exposes that text as a tooltip instead of putting
// it in every option. The generic effective rate is also not an image price
// when a group uses per-resolution fixed pricing.
export function formatModelRouteGroupLabel(group: ImageGroup): string {
  const name = imageGroupDisplayName(group);
  if (/azure/i.test(name)) return 'Azure';
  if (/官方直[连聯]|official\s+direct|google\s+official/i.test(name)) return '官方直连';
  if (/adobe/i.test(name)) return 'Adobe';

  return name
    .replace(/\s*[（(]?\s*(?:支持)?生图(?:分组)?\s*[)）]?\s*$/u, '')
    .trim() || name;
}

export function withImageGroupPrices(model: ModelConfig, group: ImageGroup | undefined): ModelConfig {
  const prices = group?.fixed_image_prices;
  if (!prices) return model;
  const currency = prices.currency?.trim() || 'CNY';
  let changed = false;
  const sizes = model.sizes.map(size => {
    const key = size.tier.toLowerCase() as '1k' | '2k' | '4k';
    const price = prices[key];
    if (typeof price !== 'number' || !Number.isFinite(price) || price < 0) return size;
    changed = true;
    return { ...size, price, currency, showPrice: true };
  });
  return changed ? { ...model, sizes } : model;
}

export function buildModelRouteOptions(
  models: ModelConfig[],
  groupsForModel: (model: ModelConfig) => ImageGroup[],
): ModelRouteOption[] {
  return models.flatMap(model => groupsForModel(model).map(group => {
    const channel = formatModelRouteGroupLabel(group);
    const label = routeLabelRepeatsModel(model.name, channel)
      ? model.name
      : `${model.name} · ${channel}`;

    return {
      value: modelRouteOptionValue(model.routeKey, group.id),
      label,
      description: group.note?.trim() || undefined,
      modelKey: model.routeKey,
      groupId: group.id,
    };
  }));
}

function imageGroupDisplayName(group: ImageGroup): string {
  return group.name.trim() || `Group ${group.id}`;
}

function routeLabelRepeatsModel(modelName: string, channel: string): boolean {
  const normalize = (value: string) => value
    .toLowerCase()
    .replace(/(\d+)\.0(?=\D|$)/g, '$1')
    .replace(/[^a-z0-9]+/g, '');

  const normalizedModel = normalize(modelName);
  return normalizedModel !== '' && normalizedModel === normalize(channel);
}

function trimRate(rate: number): string {
  return Number.isInteger(rate) ? String(rate) : rate.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}
