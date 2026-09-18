import { useTranslation } from 'react-i18next';
import type { ImageGroup } from '../../api';

// ── Seedance 视频模型 ────────────────────────────────────────────────────────
// 与 gateway-seedance 插件 registry 对齐。SD2.5 使用官方 ModelArk 原生 ID；
// 旧 -ep 只由后端兼容读取，不进入工作台模型列表。

export const VIDEO_MODEL_IDS = {
  seedance25: 'dreamina-seedance-2-5-260628',
  // Source-compatible property name; value is intentionally canonical.
  seedance25EP: 'dreamina-seedance-2-5-260628',
  standardOverseas: 'dreamina-seedance-2-0-hc',
  standardDomestic: 'doubao-seedance-2-0-260128-a',
  fastOverseas: 'dreamina-seedance-2-0-fast-hc',
  miniOverseas: 'dreamina-seedance-2-0-mini-hc',
  // 国内（Doubao）三档：与 gateway-seedance 国内原生 ID 对齐，只在国内分组可调度。
  seedance25Domestic: 'doubao-seedance-2-5-260628-a',
  fastDomestic: 'doubao-seedance-2-0-fast-260128-a',
  miniDomestic: 'doubao-seedance-2-0-mini-260615-a',
  minimaxH3: 'MiniMax-H3',
  minimaxH3Max: 'MiniMax-H3-Max',
  grokVideo15: 'grok-imagine-video-1.5',
  wan30: 'wan3.0-video',
  happyhorseT2V: 'happyhorse-1.1-t2v',
  happyhorseI2V: 'happyhorse-1.1-i2v',
  klingV3: 'kling-v3',
  klingV26: 'kling-v2-6',
} as const;

/** Legacy input accepted by the backend, never emitted by the Studio UI. */
export const LEGACY_SEEDANCE25_MODEL_ID = 'dreamina-seedance-2-5-ep';

export function canonicalVideoModelId(id: string): string {
  return id.trim().toLowerCase() === LEGACY_SEEDANCE25_MODEL_ID
    ? VIDEO_MODEL_IDS.seedance25
    : id.trim();
}

/** SD2.5 契约（海外 / 国内同一套时长与画幅域）。 */
export function isSeedance25VideoModelId(id: string): boolean {
  const canonical = canonicalVideoModelId(id);
  return canonical === VIDEO_MODEL_IDS.seedance25 || canonical === VIDEO_MODEL_IDS.seedance25Domestic;
}

export type VideoModelRegion = 'overseas' | 'domestic';
export type VideoModelPlatform = 'seedance' | 'minimax' | 'bailian' | 'kling';

export interface VideoModelConfig {
  id: string;
  nameKey: keyof typeof VIDEO_STRINGS['zh'];
  // 平台决定分组发现、提交参数域与执行插件；region 只用于 seedance 的
  // 海外/国内分组互斥判断。
  platform: VideoModelPlatform;
  region: VideoModelRegion;
  resolutions: string[];
  durationOptions?: readonly number[];
  ratioOptions?: readonly string[];
  // 各平台参数域不同：flags 缺省(undefined)视为支持(seedance 全家桶默认)。
  // MiniMax 契约没有 generate_audio / return_last_frame 开关；watermark 语义
  // 为 aigc_watermark。grok/可灵没有 watermark；快乐马 i2v 比例随首帧图。
  supportsAudio?: boolean;
  supportsReturnLastFrame?: boolean;
  supportsWatermark?: boolean;
  supportsRatio?: boolean;
  // 带参考素材时的画幅选项（缺省同 ratioOptions）：MiniMax H3 参考生视频官方允许 adaptive。
  referenceRatioOptions?: readonly string[];
}

// Seedance 2.0 的官方参数域（火山方舟「创建视频生成任务」：duration 为 [4,15] 整数或 -1
// 智能时长，ratio 七档含 adaptive），也是未单独声明选项的模型的回落。
export const VIDEO_DURATIONS = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, -1] as const;
export const VIDEO_RATIOS = ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9', 'adaptive'] as const;

// Seedance 2.5 EP's ordinary generation contract. -1 asks the upstream to
// choose the duration automatically.
export const SEEDANCE25_DURATIONS = [
  4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18,
  19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, -1,
] as const;
export const SEEDANCE25_RATIOS = ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9', 'adaptive'] as const;

// MiniMax H3 系（与 gateway-minimax registry 对齐）：整数秒、无 -1 自动；
// 文生必须显式画幅（不能 adaptive），故选项不含 adaptive。
export const MINIMAX_H3_DURATIONS = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] as const;
export const MINIMAX_H3MAX_DURATIONS = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] as const;
export const MINIMAX_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'] as const;
// H3 参考生视频（带参考素材）官方允许且默认 adaptive；文生仍不可 adaptive。
export const MINIMAX_H3_REFERENCE_RATIOS = [...MINIMAX_RATIOS, 'adaptive'] as const;

// grok（platform=seedance 按秒计费档）：1~15 秒整数、无 -1；画幅白名单多
// 3:2/2:3、无 21:9/adaptive（插件把 ratio 映射为 aspect_ratio）。
export const GROK_DURATIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] as const;
export const GROK_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4', '3:2', '2:3'] as const;

// 万相 3.0：官方 [2,30] 整数秒 + -1 智能时长；快乐马 1.1：3~15 秒。
export const WAN30_DURATIONS = [
  2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
  17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, -1,
] as const;
export const WAN30_RATIOS = ['16:9', '4:3', '1:1', '3:4', '9:16', 'adaptive'] as const;
export const HAPPYHORSE_DURATIONS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] as const;
export const HAPPYHORSE_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4', '4:5', '5:4', '9:21', '21:9'] as const;

// 可灵：分辨率合法集合由插件价格表 fail-closed，这里对齐已定价的桶（2K / 4K 为腾讯通道超分）。
// 时长按可灵官方：3.0 为 3~15 秒整数，2.6 只有 5 / 10 秒两档。
export const KLING_V3_DURATIONS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] as const;
export const KLING_V26_DURATIONS = [5, 10] as const;
export const KLING_RATIOS = ['16:9', '9:16', '1:1'] as const;

export interface VideoGenerationSettings {
  duration: number;
  resolution: string;
  ratio: string;
}

// Studio keeps the compact Seedance 2.0 presets while exposing the gateway's
// documented defaults when the Seedance 2.5 EP model is selected.
export const SEEDANCE20_VIDEO_DEFAULTS: VideoGenerationSettings = {
  duration: VIDEO_DURATIONS[0],
  resolution: '720p',
  ratio: VIDEO_RATIOS[0],
};

export const SEEDANCE25_VIDEO_DEFAULTS: VideoGenerationSettings = {
  duration: -1,
  resolution: '720p',
  ratio: 'adaptive',
};

// duration=5 同时落在 H3（4~15）与 H3-Max（5~15）区间内，换档不跳变。
export const MINIMAX_VIDEO_DEFAULTS: VideoGenerationSettings = {
  duration: 5,
  resolution: '768P',
  ratio: '16:9',
};

export const BAILIAN_VIDEO_DEFAULTS: VideoGenerationSettings = {
  duration: 5,
  resolution: '720P',
  ratio: '16:9',
};

export const KLING_VIDEO_DEFAULTS: VideoGenerationSettings = {
  duration: 5,
  resolution: '720p',
  ratio: '16:9',
};

