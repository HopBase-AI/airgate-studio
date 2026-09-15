import { describe, expect, it } from 'vitest';

import {
  KLING_V26_DURATIONS,
  VIDEO_DURATIONS,
  VIDEO_MODEL_IDS,
  VIDEO_RATIOS,
  WAN30_DURATIONS,
  normalizeVideoSubmissionSettingsForModel,
  validateVideoReferences,
  videoModelById,
  videoRatioOptionsFor,
} from './videoConfig';

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

describe('video parameter options follow the official specs', () => {
  it('Kling v2.6 offers only 5 and 10 seconds', () => {
    expect([...KLING_V26_DURATIONS]).toEqual([5, 10]);
    expect(videoModelById(VIDEO_MODEL_IDS.klingV26).durationOptions).toEqual([5, 10]);
  });

  it('Seedance 2.0 offers every integer second from 4 to 15 plus auto, and all seven ratios', () => {
    expect([...VIDEO_DURATIONS]).toEqual([...range(4, 15), -1]);
    expect([...VIDEO_RATIOS]).toEqual(['16:9', '4:3', '1:1', '3:4', '9:16', '21:9', 'adaptive']);
    for (const id of [VIDEO_MODEL_IDS.standardOverseas, VIDEO_MODEL_IDS.fastDomestic, VIDEO_MODEL_IDS.miniOverseas]) {
      const model = videoModelById(id);
      expect(model.durationOptions).toBeUndefined();
      expect(model.ratioOptions).toBeUndefined();
    }
  });

  it('Wan 3.0 offers every integer second from 2 to 30 plus auto', () => {
    expect([...WAN30_DURATIONS]).toEqual([...range(2, 30), -1]);
  });

  it('MiniMax H3 allows the adaptive ratio only with reference media', () => {
    const h3 = videoModelById(VIDEO_MODEL_IDS.minimaxH3);
    expect(videoRatioOptionsFor(h3, false)).not.toContain('adaptive');
    expect(videoRatioOptionsFor(h3, true)).toContain('adaptive');
    const settings = { duration: 5, resolution: '768P', ratio: 'adaptive' };
    expect(normalizeVideoSubmissionSettingsForModel(VIDEO_MODEL_IDS.minimaxH3, settings, true).ratio).toBe('adaptive');
    expect(normalizeVideoSubmissionSettingsForModel(VIDEO_MODEL_IDS.minimaxH3, settings).ratio).toBe('16:9');
    expect(videoRatioOptionsFor(videoModelById(VIDEO_MODEL_IDS.minimaxH3Max), true)).not.toContain('adaptive');
  });

  it('Grok caps the resolution at 720p when reference images are attached', () => {
    const codes = (resolution: string | undefined, images: number) =>
      validateVideoReferences(VIDEO_MODEL_IDS.grokVideo15, images, [], 5, resolution).map(issue => issue.code);
    expect(codes('1080p', 1)).toEqual(['ref_image_resolution']);
    expect(codes('720p', 2)).toEqual([]);
    expect(codes('480p', 1)).toEqual([]);
    expect(codes('1080p', 0)).toEqual([]);
    expect(codes(undefined, 1)).toEqual([]);
    expect(validateVideoReferences(VIDEO_MODEL_IDS.seedance25, 1, [], 5, '720p')).toEqual([]);
  });
});
