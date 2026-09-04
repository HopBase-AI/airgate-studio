import { describe, expect, it } from 'vitest';
import type { ImageGroup } from '../../api';
import {
  VIDEO_MODEL_IDS,
  LEGACY_SEEDANCE25_MODEL_ID,
  VIDEO_MODEL_REGISTRY,
  VIDEO_DURATIONS,
  VIDEO_RATIOS,
  SEEDANCE25_DURATIONS,
  SEEDANCE25_RATIOS,
  SEEDANCE20_VIDEO_DEFAULTS,
  SEEDANCE25_VIDEO_DEFAULTS,
  VIDEO_STRINGS,
  canonicalVideoModelId,
  videoGroupsForModel,
  videoDefaultsForModel,
  videoModelById,
  normalizeVideoSettingsForModel,
  normalizeVideoSubmissionSettingsForModel,
  formatVideoCostEstimate,
} from './videoConfig';

function group(id: number, name: string): ImageGroup {
  return {
    id,
    name,
    platform: 'seedance',
    rate_multiplier: 6.12,
    effective_rate: 6.12,
  };
}

describe('videoConfig', () => {
  it('注册国内外 Seedance 模型且分辨率边界正确', () => {
    expect(VIDEO_MODEL_REGISTRY).toHaveLength(13);
	    expect(VIDEO_MODEL_IDS.seedance25).toBe('dreamina-seedance-2-5-260628');
	    expect(VIDEO_MODEL_IDS.seedance25EP).toBe(VIDEO_MODEL_IDS.seedance25);
	    expect(VIDEO_MODEL_REGISTRY.map(model => model.id)).not.toContain(LEGACY_SEEDANCE25_MODEL_ID);
	    const sd25 = videoModelById(VIDEO_MODEL_IDS.seedance25);
    expect(sd25.region).toBe('overseas');
    expect(sd25.resolutions).toEqual(['480p', '720p']);
    expect(sd25.durationOptions).toEqual(SEEDANCE25_DURATIONS);
    expect(sd25.ratioOptions).toEqual(SEEDANCE25_RATIOS);
    const overseas = videoModelById(VIDEO_MODEL_IDS.standardOverseas);
    expect(overseas.region).toBe('overseas');
    expect(overseas.resolutions).toContain('4k');
    // grok 虽挂 seedance 平台但契约独立（自带时长/画幅表），此处只断言 dreamina/doubao 系。
    const seedance20 = VIDEO_MODEL_REGISTRY.filter(item => item.platform === 'seedance'
      && item.id !== VIDEO_MODEL_IDS.seedance25EP && item.id !== VIDEO_MODEL_IDS.grokVideo15);
    for (const model of seedance20) {
      expect(model.durationOptions).toBeUndefined();
      expect(model.ratioOptions).toBeUndefined();
    }

    const domestic = videoModelById(VIDEO_MODEL_IDS.standardDomestic);
    expect(domestic.region).toBe('domestic');
    expect(domestic.resolutions).toEqual(['480p', '720p', '1080p']);

    const fast = videoModelById(VIDEO_MODEL_IDS.fastOverseas);
    expect(fast.resolutions).toEqual(['480p', '720p']);
    const mini = videoModelById(VIDEO_MODEL_IDS.miniOverseas);
    expect(mini.resolutions).toEqual(['480p', '720p']);
  });

  it('注册 MiniMax H3 系且与 gateway-minimax 契约对齐', () => {
    const h3 = videoModelById(VIDEO_MODEL_IDS.minimaxH3);
    expect(h3.platform).toBe('minimax');
    expect(h3.resolutions).toEqual(['768P', '2K']);
    expect(h3.durationOptions).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    expect(h3.supportsAudio).toBe(false);
    expect(h3.supportsReturnLastFrame).toBe(false);

    const h3Max = videoModelById(VIDEO_MODEL_IDS.minimaxH3Max);
    expect(h3Max.platform).toBe('minimax');
    expect(h3Max.resolutions).toEqual(['480P', '768P']);
    expect(h3Max.durationOptions?.[0]).toBe(5);
    expect(h3Max.durationOptions?.at(-1)).toBe(15);

    // 文生画幅不能是 adaptive，选项里不得出现。
    for (const model of [h3, h3Max]) {
      expect(model.ratioOptions).not.toContain('adaptive');
    }

    // MiniMax 默认档必须同时落在 H3 与 H3-Max 的合法区间。
    const defaults = videoDefaultsForModel(VIDEO_MODEL_IDS.minimaxH3);
    expect(defaults).toEqual({ duration: 5, resolution: '768P', ratio: '16:9' });
    expect(videoDefaultsForModel(VIDEO_MODEL_IDS.minimaxH3Max)).toEqual(defaults);
    expect(normalizeVideoSettingsForModel(VIDEO_MODEL_IDS.minimaxH3Max, defaults)).toEqual(defaults);
  });

  it('注册 grok/百炼/可灵视频模型且参数域与各插件契约对齐', () => {
    const grok = videoModelById(VIDEO_MODEL_IDS.grokVideo15);
    expect(grok.platform).toBe('seedance');
    expect(grok.resolutions).toEqual(['480p', '720p', '1080p']);
    expect(grok.durationOptions?.[0]).toBe(1);
    expect(grok.durationOptions).not.toContain(-1);
    expect(grok.ratioOptions).not.toContain('adaptive');
    expect(grok.ratioOptions).not.toContain('21:9');
    expect(grok.ratioOptions).toContain('3:2');
    expect(grok.supportsWatermark).toBe(false);

    const wan = videoModelById(VIDEO_MODEL_IDS.wan30);
    expect(wan.platform).toBe('bailian');
    expect(wan.durationOptions).toContain(-1);
    expect(wan.ratioOptions).toContain('adaptive');
    expect(wan.supportsAudio).not.toBe(false);

    const hhI2V = videoModelById(VIDEO_MODEL_IDS.happyhorseI2V);
    expect(hhI2V.supportsRatio).toBe(false);
    expect(hhI2V.supportsAudio).toBe(false);

    const klingV3 = videoModelById(VIDEO_MODEL_IDS.klingV3);
    expect(klingV3.platform).toBe('kling');
    expect(klingV3.resolutions).toEqual(['720p', '1080p', '2k', '4k']);
    expect(klingV3.durationOptions?.[0]).toBe(3);
    // v2.6 720p 有声档官方未定价，必须锁无声避免 fail-closed 400。
    const klingV26 = videoModelById(VIDEO_MODEL_IDS.klingV26);
    expect(klingV26.supportsAudio).toBe(false);
    expect(klingV26.durationOptions).toEqual([5, 6, 7, 8, 9, 10]);

    for (const id of [VIDEO_MODEL_IDS.grokVideo15, VIDEO_MODEL_IDS.wan30, VIDEO_MODEL_IDS.klingV3]) {
      const defaults = videoDefaultsForModel(id);
      const model = videoModelById(id);
      expect(model.resolutions).toContain(defaults.resolution);
      expect(model.durationOptions ?? []).toContain(defaults.duration);
    }
  });

  it('跨平台切换按大小写不敏感匹配分辨率并采用目标写法', () => {
    expect(normalizeVideoSettingsForModel(VIDEO_MODEL_IDS.klingV3, {
      duration: 5, resolution: '1080P', ratio: '16:9',
    }).resolution).toBe('1080p');
    expect(normalizeVideoSettingsForModel(VIDEO_MODEL_IDS.wan30, {
      duration: 5, resolution: '1080p', ratio: '16:9',
    }).resolution).toBe('1080P');
  });

  it('grok 挂 seedance 平台但不参与国内互斥过滤', () => {
    const shared = group(39, 'Grok 视频');
    const domestic = group(26, 'Seedance 2.0 国内');
    const groupsByModel = {
      [VIDEO_MODEL_IDS.grokVideo15]: [shared, domestic],
      [VIDEO_MODEL_IDS.standardDomestic]: [domestic],
    };
    // 即使某组同时可调度国内 doubao,grok 的分组集合也原样返回。
    expect(videoGroupsForModel(VIDEO_MODEL_IDS.grokVideo15, groupsByModel))
      .toEqual([shared, domestic]);
  });

  it('从 Seedance 切到 MiniMax 时越界参数收敛到 MiniMax 默认档', () => {
    expect(normalizeVideoSettingsForModel(VIDEO_MODEL_IDS.minimaxH3, {
      duration: -1,
      resolution: '720p',
      ratio: 'adaptive',
    })).toEqual({ duration: 5, resolution: '768P', ratio: '16:9' });
    expect(normalizeVideoSubmissionSettingsForModel(VIDEO_MODEL_IDS.minimaxH3Max, {
      duration: 4,
      resolution: '2K',
      ratio: '21:9',
    })).toEqual({ duration: 5, resolution: '768P', ratio: '21:9' });
  });

  it('从海外选项排除为 API 别名兼容而挂载的国内分组', () => {
    const overseas = group(21, 'Seedance 2.0 海外');
    const domestic = group(26, 'Seedance 2.0 国内');
    const groupsByModel = {
      [VIDEO_MODEL_IDS.standardOverseas]: [overseas, domestic],
      [VIDEO_MODEL_IDS.standardDomestic]: [domestic],
      [VIDEO_MODEL_IDS.fastOverseas]: [overseas],
      [VIDEO_MODEL_IDS.miniOverseas]: [overseas],
    };

    expect(videoGroupsForModel(VIDEO_MODEL_IDS.standardOverseas, groupsByModel))
      .toEqual([overseas]);
    expect(videoGroupsForModel(VIDEO_MODEL_IDS.standardDomestic, groupsByModel))
      .toEqual([domestic]);
    expect(videoGroupsForModel(VIDEO_MODEL_IDS.fastOverseas, groupsByModel))
      .toEqual([overseas]);
  });

  it('未知模型回退到第一个注册模型', () => {
    expect(videoModelById('nope').id).toBe(VIDEO_MODEL_REGISTRY[0].id);
  });

  it('历史 SD2.5 别名在注册表查找前归一化为官方 ID', () => {
    expect(canonicalVideoModelId(LEGACY_SEEDANCE25_MODEL_ID)).toBe(VIDEO_MODEL_IDS.seedance25);
    expect(videoModelById(LEGACY_SEEDANCE25_MODEL_ID).id).toBe(VIDEO_MODEL_IDS.seedance25);
  });

  it('切换到 SD2.5 时使用网关文档的默认参数', () => {
    expect(videoDefaultsForModel(VIDEO_MODEL_IDS.seedance25EP)).toEqual(SEEDANCE25_VIDEO_DEFAULTS);
    expect(normalizeVideoSettingsForModel(VIDEO_MODEL_IDS.seedance25EP, {
      duration: 30,
      resolution: '480p',
      ratio: '21:9',
    })).toEqual(SEEDANCE25_VIDEO_DEFAULTS);
  });

  it('从 SD2.5 切回每个 2.0 模型时移除 2.5 专有参数', () => {
    const sd25Settings = videoDefaultsForModel(VIDEO_MODEL_IDS.seedance25EP);
    const seedance20 = VIDEO_MODEL_REGISTRY.filter(item => item.platform === 'seedance' && item.id !== VIDEO_MODEL_IDS.seedance25EP);
    for (const model of seedance20) {
      const normalized = normalizeVideoSettingsForModel(model.id, sd25Settings);
      expect(normalized).toEqual(SEEDANCE20_VIDEO_DEFAULTS);
      expect(VIDEO_DURATIONS).toContain(normalized.duration);
      expect(model.resolutions).toContain(normalized.resolution);
      expect(VIDEO_RATIOS).toContain(normalized.ratio);
    }
  });

  it('提交历史 2.0 路由时收敛当前 SD2.5 的越界参数', () => {
    expect(normalizeVideoSubmissionSettingsForModel(VIDEO_MODEL_IDS.fastOverseas, {
      duration: 30,
      resolution: '1080p',
      ratio: 'adaptive',
    })).toEqual({
      duration: 4,
      resolution: '720p',
      ratio: '16:9',
    });
  });

  it('提交当前 SD2.5 路由时保留合法的 30 秒与宽画幅', () => {
    expect(normalizeVideoSubmissionSettingsForModel(VIDEO_MODEL_IDS.seedance25, {
      duration: 30,
      resolution: '480p',
      ratio: '21:9',
    })).toEqual({
      duration: 30,
      resolution: '480p',
      ratio: '21:9',
    });
  });

  it('保留 2.0 预设并为 SD2.5 提供独立完整矩阵', () => {
    expect(VIDEO_DURATIONS).toEqual([4, 5, 10, 15]);
    expect(VIDEO_RATIOS).toEqual(['16:9', '9:16', '1:1', '4:3']);
    expect(SEEDANCE25_DURATIONS[0]).toBe(4);
    expect(SEEDANCE25_DURATIONS.at(-2)).toBe(30);
    expect(SEEDANCE25_DURATIONS.at(-1)).toBe(-1);
    expect(SEEDANCE25_DURATIONS).toHaveLength(28);
    expect(SEEDANCE25_RATIOS).toEqual(['16:9', '4:3', '1:1', '3:4', '9:16', '21:9', 'adaptive']);
  });

  it('五语文案键完全对齐（防漏翻）', () => {
    const zhKeys = Object.keys(VIDEO_STRINGS.zh).sort();
    for (const lang of ['en', 'ja', 'zh-HK', 'es'] as const) {
      expect(Object.keys(VIDEO_STRINGS[lang]).sort()).toEqual(zhKeys);
    }
  });

  it('模型 nameKey 都能在字典中取到', () => {
    for (const model of VIDEO_MODEL_REGISTRY) {
      expect(VIDEO_STRINGS.zh[model.nameKey]).toBeTruthy();
      expect(VIDEO_STRINGS.en[model.nameKey]).toBeTruthy();
    }
  });

  // 「预计 ≈ $X」靠 {amount} 占位符注入金额：任一语言漏了占位符，界面上就只剩一句
  // 没有数字的「预计 ≈」——五语一起断言。
  it('预算预览文案五语都带 {amount} 占位符', () => {
    for (const lang of ['zh', 'en', 'ja', 'zh-HK', 'es'] as const) {
      expect(VIDEO_STRINGS[lang].estimate_label).toContain('{amount}');
      expect(VIDEO_STRINGS[lang].estimate_insufficient).toBeTruthy();
      expect(VIDEO_STRINGS[lang].fail_insufficient_balance).toBeTruthy();
    }
  });

  it('金额一律两位小数，非美元前置币种代码', () => {
    expect(formatVideoCostEstimate(1.5, 'USD')).toBe('$1.50');
    expect(formatVideoCostEstimate(21, 'usd')).toBe('$21.00');
    expect(formatVideoCostEstimate(0.123, '')).toBe('$0.12');
    expect(formatVideoCostEstimate(3, 'CNY')).toBe('CNY 3.00');
  });

  it('过期文案与上游 24h 签名口径一致(防回归 30 天)', () => {
    for (const lang of ['zh', 'en', 'ja', 'zh-HK', 'es'] as const) {
      expect(VIDEO_STRINGS[lang].expire_hint).toContain('24');
      expect(VIDEO_STRINGS[lang].expire_hint).not.toContain('30');
      expect(VIDEO_STRINGS[lang].expired_title).toBeTruthy();
      expect(VIDEO_STRINGS[lang].expired_hint).toBeTruthy();
      expect(VIDEO_STRINGS[lang].load_failed).toBeTruthy();
    }
  });
});
