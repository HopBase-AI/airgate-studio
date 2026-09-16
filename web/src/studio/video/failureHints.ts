import type { VideoStringKey } from './videoConfig';

// 执行器失败分类码 → 文案键（五语字典在 videoConfig.ts 的 VIDEO_STRINGS）。
//
// 红线：插件写进任务 error_message 的原文一律英文，本地化只能在这里按 error_code 做；
// 映射不到的码退回原文。码由各网关插件产出：
//   - gateway-openai / gemini / seedance 图片任务：safety_rejected / bad_request / rate_limited /
//     auth_failed / server_error / http_<n>，以及 task_interrupted / reference_image_* 等；
//   - gateway-seedance 视频：classifyFailureMessage 的内容审核六类 + 请求校验码（unsupported_model、
//     too_many_images…）；
//   - gateway-bailian / minimax / kling 视频：studioFail 的提交期确定性失败码；
//   - 余额预检：insufficient_balance（studio 402 / core ResourceExhausted）。
// 同一类失败在不同插件里可能叫不同的码（如 unsupported_model 与 model_not_in_catalog），
// 这里一律收敛到同一个文案键，前端不区分来源。
interface FailureHint {
  key: VideoStringKey;
  // 提示之外还要把上游原文摆在卡片上：参数类失败的具体原因（哪个参数、上限多少）
  // 与余额不足的三个金额都只在原文里，藏进 hover 提示在触屏上等于没有。
  raw?: boolean;
}

