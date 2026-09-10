import type { ImageGroup } from '../api';
import { isNewlyLaunchedModel, type ModelConfig, type ModelFamily } from './modelConfig';

const ROUTE_VALUE_SEPARATOR = '|';

// 分组通道（数据契约 §4：plugin_settings.studio.channel）。展示层只认这四个值，
// 其余一律按 standard。
export type ImageGroupChannel = 'standard' | 'official' | 'domestic' | 'overseas';

const KNOWN_CHANNELS: ReadonlySet<string> = new Set<ImageGroupChannel>(['standard', 'official', 'domestic', 'overseas']);

// 行标签限定词是封闭词表（R2）：图像只有「官方直连」带后缀，标准通道不带。
// 视频的 国内 / 海外 由视频分组名走 localizeRouteLabel，不在这里。
const OFFICIAL_QUALIFIER = '官方直连';

// 每个供给的计费口径（R4）：分组配了固定张价 → 1K 档每张价；否则按实际消耗
// 计费，展示分组有效倍率。二者互斥，前端不再有任何写死单价。
export type ModelRoutePricing =
  | { kind: 'fixed'; price: number; currency: string }
  | { kind: 'rate'; rate: number };

export interface ModelRouteOption {
  value: string;
  label: string;
  description?: string;
  modelKey: string;
  groupId: number;
  modelName: string;
  modelId: string;
  family: ModelFamily;
  channel: ImageGroupChannel;
  pricing: ModelRoutePricing;
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
// minimax 同样剔除——产品名一律用「海螺/Hailuo」,与 Banana/Seedance 惯例一致。
// 现在只用于分组 note 的 tooltip 与 GroupSelector / 视频分组名；模型行标签
// 不再从分组名派生（R5：数据层与展示层分离）。
const VENDOR_TOKEN_PATTERN = /\b(?:azure|adobe|byteplus|dreamina|minimax|dashscope)\b/gi;
// 中文渠道词(腾讯/阿里系)没有 \b 词边界,单独剥。
const VENDOR_CJK_PATTERN = /(?:腾讯云|腾讯|騰訊雲|騰訊|阿里云百炼|阿里雲百煉|阿里云|阿里雲|阿里巴巴|阿里|百炼|百煉)/g;

export function sanitizeVendorTokens(text: string): string {
  return text
    .replace(VENDOR_TOKEN_PATTERN, '')
    .replace(VENDOR_CJK_PATTERN, '')
    .replace(/[（(]\s*[)）]/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s·|,;，；、-]+/, '')
    .replace(/[\s·|,;，；、-]+$/, '')
    .trim();
}

export function formatImageGroupLabel(group: ImageGroup): string {
  const parts = [imageGroupDisplayName(group)];
  if (!group.fixed_image_prices && group.rate_multiplier > 0 && group.effective_rate > 0) {
    parts.push(`×${trimRate(group.effective_rate)}`);
  }
  return parts.join(' · ');
}

// imageGroupChannel 读分组通道。权威来源是后端透传的 channel 字段；缺省 standard。
//
// 过渡兜底（待运营补齐 channel 后删除）：core 的 groups.list 目前不透传
// plugin_settings，生产分组还没有 channel 值，只能按已有事实推断：
// 1) platform=gemini 的分组就是 Google 官方账号（注册表同一约定：OpenAI 兼容
//    中继走 platform=openai，Google 官方走 platform=gemini），一律 official——
//    否则组 34「Gemini 生图（Banana 系）」会被当成标准通道，与组 18 的固定价行
//    撞标签、再被去重掉；
// 2) 其次才看分组名里的「官方直连 / official」。
// 两条只产出封闭词表里的值，不会把分组名或平台名带进标签。
export function imageGroupChannel(group: ImageGroup): ImageGroupChannel {
  const raw = (group.channel ?? '').trim().toLowerCase();
  if (raw && KNOWN_CHANNELS.has(raw)) return raw as ImageGroupChannel;
  if ((group.platform ?? '').trim().toLowerCase() === 'gemini') return 'official';
  if (/官方直[连聯]|official/i.test(group.name)) return 'official';
  return 'standard';
}

export function modelRouteQualifier(channel: ImageGroupChannel): string {
  return channel === 'official' ? OFFICIAL_QUALIFIER : '';
}

export function formatModelRouteLabel(model: ModelConfig, group: ImageGroup): string {
  const qualifier = modelRouteQualifier(imageGroupChannel(group));
  return qualifier ? `${model.name} · ${qualifier}` : model.name;
}

// imageGroupPricing 取供给的计费口径：固定张价优先取 1K 档（缺 1K 时退到更高档，
// 保证「有固定价就显示固定价」），否则按实际消耗显示有效倍率。
export function imageGroupPricing(group: ImageGroup): ModelRoutePricing {
  const prices = group.fixed_image_prices;
  if (prices) {
    for (const tier of ['1k', '2k', '4k'] as const) {
      const price = prices[tier];
      if (typeof price === 'number' && Number.isFinite(price) && price >= 0) {
        return { kind: 'fixed', price, currency: prices.currency?.trim() || 'CNY' };
      }
    }
  }
  return { kind: 'rate', rate: group.effective_rate };
}

