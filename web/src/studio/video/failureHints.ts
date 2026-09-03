import type { VideoStringKey } from './videoConfig';

// 执行器失败分类码 → 视频模块文案键。码由 gateway-seedance 的 classifyFailureMessage
// 产出(其它视频执行器未命中时回退上游原文)。只映射用户能采取行动的几类。
const VIDEO_FAILURE_HINTS: Record<string, VideoStringKey> = {
  output_audio_copyright: 'fail_audio_copyright',
  output_audio_sensitive: 'fail_audio_sensitive',
  output_video_copyright: 'fail_video_copyright',
  output_video_sensitive: 'fail_video_sensitive',
  input_sensitive: 'fail_input_sensitive',
  task_timeout: 'fail_timeout',
};

export function videoFailureHintKey(code: string | undefined): VideoStringKey | undefined {
  const normalized = (code ?? '').trim().toLowerCase();
  return normalized ? VIDEO_FAILURE_HINTS[normalized] : undefined;
}
