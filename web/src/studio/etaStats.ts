import type { GenerationTask } from '../api';

// ── ETA 滚动统计 ──────────────────────────────────────────────────────────────
// 生成耗时按 (mediaType, model, size, duration) 分桶记录在 localStorage,
// ETA = 桶内最近 N 次的中位数;无历史时回落到静态种子。上游没有真实进度/
// 预估接口(视频任务对象只有 status,图片完全没有),这是唯一可用的预估来源。

export interface EtaParams {
  mediaType: 'image' | 'video';
  model?: string;
  size?: string;
  durationSeconds?: number;
}

const STORE_KEY = 'studio.etaStats.v1';
const MAX_SAMPLES_PER_BUCKET = 10;
const MIN_SANE_SECONDS = 2;
const MAX_SANE_SECONDS = 7200;
// 有样本时中位数钳制在种子的 [0.4, 3] 倍,防首个离群样本把 ETA 带飞。
const CLAMP_LOW = 0.4;
const CLAMP_HIGH = 3;
// 超过 ETA 1.25 倍后不再显示"约 Y",退化为 overtime 文案(不出现负数)。
const OVERTIME_RATIO = 1.25;

type Translate = (key: string, options?: Record<string, unknown>) => string;

export function bucketKey(p: EtaParams): string {
  return `${p.mediaType}|${p.model || ''}|${p.size || ''}|${p.durationSeconds || ''}`;
}

export function medianOf(samples: number[]): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// seedEtaSeconds 静态种子:image 沿用旧写死档位;video 按档位基底 × 分辨率 ×
// 时长系数(mini/720p/5s = 150s 对齐生产实测 ~2.5min;10s ≈ ×1.6,15s 档
// 按同斜率外推 ≈ ×2.2)。未知时长自然落入最近档,不会 map 硬取崩溃。
export function seedEtaSeconds(p: EtaParams): number {
  if (p.mediaType === 'image') {
    const size = p.size || '';
    if (/3840|2160|4k/i.test(size)) return 40;
    if (/2048|2k/i.test(size)) return 25;
    return 15;
  }
  const model = p.model || '';
  const size = (p.size || '').toLowerCase();
  const dur = p.durationSeconds ?? 0;
  const durFactor = dur > 10 ? 2.2 : dur > 5 ? 1.6 : 1;
  // MiniMax H3 系明显快于 Seedance：H3-Max 官方主打极速（5s 片约 15s 出）；
  // 真实中位数会很快由样本覆盖，种子只求量级正确。
  if (/^minimax-/i.test(model)) {
    const base = /-max$/i.test(model) ? 25 : 90;
    const resFactor = size === '2k' ? 1.5 : size === '480p' ? 0.8 : 1;
    return Math.max(10, Math.round((base * resFactor * durFactor) / 5) * 5);
  }
  // 新平台粗种子：真实中位数很快由样本覆盖，只求量级正确。
  if (/^grok-/i.test(model)) {
    const resFactor = size === '1080p' ? 1.4 : size === '480p' ? 0.8 : 1;
    return Math.round((120 * resFactor * durFactor) / 10) * 10;
  }
  if (/^(wan|happyhorse)/i.test(model)) {
    const resFactor = size === '1080p' ? 1.4 : size === '480p' ? 0.8 : 1;
    return Math.round((240 * resFactor * durFactor) / 10) * 10;
  }
  if (/^kling-/i.test(model)) {
    const resFactor = size === '4k' ? 2 : size === '2k' ? 1.5 : size === '1080p' ? 1.2 : 1;
    return Math.round((300 * resFactor * durFactor) / 10) * 10;
  }
  const base = model.includes('-mini-') ? 150 : model.includes('-fast-') ? 210 : 330;
  const resFactor = size === '480p' ? 0.8 : size === '1080p' ? 1.5 : size === '4k' ? 2.5 : 1;
  return Math.round((base * resFactor * durFactor) / 10) * 10;
}

type EtaStore = Record<string, number[]>;

function readStore(): EtaStore {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    const out: EtaStore = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (Array.isArray(value)) {
        const nums = value.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
        if (nums.length > 0) out[key] = nums;
      }
    }
    return out;
  } catch {
    return {};
  }
}

function writeStore(store: EtaStore): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch { /* 隐私模式等场景静默降级,ETA 回落种子 */ }
}

export function recordEtaSample(p: EtaParams, seconds: number): void {
  if (!Number.isFinite(seconds) || seconds < MIN_SANE_SECONDS || seconds > MAX_SANE_SECONDS) return;
  const store = readStore();
  const key = bucketKey(p);
  const samples = store[key] ?? [];
  samples.push(Math.round(seconds));
  store[key] = samples.slice(-MAX_SAMPLES_PER_BUCKET);
  writeStore(store);
}

// 同一远端任务可能被多条路径观察到完成(生成回调 / 恢复轮询 / 5s 刷新),
// 用模块级 Set 按任务 id 去重,入口之间无需协调。
const recordedTaskIds = new Set<number>();

export function recordRemoteTaskSample(remote: GenerationTask, fallback?: Partial<EtaParams>): void {
  if (!remote.completed_at || !remote.created_at) return;
  if (recordedTaskIds.has(remote.id)) return;
  const startMs = Date.parse(remote.created_at);
  const endMs = Date.parse(remote.completed_at);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return;
  const mediaType: EtaParams['mediaType'] =
    remote.kind === 'video' || (remote.video_urls?.length ?? 0) > 0
      ? 'video'
      : fallback?.mediaType ?? 'image';
  recordedTaskIds.add(remote.id);
  recordEtaSample(
    {
      mediaType,
      model: remote.model ?? fallback?.model,
      size: remote.size ?? fallback?.size,
      durationSeconds: remote.duration ?? fallback?.durationSeconds,
    },
    (endMs - startMs) / 1000,
  );
}

export function estimateEtaSeconds(p: EtaParams): number {
  const seed = seedEtaSeconds(p);
  const store = readStore();
  const samples = store[bucketKey(p)]
    ?? store[`${p.mediaType}|${p.model || ''}|${p.size || ''}|`]
    ?? [];
  if (samples.length === 0) return seed;
  const median = medianOf(samples);
  return Math.round(Math.min(seed * CLAMP_HIGH, Math.max(seed * CLAMP_LOW, median)));
}

export function etaDisplayState(elapsedSec: number, etaSec: number): 'eta' | 'overtime' {
  return elapsedSec <= etaSec * OVERTIME_RATIO ? 'eta' : 'overtime';
}

export function formatElapsedCompact(sec: number): string {
  const safe = Math.max(0, Math.round(sec));
  if (safe < 60) return `${safe}s`;
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}m${String(s).padStart(2, '0')}s`;
}

// formatEtaLabel 秒级取 5s 步进,超过 100s 切分钟(复用 core 已有的
// studio_time_minutes 复数键;新键均带 defaultValue,core i18n 未部署也可用)。
export function formatEtaLabel(t: Translate, sec: number): string {
  if (sec < 100) {
    const rounded = Math.max(5, Math.round(sec / 5) * 5);
    return t('playground.studio_time_seconds', { count: rounded, defaultValue: '{{count}}s' });
  }
  const minutes = Math.max(1, Math.round(sec / 60));
  return t('playground.studio_time_minutes', { count: minutes, defaultValue: '{{count}} min' });
}

// 仅供测试:清空模块级去重集合。
export function resetEtaSampleDedupeForTest(): void {
  recordedTaskIds.clear();
}