export const VIDEO_MODEL_REGISTRY: VideoModelConfig[] = [
  {
    id: VIDEO_MODEL_IDS.seedance25,
    nameKey: 'model_sd25_ep',
    platform: 'seedance',
    region: 'overseas',
    resolutions: ['480p', '720p', '1080p'],
    durationOptions: SEEDANCE25_DURATIONS,
    ratioOptions: SEEDANCE25_RATIOS,
  },
  {
    id: VIDEO_MODEL_IDS.seedance25Domestic,
    nameKey: 'model_sd25_domestic',
    platform: 'seedance',
    region: 'domestic',
    resolutions: ['480p', '720p', '1080p'],
    durationOptions: SEEDANCE25_DURATIONS,
    ratioOptions: SEEDANCE25_RATIOS,
  },
  {
    id: VIDEO_MODEL_IDS.standardOverseas,
    nameKey: 'model_standard_overseas',
    platform: 'seedance',
    region: 'overseas',
    resolutions: ['480p', '720p', '1080p', '4k'],
  },
  {
    id: VIDEO_MODEL_IDS.standardDomestic,
    nameKey: 'model_standard_domestic',
    platform: 'seedance',
    region: 'domestic',
    resolutions: ['480p', '720p', '1080p'],
  },
  {
    id: VIDEO_MODEL_IDS.fastOverseas,
    nameKey: 'model_fast_overseas',
    platform: 'seedance',
    region: 'overseas',
    resolutions: ['480p', '720p'],
  },
  {
    id: VIDEO_MODEL_IDS.fastDomestic,
    nameKey: 'model_fast_domestic',
    platform: 'seedance',
    region: 'domestic',
    resolutions: ['480p', '720p'],
  },
  {
    id: VIDEO_MODEL_IDS.miniOverseas,
    nameKey: 'model_mini_overseas',
    platform: 'seedance',
    region: 'overseas',
    resolutions: ['480p', '720p'],
  },
  {
    id: VIDEO_MODEL_IDS.miniDomestic,
    nameKey: 'model_mini_domestic',
    platform: 'seedance',
    region: 'domestic',
    resolutions: ['480p', '720p'],
  },
  {
    id: VIDEO_MODEL_IDS.minimaxH3,
    nameKey: 'model_minimax_h3',
    platform: 'minimax',
    region: 'domestic',
    resolutions: ['768P', '2K'],
    durationOptions: MINIMAX_H3_DURATIONS,
    ratioOptions: MINIMAX_RATIOS,
    referenceRatioOptions: MINIMAX_H3_REFERENCE_RATIOS,
    supportsAudio: false,
    supportsReturnLastFrame: false,
  },
  {
    id: VIDEO_MODEL_IDS.minimaxH3Max,
    nameKey: 'model_minimax_h3_max',
    platform: 'minimax',
    region: 'domestic',
    resolutions: ['480P', '768P'],
    durationOptions: MINIMAX_H3MAX_DURATIONS,
    ratioOptions: MINIMAX_RATIOS,
    supportsAudio: false,
    supportsReturnLastFrame: false,
  },
  {
    id: VIDEO_MODEL_IDS.grokVideo15,
    nameKey: 'model_grok_video15',
    platform: 'seedance',
    region: 'overseas',
    resolutions: ['480p', '720p', '1080p'],
    durationOptions: GROK_DURATIONS,
    ratioOptions: GROK_RATIOS,
    supportsAudio: false,
    supportsReturnLastFrame: false,
    supportsWatermark: false,
  },
  {
    id: VIDEO_MODEL_IDS.wan30,
    nameKey: 'model_wan30',
    platform: 'bailian',
    region: 'domestic',
    resolutions: ['480P', '720P', '1080P'],
    durationOptions: WAN30_DURATIONS,
    ratioOptions: WAN30_RATIOS,
    supportsReturnLastFrame: false,
  },
  {
    id: VIDEO_MODEL_IDS.happyhorseT2V,
    nameKey: 'model_happyhorse_t2v',
    platform: 'bailian',
    region: 'domestic',
    resolutions: ['480P', '720P', '1080P'],
    durationOptions: HAPPYHORSE_DURATIONS,
    ratioOptions: HAPPYHORSE_RATIOS,
    supportsAudio: false,
    supportsReturnLastFrame: false,
    supportsWatermark: false,
  },
  {
    id: VIDEO_MODEL_IDS.happyhorseI2V,
    nameKey: 'model_happyhorse_i2v',
    platform: 'bailian',
    region: 'domestic',
    resolutions: ['480P', '720P', '1080P'],
    durationOptions: HAPPYHORSE_DURATIONS,
    supportsAudio: false,
    supportsReturnLastFrame: false,
    supportsWatermark: false,
    supportsRatio: false,
  },
  {
    id: VIDEO_MODEL_IDS.klingV3,
    nameKey: 'model_kling_v3',
    platform: 'kling',
    region: 'domestic',
    resolutions: ['720p', '1080p', '2k', '4k'],
    durationOptions: KLING_V3_DURATIONS,
    ratioOptions: KLING_RATIOS,
    supportsReturnLastFrame: false,
    supportsWatermark: false,
  },
  {
    // v2.6 720p 有声档官方未定价，为避免踩 fail-closed 一律无声提交。
    id: VIDEO_MODEL_IDS.klingV26,
    nameKey: 'model_kling_v26',
    platform: 'kling',
    region: 'domestic',
    resolutions: ['720p', '1080p', '2k', '4k'],
    durationOptions: KLING_V26_DURATIONS,
    ratioOptions: KLING_RATIOS,
    supportsAudio: false,
    supportsReturnLastFrame: false,
    supportsWatermark: false,
  },
];

export function videoModelById(id: string): VideoModelConfig {
  const canonicalID = canonicalVideoModelId(id);
  return VIDEO_MODEL_REGISTRY.find(m => m.id === canonicalID) ?? VIDEO_MODEL_REGISTRY[0];
}

export function videoDefaultsForModel(id: string): VideoGenerationSettings {
  const model = videoModelById(id);
  let defaults: VideoGenerationSettings;
  switch (model.platform) {
    case 'minimax':
      defaults = MINIMAX_VIDEO_DEFAULTS;
      break;
    case 'bailian':
      defaults = BAILIAN_VIDEO_DEFAULTS;
      break;
    case 'kling':
      defaults = KLING_VIDEO_DEFAULTS;
      break;
    default:
      defaults = isSeedance25VideoModelId(model.id)
        ? SEEDANCE25_VIDEO_DEFAULTS
        : SEEDANCE20_VIDEO_DEFAULTS;
  }
  return { ...defaults };
}

// SD2.5 deliberately resets to its gateway defaults on selection. When
// returning to a 2.0 model, retain choices shared by its Studio options and
// replace SD2.5-only values with the 2.0 defaults.
export function normalizeVideoSettingsForModel(
  id: string,
  settings: VideoGenerationSettings,
): VideoGenerationSettings {
  const model = videoModelById(id);
  if (isSeedance25VideoModelId(model.id)) return videoDefaultsForModel(model.id);

  const defaults = videoDefaultsForModel(model.id);
  const durations: readonly number[] = model.durationOptions ?? VIDEO_DURATIONS;
  const ratios: readonly string[] = model.ratioOptions ?? VIDEO_RATIOS;
  return {
    duration: durations.includes(settings.duration) ? settings.duration : defaults.duration,
    resolution: matchResolution(model.resolutions, settings.resolution) ?? defaults.resolution,
    ratio: ratios.includes(settings.ratio) ? settings.ratio : defaults.ratio,
  };
}

// 分辨率大小写按平台各异（'720P' vs '720p'）。跨模型切换按大小写不敏感匹配，
// 命中则采用目标模型的官方写法，避免等价档位被静默重置成默认档。
function matchResolution(resolutions: readonly string[], value: string): string | undefined {
  const normalized = value.trim().toLowerCase();
  return resolutions.find(r => r.toLowerCase() === normalized);
}

// videoRatioOptionsFor 该模型当前可选的画幅：带参考素材且模型声明了参考画幅时用它。
export function videoRatioOptionsFor(model: VideoModelConfig, hasReferences: boolean): readonly string[] {
  if (hasReferences && model.referenceRatioOptions) return model.referenceRatioOptions;
  return model.ratioOptions ?? VIDEO_RATIOS;
}

// Historical retry routes can target a different model than the composer.
// Preserve compatible values and replace out-of-contract values before send.
export function normalizeVideoSubmissionSettingsForModel(
  id: string,
  settings: VideoGenerationSettings,
  hasReferences = false,
): VideoGenerationSettings {
  const model = videoModelById(id);
  const defaults = videoDefaultsForModel(model.id);
  const durations: readonly number[] = model.durationOptions ?? VIDEO_DURATIONS;
  const ratios = videoRatioOptionsFor(model, hasReferences);
  return {
    duration: durations.includes(settings.duration) ? settings.duration : defaults.duration,
    resolution: matchResolution(model.resolutions, settings.resolution) ?? defaults.resolution,
    ratio: ratios.includes(settings.ratio) ? settings.ratio : defaults.ratio,
  };
}

export type VideoGroupsByModel = Record<string, ImageGroup[]>;

// 国内分组为了兼容既有 API 客户，也会声明支持海外标准模型别名。工作台的
// “海外”选项必须排除这些分组，否则用户选了海外仍可能被路由到国内账号。
// 国内原生模型的可调度结果是可靠的结构化判据，不依赖分组 ID 或展示名称。
export function videoGroupsForModel(
  modelId: string,
  groupsByModel: VideoGroupsByModel,
): ImageGroup[] {
  const canonicalID = canonicalVideoModelId(modelId);
  const groups = groupsByModel[canonicalID] ?? [];
  const model = VIDEO_MODEL_REGISTRY.find(item => item.id === canonicalID);
  // 海外/国内互斥只存在于 seedance 的 dreamina 系（国内组会声明海外兼容别名）；
  // 其他平台以及同挂 seedance 平台的 grok 按秒档原样返回，不参与互斥过滤。
  if (!model || model.platform !== 'seedance' || model.region === 'domestic'
    || !model.id.startsWith('dreamina')) return groups;

  // 国内组可能只声明了部分国内原生 ID（如仅标准版），取所有国内原生模型的并集。
  const domesticGroupIds = new Set(
    VIDEO_MODEL_REGISTRY
      .filter(item => item.platform === 'seedance' && item.region === 'domestic')
      .flatMap(item => (groupsByModel[item.id] ?? []).map(group => group.id)),
  );
  return groups.filter(group => !domesticGroupIds.has(group.id));
}

