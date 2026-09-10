export interface SizeOption {
  value: string;
  label: string;
  tier: '1K' | '2K' | '4K';
  // 每张价只来自分组的 fixed_image_prices（见 modelRoutes.withImageGroupPrices）。
  // 注册表本身不写死任何单价：按实际消耗计费的模型（GPT Image / Seedream）
  // 没有稳定的每张价，写死只会失真。
  price?: number;
  currency?: string;
  aspect?: string;
  showPrice?: boolean;
}

// 模型系列：驱动选择器顶部的「系列」chips 与搜索匹配（见 ModelRouteSelect）。
// 只登记工作坊真正能跑通的系列——空系列不会长出 chip，只会让人以为支持。
// grok 曾经在这里挂着却没有任何模型：组 38 的 grok-imagine-image* 三个型号在
// 网关侧是通的，但它们的档位参数是 resolution（1k/2k）而不是 size，没有 WxH
// 概念；工作坊的任务体只发 size，且 airgate-openai 的 task_image 白名单不含
// resolution，接进来只能永远锁死 1k 并把一个上游不认的 size 键发出去。
// 要上架 Grok 生图，先在插件侧把 resolution 打通（见 PR 说明），再回来加系列。
export type ModelFamily = 'gpt-image' | 'banana' | 'seedream';

// 系列展示名（chips 文案 + 搜索匹配目标）。系列名是产品线名，不含供应商词。
export const MODEL_FAMILY_LABELS: Record<ModelFamily, string> = {
  'gpt-image': 'GPT Image',
  banana: 'Banana',
  seedream: 'Seedream',
};

export interface ModelConfig {
  // routeKey is the stable UI identity. The same upstream model ID can be
  // offered by more than one platform (for example Adobe relay vs Google).
  routeKey: string;
  id: string;
  name: string;
  platform: string;
  family: ModelFamily;
  defaultSize: string;
  sizes: SizeOption[];
  // 图生图只需要参考图；局部重绘还要求上游理解 mask，二者不能共用能力开关。
  supportsImg2Img: boolean;
  supportsInpaint: boolean;
  // 上线日期（YYYY-MM-DD，按 UTC 零点解析）。只服务于「新模型置顶」：窗口内的
  // 模型排在热度榜之前（见 modelRoutes.buildModelRouteOptions）。窗口固定
  // NEW_MODEL_PIN_WINDOW_DAYS 天并自动过期，所以这行不需要谁记得回来清理——
  // 过期后请原样留着，它同时是这个模型的上线时间档案。
  launchedAt?: string;
}

// 新模型置顶窗口（天）。新模型没有 users_30d，纯按热度排会沉到列表底部
// （2026-09-10 GPT Image 2.5 上线当天就是这样），所以窗口内先钉在顶部。
export const NEW_MODEL_PIN_WINDOW_DAYS = 30;

const LAUNCHED_AT_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// isNewlyLaunchedModel 判定模型是否还在置顶窗口内。日期写成未来某天（预告上线）
// 同样置顶；格式不合法一律当没写，不影响排序。
export function isNewlyLaunchedModel(model: ModelConfig, now: number = Date.now()): boolean {
  const launchedAt = model.launchedAt?.trim();
  if (!launchedAt || !LAUNCHED_AT_PATTERN.test(launchedAt)) return false;
  const launched = Date.parse(`${launchedAt}T00:00:00Z`);
  if (Number.isNaN(launched)) return false;
  return now - launched < NEW_MODEL_PIN_WINDOW_DAYS * 24 * 60 * 60 * 1000;
}

// ── Model Registry ─────────────────────────────────────────────────────────
// Add new models here. Each model defines its supported sizes; prices are
// never hardcoded (they come from the selected group's fixed_image_prices).

const GPT_IMAGE_SIZES: SizeOption[] = [
  // 1K (≤1536)
  { value: 'auto',      label: 'Auto',      tier: '1K' },
  { value: '1024x1024', label: '1024×1024',  tier: '1K', aspect: '1:1' },
  { value: '1536x1024', label: '1536×1024',  tier: '1K', aspect: '3:2' },
  { value: '1024x1536', label: '1024×1536',  tier: '1K', aspect: '2:3' },
  { value: '1536x864',  label: '1536×864',   tier: '1K', aspect: '16:9' },
  { value: '864x1536',  label: '864×1536',   tier: '1K', aspect: '9:16' },
  { value: '1536x1152', label: '1536×1152',  tier: '1K', aspect: '4:3' },
  { value: '1152x1536', label: '1152×1536',  tier: '1K', aspect: '3:4' },
  // 2K (1537-2048)
  { value: '2048x2048', label: '2048×2048',  tier: '2K', aspect: '1:1' },
  { value: '2048x1152', label: '2048×1152',  tier: '2K', aspect: '16:9' },
  { value: '1152x2048', label: '1152×2048',  tier: '2K', aspect: '9:16' },
  { value: '2048x1536', label: '2048×1536',  tier: '2K', aspect: '4:3' },
  { value: '1536x2048', label: '1536×2048',  tier: '2K', aspect: '3:4' },
  { value: '2000x1600', label: '2000×1600',  tier: '2K', aspect: '5:4' },
  { value: '1600x2000', label: '1600×2000',  tier: '2K', aspect: '4:5' },
  // 4K (>2048)
  { value: '3840x2160', label: '3840×2160',  tier: '4K', aspect: '16:9' },
  { value: '2160x3840', label: '2160×3840',  tier: '4K', aspect: '9:16' },
  { value: '3360x1440', label: '3360×1440',  tier: '4K', aspect: '21:9' },
  { value: '1440x3360', label: '1440×3360',  tier: '4K', aspect: '9:21' },
];

