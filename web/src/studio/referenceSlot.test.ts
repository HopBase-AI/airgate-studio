import { describe, expect, it } from 'vitest';

import {
  REFERENCE_CLEAR_MIN,
  referenceSlotCountText,
  referenceSlotState,
  referenceSlotUploadingText,
} from './referenceSlot';
import { VIDEO_STRINGS, type VideoStringKey } from './video/videoConfig';

const LANGS = ['zh', 'en', 'ja', 'zh-HK', 'es'] as const;

function stringsOf(lang: (typeof LANGS)[number]) {
  return (key: VideoStringKey) => VIDEO_STRINGS[lang][key];
}

describe('referenceSlotState', () => {
  // 槽只有一个位置，三种内容互斥——有问题时用户该先解决问题，不该同时看见「清除」。
  it('阻塞问题压过上传中与计数：不出计数、不出清除', () => {
    const slot = referenceSlotState({
      warnText: '当前模型不支持参考音频',
      removable: true,
      uploadingCount: 2,
      referenceCount: 5,
    });
    expect(slot).toEqual({ kind: 'warn', text: '当前模型不支持参考音频', removable: true });
  });

  it('阻塞问题不可一键移除时 removable 为 false', () => {
    expect(referenceSlotState({ warnText: '参考音频需至少搭配 1 张参考图', referenceCount: 3 }))
      .toEqual({ kind: 'warn', text: '参考音频需至少搭配 1 张参考图', removable: false });
  });

  it('空白警告文案视同无问题，落回下一优先级', () => {
    expect(referenceSlotState({ warnText: '   ', uploadingCount: 0, referenceCount: 3 }))
      .toEqual({ kind: 'count', count: 3 });
  });

  it('上传中压过计数：不出计数、不出清除', () => {
    expect(referenceSlotState({ warnText: null, uploadingCount: 1, referenceCount: 4 }))
      .toEqual({ kind: 'uploading', count: 1 });
  });

  it('无问题且没在传时才显示计数与清除', () => {
    expect(referenceSlotState({ referenceCount: 2 })).toEqual({ kind: 'count', count: 2 });
    expect(referenceSlotState({ referenceCount: 7 })).toEqual({ kind: 'count', count: 7 });
  });

  it('素材少于 2 个时整组不出现（一个谈不上「全部」）', () => {
    expect(REFERENCE_CLEAR_MIN).toBe(2);
    expect(referenceSlotState({ referenceCount: 0 })).toBeNull();
    expect(referenceSlotState({ referenceCount: 1 })).toBeNull();
    // 只有一个素材但它正在上传：仍要告诉用户「在传」。
    expect(referenceSlotState({ referenceCount: 1, uploadingCount: 1 }))
      .toEqual({ kind: 'uploading', count: 1 });
    // 只有一个素材但它有问题：警告照出。
    expect(referenceSlotState({ referenceCount: 1, warnText: '参考视频仅支持 MP4、MOV' }))
      .toEqual({ kind: 'warn', text: '参考视频仅支持 MP4、MOV', removable: false });
  });
});

describe('referenceSlot 文案', () => {
  // 每张缩略卡自带各自的百分比，槽里绝不能合成一个假的总进度——只说「在传」与数量。
  it('上传中只报数量，不带百分比', () => {
    for (const lang of LANGS) {
      const vs = stringsOf(lang);
      const one = referenceSlotUploadingText(1, vs);
      const many = referenceSlotUploadingText(3, vs);
      expect(one).toBeTruthy();
      expect(one).not.toContain('{count}');
      expect(one).not.toContain('%');
      expect(many).toContain('3');
      expect(many).not.toContain('{count}');
      expect(many).not.toContain('%');
    }
  });

  it('计数文案五语都注入数量', () => {
    for (const lang of LANGS) {
      const text = referenceSlotCountText(4, stringsOf(lang));
      expect(text).toContain('4');
      expect(text).not.toContain('{count}');
    }
  });

  it('槽内五条文案五语齐备，占位符不漏', () => {
    const keys: VideoStringKey[] = ['ref_slot_count', 'ref_slot_clear', 'ref_slot_remove', 'ref_slot_uploading_one', 'ref_slot_uploading_many'];
    for (const lang of LANGS) {
      for (const key of keys) expect(VIDEO_STRINGS[lang][key]).toBeTruthy();
      expect(VIDEO_STRINGS[lang].ref_slot_count).toContain('{count}');
      expect(VIDEO_STRINGS[lang].ref_slot_uploading_many).toContain('{count}');
      expect(VIDEO_STRINGS[lang].ref_slot_uploading_one).not.toContain('{count}');
    }
  });

  // 行尾槽宽度有限：「移除」用短标签，长文案（ref_remove_unsupported）只挂 title。
  it('「移除」短标签明显短于完整文案', () => {
    for (const lang of LANGS) {
      expect(VIDEO_STRINGS[lang].ref_slot_remove.length).toBeLessThan(VIDEO_STRINGS[lang].ref_remove_unsupported.length);
      expect(VIDEO_STRINGS[lang].ref_slot_remove.length).toBeLessThanOrEqual(8);
      expect(VIDEO_STRINGS[lang].ref_slot_clear.length).toBeLessThanOrEqual(8);
    }
  });
});