// compareModelRoutePricing：同模型多供给「价低者在前」（R3）。固定张价与倍率不是
// 同一量纲——固定价的分组排在按量计费之前；同量纲按数值升序。
export function compareModelRoutePricing(a: ModelRoutePricing, b: ModelRoutePricing): number {
  if (a.kind !== b.kind) return a.kind === 'fixed' ? -1 : 1;
  const amount = (pricing: ModelRoutePricing) => (pricing.kind === 'fixed' ? pricing.price : pricing.rate);
  return amount(a) - amount(b);
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

function popularityOf(groups: ImageGroup[]): number | undefined {
  let best: number | undefined;
  for (const group of groups) {
    const users = group.users_30d;
    if (typeof users !== 'number' || !Number.isFinite(users)) continue;
    best = best == null ? users : Math.max(best, users);
  }
  return best;
}

// buildModelRouteOptions 生成选择器候选：一个供给一行（R1，value = routeKey|groupId）。
// - 标签 = 模型名 [· 官方直连]（R2），不解析分组名；
// - 同模型（按显示名）多供给相邻、价低在前；同模型同限定词只留价低的一行（R3）；
// - 新模型（注册表 launchedAt 在置顶窗口内）整体排在最前，彼此按注册表顺序；
// - 其余模型按近 30 天使用人数降序，缺数据的排在有数据的之后、按注册表顺序（R3）。
// now 只为测试可注入，生产按当前时间判断置顶窗口。
export function buildModelRouteOptions(
  models: ModelConfig[],
  groupsForModel: (model: ModelConfig) => ImageGroup[],
  now: number = Date.now(),
): ModelRouteOption[] {
  interface ModelBucket {
    order: number;
    isNew: boolean;
    popularity: number | undefined;
    options: ModelRouteOption[];
  }
  const buckets = new Map<string, ModelBucket>();

  models.forEach((model, index) => {
    const groups = groupsForModel(model);
    if (groups.length === 0) return;
    let bucket = buckets.get(model.name);
    if (!bucket) {
      bucket = { order: index, isNew: false, popularity: undefined, options: [] };
      buckets.set(model.name, bucket);
    }
    // 同名模型可能有多条注册表记录（同模型的不同平台供给），任一条标了上线日期就算新。
    bucket.isNew = bucket.isNew || isNewlyLaunchedModel(model, now);
    const popularity = popularityOf(groups);
    if (popularity != null) {
      bucket.popularity = bucket.popularity == null ? popularity : Math.max(bucket.popularity, popularity);
    }
    for (const group of groups) {
      bucket.options.push({
        value: modelRouteOptionValue(model.routeKey, group.id),
        label: formatModelRouteLabel(model, group),
        description: sanitizeVendorTokens(group.note?.trim() ?? '') || undefined,
        modelKey: model.routeKey,
        groupId: group.id,
        modelName: model.name,
        modelId: model.id,
        family: model.family,
        channel: imageGroupChannel(group),
        pricing: imageGroupPricing(group),
      });
    }
  });

  const ordered = Array.from(buckets.values()).sort((a, b) => {
    // 新模型置顶：零 users_30d 的新品按热度会沉底，用户根本看不到。
    if (a.isNew !== b.isNew) return a.isNew ? -1 : 1;
    if (a.isNew && b.isNew) return a.order - b.order;
    const aHas = a.popularity != null;
    const bHas = b.popularity != null;
    if (aHas && bHas && a.popularity !== b.popularity) return (b.popularity as number) - (a.popularity as number);
    if (aHas !== bHas) return aHas ? -1 : 1;
    return a.order - b.order;
  });

  return ordered.flatMap(bucket => {
    const sorted = [...bucket.options].sort((a, b) => compareModelRoutePricing(a.pricing, b.pricing));
    const seenLabels = new Set<string>();
    return sorted.filter(option => {
      if (seenLabels.has(option.label)) return false;
      seenLabels.add(option.label);
      return true;
    });
  });
}

function imageGroupDisplayName(group: ImageGroup): string {
  return sanitizeVendorTokens(group.name.trim()) || `Group ${group.id}`;
}

// ── Route label localization ────────────────────────────────────────────────
// Route labels carry Chinese qualifier tokens (“官方直连”, and “海外/国内” for video
// group names). Keep the data-layer helpers above pure and returning the raw token —
// zh/zh-HK UIs must keep showing the original Chinese wording unchanged — and only
// localize known tokens here, at the render layer, where the caller already has a
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

export function trimRate(rate: number): string {
  return Number.isInteger(rate) ? String(rate) : rate.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}
