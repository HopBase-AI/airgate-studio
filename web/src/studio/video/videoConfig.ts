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
}

// Seedance 2.0's existing Studio presets. Keep these as the fallback for
// models without an explicit per-model option list.
export const VIDEO_DURATIONS = [4, 5, 10, 15] as const;
export const VIDEO_RATIOS = ['16:9', '9:16', '1:1', '4:3'] as const;

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

// grok（platform=seedance 按秒计费档）：1~15 秒整数、无 -1；画幅白名单多
// 3:2/2:3、无 21:9/adaptive（插件把 ratio 映射为 aspect_ratio）。
export const GROK_DURATIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] as const;
export const GROK_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4', '3:2', '2:3'] as const;

// 万相 3.0：2~30 秒 + -1 自动；快乐马 1.1：3~15 秒。
export const WAN30_DURATIONS = [2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, -1] as const;
export const WAN30_RATIOS = ['16:9', '4:3', '1:1', '3:4', '9:16', 'adaptive'] as const;
export const HAPPYHORSE_DURATIONS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] as const;
export const HAPPYHORSE_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4', '4:5', '5:4', '9:21', '21:9'] as const;

// 可灵：分辨率合法集合由插件价格表 fail-closed，这里对齐已定价的桶。
export const KLING_V3_DURATIONS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] as const;
export const KLING_V26_DURATIONS = [5, 6, 7, 8, 9, 10] as const;
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
    resolutions: ['480p', '720p'],
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
    id: VIDEO_MODEL_IDS.miniOverseas,
    nameKey: 'model_mini_overseas',
    platform: 'seedance',
    region: 'overseas',
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
      defaults = model.id === VIDEO_MODEL_IDS.seedance25
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
  if (model.id === VIDEO_MODEL_IDS.seedance25) return videoDefaultsForModel(model.id);

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