const FAILURE_HINTS: Record<string, FailureHint> = {
  // ── 内容审核（seedance 视频六类 + 图片安全拒绝）──
  output_audio_copyright: { key: 'fail_audio_copyright' },
  output_audio_sensitive: { key: 'fail_audio_sensitive' },
  output_video_copyright: { key: 'fail_video_copyright' },
  output_video_sensitive: { key: 'fail_video_sensitive' },
  input_sensitive: { key: 'fail_input_sensitive' },
  safety_rejected: { key: 'fail_safety_rejected' },
  // ── 余额 / 额度 ──
  insufficient_balance: { key: 'fail_insufficient_balance', raw: true },
  insufficient_quota: { key: 'fail_insufficient_balance', raw: true },
  // ── 超时 / 中断 ──
  task_timeout: { key: 'fail_timeout' },
  stale_timeout: { key: 'fail_timeout' },
  media_probe_timeout: { key: 'fail_timeout' },
  task_interrupted: { key: 'fail_task_interrupted' },
  task_canceled: { key: 'fail_task_interrupted' },
  // ── 上游 / 服务侧 ──
  rate_limited: { key: 'fail_rate_limited' },
  upstream_rate_limited: { key: 'fail_rate_limited' },
  auth_failed: { key: 'fail_auth_failed' },
  upstream_authentication_failed: { key: 'fail_auth_failed' },
  server_error: { key: 'fail_upstream_error' },
  upstream_unavailable: { key: 'fail_upstream_error' },
  upstream_forward_failed: { key: 'fail_upstream_error' },
  upstream_generation_failed: { key: 'fail_upstream_error' },
  upstream_submit_transport: { key: 'fail_upstream_error' },
  upstream_response_invalid: { key: 'fail_upstream_error' },
  upstream_task_not_found: { key: 'fail_upstream_error' },
  submission_failed: { key: 'fail_upstream_error' },
  submission_response_invalid: { key: 'fail_upstream_error' },
  studio_submit_failed: { key: 'fail_upstream_error' },
  submission_rejected: { key: 'fail_submission_rejected', raw: true },
  upstream_submit_rejected: { key: 'fail_submission_rejected', raw: true },
  no_output: { key: 'fail_no_output' },
  upstream_no_image: { key: 'fail_no_output' },
  image_store_failed: { key: 'fail_store_failed' },
  submit_state_persist_failed: { key: 'fail_persist_failed' },
  // ── 参数 / 请求（原文里有具体参数名与上限，一并展示）──
  bad_request: { key: 'fail_bad_request', raw: true },
  invalid_request: { key: 'fail_bad_request', raw: true },
  unsupported_resolution: { key: 'fail_bad_request', raw: true },
  unsupported_parameter: { key: 'fail_bad_request', raw: true },
  invalid_duration: { key: 'fail_bad_request', raw: true },
  invalid_ratio: { key: 'fail_bad_request', raw: true },
  invalid_aspect_ratio: { key: 'fail_bad_request', raw: true },
  invalid_parameter_range: { key: 'fail_bad_request', raw: true },
  invalid_parameter_type: { key: 'fail_bad_request', raw: true },
  // ── 模型 / 分组 / 提示词 ──
  model_not_in_catalog: { key: 'fail_model_not_in_catalog' },
  unsupported_model: { key: 'fail_model_not_in_catalog' },
  unsupported_task_type: { key: 'fail_wrong_model_kind' },
  wrong_model_kind: { key: 'fail_wrong_model_kind' },
  group_missing: { key: 'fail_group_missing' },
  missing_billing_group: { key: 'fail_group_missing' },
  prompt_required: { key: 'fail_prompt_required' },
  missing_prompt: { key: 'fail_prompt_required' },
  empty_text: { key: 'fail_prompt_required' },
  empty_content: { key: 'fail_prompt_required' },
  // ── 参考素材 ──
  reference_image_invalid: { key: 'fail_reference_invalid' },
  reference_input_invalid: { key: 'fail_reference_invalid' },
  invalid_asset_url: { key: 'fail_reference_invalid' },
  invalid_media_url: { key: 'fail_reference_invalid' },
  invalid_reference_images: { key: 'fail_reference_invalid' },
  media_download_failed: { key: 'fail_reference_invalid' },
  media_dns_failed: { key: 'fail_reference_invalid' },
  reference_image_required: { key: 'fail_reference_required' },
  reference_image_unsupported: { key: 'fail_reference_unsupported' },
  reference_media_unsupported: { key: 'fail_reference_unsupported' },
  unsupported_reference_media: { key: 'fail_reference_unsupported' },
  unsupported_reference_type: { key: 'fail_reference_unsupported' },
  mask_unsupported: { key: 'fail_mask_unsupported' },
  reference_image_too_many: { key: 'fail_reference_too_many', raw: true },
  too_many_images: { key: 'fail_reference_too_many', raw: true },
  too_many_frame_images: { key: 'fail_reference_too_many', raw: true },
  too_many_videos: { key: 'fail_reference_too_many', raw: true },
  too_many_audios: { key: 'fail_reference_too_many', raw: true },
  reference_asset_not_ready: { key: 'fail_reference_not_ready' },
  // ── 语音合成（studio 后端 speech.go：提交前校验码 + 上游映射码）──
  speech_text_required: { key: 'fail_prompt_required' },
  speech_text_too_long: { key: 'fail_speech_text_too_long' },
  speech_unsupported_model: { key: 'fail_model_not_in_catalog' },
  speech_invalid_speed: { key: 'fail_bad_request', raw: true },
  speech_invalid_parameter: { key: 'fail_bad_request', raw: true },
  speech_group_missing: { key: 'fail_group_missing' },
  speech_voice_not_found: { key: 'fail_speech_voice_not_found', raw: true },
  speech_no_audio: { key: 'fail_speech_no_audio' },
  speech_store_failed: { key: 'fail_store_failed' },
  project_not_found: { key: 'fail_bad_request', raw: true },
};

function lookup(code: string | undefined): FailureHint | undefined {
  const normalized = (code ?? '').trim().toLowerCase();
  if (!normalized) return undefined;
  const hint = FAILURE_HINTS[normalized];
  if (hint) return hint;
  // gateway-openai / gemini / seedance 图片任务对未归类的上游状态码写 http_<n>。
  if (/^http_\d{3}$/.test(normalized)) return { key: 'fail_upstream_error' };
  return undefined;
}

export function failureHintKey(code: string | undefined): VideoStringKey | undefined {
  return lookup(code)?.key;
}

export function failureShowsRawMessage(code: string | undefined): boolean {
  return lookup(code)?.raw === true;
}