// ── 参考素材（视频模式）──────────────────────────────────────────────────────
// 每个模型能收的参考图 / 参考视频 / 参考音频条数与时长，与工作坊后端
// backend/internal/studio/references.go、各执行插件的请求校验同一口径
// （官方文档核对于 2026-09-15）。帧率浏览器读不到，交给执行插件探测。

export type VideoReferenceMediaKind = 'video' | 'audio';

export interface VideoReferenceMediaLimits {
  max: number;
  minSeconds: number;
  maxSeconds: number;
  maxTotalSeconds: number;
}

export interface VideoReferenceDimensionLimits {
  minSide: number;
  maxSide: number;
  // 长边 ÷ 短边上限。
  maxAspect: number;
}

export interface VideoReferenceCapability {
  images: number;
  video?: VideoReferenceMediaLimits & { dimensions: VideoReferenceDimensionLimits };
  audio?: VideoReferenceMediaLimits;
  // 三类合计上限；缺省不限。
  total?: number;
  // 参考音频必须至少搭配一张参考图或一段参考视频。
  audioRequiresVisual?: boolean;
  // 参考视频合计时长 + 生成时长上限（万相 3.0）。
  maxInputPlusOutputSeconds?: number;
  // 带参考图时允许的分辨率（小写），缺省不限。
  imageResolutions?: readonly string[];
}

// 上传链路的单文件上限：视频经 assets.store 进 core 受 64MB gRPC 约束，比各家官方上限都小。
export const REFERENCE_VIDEO_MAX_BYTES = 45 * 1024 * 1024;
export const REFERENCE_AUDIO_MAX_BYTES = 15 * 1024 * 1024;
export const REFERENCE_VIDEO_ACCEPT = 'video/mp4,video/quicktime,.mp4,.mov';
export const REFERENCE_AUDIO_ACCEPT = 'audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/wave,.mp3,.wav';

const SEEDANCE_VIDEO_DIMENSIONS: VideoReferenceDimensionLimits = { minSide: 300, maxSide: 6000, maxAspect: 2.5 };

const SEEDANCE25_REFERENCES: VideoReferenceCapability = {
  images: 30,
  video: { max: 10, minSeconds: 2, maxSeconds: 30, maxTotalSeconds: 30, dimensions: SEEDANCE_VIDEO_DIMENSIONS },
  audio: { max: 10, minSeconds: 2, maxSeconds: 30, maxTotalSeconds: 30 },
};

const SEEDANCE20_REFERENCES: VideoReferenceCapability = {
  images: 9,
  video: { max: 3, minSeconds: 2, maxSeconds: 15, maxTotalSeconds: 15, dimensions: SEEDANCE_VIDEO_DIMENSIONS },
  audio: { max: 3, minSeconds: 2, maxSeconds: 15, maxTotalSeconds: 15 },
  audioRequiresVisual: true,
};

export const VIDEO_REFERENCE_CAPABILITIES: Record<string, VideoReferenceCapability> = {
  [VIDEO_MODEL_IDS.seedance25]: SEEDANCE25_REFERENCES,
  [VIDEO_MODEL_IDS.seedance25Domestic]: SEEDANCE25_REFERENCES,
  [VIDEO_MODEL_IDS.standardOverseas]: SEEDANCE20_REFERENCES,
  [VIDEO_MODEL_IDS.standardDomestic]: SEEDANCE20_REFERENCES,
  [VIDEO_MODEL_IDS.fastOverseas]: SEEDANCE20_REFERENCES,
  [VIDEO_MODEL_IDS.fastDomestic]: SEEDANCE20_REFERENCES,
  [VIDEO_MODEL_IDS.miniOverseas]: SEEDANCE20_REFERENCES,
  [VIDEO_MODEL_IDS.miniDomestic]: SEEDANCE20_REFERENCES,
  [VIDEO_MODEL_IDS.minimaxH3]: {
    images: 9,
    video: { max: 3, minSeconds: 2, maxSeconds: 15, maxTotalSeconds: 15, dimensions: { minSide: 256, maxSide: 5760, maxAspect: 2.5 } },
    audio: { max: 3, minSeconds: 2, maxSeconds: 15, maxTotalSeconds: 15 },
    total: 12,
    audioRequiresVisual: true,
  },
  // H3-Max：首帧 + 尾帧两张图。
  [VIDEO_MODEL_IDS.minimaxH3Max]: { images: 2 },
  // grok 只收参考图；xAI 未公开张数上限，按 7 张保守。带参考图即参考生视频，官方最高 720p
  // （「Reference-to-video is capped at 720p」）。
  [VIDEO_MODEL_IDS.grokVideo15]: { images: 7, imageResolutions: ['480p', '720p'] },
  [VIDEO_MODEL_IDS.wan30]: {
    images: 10,
    video: { max: 5, minSeconds: 1, maxSeconds: 15, maxTotalSeconds: 15, dimensions: { minSide: 240, maxSide: 4096, maxAspect: 8 } },
    audio: { max: 5, minSeconds: 1, maxSeconds: 15, maxTotalSeconds: 15 },
    maxInputPlusOutputSeconds: 30,
  },
  [VIDEO_MODEL_IDS.happyhorseT2V]: { images: 0 },
  // 快乐马图生：恰好一张首帧。
  [VIDEO_MODEL_IDS.happyhorseI2V]: { images: 1 },
  [VIDEO_MODEL_IDS.klingV3]: { images: 6 },
  [VIDEO_MODEL_IDS.klingV26]: { images: 4 },
};

export function videoReferenceCapability(id: string): VideoReferenceCapability {
  return VIDEO_REFERENCE_CAPABILITIES[videoModelById(id).id];
}

export interface VideoReferenceMediaMeta {
  kind: VideoReferenceMediaKind;
  // 读不到元数据（如浏览器解不开 HEVC 编码的 mov）时缺省，交给执行插件校验。
  durationSeconds?: number;
  width?: number;
  height?: number;
}

export type VideoReferenceIssue =
  | { code: 'ref_images_unsupported' }
  | { code: 'ref_too_many_images'; max: number }
  | { code: 'ref_videos_unsupported' }
  | { code: 'ref_too_many_videos'; max: number }
  | { code: 'ref_audios_unsupported' }
  | { code: 'ref_too_many_audios'; max: number }
  | { code: 'ref_too_many_files'; max: number }
  | { code: 'ref_audio_requires_visual' }
  | { code: 'ref_video_duration'; min: number; max: number }
  | { code: 'ref_audio_duration'; min: number; max: number }
  | { code: 'ref_video_total'; max: number }
  | { code: 'ref_audio_total'; max: number }
  | { code: 'ref_video_dimensions'; min: number; max: number; ratio: number }
  | { code: 'ref_input_plus_output'; max: number }
  | { code: 'ref_image_resolution'; max: string };

// 元数据时长常带小数（14.98 / 15.02），按 0.05 秒容差比较。
const REFERENCE_DURATION_TOLERANCE = 0.05;

function knownSeconds(item: VideoReferenceMediaMeta): number | undefined {
  const seconds = item.durationSeconds;
  return seconds !== undefined && Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
}

function referenceDurationOutOfRange(item: VideoReferenceMediaMeta, limits: VideoReferenceMediaLimits): boolean {
  const seconds = knownSeconds(item);
  if (seconds === undefined) return false;
  return seconds < limits.minSeconds - REFERENCE_DURATION_TOLERANCE
    || seconds > limits.maxSeconds + REFERENCE_DURATION_TOLERANCE;
}

export function referenceTotalSeconds(items: readonly VideoReferenceMediaMeta[]): number {
  return items.reduce((sum, item) => sum + (knownSeconds(item) ?? 0), 0);
}

function referenceDimensionsOutOfRange(item: VideoReferenceMediaMeta, dims: VideoReferenceDimensionLimits): boolean {
  if (!item.width || !item.height) return false;
  const shortSide = Math.min(item.width, item.height);
  const longSide = Math.max(item.width, item.height);
  return shortSide < dims.minSide || longSide > dims.maxSide || longSide / shortSide > dims.maxAspect + 1e-6;
}

