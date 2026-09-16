import { describe, expect, it } from 'vitest';
import { failureHintKey, failureShowsRawMessage } from './failureHints';
import { VIDEO_STRINGS } from './videoConfig';

const LANGS = Object.keys(VIDEO_STRINGS) as Array<keyof typeof VIDEO_STRINGS>;

function expectKeyInEveryLanguage(key: string) {
  for (const lang of LANGS) {
    expect(VIDEO_STRINGS[lang][key as keyof typeof VIDEO_STRINGS['zh']], `${lang} 缺少 ${key}`).toBeTruthy();
  }
}

describe('failureHintKey', () => {
  it('ships five language packs', () => {
    expect([...LANGS].sort()).toEqual(['en', 'es', 'ja', 'zh', 'zh-HK']);
  });

  it('maps actionable seedance video failure codes to hint keys present in every language', () => {
    const cases: Record<string, string> = {
      output_audio_copyright: 'fail_audio_copyright',
      OUTPUT_AUDIO_SENSITIVE: 'fail_audio_sensitive',
      output_video_copyright: 'fail_video_copyright',
      output_video_sensitive: 'fail_video_sensitive',
      input_sensitive: 'fail_input_sensitive',
      task_timeout: 'fail_timeout',
      insufficient_balance: 'fail_insufficient_balance',
    };
    for (const [code, key] of Object.entries(cases)) {
      expect(failureHintKey(code)).toBe(key);
      expectKeyInEveryLanguage(key);
    }
  });

  // 图片任务（gateway-openai / gemini / seedance）的分类码：安全拒绝要给可执行提示，
  // 未归类的上游状态码 http_<n> 统一归到服务侧异常。
  it('maps image task codes, including the http_<n> family', () => {
    const cases: Record<string, string> = {
      safety_rejected: 'fail_safety_rejected',
      bad_request: 'fail_bad_request',
      rate_limited: 'fail_rate_limited',
      auth_failed: 'fail_auth_failed',
      server_error: 'fail_upstream_error',
      http_502: 'fail_upstream_error',
      HTTP_418: 'fail_upstream_error',
      task_interrupted: 'fail_task_interrupted',
      reference_image_invalid: 'fail_reference_invalid',
      reference_image_required: 'fail_reference_required',
      mask_unsupported: 'fail_mask_unsupported',
      upstream_no_image: 'fail_no_output',
      image_store_failed: 'fail_store_failed',
    };
    for (const [code, key] of Object.entries(cases)) {
      expect(failureHintKey(code)).toBe(key);
      expectKeyInEveryLanguage(key);
    }
    expect(failureHintKey('http_5xx')).toBeUndefined();
  });

  // 同一类失败在各视频插件里的不同码（studioFail 词汇 vs seedance 校验码）收敛到同一提示。
  it('folds the per-plugin submit-time codes into shared hints', () => {
    const cases: Record<string, string> = {
      model_not_in_catalog: 'fail_model_not_in_catalog',
      unsupported_model: 'fail_model_not_in_catalog',
      wrong_model_kind: 'fail_wrong_model_kind',
      group_missing: 'fail_group_missing',
      prompt_required: 'fail_prompt_required',
      missing_prompt: 'fail_prompt_required',
      reference_media_unsupported: 'fail_reference_unsupported',
      reference_image_unsupported: 'fail_reference_unsupported',
      reference_image_too_many: 'fail_reference_too_many',
      too_many_images: 'fail_reference_too_many',
      reference_input_invalid: 'fail_reference_invalid',
      submission_rejected: 'fail_submission_rejected',
      upstream_submit_rejected: 'fail_submission_rejected',
      submission_failed: 'fail_upstream_error',
      submit_state_persist_failed: 'fail_persist_failed',
      no_output: 'fail_no_output',
      invalid_request: 'fail_bad_request',
    };
    for (const [code, key] of Object.entries(cases)) {
      expect(failureHintKey(code)).toBe(key);
      expectKeyInEveryLanguage(key);
    }
  });

  // 余额不足的三个金额、参数类失败的具体原因都只在原文里，必须留在卡片上，不能只进 tooltip。
  it('keeps the raw server message visible for balance and parameter failures only', () => {
    expect(failureShowsRawMessage('insufficient_balance')).toBe(true);
    expect(failureShowsRawMessage('INSUFFICIENT_BALANCE')).toBe(true);
    expect(failureShowsRawMessage('bad_request')).toBe(true);
    expect(failureShowsRawMessage('submission_rejected')).toBe(true);
    expect(failureShowsRawMessage('reference_image_too_many')).toBe(true);
    expect(failureShowsRawMessage('task_timeout')).toBe(false);
    expect(failureShowsRawMessage('safety_rejected')).toBe(false);
    expect(failureShowsRawMessage('http_502')).toBe(false);
    expect(failureShowsRawMessage(undefined)).toBe(false);
  });

  it('falls back to undefined for unknown or empty codes so the raw message is shown', () => {
    expect(failureHintKey(undefined)).toBeUndefined();
    expect(failureHintKey('')).toBeUndefined();
    expect(failureHintKey('some_new_code_nobody_mapped')).toBeUndefined();
  });
});
