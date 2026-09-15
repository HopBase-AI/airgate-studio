import { describe, expect, it } from 'vitest';
import { buildVideoReferenceInputs } from './StudioContext';

describe('buildVideoReferenceInputs', () => {
  it('orders images, videos and audio while keeping each kind in added order', () => {
    expect(buildVideoReferenceInputs(
      ['/assets-runtime/i1.png', '/assets-runtime/i2.png'],
      ['/assets-runtime/v1.mp4'],
      ['/assets-runtime/a1.wav', '/assets-runtime/a2.mp3'],
    )).toEqual([
      { type: 'image', role: 'reference_image', url: '/assets-runtime/i1.png' },
      { type: 'image', role: 'reference_image', url: '/assets-runtime/i2.png' },
      { type: 'video', role: 'reference_video', url: '/assets-runtime/v1.mp4' },
      { type: 'audio', role: 'reference_audio', url: '/assets-runtime/a1.wav' },
      { type: 'audio', role: 'reference_audio', url: '/assets-runtime/a2.mp3' },
    ]);
  });

  it('omits inputs when there is no reference media', () => {
    expect(buildVideoReferenceInputs([], [], [])).toBeUndefined();
  });

  it('allows audio-only references for models that accept them', () => {
    expect(buildVideoReferenceInputs([], [], ['/assets-runtime/a.wav'])).toEqual([
      { type: 'audio', role: 'reference_audio', url: '/assets-runtime/a.wav' },
    ]);
  });
});
