import { type CSSProperties, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cssVar } from '@doudou-start/airgate-theme';
import { useStudio } from './StudioContext';
import type { GalleryItem, StudioGenerationTask } from './types';
import { studioStyles as ss } from './studioStyles';
import { downloadImage } from '../utils';

function useNearViewport(rootMargin = '600px', estimatedHeight = 0) {
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const heightRef = useRef<number>(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setNear(true);
        } else {
          if (el.offsetHeight > 0) heightRef.current = el.offsetHeight;
          setNear(false);
        }
      },
      { rootMargin },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [rootMargin]);

  // Real measurement wins; estimate is only a fallback so the off-screen slot
  // has a reservable height before the card has rendered once.
  const placeholderHeight = heightRef.current || estimatedHeight;
  return { ref, near, placeholderHeight };
}

function confirm(message: string): Promise<boolean> {
  const ag = (window as unknown as { airgate?: { confirm: (msg: string) => Promise<boolean> } }).airgate;
  if (ag?.confirm) return ag.confirm(message);
  return Promise.resolve(window.confirm(message));
}

// Core's runtime asset handler accepts ?w=256/?w=512 to serve a JPEG
// thumbnail. Anything served from a different origin (S3, CDN) ignores the
// param and returns the original — harmless but no benefit, so we only emit
// srcset when the asset is local.
function isLocalRuntimeAsset(url: string): boolean {
  return url.startsWith('/assets-runtime/');
}

