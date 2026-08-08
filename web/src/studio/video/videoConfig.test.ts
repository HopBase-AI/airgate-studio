import { describe, expect, it } from 'vitest';
import type { ImageGroup } from '../../api';
import {
  VIDEO_MODEL_IDS,
  VIDEO_MODEL_REGISTRY,
  VIDEO_DURATIONS,
  VIDEO_RATIOS,
  VIDEO_STRINGS,
  videoGroupsForModel,
  videoModelById,
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
    expect(VIDEO_MODEL_REGISTRY).toHaveLength(5);
    const sd25 = videoModelById(VIDEO_MODEL_IDS.seedance25EP);
    expect(sd25.region).toBe('overseas');
    expect(sd25.resolutions).toEqual(['480p']);
    expect(sd25.durationOptions).toEqual([4]);
    expect(sd25.ratioOptions).toEqual(['16:9']);
    const overseas = videoModelById(VIDEO_MODEL_IDS.standardOverseas);
    expect(overseas.region).toBe('overseas');
    expect(overseas.resolutions).toContain('4k');

    const domestic = videoModelById(VIDEO_MODEL_IDS.standardDomestic);
    expect(domestic.region).toBe('domestic');
    expect(domestic.resolutions).toEqual(['480p', '720p', '1080p']);

    const fast = videoModelById(VIDEO_MODEL_IDS.fastOverseas);
    expect(fast.resolutions).toEqual(['480p', '720p']);
    const mini = videoModelById(VIDEO_MODEL_IDS.miniOverseas);
    expect(mini.resolutions).toEqual(['480p', '720p']);
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