// Historical retry routes can target a different model than the composer.
// Preserve compatible values and replace out-of-contract values before send.
export function normalizeVideoSubmissionSettingsForModel(
  id: string,
  settings: VideoGenerationSettings,
): VideoGenerationSettings {
  const model = videoModelById(id);
  const defaults = videoDefaultsForModel(model.id);
  const durations: readonly number[] = model.durationOptions ?? VIDEO_DURATIONS;
  const ratios: readonly string[] = model.ratioOptions ?? VIDEO_RATIOS;
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

  const domesticGroupIds = new Set(
    (groupsByModel[VIDEO_MODEL_IDS.standardDomestic] ?? []).map(group => group.id),
  );
  return groups.filter(group => !domesticGroupIds.has(group.id));
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
    model_fast_overseas: 'Seedance 2.0 快速（海外）',
    model_mini_overseas: 'Seedance 2.0 迷你（海外）',
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
    watermark: '水印',
    return_last_frame: '返回末帧',
    video_placeholder: '描述你想生成的视频画面，可附参考图…',
    generating: '视频生成中（约 2-10 分钟）…',
    no_result: '生成完成但没有可用的视频输出',
    no_group: '当前没有可用的视频生成分组，请联系管理员配置',
    download: '下载视频',
    preview_video: '预览视频',
    source_link: '官方源链接',
    copy_source_link: '复制官方源链接',
    source_copied: '官方源链接已复制',
    expire_hint: '视频链接 24 小时内有效，请及时下载保存',
    expired_title: '视频链接已过期',
    expired_hint: '上游链接仅 24 小时有效，可重新生成获取新视频',
    load_failed: '视频加载失败，链接可能已失效',
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
    model_fast_overseas: 'Seedance 2.0 Fast (Overseas)',
    model_mini_overseas: 'Seedance 2.0 Mini (Overseas)',
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
    watermark: 'Watermark',
    return_last_frame: 'Return last frame',
    video_placeholder: 'Describe the video you want to create; reference images optional…',
    generating: 'Generating video (about 2-10 min)…',
    no_result: 'Task completed but returned no video output',
    no_group: 'No video generation group available. Please contact the administrator.',
    download: 'Download video',
    preview_video: 'Preview video',
    source_link: 'Source URL',
    copy_source_link: 'Copy source URL',
    source_copied: 'Source URL copied',
    expire_hint: 'Video links stay valid for 24 hours — download to keep.',
    expired_title: 'Video link expired',
    expired_hint: 'Upstream links last 24 hours — regenerate to get a fresh one.',
    load_failed: 'Video failed to load — the link may have expired.',
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
    model_fast_overseas: 'Seedance 2.0 高速（海外）',
    model_mini_overseas: 'Seedance 2.0 ミニ（海外）',
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
    watermark: 'ウォーターマーク',
    return_last_frame: '最終フレームを返す',
    video_placeholder: '生成したい動画を説明してください。参考画像も添付できます…',
    generating: '動画を生成中（約 2〜10 分）…',
    no_result: 'タスクは完了しましたが動画出力がありません',
    no_group: '利用可能な動画生成グループがありません。管理者にお問い合わせください。',
    download: '動画をダウンロード',
    preview_video: '動画をプレビュー',
    source_link: '生成元リンク',
    copy_source_link: '生成元リンクをコピー',
    source_copied: '生成元リンクをコピーしました',
    expire_hint: '動画リンクの有効期間は 24 時間です。お早めに保存してください。',
    expired_title: '動画リンクの期限が切れました',
    expired_hint: 'リンクの有効期間は 24 時間です。再生成で新しい動画を取得できます。',
    load_failed: '動画を読み込めません。リンクが失効している可能性があります。',
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
    model_fast_overseas: 'Seedance 2.0 快速（海外）',
    model_mini_overseas: 'Seedance 2.0 迷你（海外）',
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
    watermark: '浮水印',
    return_last_frame: '返回末幀',
    video_placeholder: '描述你想生成的影片畫面，可附參考圖…',
    generating: '影片生成中（約 2-10 分鐘）…',
    no_result: '生成完成但沒有可用的影片輸出',
    no_group: '目前沒有可用的影片生成分組，請聯絡管理員配置',
    download: '下載影片',
    preview_video: '預覽影片',
    source_link: '官方源連結',
    copy_source_link: '複製官方源連結',
    source_copied: '已複製官方源連結',
    expire_hint: '影片連結 24 小時內有效，請及時下載保存',
    expired_title: '影片連結已過期',
    expired_hint: '上游連結僅 24 小時有效，可重新生成獲取新影片',
    load_failed: '影片載入失敗，連結可能已失效',
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
    model_fast_overseas: 'Seedance 2.0 Rápido (internacional)',
    model_mini_overseas: 'Seedance 2.0 Mini (internacional)',
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
    watermark: 'Marca de agua',
    return_last_frame: 'Devolver el último fotograma',
    video_placeholder: 'Describa el video que desea crear; puede adjuntar imágenes de referencia…',
    generating: 'Generando video (aprox. 2-10 min)…',
    no_result: 'La tarea se completó pero no devolvió ningún video',
    no_group: 'No hay ningún grupo de generación de video disponible. Contacte al administrador.',
    download: 'Descargar video',
    preview_video: 'Vista previa del video',
    source_link: 'Enlace de origen',
    copy_source_link: 'Copiar enlace de origen',
    source_copied: 'Enlace de origen copiado',
    expire_hint: 'Los enlaces de video son válidos por 24 horas; descárguelos a tiempo.',
    expired_title: 'El enlace del video ha caducado',
    expired_hint: 'Los enlaces upstream solo son válidos por 24 horas; puede regenerar el video para obtener uno nuevo.',
    load_failed: 'No se pudo cargar el video; el enlace podría haber caducado.',
  },
} as const;

export type VideoStringKey = keyof typeof VIDEO_STRINGS['zh'];

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
