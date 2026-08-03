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
  const parts = imageGroupLabelParts(group);
  const fixedPriceSummary = formatFixedImagePriceSummary(group);
  if (fixedPriceSummary) {
    parts.push(fixedPriceSummary);
  } else if (group.rate_multiplier > 0 && group.effective_rate > 0) {
    parts.push(`×${trimRate(group.effective_rate)}`);
  }
  return parts.join(' · ');
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

// A route option may show exact per-resolution prices, but a generic group
// multiplier is not itself an image price and must not be presented as one.
export function formatModelRouteGroupLabel(group: ImageGroup): string {
  const parts = imageGroupLabelParts(group);
  const fixedPriceSummary = formatFixedImagePriceSummary(group);
  if (fixedPriceSummary) parts.push(fixedPriceSummary);
  return parts.join(' · ');
}

export function buildModelRouteOptions(
  models: ModelConfig[],
  groupsForModel: (model: ModelConfig) => ImageGroup[],
): ModelRouteOption[] {
  return models.flatMap(model => groupsForModel(model).map(group => ({
    value: modelRouteOptionValue(model.routeKey, group.id),
    label: `${model.name} · ${formatModelRouteGroupLabel(group)}`,
    modelKey: model.routeKey,
    groupId: group.id,
  })));
}

function imageGroupLabelParts(group: ImageGroup): string[] {
  const parts = [group.name.trim() || `Group ${group.id}`];
  const note = group.note?.trim();
  if (note && !parts[0].includes(note)) parts.push(note);
  return parts;
}

function trimRate(rate: number): string {
  return Number.isInteger(rate) ? String(rate) : rate.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

function formatFixedImagePriceSummary(group: ImageGroup): string {
  const prices = group.fixed_image_prices;
  if (!prices) return '';
  const currency = prices.currency?.trim() || 'CNY';
  const symbol = currency.toUpperCase() === 'CNY' ? '¥' : '$';
  const entries = (['1k', '2k', '4k'] as const).flatMap(tier => {
    const price = prices[tier];
    return typeof price === 'number' && Number.isFinite(price) && price >= 0
      ? [`${tier.toUpperCase()} ${symbol}${trimRate(price)}`]
      : [];
  });
  return entries.join(' / ');
}
