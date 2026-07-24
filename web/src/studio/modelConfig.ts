export interface SizeOption {
  value: string;
  label: string;
  tier: '1K' | '2K' | '4K';
  price: number;
  aspect?: string;
}

export interface ModelConfig {
  id: string;
  name: string;
  platform: string;
  defaultSize: string;
  sizes: SizeOption[];
  // 是否支持图生图/局部重绘（image.edit）。gateway-gemini 当前只实现文生图，
  // Gemini 系模型在编辑类面板中不可选。
  supportsEdit: boolean;
}

// ── Model Registry ─────────────────────────────────────────────────────────
// Add new models here. Each model defines its supported sizes and pricing.

const GPT_IMAGE_SIZES: SizeOption[] = [
  // 1K (≤1536)
  { value: 'auto',      label: 'Auto',      tier: '1K', price: 0.10 },
  { value: '1024x1024', label: '1024×1024',  tier: '1K', price: 0.10, aspect: '1:1' },
  { value: '1536x1024', label: '1536×1024',  tier: '1K', price: 0.10, aspect: '3:2' },
  { value: '1024x1536', label: '1024×1536',  tier: '1K', price: 0.10, aspect: '2:3' },
  { value: '1536x864',  label: '1536×864',   tier: '1K', price: 0.10, aspect: '16:9' },
  { value: '864x1536',  label: '864×1536',   tier: '1K', price: 0.10, aspect: '9:16' },
  { value: '1536x1152', label: '1536×1152',  tier: '1K', price: 0.10, aspect: '4:3' },
  { value: '1152x1536', label: '1152×1536',  tier: '1K', price: 0.10, aspect: '3:4' },
  // 2K (1537-2048)
  { value: '2048x2048', label: '2048×2048',  tier: '2K', price: 0.20, aspect: '1:1' },
  { value: '2048x1152', label: '2048×1152',  tier: '2K', price: 0.20, aspect: '16:9' },
  { value: '1152x2048', label: '1152×2048',  tier: '2K', price: 0.20, aspect: '9:16' },
  { value: '2048x1536', label: '2048×1536',  tier: '2K', price: 0.20, aspect: '4:3' },
  { value: '1536x2048', label: '1536×2048',  tier: '2K', price: 0.20, aspect: '3:4' },
  { value: '2000x1600', label: '2000×1600',  tier: '2K', price: 0.20, aspect: '5:4' },
  { value: '1600x2000', label: '1600×2000',  tier: '2K', price: 0.20, aspect: '4:5' },
  // 4K (>2048)
  { value: '3840x2160', label: '3840×2160',  tier: '4K', price: 0.40, aspect: '16:9' },
  { value: '2160x3840', label: '2160×3840',  tier: '4K', price: 0.40, aspect: '9:16' },
  { value: '3360x1440', label: '3360×1440',  tier: '4K', price: 0.40, aspect: '21:9' },
  { value: '1440x3360', label: '1440×3360',  tier: '4K', price: 0.40, aspect: '9:21' },
];

const GOOGLE_IMAGE_1K_SIZES: SizeOption[] = [
  { value: '1024x1024', label: '1024×1024', tier: '1K', price: 0, aspect: '1:1' },
  { value: '1536x1024', label: '1536×1024', tier: '1K', price: 0, aspect: '3:2' },
  { value: '1024x1536', label: '1024×1536', tier: '1K', price: 0, aspect: '2:3' },
];

const GOOGLE_IMAGE_2K_SIZES: SizeOption[] = [
  { value: '2048x2048', label: '2048×2048', tier: '2K', price: 0, aspect: '1:1' },
  { value: '2048x1152', label: '2048×1152', tier: '2K', price: 0, aspect: '16:9' },
  { value: '1152x2048', label: '1152×2048', tier: '2K', price: 0, aspect: '9:16' },
];