// validateVideoReferences 发送前按所选模型检查参考素材，空数组才允许发送。
// outputDurationSeconds ≤ 0（-1 自动时长）时跳过「参考视频 + 生成时长」上限；
// resolution 缺省时跳过「带参考图的分辨率上限」。
export function validateVideoReferences(
  modelId: string,
  imageCount: number,
  media: readonly VideoReferenceMediaMeta[],
  outputDurationSeconds: number,
  resolution?: string,
): VideoReferenceIssue[] {
  const cap = videoReferenceCapability(modelId);
  const issues: VideoReferenceIssue[] = [];
  const videos = media.filter(item => item.kind === 'video');
  const audios = media.filter(item => item.kind === 'audio');

  if (imageCount > 0 && cap.images === 0) issues.push({ code: 'ref_images_unsupported' });
  else if (imageCount > cap.images) issues.push({ code: 'ref_too_many_images', max: cap.images });
  const imageResolutions = cap.imageResolutions;
  if (imageCount > 0 && imageResolutions && resolution
    && !imageResolutions.includes(resolution.trim().toLowerCase())) {
    issues.push({ code: 'ref_image_resolution', max: imageResolutions[imageResolutions.length - 1] });
  }

  if (videos.length > 0) {
    const limits = cap.video;
    if (!limits) {
      issues.push({ code: 'ref_videos_unsupported' });
    } else {
      if (videos.length > limits.max) issues.push({ code: 'ref_too_many_videos', max: limits.max });
      if (videos.some(item => referenceDurationOutOfRange(item, limits))) {
        issues.push({ code: 'ref_video_duration', min: limits.minSeconds, max: limits.maxSeconds });
      }
      const total = referenceTotalSeconds(videos);
      if (total > limits.maxTotalSeconds + REFERENCE_DURATION_TOLERANCE) {
        issues.push({ code: 'ref_video_total', max: limits.maxTotalSeconds });
      }
      if (videos.some(item => referenceDimensionsOutOfRange(item, limits.dimensions))) {
        issues.push({
          code: 'ref_video_dimensions',
          min: limits.dimensions.minSide,
          max: limits.dimensions.maxSide,
          ratio: limits.dimensions.maxAspect,
        });
      }
      if (cap.maxInputPlusOutputSeconds && outputDurationSeconds > 0
        && total + outputDurationSeconds > cap.maxInputPlusOutputSeconds + REFERENCE_DURATION_TOLERANCE) {
        issues.push({ code: 'ref_input_plus_output', max: cap.maxInputPlusOutputSeconds });
      }
    }
  }

  if (audios.length > 0) {
    const limits = cap.audio;
    if (!limits) {
      issues.push({ code: 'ref_audios_unsupported' });
    } else {
      if (audios.length > limits.max) issues.push({ code: 'ref_too_many_audios', max: limits.max });
      if (audios.some(item => referenceDurationOutOfRange(item, limits))) {
        issues.push({ code: 'ref_audio_duration', min: limits.minSeconds, max: limits.maxSeconds });
      }
      if (referenceTotalSeconds(audios) > limits.maxTotalSeconds + REFERENCE_DURATION_TOLERANCE) {
        issues.push({ code: 'ref_audio_total', max: limits.maxTotalSeconds });
      }
    }
  }

  const totalFiles = imageCount + videos.length + audios.length;
  if (cap.total && totalFiles > cap.total) issues.push({ code: 'ref_too_many_files', max: cap.total });
  if (cap.audioRequiresVisual && audios.length > 0 && imageCount === 0 && videos.length === 0) {
    issues.push({ code: 'ref_audio_requires_visual' });
  }
  return issues;
}

// videoReferenceIssueMessage 把问题码填成当前语言的提示（{max}/{min}/{ratio} 占位）。
export function videoReferenceIssueMessage(issue: VideoReferenceIssue, vs: (key: VideoStringKey) => string): string {
  let text = vs(issue.code);
  for (const [key, value] of Object.entries(issue)) {
    if (key !== 'code') text = text.replaceAll(`{${key}}`, String(value));
  }
  return text;
}

// ── 本地多语言 ───────────────────────────────────────────────────────────────
// 视频模块的文案自带四语字典（不动 core 的 i18n 资源文件，避免与其他
// 会话的 WIP 提交纠缠；后续可迁回 core i18n）。

