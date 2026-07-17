import { useTranslation } from 'react-i18next';

// ── Seedance 2.0 视频模型 ────────────────────────────────────────────────────
// 与 gateway-seedance 插件 registry 对齐：三档各取 hc 版本对用户暴露；
// fast / mini 档只支持 480p / 720p。

export interface VideoModelConfig {
  id: string;
  nameKey: keyof typeof VIDEO_STRINGS['zh'];
  resolutions: string[];
}

export const VIDEO_MODEL_REGISTRY: VideoModelConfig[] = [
  {
    id: 'dreamina-seedance-2-0-hc',
    nameKey: 'model_standard',
    resolutions: ['480p', '720p', '1080p', '4k'],
  },
  {
    id: 'dreamina-seedance-2-0-fast-hc',
    nameKey: 'model_fast',
    resolutions: ['480p', '720p'],
  },
  {
    id: 'dreamina-seedance-2-0-mini-hc',
    nameKey: 'model_mini',
    resolutions: ['480p', '720p'],
  },
];

export const VIDEO_DURATIONS = [5, 10, 15] as const;
export const VIDEO_RATIOS = ['16:9', '9:16', '1:1', '4:3'] as const;

export function videoModelById(id: string): VideoModelConfig {
  return VIDEO_MODEL_REGISTRY.find(m => m.id === id) ?? VIDEO_MODEL_REGISTRY[0];
}

// ── 本地多语言 ───────────────────────────────────────────────────────────────
// 视频模块的文案自带四语字典（不动 core 的 i18n 资源文件，避免与其他
// 会话的 WIP 提交纠缠；后续可迁回 core i18n）。

export const VIDEO_STRINGS = {
  zh: {
    media_image: '图像',
    media_video: '视频',
    model_standard: 'Seedance 2.0 标准',
    model_fast: 'Seedance 2.0 快速',
    model_mini: 'Seedance 2.0 迷你',
    duration: '时长',
    duration_seconds: '秒',
    resolution: '分辨率',
    ratio: '画幅',
    audio: '生成音频',
    video_placeholder: '描述你想生成的视频画面，可附参考图…',
    generating: '视频生成中（约 2-10 分钟）…',
    no_result: '生成完成但没有可用的视频输出',
    no_group: '当前没有可用的视频生成分组，请联系管理员配置',
    download: '下载视频',
    source_link: '官方源链接',
    expire_hint: '视频链接 24 小时内有效，请及时下载保存',
    expired_title: '视频链接已过期',
    expired_hint: '上游链接仅 24 小时有效，可重新生成获取新视频',
    load_failed: '视频加载失败，链接可能已失效',
  },
  en: {
    media_image: 'Image',
    media_video: 'Video',
    model_standard: 'Seedance 2.0 Standard',
    model_fast: 'Seedance 2.0 Fast',
    model_mini: 'Seedance 2.0 Mini',
    duration: 'Duration',
    duration_seconds: 's',
    resolution: 'Resolution',
    ratio: 'Aspect',
    audio: 'Audio',
    video_placeholder: 'Describe the video you want to create; reference images optional…',
    generating: 'Generating video (about 2-10 min)…',
    no_result: 'Task completed but returned no video output',
    no_group: 'No video generation group available. Please contact the administrator.',
    download: 'Download video',
    source_link: 'Source URL',
    expire_hint: 'Video links stay valid for 24 hours — download to keep.',
    expired_title: 'Video link expired',
    expired_hint: 'Upstream links last 24 hours — regenerate to get a fresh one.',
    load_failed: 'Video failed to load — the link may have expired.',
  },
  ja: {
    media_image: '画像',
    media_video: '動画',
    model_standard: 'Seedance 2.0 標準',
    model_fast: 'Seedance 2.0 高速',
    model_mini: 'Seedance 2.0 ミニ',
    duration: '長さ',
    duration_seconds: '秒',
    resolution: '解像度',
    ratio: 'アスペクト',
    audio: '音声生成',
    video_placeholder: '生成したい動画を説明してください。参考画像も添付できます…',
    generating: '動画を生成中（約 2〜10 分）…',
    no_result: 'タスクは完了しましたが動画出力がありません',
    no_group: '利用可能な動画生成グループがありません。管理者にお問い合わせください。',
    download: '動画をダウンロード',
    source_link: '生成元リンク',
    expire_hint: '動画リンクの有効期間は 24 時間です。お早めに保存してください。',
    expired_title: '動画リンクの期限が切れました',
    expired_hint: 'リンクの有効期間は 24 時間です。再生成で新しい動画を取得できます。',
    load_failed: '動画を読み込めません。リンクが失効している可能性があります。',
  },
  'zh-HK': {
    media_image: '圖像',
    media_video: '影片',
    model_standard: 'Seedance 2.0 標準',
    model_fast: 'Seedance 2.0 快速',
    model_mini: 'Seedance 2.0 迷你',
    duration: '時長',
    duration_seconds: '秒',
    resolution: '解像度',
    ratio: '畫幅',
    audio: '生成音訊',
    video_placeholder: '描述你想生成的影片畫面，可附參考圖…',
    generating: '影片生成中（約 2-10 分鐘）…',
    no_result: '生成完成但沒有可用的影片輸出',
    no_group: '目前沒有可用的影片生成分組，請聯絡管理員配置',
    download: '下載影片',
    source_link: '官方源連結',
    expire_hint: '影片連結 24 小時內有效，請及時下載保存',
    expired_title: '影片連結已過期',
    expired_hint: '上游連結僅 24 小時有效，可重新生成獲取新影片',
    load_failed: '影片載入失敗，連結可能已失效',
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
      : VIDEO_STRINGS.en;
  return (key: VideoStringKey) => dict[key] ?? VIDEO_STRINGS.en[key] ?? VIDEO_STRINGS.zh[key];
}
