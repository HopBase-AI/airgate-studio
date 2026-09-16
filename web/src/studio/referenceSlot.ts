// 参考素材缩略条「行尾状态槽」的取舍逻辑。
//
// 槽只有一个位置（缩略条同一行的行尾），三种内容按优先级互斥：
//   1. 阻塞问题（超限 / 拒收 / 缺搭配）——用户不解决就发不出去，必须压过其它一切；
//   2. 上传中——瞬时状态，只说「在传」与数量，绝不合成总进度（每张缩略卡自带各自的百分比）；
//   3. 「N 个素材 · 清除」——行尾摘要，素材少于 2 个时整组不出现（一个谈不上「全部」）。
//
// 抽成纯函数是为了能单测优先级，避免以后有人往这一行再塞第四种状态。
import type { VideoStringKey } from './video/videoConfig';

export type ReferenceSlot =
  | { kind: 'warn'; text: string; removable: boolean }
  | { kind: 'uploading'; count: number }
  | { kind: 'count'; count: number };

export interface ReferenceSlotInput {
  /** 已本地化的阻塞问题文案；无问题传 null。 */
  warnText?: string | null;
  /** 是否可一键「移除不支持的素材」。 */
  removable?: boolean;
  /** 正在上传的参考素材数量。 */
  uploadingCount?: number;
  /** 缩略条里的素材总数（参考图 + 参考视频 / 音频）。 */
  referenceCount: number;
}

/** 素材数低于此值时不显示计数与「清除」。 */
export const REFERENCE_CLEAR_MIN = 2;

export function referenceSlotState(input: ReferenceSlotInput): ReferenceSlot | null {
  const warnText = input.warnText?.trim();
  if (warnText) return { kind: 'warn', text: warnText, removable: input.removable === true };
  const uploadingCount = input.uploadingCount ?? 0;
  if (uploadingCount > 0) return { kind: 'uploading', count: uploadingCount };
  if (input.referenceCount >= REFERENCE_CLEAR_MIN) return { kind: 'count', count: input.referenceCount };
  return null;
}

type VideoStrings = (key: VideoStringKey) => string;

/** 上传中文案：只报「几个在传」，不带百分比——各卡进度不同，合成一个总进度是假的。 */
export function referenceSlotUploadingText(count: number, vs: VideoStrings): string {
  if (count <= 1) return vs('ref_slot_uploading_one');
  return vs('ref_slot_uploading_many').replaceAll('{count}', String(count));
}

export function referenceSlotCountText(count: number, vs: VideoStrings): string {
  return vs('ref_slot_count').replaceAll('{count}', String(count));
}
