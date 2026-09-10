import { useTranslation } from 'react-i18next';

// ── 模型选择器本地多语言 ──────────────────────────────────────────────────────
// 与 video/videoConfig.ts 的 VIDEO_STRINGS 同一做法：插件自带五语字典，不动 core 的
// i18n 资源文件（后续可迁回 core i18n 的 studio.* 键）。「官方直连」限定词沿用 core
// 既有键 playground.studio_route_official（见 modelRoutes.localizeRouteLabel）。
//
// {price} 已含货币符号（¥ / $）；{rate} 是分组有效倍率。

export const MODEL_SELECTOR_STRINGS = {
  zh: {
    price_per_image: '{price}/张',
    billed_by_usage: '按实际消耗 ×{rate}',
    model_search_placeholder: '搜模型,如 banana / gpt-image-2.5 / seedream',
    family_all: '全部',
    no_model_match: '没有匹配的模型',
  },
  'zh-HK': {
    price_per_image: '{price}/張',
    billed_by_usage: '按實際消耗 ×{rate}',
    model_search_placeholder: '搜模型,如 banana / gpt-image-2.5 / seedream',
    family_all: '全部',
    no_model_match: '沒有匹配的模型',
  },
  en: {
    price_per_image: '{price}/image',
    billed_by_usage: 'Pay per use ×{rate}',
    model_search_placeholder: 'Search models, e.g. banana / gpt-image-2.5 / seedream',
    family_all: 'All',
    no_model_match: 'No matching models',
  },
  es: {
    price_per_image: '{price}/imagen',
    billed_by_usage: 'Según consumo ×{rate}',
    model_search_placeholder: 'Buscar modelos, p. ej. banana / gpt-image-2.5 / seedream',
    family_all: 'Todos',
    no_model_match: 'No hay modelos que coincidan',
  },
  ja: {
    price_per_image: '{price}/枚',
    billed_by_usage: '従量課金 ×{rate}',
    model_search_placeholder: 'モデルを検索(例: banana / gpt-image-2.5 / seedream)',
    family_all: 'すべて',
    no_model_match: '一致するモデルがありません',
  },
} as const;

export type ModelSelectorStringKey = keyof typeof MODEL_SELECTOR_STRINGS['zh'];
export type ModelSelectorDictionary = Record<ModelSelectorStringKey, string>;
export type ModelSelectorStrings = (key: ModelSelectorStringKey, params?: Record<string, string>) => string;

export function pickModelSelectorDictionary(language: string): ModelSelectorDictionary {
  const lang = (language || 'zh').toLowerCase();
  if (lang.startsWith('zh')) {
    return lang.includes('hk') || lang.includes('hant') || lang.includes('tw')
      ? MODEL_SELECTOR_STRINGS['zh-HK']
      : MODEL_SELECTOR_STRINGS.zh;
  }
  if (lang.startsWith('ja')) return MODEL_SELECTOR_STRINGS.ja;
  if (lang.startsWith('es')) return MODEL_SELECTOR_STRINGS.es;
  return MODEL_SELECTOR_STRINGS.en;
}

export function modelSelectorStringsFor(language: string): ModelSelectorStrings {
  const dict = pickModelSelectorDictionary(language);
  return (key, params) => {
    const template: string = dict[key] ?? MODEL_SELECTOR_STRINGS.en[key] ?? MODEL_SELECTOR_STRINGS.zh[key];
    if (!params) return template;
    return Object.entries(params).reduce(
      (acc, [name, value]) => acc.split(`{${name}}`).join(value),
      template,
    );
  };
}

// useModelSelectorStrings 按当前界面语言取选择器文案（缺失回退英文 → 中文）。
export function useModelSelectorStrings(): ModelSelectorStrings {
  const { i18n } = useTranslation();
  return modelSelectorStringsFor(i18n.language);
}