const GOOGLE_IMAGE_1K_SIZES: SizeOption[] = [
  { value: '1024x1024', label: '1024×1024', tier: '1K', aspect: '1:1' },
  { value: '1536x1024', label: '1536×1024', tier: '1K', aspect: '3:2' },
  { value: '1024x1536', label: '1024×1536', tier: '1K', aspect: '2:3' },
];

const GOOGLE_IMAGE_2K_SIZES: SizeOption[] = [
  { value: '2048x2048', label: '2048×2048', tier: '2K', aspect: '1:1' },
  { value: '2048x1152', label: '2048×1152', tier: '2K', aspect: '16:9' },
  { value: '1152x2048', label: '1152×2048', tier: '2K', aspect: '9:16' },
];

const GOOGLE_IMAGE_4K_SIZES: SizeOption[] = [
  { value: '3840x2160', label: '3840×2160', tier: '4K', aspect: '16:9' },
  { value: '2160x3840', label: '2160×3840', tier: '4K', aspect: '9:16' },
];

const GOOGLE_IMAGE_1K_ONLY_SIZES: SizeOption[] = GOOGLE_IMAGE_1K_SIZES;
const GOOGLE_IMAGE_UP_TO_2K_SIZES: SizeOption[] = [
  ...GOOGLE_IMAGE_1K_SIZES,
  ...GOOGLE_IMAGE_2K_SIZES,
];
const GOOGLE_IMAGE_ALL_SIZES: SizeOption[] = [
  ...GOOGLE_IMAGE_1K_SIZES,
  ...GOOGLE_IMAGE_2K_SIZES,
  ...GOOGLE_IMAGE_4K_SIZES,
];

// Seedream 5.0 Pro 仅支持 1K/2K（BytePlus 官方按 2.61MP 分档）。按实际消耗
// 计费，每张价不在这里写死。
// 上游其实还认 1.5K（gateway-seedance images.go allowedKSizes），但 SizeOption.tier
// 只有 1K/2K/4K 三档、分组固定张价也按这三档取，1536×1536 只能挂到 2K 档上并取错
// 档位价，所以这里不提供 1.5K。
const SEEDREAM_SIZES: SizeOption[] = [
  { value: '1024x1024', label: '1024×1024', tier: '1K', aspect: '1:1' },
  { value: '2048x2048', label: '2048×2048', tier: '2K', aspect: '1:1' },
];

// Seedream 5.0 Lite / 4.5 走上游的大图档：输出像素必须落在 3,686,400 ~ 16,777,216
// 之间（gateway-seedance images.go 的 min4KOutputPixels / max4KOutputPixels，小于
// 下限上游直接 400），所以没有 1K 档——2048×2048（4.19MP）已是下限之上最小的可用
// 尺寸。两者都按实际消耗计费，不写死每张价。
const SEEDREAM_LARGE_SIZES: SizeOption[] = [
  { value: '2048x2048', label: '2048×2048', tier: '2K', aspect: '1:1' },
  { value: '3840x2160', label: '3840×2160', tier: '4K', aspect: '16:9' },
  { value: '2160x3840', label: '2160×3840', tier: '4K', aspect: '9:16' },
];

type GeminiImageModel = Omit<ModelConfig, 'routeKey' | 'platform' | 'family'>;

const GEMINI_IMAGE_MODELS: GeminiImageModel[] = [
  {
    id: 'gemini-2.5-flash-image',
    name: 'Nano Banana',
    defaultSize: '1024x1024',
    sizes: GOOGLE_IMAGE_1K_ONLY_SIZES,
    supportsImg2Img: true,
    supportsInpaint: false,
  },
  {
    id: 'gemini-3-pro-image',
    name: 'Banana Pro',
    defaultSize: '1024x1024',
    sizes: GOOGLE_IMAGE_ALL_SIZES,
    supportsImg2Img: true,
    supportsInpaint: false,
  },
  {
    id: 'gemini-3-pro-image-preview',
    name: 'Banana Pro Preview',
    defaultSize: '1024x1024',
    sizes: GOOGLE_IMAGE_ALL_SIZES,
    supportsImg2Img: true,
    supportsInpaint: false,
  },
  {
    id: 'gemini-3.1-flash-image',
    name: 'Banana 2',
    defaultSize: '1024x1024',
    sizes: GOOGLE_IMAGE_UP_TO_2K_SIZES,
    supportsImg2Img: true,
    supportsInpaint: false,
  },
  {
    id: 'gemini-3.1-flash-image-preview',
    name: 'Banana 2 Preview',
    defaultSize: '1024x1024',
    sizes: GOOGLE_IMAGE_UP_TO_2K_SIZES,
    supportsImg2Img: true,
    supportsInpaint: false,
  },
  {
    id: 'gemini-3.1-flash-lite-image',
    name: 'Banana 2 Lite',
    defaultSize: '1024x1024',
    sizes: GOOGLE_IMAGE_1K_ONLY_SIZES,
    supportsImg2Img: true,
    supportsInpaint: false,
  },
];

