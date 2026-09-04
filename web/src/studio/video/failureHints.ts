import type { VideoStringKey } from './videoConfig';

// 执行器失败分类码 → 视频模块文案键。码由 gateway-seedance 的 classifyFailureMessage
// 产出(其它视频执行器未命中时回退上游原文)。只映射用户能采取行动的几类。
// insufficient_balance 例外:它由余额预检产出(studio 402 / core ResourceExhausted),
// 各视频网关插件都会原样落到任务上。
const VIDEO_FAILURE_HINTS: Record<string, VideoStringKey> = {
  output_audio_copyright: 'fail_audio_copyright',
  output_audio_sensitive: 'fail_audio_sensitive',
  output_video_copyright: 'fail_video_copyright',
  output_video_sensitive: 'fail_video_sensitive',
  input_sensitive: 'fail_input_sensitive',
  task_timeout: 'fail_timeout',
  insufficient_balance: 'fail_insufficient_balance',
};

// 提示之外还要把上游原文摆在卡片上的码。其余码的原文退居 tooltip 就够了,
// 余额不足不行——「可用 / 在途预留 / 本条预估」三个金额才是用户要看的信息,
// 藏进 hover 提示在触屏上等于没有。
const VIDEO_FAILURE_RAW_MESSAGE_CODES = new Set(['insufficient_balance']);

export function videoFailureHintKey(code: string | undefined): VideoStringKey | undefined {
  const normalized = (code ?? '').trim().toLowerCase();
  return normalized ? VIDEO_FAILURE_HINTS[normalized] : undefined;
}

export function videoFailureShowsRawMessage(code: string | undefined): boolean {
  const normalized = (code ?? '').trim().toLowerCase();
  return normalized ? VIDEO_FAILURE_RAW_MESSAGE_CODES.has(normalized) : false;
}