function buildThumbSrcSet(url: string): string | undefined {
  if (!isLocalRuntimeAsset(url)) return undefined;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}w=256 256w, ${url}${sep}w=512 512w, ${url} 1024w`;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function formatCreatedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatRemainingTime(ms: number): string {
  const safeMs = Math.max(0, ms);
  const days = Math.floor(safeMs / MS_PER_DAY);
  if (days >= 1) return `${days} 天`;
  const hours = Math.ceil(safeMs / (60 * 60 * 1000));
  if (hours >= 1) return `${hours} 小时`;
  const minutes = Math.max(1, Math.ceil(safeMs / 60000));
  return `${minutes} 分钟`;
}

function getExpiryNotice(createdAt: string, retentionDays: number | null): { tone: 'warning' | 'danger'; remainingLabel: string } | null {
  if (!retentionDays || retentionDays <= 0) return null;
  const createdAtMs = Date.parse(createdAt);
  if (!Number.isFinite(createdAtMs)) return null;
  const expiresAt = createdAtMs + retentionDays * MS_PER_DAY;
  const remainingMs = expiresAt - Date.now();
  if (remainingMs <= 0) {
    return { tone: 'danger', remainingLabel: '' };
  }
  if (remainingMs <= MS_PER_DAY) {
    return { tone: 'warning', remainingLabel: formatRemainingTime(remainingMs) };
  }
  return null;
}

// Parse "1024x1024" → 1, "1024x768" → 0.75. Returns undefined if unparseable
// so callers can fall back to letting the image define its own aspect ratio.
function parseAspectRatio(size: string | undefined): number | undefined {
  if (!size) return undefined;
  const m = /^(\d+)x(\d+)$/.exec(size);
  if (!m) return undefined;
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (!w || !h) return undefined;
  return w / h;
}

function useCopyOnClick(text: string | undefined | null) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
  }, []);

  const copy = useCallback(async (e: React.MouseEvent) => {
    if (!text) return;
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Fallback for non-secure contexts where Clipboard API is unavailable.
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch { /* ignore */ }
      document.body.removeChild(ta);
    }
    setCopied(true);
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setCopied(false), 1500);
  }, [text]);

  return { copied, copy };
}

// ── TaskCard ────────────────────────────────────────────────────────────────

const taskCardStyles: Record<string, CSSProperties> = {
  card: {
    position: 'relative',
    borderRadius: 14,
    overflow: 'hidden',
    background: cssVar('bgElevated'),
    border: `1px solid ${cssVar('borderSubtle')}`,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: 16,
    marginBottom: 14,
    breakInside: 'avoid',
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
  } as CSSProperties,
  spinner: {
    width: 32,
    height: 32,
    border: `2px solid ${cssVar('borderSubtle')}`,
    borderTopColor: cssVar('textSecondary'),
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
    flexShrink: 0,
  },
  failedIcon: {
    width: 32,
    height: 32,
    borderRadius: '50%',
    border: `2px solid ${cssVar('dangerSubtle')}`,
    color: cssVar('danger'),
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 18,
    fontWeight: 700,
    flexShrink: 0,
  },
  prompt: {
    fontSize: 11,
    color: cssVar('textTertiary'),
    textAlign: 'center',
    lineHeight: 1.45,
    overflow: 'hidden',
    display: '-webkit-box',
    WebkitLineClamp: 3,
    WebkitBoxOrient: 'vertical',
  },
  statusLabel: {
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    color: cssVar('textTertiary'),
    fontFamily: cssVar('fontMono'),
  },
  errorText: {
    fontSize: 10,
    color: cssVar('danger'),
    textAlign: 'center',
    lineHeight: 1.45,
    overflow: 'hidden',
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical',
    opacity: 0.85,
  },
  failedActions: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  retryBtn: {
    padding: '4px 12px',
    border: `1px solid ${cssVar('borderSubtle')}`,
    borderRadius: 6,
    background: 'transparent',
    color: cssVar('textSecondary'),
    fontSize: 10,
    fontWeight: 500,
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'all 0.15s',
  },
  deleteBtn: {
    padding: '4px 12px',
    border: `1px solid ${cssVar('dangerSubtle')}`,
    borderRadius: 6,
    background: 'transparent',
    color: cssVar('danger'),
    fontSize: 10,
    fontWeight: 500,
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'all 0.15s',
  },
};

// 批量聚合卡专用：子任务状态点行
const batchCardStyles: Record<string, CSSProperties> = {
  dotRow: {
    display: 'flex',
    gap: 5,
    flexWrap: 'wrap',
    justifyContent: 'center',
    maxWidth: 140,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    border: '1.5px solid transparent',
    boxSizing: 'border-box',
    transition: 'background 0.2s',
  },
};

const batchStyles: Record<string, CSSProperties> = {
  toolbar: {
    position: 'sticky',
    top: 0,
    zIndex: 25,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    margin: '0 0 14px',
    padding: '8px 10px',
    borderRadius: 12,
    background: cssVar('bgElevated'),
    border: `1px solid ${cssVar('borderSubtle')}`,
    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.18)',
    backdropFilter: 'blur(10px)',
    WebkitBackdropFilter: 'blur(10px)',
  },
  toolbarLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    minWidth: 0,
  },
  toolbarRight: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  },
  label: {
    fontSize: 12,
    color: cssVar('textSecondary'),
    fontWeight: 600,
    whiteSpace: 'nowrap',
  },
  hint: {
    fontSize: 11,
    color: cssVar('textTertiary'),
    whiteSpace: 'nowrap',
  },
  actionBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 30,
    padding: '0 10px',
    border: `1px solid ${cssVar('borderSubtle')}`,
    borderRadius: 7,
    background: 'transparent',
    color: cssVar('textSecondary'),
    cursor: 'pointer',
    fontSize: 11,
    fontWeight: 600,
    fontFamily: 'inherit',
    whiteSpace: 'nowrap',
    transition: 'all 0.15s',
  },
  dangerBtn: {
    border: `1px solid ${cssVar('dangerSubtle')}`,
    color: cssVar('danger'),
  },
  disabledBtn: {
    opacity: 0.45,
    cursor: 'not-allowed',
  },
  cardSelectable: {
    cursor: 'default',
  },
  cardSelected: {
    borderColor: cssVar('primary'),
    boxShadow: `0 0 0 1px ${cssVar('primaryGlow')}, 0 2px 8px rgba(0, 0, 0, 0.12)`,
  },
  selectBtn: {
    position: 'absolute',
    top: 8,
    left: 8,
    zIndex: 5,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 24,
    height: 24,
    padding: 0,
    border: `1px solid ${cssVar('borderSubtle')}`,
    borderRadius: 7,
    background: cssVar('bgElevated'),
    color: cssVar('textTertiary'),
    cursor: 'pointer',
    transition: 'all 0.15s',
  },
  selectBtnSelected: {
    borderColor: cssVar('primary'),
    background: cssVar('primarySubtle'),
    color: cssVar('text'),
  },
};

function TaskCard({ task }: { task: StudioGenerationTask }) {
  const { t } = useTranslation();
  const { deleteTask, generate, setSelectedModelId, setImageSize, setImageMode, retryBatchFailures, tasks } = useStudio();
  const { copied, copy } = useCopyOnClick(task.prompt);

  // 生成反馈：已用时计时（每秒）、队列位置、按尺寸档的 ETA 估算。
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (task.status === 'completed' || task.status === 'failed') return;
    const started = new Date(task.createdAt).getTime();
    const tick = () => setElapsed(Math.max(0, Math.round((Date.now() - started) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [task.createdAt, task.status]);
  const queuePos = task.status === 'queued'
    ? tasks.filter(x => x.status === 'queued').findIndex(x => x.id === task.id) + 1
    : 0;
  const etaSeconds = /3840|2160|4k/i.test(task.size || '') ? 40 : /2048|2k/i.test(task.size || '') ? 25 : 15;

  // 批量任务：渲染聚合卡（子任务进度 + 全部重试）。
  const isBatch = !!task.subtasks && task.subtasks.length > 0;
  const subtasks = task.subtasks ?? [];
  const doneCount = subtasks.filter(s => s.status === 'completed').length;
  const failedCount = subtasks.filter(s => s.status === 'failed').length;
  const processingCount = subtasks.filter(s => s.status === 'processing').length;
  const total = subtasks.length;

  const statusLabel = task.status === 'queued'
    ? t('playground.studio_task_queued', { defaultValue: '队列中...' })
    : task.status === 'failed'
      ? t('playground.studio_task_failed', { defaultValue: '生成失败' })
      : t('playground.studio_task_processing', { defaultValue: '生成中...' });

  const handleRetry = () => {
    if (!task.prompt) return;
    deleteTask(task.id);
    if (task.model) setSelectedModelId(task.model);
    if (task.size) setImageSize(task.size);
    setImageMode(task.mode);
    setTimeout(() => generate(task.prompt, { mode: task.mode }), 0);
  };

  const handleDelete = async () => {
    if (!await confirm(t('playground.studio_confirm_delete_task', { defaultValue: '确定要删除这个任务吗？' }))) return;
    deleteTask(task.id);
  };

  // ── 批量聚合卡 ──────────────────────────────────────────────────────────
  if (isBatch) {
    const batchProcessing = processingCount > 0;
    return (
      <div style={taskCardStyles.card}>
        {batchProcessing ? (
          <div style={taskCardStyles.spinner} />
        ) : failedCount > 0 ? (
          <div style={taskCardStyles.failedIcon}>!</div>
        ) : (
          <div style={{ ...taskCardStyles.failedIcon, border: `2px solid ${cssVar('borderSubtle')}`, color: cssVar('textSecondary') }}>✓</div>
        )}
        <div style={taskCardStyles.statusLabel}>
          {batchProcessing
            ? t('playground.studio_batch_progress', { defaultValue: '批量生成 {{done}}/{{total}}', done: doneCount, total })
            : failedCount > 0
              ? t('playground.studio_batch_partial', { defaultValue: '成功 {{done}} · 失败 {{failed}}', done: doneCount, failed: failedCount })
              : t('playground.studio_batch_done', { defaultValue: '批量完成 {{total}} 张', total })}
        </div>
        {/* 子任务状态点：直观看每张的成功/失败/进行中 */}
        <div style={batchCardStyles.dotRow}>
          {subtasks.map(s => (
            <span
              key={s.id}
              style={{
                ...batchCardStyles.dot,
                background: s.status === 'completed'
                  ? cssVar('primary')
                  : s.status === 'failed'
                    ? cssVar('danger')
                    : 'transparent',
                borderColor: s.status === 'processing' ? cssVar('textTertiary') : 'transparent',
              }}
              title={s.status === 'failed' ? (s.error || '失败') : s.status === 'completed' ? '成功' : '生成中'}
            />
          ))}
        </div>
        {task.prompt && (
          <div
            style={{
              ...taskCardStyles.prompt,
              cursor: 'pointer',
              color: copied ? cssVar('primary') : taskCardStyles.prompt.color,
              transition: 'color 0.2s',
            }}
            onClick={copy}
            title={copied ? '已复制到剪贴板' : '点击复制提示词'}
          >
            {copied ? '✓ 已复制' : task.prompt}
          </div>
        )}
        {!batchProcessing && failedCount > 0 && (
          <div style={taskCardStyles.failedActions}>
            <button
              type="button"
              style={taskCardStyles.retryBtn}
              className="studio-gallery-action"
              onClick={() => retryBatchFailures(task.id)}
            >
              {t('playground.studio_retry_failed', { defaultValue: '重试失败的 {{count}} 张', count: failedCount })}
            </button>
            <button
              type="button"
              style={taskCardStyles.deleteBtn}
              className="studio-gallery-action"
              onClick={handleDelete}
            >
              {t('playground.studio_delete', { defaultValue: '删除' })}
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={taskCardStyles.card}>
      {task.status === 'failed' ? (
        <div style={taskCardStyles.failedIcon}>!</div>
      ) : (
        <div style={taskCardStyles.spinner} />
      )}
      <div style={taskCardStyles.statusLabel}>{statusLabel}</div>
      {task.status !== 'failed' && (
        <>
          <div style={{ width: '72%', maxWidth: 200, height: 3, borderRadius: 999, background: cssVar('bgHover'), overflow: 'hidden', margin: '1px 0' }}>
            <div style={{
              height: '100%',
              width: typeof task.progress === 'number' && task.progress > 0 ? `${Math.min(100, task.progress)}%` : '40%',
              background: cssVar('primary'),
              borderRadius: 999,
              opacity: typeof task.progress === 'number' && task.progress > 0 ? 1 : 0.45,
              transition: 'width 0.4s ease',
            }} />
          </div>
          <div style={{ fontSize: 10, color: cssVar('textTertiary'), fontFamily: cssVar('fontMono') }}>
            {task.status === 'queued' && queuePos > 0
              ? t('playground.studio_queue_position', { defaultValue: '队列中 · 第 {{pos}} 位', pos: queuePos })
              : t('playground.studio_eta', { defaultValue: '已用 {{elapsed}}s · 约 {{eta}}s', elapsed, eta: etaSeconds })}
            {typeof task.progress === 'number' && task.progress > 0 ? ` · ${Math.round(task.progress)}%` : ''}
          </div>
        </>
      )}
      {task.status === 'failed' && task.error && (
        <div style={taskCardStyles.errorText}>{task.error}</div>
      )}
      {task.prompt && (
        <div
          style={{
            ...taskCardStyles.prompt,
            cursor: 'pointer',
            color: copied ? cssVar('primary') : taskCardStyles.prompt.color,
            transition: 'color 0.2s',
          }}
          onClick={copy}
          title={copied ? '已复制到剪贴板' : '点击复制提示词'}
        >
          {copied ? '✓ 已复制' : task.prompt}
        </div>
      )}
      {task.status === 'failed' && (
        <div style={taskCardStyles.failedActions}>
          <button
            type="button"
            style={taskCardStyles.retryBtn}
            className="studio-gallery-action"
            onClick={handleRetry}
          >
            {t('playground.studio_retry', { defaultValue: '重试' })}
          </button>
          <button
            type="button"
            style={taskCardStyles.deleteBtn}
            className="studio-gallery-action"
            onClick={handleDelete}
          >
            {t('playground.studio_delete', { defaultValue: '删除' })}
          </button>
        </div>
      )}
    </div>
  );
}

// ── GalleryCard ─────────────────────────────────────────────────────────────

const GALLERY_COL_WIDTH = 200;
const GALLERY_OVERLAY_HEIGHT = 104;

interface GalleryCardProps {
  item: GalleryItem;
  index: number;
  selectionMode?: boolean;
  selected?: boolean;
  onToggleSelected?: (id: string) => void;
}

function GalleryCard({ item, index, selectionMode = false, selected = false, onToggleSelected }: GalleryCardProps) {
  const { t } = useTranslation();
  const { setPreviewItem, deleteGalleryItem, useAsReference, regenerate, variations, requestEdit, generatedAssetRetentionDays } = useStudio();
  const { copied, copy } = useCopyOnClick(item.prompt);
  const aspectRatio = parseAspectRatio(item.size);
  const createdAtLabel = formatCreatedAt(item.createdAt);
  const expiryNotice = getExpiryNotice(item.createdAt, generatedAssetRetentionDays);
  const estimatedHeight = aspectRatio
    ? Math.round(GALLERY_COL_WIDTH / aspectRatio) + GALLERY_OVERLAY_HEIGHT
    : 0;
  const { ref, near, placeholderHeight } = useNearViewport('800px', estimatedHeight);

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation();
    void downloadImage(item.url, item.alt);
  };

  const handleRegenerate = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!await confirm(t('playground.studio_confirm_regenerate', { defaultValue: '确定要重新生成吗？将消耗一次生成额度。' }))) return;
    regenerate(item);
  };

  const handleUseAsReference = (e: React.MouseEvent) => {
    e.stopPropagation();
    useAsReference(item);
  };

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!await confirm(t('playground.studio_confirm_delete', { defaultValue: '确定要删除这张图片吗？' }))) return;
    deleteGalleryItem(item.id);
  };

  const handleToggleSelected = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleSelected?.(item.id);
  };

  const handlePreview = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (selectionMode) {
      onToggleSelected?.(item.id);
      return;
    }
    setPreviewItem(item);
  };

  if (!near && placeholderHeight > 0) {
    return (
      <div
        ref={ref}
        style={{
          ...ss.galleryCard,
          ...(selected ? batchStyles.cardSelected : {}),
          height: placeholderHeight,
          background: cssVar('bgElevated'),
        }}
        className="studio-gallery-card"
      />
    );
  }

  return (
    <div
      ref={ref}
      style={{
        ...ss.galleryCard,
        ...(selectionMode ? batchStyles.cardSelectable : {}),
        ...(selected ? batchStyles.cardSelected : {}),
        animationDelay: `${Math.min(index * 50, 300)}ms`,
      }}
      className="studio-gallery-card"
      onClick={selectionMode ? handleToggleSelected : undefined}
    >
      {selectionMode && (
        <button
          type="button"
          style={{
            ...batchStyles.selectBtn,
            ...(selected ? batchStyles.selectBtnSelected : {}),
          }}
          className="studio-gallery-action"
          onClick={handleToggleSelected}
          aria-pressed={selected}
          title={selected
            ? t('playground.studio_batch_unselect', { defaultValue: '取消选择' })
            : t('playground.studio_batch_select', { defaultValue: '选择' })}
        >
          {selected && (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6L9 17l-5-5" />
            </svg>
          )}
        </button>
      )}
      <img
        src={item.url}
        srcSet={buildThumbSrcSet(item.url)}
        sizes="(max-width: 1023px) 50vw, 200px"
        alt={item.alt || item.prompt}
        style={aspectRatio !== undefined ? { ...ss.galleryCardImg, aspectRatio: String(aspectRatio) } : ss.galleryCardImg}
        loading="lazy"
        decoding="async"
        fetchPriority="low"
        onClick={handlePreview}
      />
      <div style={ss.galleryCardOverlay}>
        <div style={ss.galleryCardMetaRow}>
          {item.size && (
            <span style={ss.galleryCardMetaItem}>{item.size}</span>
          )}
              <span style={ss.galleryCardMetaItem}>
                {t('playground.studio_created_at', { defaultValue: '创建于' })}
                {' '}
                {createdAtLabel}
              </span>
          {expiryNotice && (
            <span
              style={{
                ...ss.galleryCardExpiryBadge,
                ...(expiryNotice.tone === 'danger' ? ss.galleryCardExpiryBadgeDanger : ss.galleryCardExpiryBadgeWarning),
              }}
              >
                {expiryNotice.tone === 'danger'
                ? t('playground.studio_asset_expired', { defaultValue: '已过期，请立即保存' })
                : t('playground.studio_asset_expiring', { defaultValue: '还有 {{time}} 过期，请尽快保存', time: expiryNotice.remainingLabel })}
              </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {item.prompt && (
            <div
              style={{
                ...ss.galleryCardPrompt,
                flex: 1,
                minWidth: 0,
                cursor: 'pointer',
                color: copied ? cssVar('primary') : ss.galleryCardPrompt.color,
                transition: 'color 0.2s',
              }}
              onClick={copy}
              title={copied ? '已复制到剪贴板' : '点击复制提示词'}
            >
              {copied ? '✓ 已复制' : item.prompt}
            </div>
          )}
        </div>
        <div style={ss.galleryCardActions}>
          <button
            type="button"
            style={ss.galleryCardActionBtn}
            className="studio-gallery-action"
            onClick={handleDownload}
            title={t('playground.studio_download', { defaultValue: '下载' })}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </button>
          <button
            type="button"
            style={ss.galleryCardActionBtn}
            className="studio-gallery-action"
            onClick={handleRegenerate}
            title={t('playground.studio_regenerate', { defaultValue: '重试' })}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 4v6h6" />
              <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
            </svg>
          </button>
          <button
            type="button"
            style={ss.galleryCardActionBtn}
            className="studio-gallery-action"
            onClick={handleUseAsReference}
            title={t('playground.studio_use_as_reference', { defaultValue: '参考图' })}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 3h5v5" />
              <path d="M21 3l-7 7" />
              <path d="M8 21H3v-5" />
              <path d="M3 21l7-7" />
            </svg>
          </button>
          <button
            type="button"
            style={ss.galleryCardActionBtn}
            className="studio-gallery-action"
            onClick={(e) => { e.stopPropagation(); requestEdit(item.url); }}
            title={t('playground.studio_edit_this', { defaultValue: '编辑这张' })}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
            </svg>
          </button>
          <button
            type="button"
            style={ss.galleryCardActionBtn}
            className="studio-gallery-action"
            onClick={(e) => { e.stopPropagation(); variations(item); }}
            title={t('playground.studio_variations', { defaultValue: '变体（4 张）' })}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="7" height="7" rx="1" />
              <rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" />
              <rect x="14" y="14" width="7" height="7" rx="1" />
            </svg>
          </button>
          <button
            type="button"
            style={ss.galleryCardActionBtn}
            className="studio-gallery-action"
            onClick={handleDelete}
            title={t('playground.studio_delete', { defaultValue: '删除' })}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 6h18" />
              <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

// ── PreviewOverlay ──────────────────────────────────────────────────────────

function PreviewOverlay() {
  const { previewItem, setPreviewItem } = useStudio();
  const [hiResReady, setHiResReady] = useState(false);
  const [zoom, setZoom] = useState(1);
  const zoomImage = useCallback((delta: number) => {
    setZoom(value => Math.max(0.5, Math.min(3, Math.round((value + delta) * 10) / 10)));
  }, []);

  useEffect(() => {
    if (!previewItem) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPreviewItem(null);
      if (e.key === '+' || e.key === '=') zoomImage(0.25);
      if (e.key === '-' || e.key === '_') zoomImage(-0.25);
      if (e.key === '0') setZoom(1);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [previewItem, setPreviewItem, zoomImage]);

  // Preload the original off-DOM. When ready, swap the displayed src from the
  // 512-wide thumb (often already cached by the gallery grid) to the full-res
  // image. Reset on every previewItem change so navigation between items
  // re-shows the placeholder until the new hi-res arrives.
  useEffect(() => {
    setHiResReady(false);
    setZoom(1);
    if (!previewItem) return;
    if (!isLocalRuntimeAsset(previewItem.url)) {
      setHiResReady(true);
      return;
    }
    const img = new window.Image();
    let cancelled = false;
    img.onload = () => { if (!cancelled) setHiResReady(true); };
    img.onerror = () => { if (!cancelled) setHiResReady(true); };
    img.src = previewItem.url;
    return () => { cancelled = true; };
  }, [previewItem]);

  if (!previewItem) return null;

  const useProgressive = isLocalRuntimeAsset(previewItem.url) && !hiResReady;
  const displaySrc = useProgressive
    ? `${previewItem.url}${previewItem.url.includes('?') ? '&' : '?'}w=512`
    : previewItem.url;

  return (
    <div style={ss.previewOverlay} onClick={() => setPreviewItem(null)}>
      <div style={ss.previewToolbar} onClick={e => e.stopPropagation()}>
        <button type="button" style={ss.previewZoomBtn} onClick={() => zoomImage(-0.25)} aria-label="缩小">−</button>
        <span style={ss.previewZoomLabel}>{Math.round(zoom * 100)}%</span>
        <button type="button" style={ss.previewZoomBtn} onClick={() => zoomImage(0.25)} aria-label="放大">+</button>
        <button type="button" style={ss.previewZoomBtn} onClick={() => setZoom(1)} aria-label="适配屏幕">适配</button>
      </div>
      <button
        type="button"
        style={ss.previewCloseBtn}
        className="studio-preview-close"
        onClick={() => setPreviewItem(null)}
      >
        ×
      </button>
      <div
        style={{
          ...ss.previewStage,
          alignItems: zoom > 1 ? 'flex-start' : 'center',
          justifyContent: zoom > 1 ? 'flex-start' : 'center',
        }}
        onClick={e => e.stopPropagation()}
      >
        <img
          src={displaySrc}
          alt={previewItem.alt || previewItem.prompt}
          style={useProgressive
            ? { ...ss.previewOverlayImg, maxWidth: `${60 * zoom}vw`, maxHeight: `${65 * zoom}vh`, filter: 'blur(6px)', transition: 'filter 0.25s' }
            : { ...ss.previewOverlayImg, maxWidth: `${60 * zoom}vw`, maxHeight: `${65 * zoom}vh`, filter: 'blur(0)', transition: 'filter 0.25s' }}
        />
      </div>
    </div>
  );
}

// ── EmptyState ──────────────────────────────────────────────────────────────

const emptyStyles: Record<string, CSSProperties> = {
  wrapper: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
    height: '100%',
    minHeight: 400,
    userSelect: 'none',
    paddingBottom: 80,
  },
  iconWrap: {
    width: 120,
    height: 120,
    borderRadius: 32,
    background: `radial-gradient(circle at 40% 35%, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.01) 70%, transparent 100%)`,
    border: '1px solid rgba(255, 255, 255, 0.06)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    boxShadow: '0 8px 32px rgba(0,0,0,0.15), inset 0 1px 0 rgba(255,255,255,0.04)',
  },
  title: {
    fontSize: 16,
    fontWeight: 600,
    color: cssVar('textSecondary'),
    letterSpacing: '-0.01em',
  },
  hint: {
    fontSize: 13,
    marginTop: 2,
    color: cssVar('textTertiary'),
    opacity: 0.5,
    fontFamily: cssVar('fontMono'),
    letterSpacing: '0.02em',
  },
  shortcutRow: {
    display: 'flex',
    gap: 16,
    marginTop: 8,
  },
  shortcutItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 11,
    color: cssVar('textTertiary'),
    opacity: 0.4,
    fontFamily: cssVar('fontMono'),
  },
  kbd: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 20,
    height: 20,
    padding: '0 5px',
    borderRadius: 5,
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.08)',
    fontSize: 10,
    fontWeight: 600,
    fontFamily: cssVar('fontMono'),
    color: cssVar('textTertiary'),
  },
};

function EmptyState() {
  const { t } = useTranslation();
  return (
    <div style={emptyStyles.wrapper}>
      <div style={emptyStyles.iconWrap}>
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.2 }}>
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <path d="M21 15l-5-5L5 21" />
        </svg>
      </div>
      <div style={emptyStyles.title}>{t('playground.studio_gallery_empty', { defaultValue: '还没有生成的图片' })}</div>
      <div style={emptyStyles.hint}>
        {t('playground.studio_gallery_empty_hint', { defaultValue: '在下方输入框输入提示词，开始创作' })}
      </div>
      <div style={emptyStyles.shortcutRow}>
        <div style={emptyStyles.shortcutItem}>
          <span style={emptyStyles.kbd}>Enter</span>
          <span>{t('playground.studio_shortcut_send', { defaultValue: '发送' })}</span>
        </div>
        <div style={emptyStyles.shortcutItem}>
          <span style={emptyStyles.kbd}>Shift</span>
          <span>+</span>
          <span style={emptyStyles.kbd}>Enter</span>
          <span>{t('playground.studio_shortcut_newline', { defaultValue: '换行' })}</span>
        </div>
      </div>
    </div>
  );
}

// ── GalleryView ─────────────────────────────────────────────────────────────

export function GalleryView() {
  const { gallery, tasks, previewItem, hasMore, loadingMore, loadMore, deleteGalleryItem } = useStudio();
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [query, setQuery] = useState('');

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || loadingMore || !hasMore) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 300) {
      loadMore();
    }
  }, [loadMore, loadingMore, hasMore]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  const visibleTasks = tasks.filter(t => t.status !== 'completed');
  const q = query.trim().toLowerCase();
  const filteredGallery = q ? gallery.filter(it => (it.prompt || '').toLowerCase().includes(q)) : gallery;
  const isEmpty = gallery.length === 0 && visibleTasks.length === 0;
  const selectedCount = selectedIds.size;
  const allVisibleSelected = filteredGallery.length > 0 && filteredGallery.every(item => selectedIds.has(item.id));

  useEffect(() => {
    setSelectedIds(prev => {
      if (prev.size === 0) return prev;
      const visible = new Set(gallery.map(item => item.id));
      const next = new Set([...prev].filter(id => visible.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [gallery]);

  const toggleSelectionMode = () => {
    setSelectionMode(prev => {
      const next = !prev;
      if (!next) setSelectedIds(new Set());
      return next;
    });
  };

  const toggleSelected = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const selectAllVisible = () => {
    // 只全选「当前可见」(搜索过滤后) 的素材，避免选中并误删被搜索隐藏的图片。
    setSelectedIds(new Set(filteredGallery.map(item => item.id)));
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
  };

  const deleteSelected = async () => {
    if (selectedCount === 0) return;
    const ok = await confirm(t('playground.studio_confirm_delete_selected', { defaultValue: '确定要删除选中的 {{count}} 张图片吗？', count: selectedCount }));
    if (!ok) return;
    const ids = [...selectedIds];
    ids.forEach(id => deleteGalleryItem(id));
    setSelectedIds(new Set());
    setSelectionMode(false);
  };

  return (
    <div ref={scrollRef} style={ss.gallery} className="studio-gallery">
      {previewItem && <PreviewOverlay />}

      {isEmpty ? (
        <EmptyState />
      ) : (
        <>
          <div style={batchStyles.toolbar}>
            <div style={batchStyles.toolbarLeft}>
              <span style={batchStyles.label}>
                {selectionMode
                  ? t('playground.studio_batch_selected_count', { defaultValue: '已选择 {{count}} 张', count: selectedCount })
                  : t('playground.studio_batch_manage_assets', { defaultValue: '素材管理' })}
              </span>
              {selectionMode ? (
                <span style={batchStyles.hint}>
                  {t('playground.studio_batch_select_hint', { defaultValue: '点击图片选择素材' })}
                </span>
              ) : gallery.length > 0 ? (
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t('playground.studio_search_prompt', { defaultValue: '搜索提示词…' })}
                  style={{
                    marginLeft: 6, maxWidth: 220, width: '40vw', minWidth: 0,
                    padding: '4px 10px', borderRadius: 7, fontSize: 12,
                    border: `1px solid ${cssVar('borderSubtle')}`, background: cssVar('bgElevated'),
                    color: cssVar('text'), fontFamily: 'inherit', outline: 'none',
                  }}
                />
              ) : null}
            </div>
            <div style={batchStyles.toolbarRight}>
              {selectionMode && (
                <>
                  <button
                    type="button"
                    style={batchStyles.actionBtn}
                    className="studio-gallery-action"
                    onClick={allVisibleSelected ? clearSelection : selectAllVisible}
                  >
                    {allVisibleSelected
                      ? t('playground.studio_batch_clear_selection', { defaultValue: '取消全选' })
                      : t('playground.studio_batch_select_all', { defaultValue: '全选当前' })}
                  </button>
                  <button
                    type="button"
                    style={{
                      ...batchStyles.actionBtn,
                      ...batchStyles.dangerBtn,
                      ...(selectedCount === 0 ? batchStyles.disabledBtn : {}),
                    }}
                    className="studio-gallery-action"
                    onClick={() => { void deleteSelected(); }}
                    disabled={selectedCount === 0}
                  >
                    {t('playground.studio_batch_delete', { defaultValue: '删除选中' })}
                  </button>
                </>
              )}
              <button
                type="button"
                style={batchStyles.actionBtn}
                className="studio-gallery-action"
                onClick={toggleSelectionMode}
              >
                {selectionMode
                  ? t('playground.studio_batch_done_manage', { defaultValue: '完成' })
                  : t('playground.studio_batch_manage', { defaultValue: '批量操作' })}
              </button>
            </div>
          </div>
          <div style={ss.galleryGrid}>
            {visibleTasks.map(task => (
              <TaskCard key={task.id} task={task} />
            ))}
            {filteredGallery.length === 0 && q && (
              <div style={{ gridColumn: '1 / -1', padding: '24px 8px', textAlign: 'center', fontSize: 12, color: cssVar('textTertiary') }}>
                {t('playground.studio_search_empty', { defaultValue: '没有匹配「{{q}}」的作品', q: query.trim() })}
              </div>
            )}
            {filteredGallery.map((item, i) => (
              <GalleryCard
                key={item.id}
                item={item}
                index={i}
                selectionMode={selectionMode}
                selected={selectedIds.has(item.id)}
                onToggleSelected={toggleSelected}
              />
            ))}
          </div>
        </>
      )}
      {loadingMore && (
        <div style={{ textAlign: 'center', padding: '16px 0', color: cssVar('textTertiary'), fontSize: 12 }}>加载中...</div>
      )}
    </div>
  );
}