export const VIDEO_STRINGS = {
  zh: {
    media_image: '图像',
    media_video: '视频',
    gallery_load_more: '加载更多',
    gallery_empty_image: '暂无图像作品',
    gallery_empty_video: '暂无视频作品',
    model_standard_overseas: 'Seedance 2.0 标准（海外）',
    model_sd25_ep: 'Seedance 2.5 EP（海外）',
    model_standard_domestic: 'Seedance 2.0 标准（国内）',
    model_sd25_domestic: 'Seedance 2.5（国内）',
    model_fast_overseas: 'Seedance 2.0 快速（海外）',
    model_fast_domestic: 'Seedance 2.0 快速（国内）',
    model_mini_overseas: 'Seedance 2.0 迷你（海外）',
    model_mini_domestic: 'Seedance 2.0 迷你（国内）',
    model_minimax_h3: '海螺 H3',
    model_minimax_h3_max: '海螺 H3 Max（极速）',
    model_grok_video15: 'Grok Imagine 1.5',
    model_wan30: '万相 3.0',
    model_happyhorse_t2v: '快乐马 1.1 文生',
    model_happyhorse_i2v: '快乐马 1.1 图生（首帧）',
    model_kling_v3: '可灵 v3',
    model_kling_v26: '可灵 v2.6',
    duration: '时长',
    duration_seconds: '秒',
    resolution: '分辨率',
    ratio: '画幅',
    duration_auto: '自动',
    audio: '生成音频',
    fail_audio_copyright: '生成的配音触发了版权审核。关闭「生成音频」后重试即可，画面不受影响',
    fail_audio_sensitive: '生成的配音未通过内容审核。可关闭「生成音频」或调整提示词后重试',
    fail_video_copyright: '生成的画面触发了版权审核，请调整提示词或更换参考素材后重试',
    fail_video_sensitive: '生成的画面未通过内容审核，请调整提示词或更换参考素材后重试',
    fail_input_sensitive: '参考素材未通过审核（可能包含真人或敏感内容），请更换素材后重试',
    fail_timeout: '上游生成超时，请稍后重试',
    fail_insufficient_balance: '余额不足，任务未提交。可先充值，或等在途的视频跑完释放预留额度后重试',
    fail_safety_rejected: '提示词或参考图触发了内容审核。请去掉具体人名、歌名、品牌或版权元素，改写后重试',
    fail_task_interrupted: '任务执行被中断，未生成结果。请重新提交',
    fail_rate_limited: '当前请求过于密集，生成服务暂时繁忙。请稍等片刻再试',
    fail_auth_failed: '生成服务鉴权失败，本次未成功。请稍后重试，持续出现请联系管理员',
    fail_upstream_error: '生成服务暂时异常，本次未成功。请稍后重试',
    fail_submission_rejected: '提交被生成服务拒绝，请按下方原因调整参数或素材后重试',
    fail_no_output: '生成已完成但没有返回可用结果，请重试',
    fail_store_failed: '生成结果保存失败，请重试',
    fail_persist_failed: '任务已提交但状态保存失败，请稍后到使用记录核对，不要重复提交',
    fail_bad_request: '请求参数不被接受，请按下方原因调整后重试',
    fail_model_not_in_catalog: '所选模型当前不可用，请换一个模型重试',
    fail_wrong_model_kind: '所选模型不支持这种生成类型，请切换模型',
    fail_group_missing: '未选择计费分组，请选择分组后重新提交',
    fail_prompt_required: '提示词不能为空，请填写后重试',
    fail_reference_invalid: '参考素材无法读取，请重新上传后重试',
    fail_reference_required: '该模式至少需要一张参考图，请添加后重试',
    fail_reference_unsupported: '当前模型不支持这类参考素材，请移除素材或更换模型',
    fail_mask_unsupported: '当前模型不支持蒙版局部重绘，请更换模型或去掉蒙版',
    fail_reference_too_many: '参考素材数量超过模型上限，请减少后重试',
    fail_reference_not_ready: '参考素材仍在处理中，请稍后重试',
    watermark: '水印',
    return_last_frame: '返回末帧',
    video_placeholder: '描述你想生成的视频画面，可附参考图、视频或音频…',
    generating: '视频生成中（约 2-10 分钟）…',
    no_result: '生成完成但没有可用的视频输出',
    no_group: '当前没有可用的视频生成分组，请联系管理员配置',
    estimate_label: '预计 ≈ {amount}',
    estimate_insufficient: '余额不足',
    download: '下载视频',
    preview_video: '预览视频',
    source_link: '官方源链接',
    copy_source_link: '复制官方源链接',
    source_copied: '官方源链接已复制',
    expire_hint: '视频链接 24 小时内有效，请及时下载保存',
    expired_title: '视频链接已过期',
    expired_hint: '上游链接仅 24 小时有效，可重新生成获取新视频',
    load_failed: '视频加载失败，链接可能已失效',
    add_reference: '添加参考图、视频或音频',
    reference_video: '参考视频',
    reference_audio: '参考音频',
    reference_uploading: '上传中…',
    reference_upload_failed: '上传失败，点击重试',
    reference_remove: '移除',
    reference_play: '播放',
    reference_pause: '暂停',
    ref_images_unsupported: '当前模型不支持参考图',
    ref_too_many_images: '当前模型最多 {max} 张参考图',
    ref_videos_unsupported: '当前模型不支持参考视频',
    ref_too_many_videos: '当前模型最多 {max} 段参考视频',
    ref_audios_unsupported: '当前模型不支持参考音频',
    ref_too_many_audios: '当前模型最多 {max} 段参考音频',
    ref_too_many_files: '参考素材合计最多 {max} 个',
    ref_audio_requires_visual: '参考音频需至少搭配 1 张参考图或 1 段参考视频',
    ref_video_duration: '每段参考视频需在 {min}–{max} 秒之间',
    ref_audio_duration: '每段参考音频需在 {min}–{max} 秒之间',
    ref_video_total: '参考视频合计不能超过 {max} 秒',
    ref_audio_total: '参考音频合计不能超过 {max} 秒',
    ref_video_dimensions: '参考视频边长需在 {min}–{max} 像素，长宽比不超过 {ratio}:1',
    ref_input_plus_output: '参考视频时长加生成时长不能超过 {max} 秒',
    ref_video_too_large: '参考视频不能超过 {max} MB',
    ref_audio_too_large: '参考音频不能超过 {max} MB',
    ref_video_format: '参考视频仅支持 MP4、MOV',
    ref_audio_format: '参考音频仅支持 MP3、WAV',
    ref_remove_unsupported: '移除不支持的素材',
    // 缩略条行尾状态槽：计数 + 「清除」/ 上传中（优先级见 referenceSlot.ts）
    ref_slot_count: '{count} 个素材',
    ref_slot_clear: '清除',
    ref_slot_remove: '移除',
    ref_slot_uploading_one: '素材上传中…',
    ref_slot_uploading_many: '{count} 个素材上传中…',
    ref_image_resolution: '带参考图时分辨率最高 {max}',
    // 画廊里的语音作品「引用」进视频参考素材：复用已落库的持久资产，不必下载再上传。
    use_as_video_reference: '用作视频参考音频',
    ref_audio_already_added: '该音频已在参考素材中',
    fail_speech_text_too_long: '文本超过 10,000 字符上限，请分段后重试',
    fail_speech_voice_not_found: '音色 ID 不存在，请从列表选择或核对官方音色 ID 后重试',
    fail_speech_no_audio: '合成完成但没有返回可用音频，请重试',
  },
  en: {
    media_image: 'Image',
    media_video: 'Video',
    gallery_load_more: 'Load more',
    gallery_empty_image: 'No image works',
    gallery_empty_video: 'No video works',
    model_standard_overseas: 'Seedance 2.0 Standard (Overseas)',
    model_sd25_ep: 'Seedance 2.5 EP (Overseas)',
    model_standard_domestic: 'Seedance 2.0 Standard (China)',
    model_sd25_domestic: 'Seedance 2.5 (China)',
    model_fast_overseas: 'Seedance 2.0 Fast (Overseas)',
    model_fast_domestic: 'Seedance 2.0 Fast (China)',
    model_mini_overseas: 'Seedance 2.0 Mini (Overseas)',
    model_mini_domestic: 'Seedance 2.0 Mini (China)',
    model_minimax_h3: 'Hailuo H3',
    model_minimax_h3_max: 'Hailuo H3 Max (Fast)',
    model_grok_video15: 'Grok Imagine 1.5',
    model_wan30: 'Wan 3.0',
    model_happyhorse_t2v: 'HappyHorse 1.1 (Text)',
    model_happyhorse_i2v: 'HappyHorse 1.1 (Image)',
    model_kling_v3: 'Kling v3',
    model_kling_v26: 'Kling v2.6',
    duration: 'Duration',
    duration_seconds: 's',
    resolution: 'Resolution',
    ratio: 'Aspect',
    duration_auto: 'Auto',
    audio: 'Audio',
    fail_audio_copyright: 'The generated soundtrack was flagged for copyright. Turn off "Audio" and retry — the visuals are unaffected.',
    fail_audio_sensitive: 'The generated soundtrack failed content review. Turn off "Audio" or adjust the prompt and retry.',
    fail_video_copyright: 'The generated video was flagged for copyright. Adjust the prompt or reference media and retry.',
    fail_video_sensitive: 'The generated video failed content review. Adjust the prompt or reference media and retry.',
    fail_input_sensitive: 'A reference asset failed review (it may contain a real person or sensitive content). Replace it and retry.',
    fail_timeout: 'The upstream generation timed out. Please try again later.',
    fail_insufficient_balance: 'Not enough balance — the task was not submitted. Top up, or wait for the in-flight videos to finish and free up their reserved amount.',
    fail_safety_rejected: 'The prompt or reference image was blocked by content review. Remove specific people, song titles, brands or copyrighted elements, rephrase and retry.',
    fail_task_interrupted: 'The task was interrupted before producing a result. Please submit it again.',
    fail_rate_limited: 'Too many requests right now — the generation service is busy. Wait a moment and retry.',
    fail_auth_failed: 'The generation service rejected our credentials, so nothing was generated. Retry later; contact the administrator if it keeps happening.',
    fail_upstream_error: 'The generation service is temporarily unavailable, so nothing was generated. Please retry later.',
    fail_submission_rejected: 'The generation service rejected the submission. Adjust the parameters or media per the reason below and retry.',
    fail_no_output: 'Generation finished but returned no usable result. Please retry.',
    fail_store_failed: 'The generated result could not be saved. Please retry.',
    fail_persist_failed: 'The task was submitted but its state could not be saved. Check the usage records later instead of resubmitting.',
    fail_bad_request: 'The request parameters were not accepted. Adjust them per the reason below and retry.',
    fail_model_not_in_catalog: 'The selected model is currently unavailable. Pick another model and retry.',
    fail_wrong_model_kind: 'The selected model does not support this kind of generation. Switch models.',
    fail_group_missing: 'No billing group selected. Pick a group and submit again.',
    fail_prompt_required: 'The prompt must not be empty. Fill it in and retry.',
    fail_reference_invalid: 'A reference asset could not be read. Upload it again and retry.',
    fail_reference_required: 'This mode needs at least one reference image. Add one and retry.',
    fail_reference_unsupported: 'The current model does not accept this kind of reference media. Remove it or switch models.',
    fail_mask_unsupported: 'The current model does not support mask inpainting. Switch models or remove the mask.',
    fail_reference_too_many: 'Too many reference assets for this model. Remove some and retry.',
    fail_reference_not_ready: 'A reference asset is still being processed. Please retry shortly.',
    watermark: 'Watermark',
    return_last_frame: 'Return last frame',
    video_placeholder: 'Describe the video you want to create; reference images, videos, or audio optional…',
    generating: 'Generating video (about 2-10 min)…',
    no_result: 'Task completed but returned no video output',
    no_group: 'No video generation group available. Please contact the administrator.',
    estimate_label: 'Est. ≈ {amount}',
    estimate_insufficient: 'Insufficient balance',
    download: 'Download video',
    preview_video: 'Preview video',
    source_link: 'Source URL',
    copy_source_link: 'Copy source URL',
    source_copied: 'Source URL copied',
    expire_hint: 'Video links stay valid for 24 hours — download to keep.',
    expired_title: 'Video link expired',
    expired_hint: 'Upstream links last 24 hours — regenerate to get a fresh one.',
    load_failed: 'Video failed to load — the link may have expired.',
    add_reference: 'Add reference image, video, or audio',
    reference_video: 'Reference video',
    reference_audio: 'Reference audio',
    reference_uploading: 'Uploading…',
    reference_upload_failed: 'Upload failed — click to retry',
    reference_remove: 'Remove',
    reference_play: 'Play',
    reference_pause: 'Pause',
    ref_images_unsupported: 'This model does not accept reference images',
    ref_too_many_images: 'This model accepts up to {max} reference images',
    ref_videos_unsupported: 'This model does not accept reference videos',
    ref_too_many_videos: 'This model accepts up to {max} reference videos',
    ref_audios_unsupported: 'This model does not accept reference audio',
    ref_too_many_audios: 'This model accepts up to {max} reference audio clips',
    ref_too_many_files: 'Up to {max} reference files in total',
    ref_audio_requires_visual: 'Reference audio needs at least one reference image or video',
    ref_video_duration: 'Each reference video must be {min}–{max} s long',
    ref_audio_duration: 'Each reference audio clip must be {min}–{max} s long',
    ref_video_total: 'Reference videos can total at most {max} s',
    ref_audio_total: 'Reference audio can total at most {max} s',
    ref_video_dimensions: 'Reference video sides must be {min}–{max} px, with an aspect ratio up to {ratio}:1',
    ref_input_plus_output: 'Reference video length plus output length must not exceed {max} s',
    ref_video_too_large: 'Reference videos must be {max} MB or smaller',
    ref_audio_too_large: 'Reference audio must be {max} MB or smaller',
    ref_video_format: 'Reference videos must be MP4 or MOV',
    ref_audio_format: 'Reference audio must be MP3 or WAV',
    ref_remove_unsupported: 'Remove unsupported files',
    ref_slot_count: '{count} files',
    ref_slot_clear: 'Clear',
    ref_slot_remove: 'Remove',
    ref_slot_uploading_one: 'Uploading…',
    ref_slot_uploading_many: 'Uploading {count} files…',
    ref_image_resolution: 'With reference images the resolution is limited to {max}',
    // 画廊里的语音作品「引用」进视频参考素材：复用已落库的持久资产，不必下载再上传。
    use_as_video_reference: 'Use as reference audio for video',
    ref_audio_already_added: 'That audio is already in your reference files',
    fail_speech_text_too_long: 'The text exceeds the 10,000-character limit. Split it and retry.',
    fail_speech_voice_not_found: 'The voice ID does not exist. Pick one from the list or check the official voice ID and retry.',
    fail_speech_no_audio: 'Synthesis finished but returned no usable audio. Please retry.',
  },
  ja: {
    media_image: '画像',
    media_video: '動画',
    gallery_load_more: 'さらに読み込む',
    gallery_empty_image: '画像作品はありません',
    gallery_empty_video: '動画作品はありません',
    model_standard_overseas: 'Seedance 2.0 標準（海外）',
    model_sd25_ep: 'Seedance 2.5 EP（海外）',
    model_standard_domestic: 'Seedance 2.0 標準（中国）',
    model_sd25_domestic: 'Seedance 2.5（中国）',
    model_fast_overseas: 'Seedance 2.0 高速（海外）',
    model_fast_domestic: 'Seedance 2.0 高速（中国）',
    model_mini_overseas: 'Seedance 2.0 ミニ（海外）',
    model_mini_domestic: 'Seedance 2.0 ミニ（中国）',
    model_minimax_h3: 'Hailuo H3',
    model_minimax_h3_max: 'Hailuo H3 Max（高速）',
    model_grok_video15: 'Grok Imagine 1.5',
    model_wan30: 'Wan 3.0（万相）',
    model_happyhorse_t2v: 'HappyHorse 1.1（テキスト）',
    model_happyhorse_i2v: 'HappyHorse 1.1（画像）',
    model_kling_v3: 'Kling v3',
    model_kling_v26: 'Kling v2.6',
    duration: '長さ',
    duration_seconds: '秒',
    resolution: '解像度',
    ratio: 'アスペクト',
    duration_auto: '自動',
    audio: '音声生成',
    fail_audio_copyright: '生成された音声が著作権審査に引っかかりました。「音声生成」をオフにして再試行してください（映像には影響しません）',
    fail_audio_sensitive: '生成された音声がコンテンツ審査を通過しませんでした。「音声生成」をオフにするか、プロンプトを調整して再試行してください',
    fail_video_copyright: '生成された映像が著作権審査に引っかかりました。プロンプトまたは参考素材を変更して再試行してください',
    fail_video_sensitive: '生成された映像がコンテンツ審査を通過しませんでした。プロンプトまたは参考素材を変更して再試行してください',
    fail_input_sensitive: '参考素材が審査を通過しませんでした（実在の人物や機微な内容を含む可能性があります）。素材を差し替えて再試行してください',
    fail_timeout: '上流の生成がタイムアウトしました。しばらくしてから再試行してください',
    fail_insufficient_balance: '残高が不足しているため、タスクは送信されませんでした。チャージするか、進行中の動画の完了で予約分が解放されるのをお待ちください',
    fail_safety_rejected: 'プロンプトまたは参考画像がコンテンツ審査でブロックされました。特定の人名・曲名・ブランド・著作物の要素を外して書き直し、再試行してください',
    fail_task_interrupted: 'タスクは結果を生成する前に中断されました。もう一度送信してください',
    fail_rate_limited: 'リクエストが集中しており、生成サービスが混み合っています。少し待ってから再試行してください',
    fail_auth_failed: '生成サービスの認証に失敗したため生成されませんでした。しばらくして再試行し、続く場合は管理者に連絡してください',
    fail_upstream_error: '生成サービスが一時的に利用できず、生成されませんでした。しばらくしてから再試行してください',
    fail_submission_rejected: '送信が生成サービスに拒否されました。下記の理由に沿ってパラメータや素材を調整し、再試行してください',
    fail_no_output: '生成は完了しましたが利用可能な結果が返りませんでした。再試行してください',
    fail_store_failed: '生成結果を保存できませんでした。再試行してください',
    fail_persist_failed: 'タスクは送信されましたが状態を保存できませんでした。再送信せず、後ほど利用記録で確認してください',
    fail_bad_request: 'リクエストのパラメータが受け付けられませんでした。下記の理由に沿って調整し、再試行してください',
    fail_model_not_in_catalog: '選択したモデルは現在利用できません。別のモデルで再試行してください',
    fail_wrong_model_kind: '選択したモデルはこの生成タイプに対応していません。モデルを切り替えてください',
    fail_group_missing: '課金グループが選択されていません。グループを選んで再送信してください',
    fail_prompt_required: 'プロンプトを空にはできません。入力して再試行してください',
    fail_reference_invalid: '参考素材を読み込めませんでした。再アップロードして再試行してください',
    fail_reference_required: 'このモードには参考画像が少なくとも 1 枚必要です。追加して再試行してください',
    fail_reference_unsupported: '現在のモデルはこの種類の参考素材に対応していません。素材を外すかモデルを変更してください',
    fail_mask_unsupported: '現在のモデルはマスクによる部分修正に対応していません。モデルを変更するかマスクを外してください',
    fail_reference_too_many: '参考素材の数がモデルの上限を超えています。減らして再試行してください',
    fail_reference_not_ready: '参考素材はまだ処理中です。しばらくしてから再試行してください',
    watermark: 'ウォーターマーク',
    return_last_frame: '最終フレームを返す',
    video_placeholder: '生成したい動画を説明してください。参考画像・動画・音声も添付できます…',
    generating: '動画を生成中（約 2〜10 分）…',
    no_result: 'タスクは完了しましたが動画出力がありません',
    no_group: '利用可能な動画生成グループがありません。管理者にお問い合わせください。',
    estimate_label: '概算 ≈ {amount}',
    estimate_insufficient: '残高不足',
    download: '動画をダウンロード',
    preview_video: '動画をプレビュー',
    source_link: '生成元リンク',
    copy_source_link: '生成元リンクをコピー',
    source_copied: '生成元リンクをコピーしました',
    expire_hint: '動画リンクの有効期間は 24 時間です。お早めに保存してください。',
    expired_title: '動画リンクの期限が切れました',
    expired_hint: 'リンクの有効期間は 24 時間です。再生成で新しい動画を取得できます。',
    load_failed: '動画を読み込めません。リンクが失効している可能性があります。',
    add_reference: '参考画像・動画・音声を追加',
    reference_video: '参考動画',
    reference_audio: '参考音声',
    reference_uploading: 'アップロード中…',
    reference_upload_failed: 'アップロードに失敗しました。クリックして再試行',
    reference_remove: '削除',
    reference_play: '再生',
    reference_pause: '一時停止',
    ref_images_unsupported: 'このモデルは参考画像に対応していません',
    ref_too_many_images: 'このモデルの参考画像は最大 {max} 枚です',
    ref_videos_unsupported: 'このモデルは参考動画に対応していません',
    ref_too_many_videos: 'このモデルの参考動画は最大 {max} 本です',
    ref_audios_unsupported: 'このモデルは参考音声に対応していません',
    ref_too_many_audios: 'このモデルの参考音声は最大 {max} 本です',
    ref_too_many_files: '参考ファイルは合計 {max} 個までです',
    ref_audio_requires_visual: '参考音声には参考画像または参考動画を 1 つ以上組み合わせてください',
    ref_video_duration: '参考動画は 1 本あたり {min}〜{max} 秒にしてください',
    ref_audio_duration: '参考音声は 1 本あたり {min}〜{max} 秒にしてください',
    ref_video_total: '参考動画の合計は {max} 秒以内にしてください',
    ref_audio_total: '参考音声の合計は {max} 秒以内にしてください',
    ref_video_dimensions: '参考動画の辺の長さは {min}〜{max} px、縦横比は {ratio}:1 以内にしてください',
    ref_input_plus_output: '参考動画の長さと生成する長さの合計は {max} 秒以内にしてください',
    ref_video_too_large: '参考動画は {max} MB 以下にしてください',
    ref_audio_too_large: '参考音声は {max} MB 以下にしてください',
    ref_video_format: '参考動画は MP4 / MOV のみ対応しています',
    ref_audio_format: '参考音声は MP3 / WAV のみ対応しています',
    ref_remove_unsupported: '非対応のファイルを削除',
    ref_slot_count: '{count} 件の素材',
    ref_slot_clear: 'クリア',
    ref_slot_remove: '削除',
    ref_slot_uploading_one: 'アップロード中…',
    ref_slot_uploading_many: '{count} 件をアップロード中…',
    ref_image_resolution: '参考画像を使う場合、解像度は {max} までです',
    // 画廊里的语音作品「引用」进视频参考素材：复用已落库的持久资产，不必下载再上传。
    use_as_video_reference: '動画の参考音声として使う',
    ref_audio_already_added: 'この音声はすでに参考素材に追加されています',
    fail_speech_text_too_long: 'テキストが 10,000 文字の上限を超えています。分割して再試行してください',
    fail_speech_voice_not_found: '音声 ID が存在しません。一覧から選ぶか、公式の音声 ID を確認して再試行してください',
    fail_speech_no_audio: '合成は完了しましたが利用できる音声が返りませんでした。再試行してください',
  },
  'zh-HK': {
    media_image: '圖像',
    media_video: '影片',
    gallery_load_more: '載入更多',
    gallery_empty_image: '暫無圖像作品',
    gallery_empty_video: '暫無影片作品',
    model_standard_overseas: 'Seedance 2.0 標準（海外）',
    model_sd25_ep: 'Seedance 2.5 EP（海外）',
    model_standard_domestic: 'Seedance 2.0 標準（國內）',
    model_sd25_domestic: 'Seedance 2.5（國內）',
    model_fast_overseas: 'Seedance 2.0 快速（海外）',
    model_fast_domestic: 'Seedance 2.0 快速（國內）',
    model_mini_overseas: 'Seedance 2.0 迷你（海外）',
    model_mini_domestic: 'Seedance 2.0 迷你（國內）',
    model_minimax_h3: '海螺 H3',
    model_minimax_h3_max: '海螺 H3 Max（極速）',
    model_grok_video15: 'Grok Imagine 1.5',
    model_wan30: '萬相 3.0',
    model_happyhorse_t2v: '快樂馬 1.1 文生',
    model_happyhorse_i2v: '快樂馬 1.1 圖生（首幀）',
    model_kling_v3: '可靈 v3',
    model_kling_v26: '可靈 v2.6',
    duration: '時長',
    duration_seconds: '秒',
    resolution: '解像度',
    ratio: '畫幅',
    duration_auto: '自動',
    audio: '生成音訊',
    fail_audio_copyright: '生成的配音觸發了版權審核。關閉「生成音訊」後重試即可，畫面不受影響',
    fail_audio_sensitive: '生成的配音未通過內容審核。可關閉「生成音訊」或調整提示詞後重試',
    fail_video_copyright: '生成的畫面觸發了版權審核，請調整提示詞或更換參考素材後重試',
    fail_video_sensitive: '生成的畫面未通過內容審核，請調整提示詞或更換參考素材後重試',
    fail_input_sensitive: '參考素材未通過審核（可能包含真人或敏感內容），請更換素材後重試',
    fail_timeout: '上游生成逾時，請稍後重試',
    fail_insufficient_balance: '餘額不足，任務未送出。可先儲值，或等在途的影片跑完釋放預留額度後重試',
    fail_safety_rejected: '提示詞或參考圖觸發了內容審核。請去掉具體人名、歌名、品牌或版權元素，改寫後重試',
    fail_task_interrupted: '任務執行被中斷，未產生結果。請重新送出',
    fail_rate_limited: '目前請求過於密集，生成服務暫時繁忙。請稍等片刻再試',
    fail_auth_failed: '生成服務鑑權失敗，本次未成功。請稍後重試，持續出現請聯絡管理員',
    fail_upstream_error: '生成服務暫時異常，本次未成功。請稍後重試',
    fail_submission_rejected: '送出被生成服務拒絕，請按下方原因調整參數或素材後重試',
    fail_no_output: '生成已完成但沒有回傳可用結果，請重試',
    fail_store_failed: '生成結果儲存失敗，請重試',
    fail_persist_failed: '任務已送出但狀態儲存失敗，請稍後到使用記錄核對，不要重複送出',
    fail_bad_request: '請求參數不被接受，請按下方原因調整後重試',
    fail_model_not_in_catalog: '所選模型目前不可用，請換一個模型重試',
    fail_wrong_model_kind: '所選模型不支援這種生成類型，請切換模型',
    fail_group_missing: '未選擇計費分組，請選擇分組後重新送出',
    fail_prompt_required: '提示詞不能為空，請填寫後重試',
    fail_reference_invalid: '參考素材無法讀取，請重新上傳後重試',
    fail_reference_required: '該模式至少需要一張參考圖，請新增後重試',
    fail_reference_unsupported: '目前模型不支援這類參考素材，請移除素材或更換模型',
    fail_mask_unsupported: '目前模型不支援遮罩局部重繪，請更換模型或去掉遮罩',
    fail_reference_too_many: '參考素材數量超過模型上限，請減少後重試',
    fail_reference_not_ready: '參考素材仍在處理中，請稍後重試',
    watermark: '浮水印',
    return_last_frame: '返回末幀',
    video_placeholder: '描述你想生成的影片畫面，可附參考圖、影片或音訊…',
    generating: '影片生成中（約 2-10 分鐘）…',
    no_result: '生成完成但沒有可用的影片輸出',
    no_group: '目前沒有可用的影片生成分組，請聯絡管理員配置',
    estimate_label: '預計 ≈ {amount}',
    estimate_insufficient: '餘額不足',
    download: '下載影片',
    preview_video: '預覽影片',
    source_link: '官方源連結',
    copy_source_link: '複製官方源連結',
    source_copied: '已複製官方源連結',
    expire_hint: '影片連結 24 小時內有效，請及時下載保存',
    expired_title: '影片連結已過期',
    expired_hint: '上游連結僅 24 小時有效，可重新生成獲取新影片',
    load_failed: '影片載入失敗，連結可能已失效',
    add_reference: '加入參考圖、影片或音訊',
    reference_video: '參考影片',
    reference_audio: '參考音訊',
    reference_uploading: '上載中…',
    reference_upload_failed: '上載失敗，按此重試',
    reference_remove: '移除',
    reference_play: '播放',
    reference_pause: '暫停',
    ref_images_unsupported: '目前模型不支援參考圖',
    ref_too_many_images: '目前模型最多 {max} 張參考圖',
    ref_videos_unsupported: '目前模型不支援參考影片',
    ref_too_many_videos: '目前模型最多 {max} 段參考影片',
    ref_audios_unsupported: '目前模型不支援參考音訊',
    ref_too_many_audios: '目前模型最多 {max} 段參考音訊',
    ref_too_many_files: '參考素材合共最多 {max} 個',
    ref_audio_requires_visual: '參考音訊須至少搭配 1 張參考圖或 1 段參考影片',
    ref_video_duration: '每段參考影片須介乎 {min} 至 {max} 秒',
    ref_audio_duration: '每段參考音訊須介乎 {min} 至 {max} 秒',
    ref_video_total: '參考影片合共不可超過 {max} 秒',
    ref_audio_total: '參考音訊合共不可超過 {max} 秒',
    ref_video_dimensions: '參考影片邊長須介乎 {min} 至 {max} 像素，長寬比不超過 {ratio}:1',
    ref_input_plus_output: '參考影片時長加生成時長不可超過 {max} 秒',
    ref_video_too_large: '參考影片不可超過 {max} MB',
    ref_audio_too_large: '參考音訊不可超過 {max} MB',
    ref_video_format: '參考影片只支援 MP4、MOV',
    ref_audio_format: '參考音訊只支援 MP3、WAV',
    ref_remove_unsupported: '移除不支援的素材',
    ref_slot_count: '{count} 個素材',
    ref_slot_clear: '清除',
    ref_slot_remove: '移除',
    ref_slot_uploading_one: '素材上載中…',
    ref_slot_uploading_many: '{count} 個素材上載中…',
    ref_image_resolution: '附參考圖時解像度最高 {max}',
    // 画廊里的语音作品「引用」进视频参考素材：复用已落库的持久资产，不必下载再上传。
    use_as_video_reference: '用作影片參考音訊',
    ref_audio_already_added: '該音訊已在參考素材中',
    fail_speech_text_too_long: '文字超過 10,000 字元上限，請分段後重試',
    fail_speech_voice_not_found: '音色 ID 不存在，請從列表選擇或核對官方音色 ID 後重試',
    fail_speech_no_audio: '合成完成但沒有回傳可用音訊，請重試',
  },
  es: {
    media_image: 'Imagen',
    media_video: 'Video',
    gallery_load_more: 'Cargar más',
    gallery_empty_image: 'Sin obras de imagen',
    gallery_empty_video: 'Sin obras de video',
    model_standard_overseas: 'Seedance 2.0 Estándar (internacional)',
    model_sd25_ep: 'Seedance 2.5 EP (internacional)',
    model_standard_domestic: 'Seedance 2.0 Estándar (China)',
    model_sd25_domestic: 'Seedance 2.5 (China)',
    model_fast_overseas: 'Seedance 2.0 Rápido (internacional)',
    model_fast_domestic: 'Seedance 2.0 Rápido (China)',
    model_mini_overseas: 'Seedance 2.0 Mini (internacional)',
    model_mini_domestic: 'Seedance 2.0 Mini (China)',
    model_minimax_h3: 'Hailuo H3',
    model_minimax_h3_max: 'Hailuo H3 Max (rápido)',
    model_grok_video15: 'Grok Imagine 1.5',
    model_wan30: 'Wan 3.0',
    model_happyhorse_t2v: 'HappyHorse 1.1 (texto)',
    model_happyhorse_i2v: 'HappyHorse 1.1 (imagen)',
    model_kling_v3: 'Kling v3',
    model_kling_v26: 'Kling v2.6',
    duration: 'Duración',
    duration_seconds: 's',
    resolution: 'Resolución',
    ratio: 'Proporción',
    duration_auto: 'Automático',
    audio: 'Audio',
    fail_audio_copyright: 'La banda sonora generada fue marcada por derechos de autor. Desactiva «Audio» y reintenta; el vídeo no se ve afectado.',
    fail_audio_sensitive: 'La banda sonora generada no pasó la revisión de contenido. Desactiva «Audio» o ajusta el prompt y reintenta.',
    fail_video_copyright: 'El vídeo generado fue marcado por derechos de autor. Ajusta el prompt o el material de referencia y reintenta.',
    fail_video_sensitive: 'El vídeo generado no pasó la revisión de contenido. Ajusta el prompt o el material de referencia y reintenta.',
    fail_input_sensitive: 'Un material de referencia no pasó la revisión (puede contener una persona real o contenido sensible). Reemplázalo y reintenta.',
    fail_timeout: 'La generación upstream agotó el tiempo de espera. Inténtalo de nuevo más tarde.',
    fail_insufficient_balance: 'Saldo insuficiente: la tarea no se envió. Recarga o espera a que terminen los videos en curso para liberar el importe reservado.',
    fail_safety_rejected: 'El prompt o la imagen de referencia fue bloqueado por la revisión de contenido. Quita nombres de personas, títulos de canciones, marcas o elementos con derechos de autor, reformula y reintenta.',
    fail_task_interrupted: 'La tarea se interrumpió antes de producir un resultado. Vuelve a enviarla.',
    fail_rate_limited: 'Hay demasiadas solicitudes ahora mismo y el servicio de generación está ocupado. Espera un momento y reintenta.',
    fail_auth_failed: 'El servicio de generación rechazó nuestras credenciales, así que no se generó nada. Reintenta más tarde; si persiste, contacta al administrador.',
    fail_upstream_error: 'El servicio de generación no está disponible temporalmente, así que no se generó nada. Reintenta más tarde.',
    fail_submission_rejected: 'El servicio de generación rechazó el envío. Ajusta los parámetros o el material según el motivo de abajo y reintenta.',
    fail_no_output: 'La generación terminó pero no devolvió ningún resultado utilizable. Reintenta.',
    fail_store_failed: 'No se pudo guardar el resultado generado. Reintenta.',
    fail_persist_failed: 'La tarea se envió pero no se pudo guardar su estado. Consulta los registros de uso más tarde en lugar de reenviarla.',
    fail_bad_request: 'Los parámetros de la solicitud no fueron aceptados. Ajústalos según el motivo de abajo y reintenta.',
    fail_model_not_in_catalog: 'El modelo seleccionado no está disponible ahora. Elige otro modelo y reintenta.',
    fail_wrong_model_kind: 'El modelo seleccionado no admite este tipo de generación. Cambia de modelo.',
    fail_group_missing: 'No se seleccionó un grupo de facturación. Elige un grupo y vuelve a enviar.',
    fail_prompt_required: 'El prompt no puede estar vacío. Escríbelo y reintenta.',
    fail_reference_invalid: 'No se pudo leer un material de referencia. Súbelo de nuevo y reintenta.',
    fail_reference_required: 'Este modo necesita al menos una imagen de referencia. Añade una y reintenta.',
    fail_reference_unsupported: 'El modelo actual no acepta este tipo de material de referencia. Quítalo o cambia de modelo.',
    fail_mask_unsupported: 'El modelo actual no admite el repintado con máscara. Cambia de modelo o quita la máscara.',
    fail_reference_too_many: 'Demasiados materiales de referencia para este modelo. Quita algunos y reintenta.',
    fail_reference_not_ready: 'Un material de referencia todavía se está procesando. Reintenta en breve.',
    watermark: 'Marca de agua',
    return_last_frame: 'Devolver el último fotograma',
    video_placeholder: 'Describa el video que desea crear; puede adjuntar imágenes, videos o audio de referencia…',
    generating: 'Generando video (aprox. 2-10 min)…',
    no_result: 'La tarea se completó pero no devolvió ningún video',
    no_group: 'No hay ningún grupo de generación de video disponible. Contacte al administrador.',
    estimate_label: 'Est. ≈ {amount}',
    estimate_insufficient: 'Saldo insuficiente',
    download: 'Descargar video',
    preview_video: 'Vista previa del video',
    source_link: 'Enlace de origen',
    copy_source_link: 'Copiar enlace de origen',
    source_copied: 'Enlace de origen copiado',
    expire_hint: 'Los enlaces de video son válidos por 24 horas; descárguelos a tiempo.',
    expired_title: 'El enlace del video ha caducado',
    expired_hint: 'Los enlaces upstream solo son válidos por 24 horas; puede regenerar el video para obtener uno nuevo.',
    load_failed: 'No se pudo cargar el video; el enlace podría haber caducado.',
    add_reference: 'Añadir imagen, video o audio de referencia',
    reference_video: 'Video de referencia',
    reference_audio: 'Audio de referencia',
    reference_uploading: 'Subiendo…',
    reference_upload_failed: 'Error al subir; haz clic para reintentar',
    reference_remove: 'Quitar',
    reference_play: 'Reproducir',
    reference_pause: 'Pausar',
    ref_images_unsupported: 'Este modelo no admite imágenes de referencia',
    ref_too_many_images: 'Este modelo admite hasta {max} imágenes de referencia',
    ref_videos_unsupported: 'Este modelo no admite videos de referencia',
    ref_too_many_videos: 'Este modelo admite hasta {max} videos de referencia',
    ref_audios_unsupported: 'Este modelo no admite audio de referencia',
    ref_too_many_audios: 'Este modelo admite hasta {max} audios de referencia',
    ref_too_many_files: 'Puedes usar hasta {max} archivos de referencia en total',
    ref_audio_requires_visual: 'El audio de referencia necesita al menos una imagen o un video de referencia',
    ref_video_duration: 'Cada video de referencia debe durar entre {min} y {max} s',
    ref_audio_duration: 'Cada audio de referencia debe durar entre {min} y {max} s',
    ref_video_total: 'Los videos de referencia no pueden sumar más de {max} s',
    ref_audio_total: 'Los audios de referencia no pueden sumar más de {max} s',
    ref_video_dimensions: 'Los lados del video de referencia deben medir entre {min} y {max} px, con una relación de aspecto de hasta {ratio}:1',
    ref_input_plus_output: 'La duración de los videos de referencia más la del video generado no puede superar {max} s',
    ref_video_too_large: 'El video de referencia no puede superar {max} MB',
    ref_audio_too_large: 'El audio de referencia no puede superar {max} MB',
    ref_video_format: 'Los videos de referencia deben ser MP4 o MOV',
    ref_audio_format: 'Los audios de referencia deben ser MP3 o WAV',
    ref_remove_unsupported: 'Quitar archivos no compatibles',
    ref_slot_count: '{count} archivos',
    ref_slot_clear: 'Borrar',
    ref_slot_remove: 'Quitar',
    ref_slot_uploading_one: 'Subiendo…',
    ref_slot_uploading_many: 'Subiendo {count} archivos…',
    ref_image_resolution: 'Con imágenes de referencia, la resolución máxima es {max}',
    // 画廊里的语音作品「引用」进视频参考素材：复用已落库的持久资产，不必下载再上传。
    use_as_video_reference: 'Usar como audio de referencia para video',
    ref_audio_already_added: 'Ese audio ya está en tus archivos de referencia',
    fail_speech_text_too_long: 'El texto supera el límite de 10 000 caracteres. Divídelo y reintenta.',
    fail_speech_voice_not_found: 'El ID de voz no existe. Elige uno de la lista o verifica el ID de voz oficial y reintenta.',
    fail_speech_no_audio: 'La síntesis terminó pero no devolvió audio utilizable. Reintenta.',
  },
} as const;

