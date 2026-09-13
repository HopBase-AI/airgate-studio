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

// 倍率 → 折数的汇率，与 core 的 DEFAULT_QUOTE_FX（web/src/shared/quoteMath.ts）同值：
// 倍率 = 每消耗官方 $1 扣多少 ¥，折 = 倍率 ÷ 汇率。6.8 是结算常数，插件拿不到站点设置，
// 这里不另起口径。
export const OFFICIAL_PRICE_FX = 6.8;

// 按实际消耗计费的供给相对官方价的比例（0.75 = 7.5 折）；倍率无效返回 null。
export function modelRoutePriceRatio(pricing: ModelRoutePricing): number | null {
  if (pricing.kind !== 'rate' || !(pricing.rate > 0)) return null;
  return pricing.rate / OFFICIAL_PRICE_FX;
}

// 折数展示与密钥页分组下拉一致：不足 1 折保留两位，其余一位（0.75 → 7.5）。
function formatZhe(ratio: number): string {
  const value = ratio * 10;
  return value < 1 ? value.toFixed(2) : value.toFixed(1);
}

// 与官方价差在半个百分点内按官方价展示，避免 6.79 这类倍率显示成「约 10.0 折」。
const OFFICIAL_PRICE_TOLERANCE = 0.005;

export function isDiscountedModelRoutePricing(pricing: ModelRoutePricing): boolean {
  const ratio = modelRoutePriceRatio(pricing);
  return ratio != null && ratio < 1 - OFFICIAL_PRICE_TOLERANCE;
}

// 价格列文案（R4）：固定张价 → 「¥x/张」；按实际消耗 → 折数标签「约 7.5 折」，
// 与密钥页分组下拉同一口径——倍率本身（×5.1）用户读不懂，不再露出。
// 不低于官方价时显示「官方价」或「官方价 ×1.2」。
export function formatModelRoutePricing(pricing: ModelRoutePricing, s: ModelSelectorStrings): string {
  if (pricing.kind === 'fixed') {
    return s('price_per_image', { price: `${priceSymbol(pricing.currency)}${formatFixedPrice(pricing.price)}` });
  }
  const ratio = modelRoutePriceRatio(pricing);
  if (ratio == null) return '';
  if (ratio < 1 - OFFICIAL_PRICE_TOLERANCE) {
    return s('discount', { zhe: formatZhe(ratio), off: String(Math.round((1 - ratio) * 100)) });
  }
  if (ratio <= 1 + OFFICIAL_PRICE_TOLERANCE) return s('official_price');
  return s('above_official_price', { multiple: trimRate(Math.round(ratio * 100) / 100) });
}
