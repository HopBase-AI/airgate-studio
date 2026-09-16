import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { ImageGroup } from '../../api';

// ── 语音合成（MiniMax Speech 2.8）──────────────────────────────────────────
// 模型 / 音色 / 计费口径与后端 speech.go、网关文档（docs/audio/speech）同源；
// 音色 ID 一律照官方系统音色列表原样复制——大小写、空格、括号都是 ID 的一部分。

export const SPEECH_PLATFORM = 'minimax';

export const SPEECH_MODEL_IDS = {
  hd: 'speech-2.8-hd',
  turbo: 'speech-2.8-turbo',
} as const;

export type SpeechModelId = typeof SPEECH_MODEL_IDS[keyof typeof SPEECH_MODEL_IDS];

export interface SpeechModelConfig {
  id: SpeechModelId;
  platform: typeof SPEECH_PLATFORM;
  nameKey: SpeechStringKey;
  hintKey: SpeechStringKey;
}

export const SPEECH_MODEL_REGISTRY: SpeechModelConfig[] = [
  { id: SPEECH_MODEL_IDS.hd, platform: SPEECH_PLATFORM, nameKey: 'model_hd', hintKey: 'model_hd_hint' },
  { id: SPEECH_MODEL_IDS.turbo, platform: SPEECH_PLATFORM, nameKey: 'model_turbo', hintKey: 'model_turbo_hint' },
];

export function isSpeechModelId(id: string): id is SpeechModelId {
  return SPEECH_MODEL_REGISTRY.some(model => model.id === id);
}

export function speechModelById(id: string): SpeechModelConfig {
  return SPEECH_MODEL_REGISTRY.find(model => model.id === id) ?? SPEECH_MODEL_REGISTRY[0];
}

// 官方上限：原生入口 10,000 个 Unicode 码点；语速官方区间 [0.5, 2]；v1 固定 mp3。
export const SPEECH_MAX_CHARS = 10000;
export const SPEECH_MIN_SPEED = 0.5;
export const SPEECH_MAX_SPEED = 2;
export const SPEECH_DEFAULT_SPEED = 1;
export const SPEECH_SPEED_STEP = 0.1;
export const SPEECH_FORMAT = 'mp3';

export function clampSpeechSpeed(speed: number): number {
  if (!Number.isFinite(speed)) return SPEECH_DEFAULT_SPEED;
  const clamped = Math.min(SPEECH_MAX_SPEED, Math.max(SPEECH_MIN_SPEED, speed));
  return Math.round(clamped * 10) / 10;
}

// countCodePoints 官方上限按码点计（不是 UTF-16 单元）：emoji / 生僻字算 1。
// 手动跳过代理对，不为 1 万字的文本每次敲键都分配一个数组。
export function countCodePoints(text: string): number {
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) i++;
    count++;
  }
  return count;
}

const HAN_PATTERN = /\p{Script=Han}/u;

// speechBillableCharacters 官方计费口径：每个字符计 1，汉字再加 1（与后端
// speechBillableCharacters、网关 ttsBillableCharacters 同一公式，实测与上游回报相等）。
export function speechBillableCharacters(text: string): number {
  let count = 0;
  for (const ch of text) {
    count++;
    if (HAN_PATTERN.test(ch)) count++;
  }
  return count;
}

// ── 音色 ──────────────────────────────────────────────────────────────────
// 精选列表（英 8 / 普通话 8 / 日 3 / 西 3 / 粤 1），ID 与文档 System voices 表逐字一致。
// 官方 332 个系统音色全部可用，列表外的走「自定义音色 ID」原样透传。

export type SpeechVoiceLanguage = 'en' | 'zh' | 'ja' | 'es' | 'yue';

export interface SpeechVoice {
  id: string;
  // 官方标签（英文），五语同形，不进字典。
  name: string;
  language: SpeechVoiceLanguage;
}

export const SPEECH_VOICE_LANGUAGES: SpeechVoiceLanguage[] = ['en', 'zh', 'ja', 'es', 'yue'];

