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

// 工作台不暴露上游渠道:分组名/备注里的渠道品牌词在展示层剔除或中性化。
// 数据层(DB 组名)保持原样——控制台其他页面(密钥/定价)仍按原名展示。
const VENDOR_TOKEN_PATTERN = /\b(?:azure|adobe|byteplus|dreamina)\b/gi;

export function sanitizeVendorTokens(text: string): string {
  return text
    .replace(VENDOR_TOKEN_PATTERN, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s·|,;，；、-]+/, '')
    .trim();
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
  const rawName = group.name.trim() || `Group ${group.id}`;
  // 中转/转售渠道(Azure、Adobe 等)统一显示为中性「专线」,不泄露上游身份。
  if (/azure|adobe/i.test(rawName)) return '专线';
  if (/官方直[连聯]|official\s+direct|google\s+official/i.test(rawName)) return '官方直连';

  const name = imageGroupDisplayName(group);
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
      description: sanitizeVendorTokens(group.note?.trim() ?? '') || undefined,
      modelKey: model.routeKey,
      groupId: group.id,
    };
  }));
}

function imageGroupDisplayName(group: ImageGroup): string {
  return sanitizeVendorTokens(group.name.trim()) || `Group ${group.id}`;
}

// ── Route label localization ────────────────────────────────────────────────
// Group/model display names come straight from backend data (formatModelRouteGroupLabel,
// imageGroupDisplayName, video group names) and routinely carry Chinese tokens like
// “官方直连/海外/国内”. Keep the data-layer helpers above pure and returning the raw
// token — zh/zh-HK UIs must keep showing the original Chinese wording unchanged — and
// only localize known tokens here, at the render layer, where the caller already has a
// `t` function and the active UI language.
type Translate = (key: string, options?: Record<string, unknown>) => string;

const ROUTE_TOKEN_REPLACEMENTS: ReadonlyArray<{ token: string; key: string; defaultValue: string }> = [
  { token: '官方直连', key: 'playground.studio_route_official', defaultValue: 'Official' },
  { token: '专线', key: 'playground.studio_route_dedicated', defaultValue: 'Dedicated' },
  { token: '海外', key: 'playground.studio_route_overseas', defaultValue: 'Global' },
  { token: '国内', key: 'playground.studio_route_domestic', defaultValue: 'CN' },
];

export function localizeRouteLabel(label: string, t: Translate, lang: string): string {
  if ((lang || '').trim().toLowerCase().startsWith('zh')) return label;

  return ROUTE_TOKEN_REPLACEMENTS.reduce(
    (acc, { token, key, defaultValue }) =>
      acc.includes(token) ? acc.split(token).join(t(key, { defaultValue })) : acc,
    label,
  );
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
