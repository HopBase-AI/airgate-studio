import { describe, expect, it } from 'vitest';
import { getExpiryNotice, isVideoExpired, MS_PER_DAY, VIDEO_URL_TTL_MS } from './expiry';

const t = (key: string, options?: Record<string, unknown>) =>
  `${key}${options?.count != null ? `:${options.count}` : ''}`;

const BASE = Date.parse('2026-07-14T00:00:00Z');
const createdAt = new Date(BASE).toISOString();

describe('expiry', () => {
  it('视频 24h 内返回 warning 且带剩余时间', () => {
    const now = BASE + VIDEO_URL_TTL_MS - 61 * 60 * 1000; // 剩 61 分钟
    const notice = getExpiryNotice(t, { createdAt, mediaType: 'video' }, null, now);
    expect(notice?.tone).toBe('warning');
    expect(notice?.remainingLabel).toContain('studio_time_hours');
  });

  it('视频 23h59m 仍 warning,24h+1s 变 danger', () => {
    const warning = getExpiryNotice(t, { createdAt, mediaType: 'video' }, null, BASE + VIDEO_URL_TTL_MS - 60 * 1000);
    expect(warning?.tone).toBe('warning');
    const danger = getExpiryNotice(t, { createdAt, mediaType: 'video' }, null, BASE + VIDEO_URL_TTL_MS + 1000);
    expect(danger?.tone).toBe('danger');
  });

  it('视频口径忽略 retentionDays(即使 null/0 也按 24h 算)', () => {
    expect(getExpiryNotice(t, { createdAt, mediaType: 'video' }, null, BASE + 1000)?.tone).toBe('warning');
    expect(getExpiryNotice(t, { createdAt, mediaType: 'video' }, 0, BASE + 1000)?.tone).toBe('warning');
  });

  it('图片行为与迁移前一致:retentionDays 生效,临期 24h 内才提示', () => {
    const days = 7;
    expect(getExpiryNotice(t, { createdAt, mediaType: 'image' }, days, BASE + MS_PER_DAY)).toBeNull();
    const warning = getExpiryNotice(t, { createdAt, mediaType: 'image' }, days, BASE + days * MS_PER_DAY - 60 * 60 * 1000);
    expect(warning?.tone).toBe('warning');
    const danger = getExpiryNotice(t, { createdAt, mediaType: 'image' }, days, BASE + days * MS_PER_DAY + 1000);
    expect(danger?.tone).toBe('danger');
  });

  it('图片 retentionDays=null → 永不提示;mediaType 缺省按图片处理', () => {
    expect(getExpiryNotice(t, { createdAt, mediaType: undefined }, null, BASE + 100 * MS_PER_DAY)).toBeNull();
  });

  it('isVideoExpired 边界与非法时间', () => {
    expect(isVideoExpired(createdAt, BASE + VIDEO_URL_TTL_MS - 1)).toBe(false);
    expect(isVideoExpired(createdAt, BASE + VIDEO_URL_TTL_MS)).toBe(true);
    expect(isVideoExpired('not-a-date', BASE)).toBe(false);
  });
});
