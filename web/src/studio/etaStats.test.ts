import { describe, expect, it } from 'vitest';
import {
  bucketKey,
  estimateEtaSeconds,
  etaDisplayState,
  formatElapsedCompact,
  formatEtaLabel,
  medianOf,
  recordEtaSample,
  seedEtaSeconds,
} from './etaStats';

describe('etaStats', () => {
  it('medianOf 奇数/偶数/单样本', () => {
    expect(medianOf([3, 1, 2])).toBe(2);
    expect(medianOf([1, 2, 3, 4])).toBe(2.5);
    expect(medianOf([7])).toBe(7);
    expect(medianOf([])).toBe(0);
  });

  it('bucketKey 缺省字段稳定', () => {
    expect(bucketKey({ mediaType: 'image' })).toBe('image|||');
    expect(bucketKey({ mediaType: 'video', model: 'm', size: '720p', durationSeconds: 5 }))
      .toBe('video|m|720p|5');
  });

  it('seedEtaSeconds 图片沿用旧写死档位', () => {
    expect(seedEtaSeconds({ mediaType: 'image', size: '3840x2160' })).toBe(40);
    expect(seedEtaSeconds({ mediaType: 'image', size: '2048x2048' })).toBe(25);
    expect(seedEtaSeconds({ mediaType: 'image', size: '1024x1024' })).toBe(15);
    expect(seedEtaSeconds({ mediaType: 'image' })).toBe(15);
  });

  it('seedEtaSeconds 视频按档位×分辨率×时长', () => {
    // mini + 720p + 5s = 150(生产实测 ~2.5min)
    expect(seedEtaSeconds({ mediaType: 'video', model: 'dreamina-seedance-2-0-mini-hc', size: '720p', durationSeconds: 5 })).toBe(150);
    // standard + 4k + 10s = 330 × 2.5 × 1.6 = 1320
    expect(seedEtaSeconds({ mediaType: 'video', model: 'dreamina-seedance-2-0-hc', size: '4k', durationSeconds: 10 })).toBe(1320);
    // fast + 480p + 5s = 210 × 0.8 = 168 → 170(取 10s 步进)
    expect(seedEtaSeconds({ mediaType: 'video', model: 'dreamina-seedance-2-0-fast-hc', size: '480p', durationSeconds: 5 })).toBe(170);
  });

  it('etaDisplayState 1.25× 边界', () => {
    expect(etaDisplayState(125, 100)).toBe('eta');
    expect(etaDisplayState(126, 100)).toBe('overtime');
    expect(etaDisplayState(0, 15)).toBe('eta');
  });

  it('formatElapsedCompact', () => {
    expect(formatElapsedCompact(59)).toBe('59s');
    expect(formatElapsedCompact(60)).toBe('1m00s');
    expect(formatElapsedCompact(185)).toBe('3m05s');
  });

  it('formatEtaLabel 秒级 5s 步进,>=100s 切分钟', () => {
    const t = (key: string, options?: Record<string, unknown>) =>
      `${key}:${options?.count}`;
    expect(formatEtaLabel(t, 17)).toBe('playground.studio_time_seconds:15');
    expect(formatEtaLabel(t, 3)).toBe('playground.studio_time_seconds:5');
    expect(formatEtaLabel(t, 150)).toBe('playground.studio_time_minutes:3');
  });

  it('无 window 环境不抛异常且回落种子', () => {
    // vitest node 环境无 localStorage:record 静默丢弃,estimate 回种子。
    expect(() => recordEtaSample({ mediaType: 'image' }, 20)).not.toThrow();
    expect(estimateEtaSeconds({ mediaType: 'image', size: '1024x1024' })).toBe(15);
    expect(estimateEtaSeconds({ mediaType: 'video', model: 'dreamina-seedance-2-0-mini-hc', size: '720p', durationSeconds: 5 })).toBe(150);
  });

  it('recordEtaSample 丢弃非法样本(不抛)', () => {
    expect(() => recordEtaSample({ mediaType: 'image' }, 1)).not.toThrow();
    expect(() => recordEtaSample({ mediaType: 'image' }, 10000)).not.toThrow();
    expect(() => recordEtaSample({ mediaType: 'image' }, Number.NaN)).not.toThrow();
  });
});
