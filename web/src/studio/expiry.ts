import type { GalleryItem } from './types';

// ── 资产过期口径 ──────────────────────────────────────────────────────────────
// 图片:持久资产,按后台 asset_retention_generated_days 配置(0/null = 永久)。
// 视频:不落盘(产品决策跟随上游规则),上游火山 TOS 签名 URL 完成后 24 小时
// 过期且重查不重签,中继回源即 410——所以视频有效期 = 完成时间 + 24h,
// 与 retentionDays 无关。

export const MS_PER_DAY = 24 * 60 * 60 * 1000;
export const VIDEO_URL_TTL_MS = 24 * 60 * 60 * 1000;

type Translate = (key: string, options?: Record<string, unknown>) => string;

export function formatRemainingTime(t: Translate, ms: number): string {
  const safeMs = Math.max(0, ms);
  const days = Math.floor(safeMs / MS_PER_DAY);
  if (days >= 1) return t('playground.studio_time_days', { count: days });
  const hours = Math.ceil(safeMs / (60 * 60 * 1000));
  if (hours >= 1) return t('playground.studio_time_hours', { count: hours });
  const minutes = Math.max(1, Math.ceil(safeMs / 60000));
  return t('playground.studio_time_minutes', { count: minutes });
}

export function isVideoExpired(createdAt: string, now = Date.now()): boolean {
  const createdAtMs = Date.parse(createdAt);
  if (!Number.isFinite(createdAtMs)) return false;
  return now - createdAtMs >= VIDEO_URL_TTL_MS;
}

export interface ExpiryNotice {
  tone: 'warning' | 'danger';
  remainingLabel: string;
}

export function getExpiryNotice(
  t: Translate,
  item: Pick<GalleryItem, 'createdAt' | 'mediaType'>,
  retentionDays: number | null,
  now = Date.now(),
): ExpiryNotice | null {
  const createdAtMs = Date.parse(item.createdAt);
  if (!Number.isFinite(createdAtMs)) return null;
  if (item.mediaType === 'video') {
    const remainingMs = createdAtMs + VIDEO_URL_TTL_MS - now;
    if (remainingMs <= 0) return { tone: 'danger', remainingLabel: '' };
    // 24h 内恒显剩余时间徽标,兼作"尽快下载"提醒。
    return { tone: 'warning', remainingLabel: formatRemainingTime(t, remainingMs) };
  }
  if (!retentionDays || retentionDays <= 0) return null;
  const expiresAt = createdAtMs + retentionDays * MS_PER_DAY;
  const remainingMs = expiresAt - now;
  if (remainingMs <= 0) {
    return { tone: 'danger', remainingLabel: '' };
  }
  if (remainingMs <= MS_PER_DAY) {
    return { tone: 'warning', remainingLabel: formatRemainingTime(t, remainingMs) };
  }
  return null;
}
