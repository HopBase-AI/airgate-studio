import { describe, expect, it } from 'vitest';
import {
  VIDEO_MODEL_IDS,
  VIDEO_MODEL_REGISTRY,
  VIDEO_REFERENCE_CAPABILITIES,
  VIDEO_STRINGS,
  validateVideoReferences,
  videoReferenceCapability,
  videoReferenceIssueMessage,
  type VideoReferenceMediaMeta,
} from './videoConfig';

const video = (durationSeconds?: number, width = 1280, height = 720): VideoReferenceMediaMeta => ({
  kind: 'video', durationSeconds, width, height,
});
const audio = (durationSeconds?: number): VideoReferenceMediaMeta => ({ kind: 'audio', durationSeconds });

describe('video reference capabilities', () => {
  it('declares limits for every studio video model', () => {
    for (const model of VIDEO_MODEL_REGISTRY) {
      expect(VIDEO_REFERENCE_CAPABILITIES[model.id], model.id).toBeDefined();
    }
  });

  it('matches the official per-model counts', () => {
    const sd25 = videoReferenceCapability(VIDEO_MODEL_IDS.seedance25);
    expect([sd25.images, sd25.video?.max, sd25.audio?.max, sd25.audioRequiresVisual]).toEqual([30, 10, 10, undefined]);
    const sd20 = videoReferenceCapability(VIDEO_MODEL_IDS.miniDomestic);
    expect([sd20.images, sd20.video?.max, sd20.audio?.max, sd20.audioRequiresVisual]).toEqual([9, 3, 3, true]);
    expect(videoReferenceCapability(VIDEO_MODEL_IDS.minimaxH3).total).toBe(12);
    expect(videoReferenceCapability(VIDEO_MODEL_IDS.minimaxH3Max)).toEqual({ images: 2 });
    expect(videoReferenceCapability(VIDEO_MODEL_IDS.wan30).maxInputPlusOutputSeconds).toBe(30);
    expect(videoReferenceCapability(VIDEO_MODEL_IDS.grokVideo15)).toEqual({ images: 7, imageResolutions: ['480p', '720p'] });
    expect(videoReferenceCapability(VIDEO_MODEL_IDS.klingV26)).toEqual({ images: 4 });
    // 旧的 SD2.5 EP ID 与未登记 ID 走和 videoModelById 相同的回落。
    expect(videoReferenceCapability('dreamina-seedance-2-5-ep')).toBe(sd25);
  });
});

describe('validateVideoReferences', () => {
  const codes = (...args: Parameters<typeof validateVideoReferences>) => validateVideoReferences(...args).map(issue => issue.code);

  it('accepts a full Seedance 2.5 mix and audio-only input', () => {
    const media = [...Array(10)].map(() => video(3)).concat([...Array(10)].map(() => audio(3)));
    expect(codes(VIDEO_MODEL_IDS.seedance25, 30, media, 10)).toEqual([]);
    expect(codes(VIDEO_MODEL_IDS.seedance25Domestic, 0, [audio(20)], -1)).toEqual([]);
  });

  it('enforces Seedance 2.0 counts, durations and audio pairing', () => {
    expect(codes(VIDEO_MODEL_IDS.standardOverseas, 0, [audio(5)], 5)).toEqual(['ref_audio_requires_visual']);
    expect(codes(VIDEO_MODEL_IDS.standardOverseas, 1, [audio(5)], 5)).toEqual([]);
    expect(codes(VIDEO_MODEL_IDS.fastOverseas, 10, [], 5)).toEqual(['ref_too_many_images']);
    expect(codes(VIDEO_MODEL_IDS.fastOverseas, 0, [video(8), video(8)], 5)).toEqual(['ref_video_total']);
    expect(codes(VIDEO_MODEL_IDS.fastOverseas, 0, [video(1.5)], 5)).toEqual(['ref_video_duration']);
    expect(codes(VIDEO_MODEL_IDS.fastOverseas, 0, [video(15.02)], 5)).toEqual([]);
    expect(codes(VIDEO_MODEL_IDS.fastOverseas, 1, [audio(16)], 5)).toEqual(['ref_audio_duration', 'ref_audio_total']);
  });

  it('skips checks that need unknown metadata', () => {
    expect(codes(VIDEO_MODEL_IDS.miniOverseas, 0, [{ kind: 'video' }, { kind: 'video' }], 5)).toEqual([]);
  });

  it('checks video dimensions per model', () => {
    expect(codes(VIDEO_MODEL_IDS.seedance25, 0, [video(5, 3000, 1000)], 5)).toEqual(['ref_video_dimensions']);
    expect(codes(VIDEO_MODEL_IDS.wan30, 0, [video(5, 3000, 1000)], 5)).toEqual([]);
    expect(codes(VIDEO_MODEL_IDS.minimaxH3, 0, [video(5, 200, 400)], 5)).toEqual(['ref_video_dimensions']);
  });

  it('enforces MiniMax H3 total files and rejects media on image-only models', () => {
    expect(codes(VIDEO_MODEL_IDS.minimaxH3, 9, [video(3), video(3), video(3), audio(3)], 5)).toEqual(['ref_too_many_files']);
    expect(codes(VIDEO_MODEL_IDS.minimaxH3Max, 1, [audio(3)], 5)).toEqual(['ref_audios_unsupported']);
    expect(codes(VIDEO_MODEL_IDS.klingV3, 0, [video(3)], 5)).toEqual(['ref_videos_unsupported']);
    expect(codes(VIDEO_MODEL_IDS.happyhorseT2V, 1, [], 5)).toEqual(['ref_images_unsupported']);
    expect(codes(VIDEO_MODEL_IDS.grokVideo15, 8, [], 5)).toEqual(['ref_too_many_images']);
  });

  it('caps Wan 3.0 reference video plus output length unless duration is automatic', () => {
    expect(codes(VIDEO_MODEL_IDS.wan30, 0, [video(15)], 20)).toEqual(['ref_input_plus_output']);
    expect(codes(VIDEO_MODEL_IDS.wan30, 0, [video(15)], 15)).toEqual([]);
    expect(codes(VIDEO_MODEL_IDS.wan30, 0, [video(15)], -1)).toEqual([]);
  });

  it('formats issue messages in every language', () => {
    for (const lang of ['zh', 'en', 'ja', 'zh-HK', 'es'] as const) {
      const vs = (key: keyof typeof VIDEO_STRINGS['zh']) => VIDEO_STRINGS[lang][key];
      const text = videoReferenceIssueMessage({ code: 'ref_video_dimensions', min: 300, max: 6000, ratio: 2.5 }, vs);
      expect(text).toContain('300');
      expect(text).toContain('6000');
      expect(text).toContain('2.5');
      expect(text).not.toMatch(/\{\w+\}/);
    }
  });
});
