import { describe, expect, it } from 'vitest';
import { videoFailureHintKey } from './failureHints';
import { VIDEO_STRINGS } from './videoConfig';

describe('videoFailureHintKey', () => {
  it('maps actionable seedance failure codes to hint keys present in every language', () => {
    const cases: Record<string, string> = {
      output_audio_copyright: 'fail_audio_copyright',
      OUTPUT_AUDIO_SENSITIVE: 'fail_audio_sensitive',
      output_video_copyright: 'fail_video_copyright',
      output_video_sensitive: 'fail_video_sensitive',
      input_sensitive: 'fail_input_sensitive',
      task_timeout: 'fail_timeout',
    };
    for (const [code, key] of Object.entries(cases)) {
      expect(videoFailureHintKey(code)).toBe(key);
      for (const lang of Object.keys(VIDEO_STRINGS) as Array<keyof typeof VIDEO_STRINGS>) {
        expect(VIDEO_STRINGS[lang][key as keyof typeof VIDEO_STRINGS['zh']]).toBeTruthy();
      }
    }
  });

  it('falls back to undefined for unknown or empty codes so the raw message is shown', () => {
    expect(videoFailureHintKey(undefined)).toBeUndefined();
    expect(videoFailureHintKey('')).toBeUndefined();
    expect(videoFailureHintKey('upstream_generation_failed')).toBeUndefined();
  });
});