export const SPEECH_VOICES: SpeechVoice[] = [
  { id: 'English_expressive_narrator', name: 'Expressive Narrator', language: 'en' },
  { id: 'English_radiant_girl', name: 'Radiant Girl', language: 'en' },
  { id: 'English_magnetic_voiced_man', name: 'Magnetic-voiced Male', language: 'en' },
  { id: 'English_compelling_lady1', name: 'Compelling Lady', language: 'en' },
  { id: 'English_Aussie_Bloke', name: 'Aussie Bloke', language: 'en' },
  { id: 'English_captivating_female1', name: 'Captivating Female', language: 'en' },
  { id: 'English_Upbeat_Woman', name: 'Upbeat Woman', language: 'en' },
  { id: 'English_Trustworth_Man', name: 'Trustworthy Man', language: 'en' },
  { id: 'Chinese (Mandarin)_Reliable_Executive', name: 'Reliable Executive', language: 'zh' },
  { id: 'Chinese (Mandarin)_News_Anchor', name: 'News Anchor', language: 'zh' },
  { id: 'Chinese (Mandarin)_Unrestrained_Young_Man', name: 'Unrestrained Young Man', language: 'zh' },
  { id: 'Chinese (Mandarin)_Mature_Woman', name: 'Mature Woman', language: 'zh' },
  { id: 'Arrogant_Miss', name: 'Arrogant Miss', language: 'zh' },
  { id: 'Robot_Armor', name: 'Robot Armor', language: 'zh' },
  { id: 'Chinese (Mandarin)_Kind-hearted_Antie', name: 'Kind-hearted Antie', language: 'zh' },
  { id: 'Chinese (Mandarin)_HK_Flight_Attendant', name: 'HK Flight Attendant', language: 'zh' },
  { id: 'Japanese_IntellectualSenior', name: 'Intellectual Senior', language: 'ja' },
  { id: 'Japanese_DecisivePrincess', name: 'Decisive Princess', language: 'ja' },
  { id: 'Japanese_LoyalKnight', name: 'Loyal Knight', language: 'ja' },
  { id: 'Spanish_SereneWoman', name: 'Serene Woman', language: 'es' },
  { id: 'Spanish_MaturePartner', name: 'Mature Partner', language: 'es' },
  { id: 'Spanish_CaptivatingStoryteller', name: 'Captivating Storyteller', language: 'es' },
  { id: 'Cantonese_GentleLady', name: 'Gentle Lady', language: 'yue' },
];

// 默认音色按文本语言：含汉字用普通话音色，否则英文音色（与网关缺省一致）。
export const SPEECH_DEFAULT_VOICE_EN = 'English_expressive_narrator';
export const SPEECH_DEFAULT_VOICE_HAN = 'Chinese (Mandarin)_News_Anchor';

export function defaultSpeechVoiceFor(text: string): string {
  return HAN_PATTERN.test(text) ? SPEECH_DEFAULT_VOICE_HAN : SPEECH_DEFAULT_VOICE_EN;
}

export function speechVoiceById(id: string): SpeechVoice | undefined {
  return SPEECH_VOICES.find(voice => voice.id === id);
}

// 粤语音色必须带 language_boost: "Chinese,Yue"（后端也会自动补，这里只为请求体自描述）。
export const CANTONESE_LANGUAGE_BOOST = 'Chinese,Yue';

export function speechLanguageBoostFor(voiceId: string): string | undefined {
  return voiceId.startsWith('Cantonese_') ? CANTONESE_LANGUAGE_BOOST : undefined;
}