const GOOGLE_IMAGE_4K_SIZES: SizeOption[] = [
  { value: '3840x2160', label: '3840×2160', tier: '4K', price: 0, aspect: '16:9' },
  { value: '2160x3840', label: '2160×3840', tier: '4K', price: 0, aspect: '9:16' },
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

// Seedream（gateway-seedance 文生图）按 1K/2K/4K 三档计费；插件侧接受 "宽x高"
// 像素格式，这里与后端 imageModelSupportedSizes 的 seedream-5-0-pro 契约一致，
// 三档各取正方形值。计价按上游像素分档（≤2.36MP / >2.36MP 两档），非面积比例：
// 1024²≈1.05MP 落低档 $0.038/张；2048² 与 4096² 均 >2.36MP 同为高档 $0.076/张。
const SEEDREAM_SIZES: SizeOption[] = [
  { value: '1024x1024', label: '1024×1024', tier: '1K', price: 0.038, aspect: '1:1' },
  { value: '2048x2048', label: '2048×2048', tier: '2K', price: 0.076, aspect: '1:1' },
  { value: '4096x4096', label: '4096×4096', tier: '4K', price: 0.076, aspect: '1:1' },
];

export const MODEL_REGISTRY: ModelConfig[] = [
  {
    id: 'gpt-image-2',
    name: 'GPT Image 2',
    platform: 'openai',
    defaultSize: 'auto',
    sizes: GPT_IMAGE_SIZES,
    supportsEdit: true,
  },
  {
    id: 'gemini-2.5-flash-image',
    name: 'Nano Banana',
    platform: 'openai',
    defaultSize: '1024x1024',
    sizes: GOOGLE_IMAGE_1K_ONLY_SIZES,
    supportsEdit: false,
  },
  {
    id: 'gemini-3-pro-image',
    name: 'Banana Pro',
    platform: 'openai',
    defaultSize: '1024x1024',
    sizes: GOOGLE_IMAGE_ALL_SIZES,
    supportsEdit: false,
  },
  {
    id: 'gemini-3-pro-image-preview',
    name: 'Banana Pro Preview',
    platform: 'openai',
    defaultSize: '1024x1024',
    sizes: GOOGLE_IMAGE_ALL_SIZES,
    supportsEdit: false,
  },
  {
    id: 'gemini-3.1-flash-image',
    name: 'Banana 2',
    platform: 'openai',
    defaultSize: '1024x1024',
    sizes: GOOGLE_IMAGE_UP_TO_2K_SIZES,
    supportsEdit: false,
  },
  {
    id: 'gemini-3.1-flash-image-preview',
    name: 'Banana 2 Preview',
    platform: 'openai',
    defaultSize: '1024x1024',
    sizes: GOOGLE_IMAGE_UP_TO_2K_SIZES,
    supportsEdit: false,
  },
  {
    id: 'gemini-3.1-flash-lite-image',
    name: 'Banana 2 Lite',
    platform: 'openai',
    defaultSize: '1024x1024',
    sizes: GOOGLE_IMAGE_1K_ONLY_SIZES,
    supportsEdit: false,
  },
  {
    id: 'seedream-5-0-pro',
    name: 'Seedream 5.0 Pro',
    platform: 'seedance',
    defaultSize: '2048x2048',
    sizes: SEEDREAM_SIZES,
    // 首期不支持编辑/参考图。
    supportsEdit: false,
  },
];

export function getModelConfig(id: string): ModelConfig | undefined {
  return MODEL_REGISTRY.find(m => m.id === id);
}

export function getDefaultModel(): ModelConfig {
  return MODEL_REGISTRY[0];
}

// 支持图生图/局部重绘的模型子集，供编辑类面板过滤下拉选项。
export const EDIT_MODEL_REGISTRY: ModelConfig[] = MODEL_REGISTRY.filter(m => m.supportsEdit);

export function getSizeOption(model: ModelConfig, sizeValue: string): SizeOption | undefined {
  return model.sizes.find(s => s.value === sizeValue);
}