export type VideoStringKey = keyof typeof VIDEO_STRINGS['zh'];

// formatVideoCostEstimate 预算预览的金额文案：USD 用 $，其它币种前置代码，
// 一律两位小数（与后端 message 里的金额同口径）。
export function formatVideoCostEstimate(amount: number, currency: string): string {
  const value = Number.isFinite(amount) ? amount : 0;
  const code = (currency || 'USD').trim().toUpperCase();
  return code === 'USD' ? `$${value.toFixed(2)}` : `${code} ${value.toFixed(2)}`;
}

// useVideoStrings 按当前界面语言取视频模块文案（缺失回退英文 → 中文）。
export function useVideoStrings(): (key: VideoStringKey) => string {
  const { i18n } = useTranslation();
  const lang = (i18n.language || 'zh').toLowerCase();
  const dict = lang.startsWith('zh')
    ? (lang.includes('hk') || lang.includes('hant') || lang.includes('tw') ? VIDEO_STRINGS['zh-HK'] : VIDEO_STRINGS.zh)
    : lang.startsWith('ja')
      ? VIDEO_STRINGS.ja
      : lang.startsWith('es')
        ? VIDEO_STRINGS.es
        : VIDEO_STRINGS.en;
  return (key: VideoStringKey) => dict[key] ?? VIDEO_STRINGS.en[key] ?? VIDEO_STRINGS.zh[key];
}