// formatAudioDuration 毫秒 → m:ss（不足 1 秒按 1 秒显示，0 / 缺失显示 --:--）。
export function formatAudioDuration(ms?: number): string {
  if (ms === undefined || !Number.isFinite(ms) || ms <= 0) return '--:--';
  const total = Math.max(1, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export function formatSpeechSpeed(speed: number): string {
  return `${clampSpeechSpeed(speed).toFixed(1)}×`;
}

// ── 分组发现 ──────────────────────────────────────────────────────────────
// 与视频同一套：每个模型问一次 /image-groups?media=audio；没有可达分组的模型不展示，
// 两个模型都不可达时整个语音模式不出现。

export type SpeechGroupsByModel = Record<string, ImageGroup[]>;

export function speechGroupsForModel(id: string, groupsByModel: SpeechGroupsByModel): ImageGroup[] {
  return groupsByModel[id] ?? [];
}

// ── 本地多语言 ───────────────────────────────────────────────────────────────
// 与 video/videoConfig.ts 的 VIDEO_STRINGS 同一做法：插件自带五语字典。失败码的文案在
// VIDEO_STRINGS 的 fail_* 里（failureHints 统一按码映射），这里只放语音模式自己的界面文案。
// 供给中性：只出现「MiniMax Speech 2.8」品牌与模型 ID，不提账号 / 通道。

export const SPEECH_STRINGS = {
  zh: {
    media_audio: '语音',
    gallery_empty_audio: '暂无语音作品',
    model_hd: 'MiniMax Speech 2.8 HD',
    model_turbo: 'MiniMax Speech 2.8 Turbo',
    model_hd_hint: '高音质',
    model_turbo_hint: '更快',
    placeholder: '输入要朗读的文本（最多 10,000 字符），可用 <#0.5#> 插入停顿…',
    chars_count: '{count} / {max} 字符',
    billable_estimate: '预计计费字符 {count}（汉字按 2 计）',
    too_long: '文本超过 10,000 字符上限，请分段后再合成',
    voice: '音色',
    voice_auto: '自动（按文本语言）',
    voice_custom: '自定义音色 ID',
    voice_custom_placeholder: '粘贴官方系统音色 ID',
    voice_custom_hint: '官方系统音色全部可用；大小写、空格、括号须与官方列表一致',
    voice_lang_all: '全部',
    voice_lang_en: '英语',
    voice_lang_zh: '普通话',
    voice_lang_ja: '日语',
    voice_lang_es: '西班牙语',
    voice_lang_yue: '粤语',
    speed: '语速',
    format: '格式',
    generating: '语音合成中…',
    no_group: '当前没有可用的语音合成分组，请联系管理员配置',
    result_chars: '计费字符 {count}',
    result_duration: '时长 {duration}',
    download: '下载音频',
    load_failed: '音频加载失败',
  },
  en: {
    media_audio: 'Speech',
    gallery_empty_audio: 'No speech works',
    model_hd: 'MiniMax Speech 2.8 HD',
    model_turbo: 'MiniMax Speech 2.8 Turbo',
    model_hd_hint: 'High fidelity',
    model_turbo_hint: 'Faster',
    placeholder: 'Enter the text to read aloud (up to 10,000 characters); use <#0.5#> to insert a pause…',
    chars_count: '{count} / {max} characters',
    billable_estimate: 'Estimated billed characters: {count} (Han characters count 2)',
    too_long: 'The text exceeds the 10,000-character limit. Split it before synthesizing.',
    voice: 'Voice',
    voice_auto: 'Auto (by text language)',
    voice_custom: 'Custom voice ID',
    voice_custom_placeholder: 'Paste an official system voice ID',
    voice_custom_hint: 'Every official system voice works; case, spaces, and parentheses must match the official list',
    voice_lang_all: 'All',
    voice_lang_en: 'English',
    voice_lang_zh: 'Mandarin',
    voice_lang_ja: 'Japanese',
    voice_lang_es: 'Spanish',
    voice_lang_yue: 'Cantonese',
    speed: 'Speed',
    format: 'Format',
    generating: 'Synthesizing speech…',
    no_group: 'No speech synthesis group is available. Ask an administrator to configure one.',
    result_chars: '{count} billed characters',
    result_duration: 'Duration {duration}',
    download: 'Download audio',
    load_failed: 'Audio failed to load',
  },
  ja: {
    media_audio: '音声',
    gallery_empty_audio: '音声作品はまだありません',
    model_hd: 'MiniMax Speech 2.8 HD',
    model_turbo: 'MiniMax Speech 2.8 Turbo',
    model_hd_hint: '高音質',
    model_turbo_hint: '高速',
    placeholder: '読み上げるテキストを入力（最大 10,000 文字）。<#0.5#> でポーズを挿入できます…',
    chars_count: '{count} / {max} 文字',
    billable_estimate: '課金文字数の目安 {count}（漢字は 2 文字換算）',
    too_long: 'テキストが 10,000 文字の上限を超えています。分割してから合成してください',
    voice: '音声',
    voice_auto: '自動（テキストの言語に合わせる）',
    voice_custom: 'カスタム音声 ID',
    voice_custom_placeholder: '公式のシステム音声 ID を貼り付け',
    voice_custom_hint: '公式のシステム音声はすべて利用可能。大文字小文字・スペース・括弧は公式一覧と一致させてください',
    voice_lang_all: 'すべて',
    voice_lang_en: '英語',
    voice_lang_zh: '中国語（普通話）',
    voice_lang_ja: '日本語',
    voice_lang_es: 'スペイン語',
    voice_lang_yue: '広東語',
    speed: '話速',
    format: '形式',
    generating: '音声を合成中…',
    no_group: '利用できる音声合成グループがありません。管理者に設定を依頼してください',
    result_chars: '課金文字数 {count}',
    result_duration: '長さ {duration}',
    download: '音声をダウンロード',
    load_failed: '音声の読み込みに失敗しました',
  },
  'zh-HK': {
    media_audio: '語音',
    gallery_empty_audio: '暫無語音作品',
    model_hd: 'MiniMax Speech 2.8 HD',
    model_turbo: 'MiniMax Speech 2.8 Turbo',
    model_hd_hint: '高音質',
    model_turbo_hint: '更快',
    placeholder: '輸入要朗讀的文字（最多 10,000 字元），可用 <#0.5#> 插入停頓…',
    chars_count: '{count} / {max} 字元',
    billable_estimate: '預計計費字元 {count}（漢字按 2 計）',
    too_long: '文字超過 10,000 字元上限，請分段後再合成',
    voice: '音色',
    voice_auto: '自動（按文字語言）',
    voice_custom: '自訂音色 ID',
    voice_custom_placeholder: '貼上官方系統音色 ID',
    voice_custom_hint: '官方系統音色全部可用；大小寫、空格、括號須與官方列表一致',
    voice_lang_all: '全部',
    voice_lang_en: '英語',
    voice_lang_zh: '普通話',
    voice_lang_ja: '日語',
    voice_lang_es: '西班牙語',
    voice_lang_yue: '粵語',
    speed: '語速',
    format: '格式',
    generating: '語音合成中…',
    no_group: '目前沒有可用的語音合成分組，請聯絡管理員設定',
    result_chars: '計費字元 {count}',
    result_duration: '時長 {duration}',
    download: '下載音訊',
    load_failed: '音訊載入失敗',
  },
  es: {
    media_audio: 'Voz',
    gallery_empty_audio: 'Aún no hay obras de voz',
    model_hd: 'MiniMax Speech 2.8 HD',
    model_turbo: 'MiniMax Speech 2.8 Turbo',
    model_hd_hint: 'Alta fidelidad',
    model_turbo_hint: 'Más rápido',
    placeholder: 'Escribe el texto a leer en voz alta (hasta 10 000 caracteres); usa <#0.5#> para insertar una pausa…',
    chars_count: '{count} / {max} caracteres',
    billable_estimate: 'Caracteres facturables estimados: {count} (los caracteres Han cuentan 2)',
    too_long: 'El texto supera el límite de 10 000 caracteres. Divídelo antes de sintetizar.',
    voice: 'Voz',
    voice_auto: 'Automática (según el idioma del texto)',
    voice_custom: 'ID de voz personalizado',
    voice_custom_placeholder: 'Pega un ID de voz oficial del sistema',
    voice_custom_hint: 'Todas las voces oficiales del sistema funcionan; mayúsculas, espacios y paréntesis deben coincidir con la lista oficial',
    voice_lang_all: 'Todas',
    voice_lang_en: 'Inglés',
    voice_lang_zh: 'Mandarín',
    voice_lang_ja: 'Japonés',
    voice_lang_es: 'Español',
    voice_lang_yue: 'Cantonés',
    speed: 'Velocidad',
    format: 'Formato',
    generating: 'Sintetizando voz…',
    no_group: 'No hay ningún grupo de síntesis de voz disponible. Pide a un administrador que configure uno.',
    result_chars: '{count} caracteres facturados',
    result_duration: 'Duración {duration}',
    download: 'Descargar audio',
    load_failed: 'No se pudo cargar el audio',
  },
} as const;

export type SpeechStringKey = keyof typeof SPEECH_STRINGS['zh'];
export type SpeechStrings = (key: SpeechStringKey, params?: Record<string, string | number>) => string;

export function pickSpeechDictionary(language: string): Record<SpeechStringKey, string> {
  const lang = (language || 'zh').toLowerCase();
  if (lang.startsWith('zh')) {
    return lang.includes('hk') || lang.includes('hant') || lang.includes('tw')
      ? SPEECH_STRINGS['zh-HK']
      : SPEECH_STRINGS.zh;
  }
  if (lang.startsWith('ja')) return SPEECH_STRINGS.ja;
  if (lang.startsWith('es')) return SPEECH_STRINGS.es;
  return SPEECH_STRINGS.en;
}

export function speechStringsFor(language: string): SpeechStrings {
  const dict = pickSpeechDictionary(language);
  return (key, params) => {
    const template: string = dict[key] ?? SPEECH_STRINGS.en[key] ?? SPEECH_STRINGS.zh[key];
    if (!params) return template;
    return Object.entries(params).reduce(
      (acc, [name, value]) => acc.split(`{${name}}`).join(String(value)),
      template,
    );
  };
}

// 音色语言分组的标签键。
export function speechVoiceLanguageKey(language: SpeechVoiceLanguage): SpeechStringKey {
  switch (language) {
    case 'en': return 'voice_lang_en';
    case 'zh': return 'voice_lang_zh';
    case 'ja': return 'voice_lang_ja';
    case 'es': return 'voice_lang_es';
    default: return 'voice_lang_yue';
  }
}

// useSpeechStrings 按当前界面语言取语音模块文案；按语言 memo（同 useModelSelectorStrings）。
export function useSpeechStrings(): SpeechStrings {
  const { i18n } = useTranslation();
  const language = i18n.language;
  return useMemo(() => speechStringsFor(language), [language]);
}