export function modelRouteKey(platform: string, modelId: string): string {
  return `${platform}:${modelId}`;
}

function geminiImageRoutes(platform: 'openai' | 'gemini'): ModelConfig[] {
  return GEMINI_IMAGE_MODELS.map(model => ({
    ...model,
    routeKey: modelRouteKey(platform, model.id),
    platform,
    family: 'banana' as const,
  }));
}

// GPT Image 2 / 2.5 全家共用一套尺寸表与编辑能力（图生图 + mask 局部重绘）。
function gptImageRoute(id: string, name: string, launchedAt?: string): ModelConfig {
  return {
    routeKey: modelRouteKey('openai', id),
    id,
    name,
    platform: 'openai',
    family: 'gpt-image',
    defaultSize: 'auto',
    sizes: GPT_IMAGE_SIZES,
    supportsImg2Img: true,
    supportsInpaint: true,
    launchedAt,
  };
}

export const MODEL_REGISTRY: ModelConfig[] = [
  gptImageRoute('gpt-image-2', 'GPT Image 2'),
  // OpenAI-compatible relays (for example Azure) use platform=openai. Google
  // official accounts use platform=gemini. Adobe Image only advertises
  // gpt-image-2, so model-aware group discovery never offers it for Banana.
  ...geminiImageRoutes('openai'),
  ...geminiImageRoutes('gemini'),
  {
    routeKey: modelRouteKey('seedance', 'seedream-5-0-pro'),
    id: 'seedream-5-0-pro',
    name: 'Seedream 5.0 Pro',
    platform: 'seedance',
    family: 'seedream',
    defaultSize: '2048x2048',
    sizes: SEEDREAM_SIZES,
    // 官方能力表：Seedream 5.0 Pro 支持单/多图生图（参考图走 image 数组）。
    // 但它不吃传统 mask——官方的局部编辑靠「参考图上的标注 + prompt 里的
    // <point>/<bbox> 坐标」表达，与 gateway-seedance images.go 的拒绝口径一致，
    // 所以 inpaint 面板继续不暴露它。
    supportsImg2Img: true,
    supportsInpaint: false,
  },
  // Seedream 5.0 Lite / 4.5 与 5.0 Pro 同在组 24，能力口径同样来自 gateway-seedance：
  // 支持参考图（img2img），不吃传统 mask（inpaint 面板不暴露）。上游对这两个型号还
  // 收窄了 output_format / optimize 模式，工作坊两者都不发，因此不影响可用尺寸。
  {
    routeKey: modelRouteKey('seedance', 'seedream-5-0-lite'),
    id: 'seedream-5-0-lite',
    name: 'Seedream 5.0 Lite',
    platform: 'seedance',
    family: 'seedream',
    defaultSize: '2048x2048',
    sizes: SEEDREAM_LARGE_SIZES,
    supportsImg2Img: true,
    supportsInpaint: false,
  },
  {
    routeKey: modelRouteKey('seedance', 'seedream-4-5'),
    id: 'seedream-4-5',
    name: 'Seedream 4.5',
    platform: 'seedance',
    family: 'seedream',
    defaultSize: '2048x2048',
    sizes: SEEDREAM_LARGE_SIZES,
    supportsImg2Img: true,
    supportsInpaint: false,
  },
  // GPT Image 2.5：flare = 标准档，sunburst = Max 档；与 GPT Image 2 同在
  // 按实际消耗计费的分组，尺寸表与编辑能力沿用 GPT Image 2。
  gptImageRoute('gpt-image-2.5-flare', 'GPT Image 2.5', '2026-09-10'),
  gptImageRoute('gpt-image-2.5-sunburst', 'GPT Image 2.5 Max', '2026-09-10'),
];

export function getModelConfig(value: string, preferredPlatform?: string): ModelConfig | undefined {
  const normalized = value.trim();
  return MODEL_REGISTRY.find(model => model.routeKey === normalized)
    ?? MODEL_REGISTRY.find(model => model.id === normalized && model.platform === preferredPlatform)
    ?? MODEL_REGISTRY.find(model => model.id === normalized);
}

export function getDefaultModel(): ModelConfig {
  return MODEL_REGISTRY[0];
}

export const IMG2IMG_MODEL_REGISTRY: ModelConfig[] = MODEL_REGISTRY.filter(m => m.supportsImg2Img);
export const INPAINT_MODEL_REGISTRY: ModelConfig[] = MODEL_REGISTRY.filter(m => m.supportsInpaint);

export function getSizeOption(model: ModelConfig, sizeValue: string): SizeOption | undefined {
  return model.sizes.find(s => s.value === sizeValue);
}
