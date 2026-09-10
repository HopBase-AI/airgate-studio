import { MODEL_FAMILY_LABELS, type ModelFamily } from './modelConfig';
import type { ModelRouteOption, ModelRoutePricing } from './modelRoutes';
import { trimRate } from './modelRoutes';
import type { ModelSelectorStrings } from './modelSelectorStrings';

// 快速筛选（R6）的纯逻辑：搜索 + 系列 chips 只影响可见项，不改变顺序与默认选中。

export const MODEL_FAMILY_FILTER_STORAGE_KEY = 'studio.model_family_filter';

// chips 顺序固定按系列表顺序，只展示当前有可用供给的系列。
const FAMILY_ORDER = Object.keys(MODEL_FAMILY_LABELS) as ModelFamily[];

export function availableModelFamilies(options: ReadonlyArray<ModelRouteOption>): ModelFamily[] {
  const present = new Set(options.map(option => option.family));
  return FAMILY_ORDER.filter(family => present.has(family));
}

function normalizeQuery(query: string): string {
  return query.trim().toLowerCase();
}

// 搜索匹配模型显示名 / 模型 ID / 系列名，不区分大小写。
export function modelRouteMatchesQuery(option: ModelRouteOption, query: string): boolean {
  const needle = normalizeQuery(query);
  if (!needle) return true;
  const haystacks = [option.modelName, option.modelId, MODEL_FAMILY_LABELS[option.family]];
  return haystacks.some(text => text.toLowerCase().includes(needle));
}

export function filterModelRouteOptions(
  options: ReadonlyArray<ModelRouteOption>,
  query: string,
  family: ModelFamily | null,
): ModelRouteOption[] {
  return options.filter(option =>
    (family == null || option.family === family) && modelRouteMatchesQuery(option, query),
  );
}

function isModelFamily(value: string | null): value is ModelFamily {
  return value != null && (FAMILY_ORDER as string[]).includes(value);
}

// chips 状态按会话记忆（sessionStorage）；搜索词不记忆。storage 访问失败一律当作未设置。
export function readFamilyFilter(storage: Pick<Storage, 'getItem'> | null | undefined): ModelFamily | null {
  try {
    const raw = storage?.getItem(MODEL_FAMILY_FILTER_STORAGE_KEY) ?? null;
    return isModelFamily(raw) ? raw : null;
  } catch {
    return null;
  }
}

export function writeFamilyFilter(
  storage: Pick<Storage, 'setItem' | 'removeItem'> | null | undefined,
  family: ModelFamily | null,
): void {
  try {
    if (family == null) storage?.removeItem(MODEL_FAMILY_FILTER_STORAGE_KEY);
    else storage?.setItem(MODEL_FAMILY_FILTER_STORAGE_KEY, family);
  } catch {
    /* ignore */
  }
}

function priceSymbol(currency: string): string {
  return currency.toUpperCase() === 'CNY' ? '¥' : '$';
}

function formatFixedPrice(price: number): string {
  return price.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

// 价格列文案（R4）：固定张价 → 「¥x/张」；否则 → 「按实际消耗 ×倍率」。
export function formatModelRoutePricing(pricing: ModelRoutePricing, s: ModelSelectorStrings): string {
  if (pricing.kind === 'fixed') {
    return s('price_per_image', { price: `${priceSymbol(pricing.currency)}${formatFixedPrice(pricing.price)}` });
  }
  return s('billed_by_usage', { rate: trimRate(pricing.rate) });
}
