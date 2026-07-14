import { describe, expect, it } from 'vitest';
import { VIDEO_MODEL_REGISTRY, VIDEO_DURATIONS, VIDEO_RATIOS, VIDEO_STRINGS, videoModelById } from './videoConfig';

describe('videoConfig', () => {
  it('注册三档 Seedance 模型且档位分辨率正确', () => {
    expect(VIDEO_MODEL_REGISTRY).toHaveLength(3);
    const standard = videoModelById('dreamina-seedance-2-0-hc');
    expect(standard.resolutions).toContain('4k');
    const fast = videoModelById('dreamina-seedance-2-0-fast-hc');
    expect(fast.resolutions).toEqual(['480p', '720p']);
    const mini = videoModelById('dreamina-seedance-2-0-mini-hc');
    expect(mini.resolutions).toEqual(['480p', '720p']);
  });

  it('未知模型回退到第一个注册模型', () => {
    expect(videoModelById('nope').id).toBe(VIDEO_MODEL_REGISTRY[0].id);
  });

  it('时长与画幅选项非空', () => {
    expect(VIDEO_DURATIONS.length).toBeGreaterThan(0);
    expect(VIDEO_RATIOS).toContain('16:9');
  });

  it('四语文案键完全对齐（防漏翻）', () => {
    const zhKeys = Object.keys(VIDEO_STRINGS.zh).sort();
    for (const lang of ['en', 'ja', 'zh-HK'] as const) {
      expect(Object.keys(VIDEO_STRINGS[lang]).sort()).toEqual(zhKeys);
    }
  });

  it('模型 nameKey 都能在字典中取到', () => {
    for (const model of VIDEO_MODEL_REGISTRY) {
      expect(VIDEO_STRINGS.zh[model.nameKey]).toBeTruthy();
      expect(VIDEO_STRINGS.en[model.nameKey]).toBeTruthy();
    }
  });

  it('过期文案与上游 24h 签名口径一致(防回归 30 天)', () => {
    for (const lang of ['zh', 'en', 'ja', 'zh-HK'] as const) {
      expect(VIDEO_STRINGS[lang].expire_hint).toContain('24');
      expect(VIDEO_STRINGS[lang].expire_hint).not.toContain('30');
      expect(VIDEO_STRINGS[lang].expired_title).toBeTruthy();
      expect(VIDEO_STRINGS[lang].expired_hint).toBeTruthy();
      expect(VIDEO_STRINGS[lang].load_failed).toBeTruthy();
    }
  });
});
