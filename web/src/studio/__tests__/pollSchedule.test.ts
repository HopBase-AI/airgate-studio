// 轮询节奏回归。
//
// 改造前是固定 2s：图片常在 1-3 秒出结果，首检等满 2s 是白等；视频常态 2-10 分钟，
// 固定 2s 要打上百次「还在跑」的无效请求。改成首检快 + 指数退避到上限后，必须保证
// 三件事：首检确实更快、退避有上限（结果不会长时间显示不出来）、
// 总超时预算与改造前分毫不差。
import { describe, expect, it } from 'vitest';
import { pollDelayMs, pollSleepBudgetMs } from '../StudioContext';

// 与 StudioContext 内的常量对齐（模块内私有，这里按契约复述）
const LEGACY_INTERVAL_MS = 2000;
const IMAGE_MAX_ATTEMPTS = 300;
const VIDEO_MAX_ATTEMPTS = 1800;
const MAX_DELAY_MS = 4000;

function schedule(maxAttempts: number): number[] {
  const budget = pollSleepBudgetMs(maxAttempts);
  const delays: number[] = [];
  let slept = 0;
  for (let attempt = 0; slept < budget; attempt++) {
    const d = pollDelayMs(attempt);
    delays.push(d);
    slept += d;
  }
  return delays;
}

describe('轮询等待节奏', () => {
  it('首检比原固定间隔更快', () => {
    expect(pollDelayMs(0)).toBeLessThan(LEGACY_INTERVAL_MS);
  });

  it('等待时长单调不减', () => {
    for (let i = 1; i < 40; i++) {
      expect(pollDelayMs(i), `第 ${i} 次等待短于上一次`).toBeGreaterThanOrEqual(pollDelayMs(i - 1));
    }
  });

  it('退避有上限，结果不会长时间显示不出来', () => {
    for (let i = 0; i < 200; i++) {
      expect(pollDelayMs(i)).toBeLessThanOrEqual(MAX_DELAY_MS);
    }
    expect(pollDelayMs(100)).toBe(MAX_DELAY_MS);
  });

  it('负数/零一律回落到首检时长（防御非法入参）', () => {
    expect(pollDelayMs(-5)).toBe(pollDelayMs(0));
    expect(pollDelayMs(0)).toBe(pollDelayMs(0));
  });

  it('总睡眠预算与改造前（次数 × 固定间隔）完全一致', () => {
    expect(pollSleepBudgetMs(IMAGE_MAX_ATTEMPTS)).toBe(IMAGE_MAX_ATTEMPTS * LEGACY_INTERVAL_MS);
    expect(pollSleepBudgetMs(VIDEO_MAX_ATTEMPTS)).toBe(VIDEO_MAX_ATTEMPTS * LEGACY_INTERVAL_MS);
  });

  it('实际排期的总睡眠不短于预算（超时不会提前发生）', () => {
    for (const attempts of [IMAGE_MAX_ATTEMPTS, VIDEO_MAX_ATTEMPTS]) {
      const delays = schedule(attempts);
      const total = delays.reduce((sum, d) => sum + d, 0);
      expect(total, `${attempts} 次预算下总睡眠 ${total}ms 短于 ${pollSleepBudgetMs(attempts)}ms`)
        .toBeGreaterThanOrEqual(pollSleepBudgetMs(attempts));
    }
  });

  it('长任务的请求次数显著少于固定间隔方案', () => {
    const videoPolls = schedule(VIDEO_MAX_ATTEMPTS).length;
    expect(videoPolls).toBeLessThan(VIDEO_MAX_ATTEMPTS);
    // 上限 4s vs 原 2s，长尾请求数应约减半
    expect(videoPolls).toBeLessThanOrEqual(VIDEO_MAX_ATTEMPTS / 1.9);
  });

  // 注意口径：本文件只算主轮询自身的排期。工作台另有一条 5s 兜底刷新，
  // 但它会跳过主轮询正在跟进的任务（isTaskPolledLive），不会叠加重复请求——
  // 该行为由 studioRenderPath.test.ts 的「兜底刷新不与主轮询重复请求同一任务」守。
  it('一个 5 分钟视频的主轮询次数从 150 次降到 80 次以内', () => {
    const delays = schedule(VIDEO_MAX_ATTEMPTS);
    let slept = 0;
    let polls = 0;
    for (const d of delays) {
      if (slept >= 300_000) break;
      slept += d;
      polls += 1;
    }
    expect(polls).toBeLessThanOrEqual(80);
    // 固定 2s 方案同期为 150 次
    expect(polls).toBeLessThan(300_000 / LEGACY_INTERVAL_MS);
  });

  it('快结果场景：3 秒内完成时首检更早命中', () => {
    // 新节奏前两次检查落在 0.8s / 1.92s；旧节奏为 2s / 4s
    expect(pollDelayMs(0)).toBeLessThan(LEGACY_INTERVAL_MS);
    expect(pollDelayMs(0) + pollDelayMs(1)).toBeLessThan(LEGACY_INTERVAL_MS * 2);
  });
});
