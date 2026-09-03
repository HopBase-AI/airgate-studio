import { type CSSProperties, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cssVar } from '@doudou-start/airgate-theme';
import { useStudio } from './StudioContext';
import type { GalleryItem, StudioGenerationTask } from './types';
import { studioStyles as ss } from './studioStyles';
import { downloadImage } from '../utils';
import { getExpiryNotice, isVideoExpired, VIDEO_URL_TTL_MS } from './expiry';
import { estimateEtaSeconds, etaDisplayState, formatElapsedCompact, formatEtaLabel } from './etaStats';
import { useVideoStrings } from './video/videoConfig';
import { videoFailureHintKey } from './video/failureHints';

type NearViewportListener = (near: boolean) => void;

const nearViewportListeners = new Map<Element, NearViewportListener>();
let nearViewportObserver: IntersectionObserver | null = null;

// TaskFailureText 失败卡的错误文案：视频任务优先按执行器分类码给可执行提示
// （如「关闭生成音频后重试」），上游原文退居 tooltip；图片或未知码则原样显示。
function TaskFailureText({ task }: { task: StudioGenerationTask }) {
  const vs = useVideoStrings();
  const hintKey = task.mode === 'video' ? videoFailureHintKey(task.errorCode) : undefined;
  const text = hintKey ? vs(hintKey) : (task.error ?? '');
  return (
    <div style={taskCardStyles.errorText} title={hintKey ? task.error : undefined}>
      {text}
    </div>
  );
}

function observeNearViewport(element: Element, listener: NearViewportListener): () => void {
  if (!nearViewportObserver) {
    nearViewportObserver = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          nearViewportListeners.get(entry.target)?.(entry.isIntersecting);
        }
      },
      { rootMargin: '800px 0px' },
    );
  }
  nearViewportListeners.set(element, listener);
  nearViewportObserver.observe(element);
  return () => {
    nearViewportObserver?.unobserve(element);
    nearViewportListeners.delete(element);
    if (nearViewportListeners.size === 0) {
      nearViewportObserver?.disconnect();
      nearViewportObserver = null;
    }
  };
}

function useNearViewport(estimatedHeight = 340) {
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(() => typeof IntersectionObserver === 'undefined');
  const [placeholderHeight, setPlaceholderHeight] = useState(estimatedHeight);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') return;
    return observeNearViewport(el, isNear => {
      if (!isNear && el.offsetHeight > 0) setPlaceholderHeight(el.offsetHeight);
      setNear(isNear);
    });
  }, []);

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

function formatCreatedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
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
    minWidth: 0,
    borderRadius: 8,
    overflow: 'hidden',
    background: cssVar('bgElevated'),
    border: `1px solid ${cssVar('borderSubtle')}`,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: 16,
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
  },
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
    justifyContent: 'center',
    flexWrap: 'wrap',
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

function TaskCard({ task }: { task: StudioGenerationTask }) {
  const { t } = useTranslation();
  const { deleteTask, generate, generateVideo, selectModelRoute, setSelectedModelKey, setImageSize, setImageMode, setMediaType, setVideoModelId, retryBatchFailures, tasks } = useStudio();
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
  // ETA 来自同桶历史耗时的中位数(localStorage 滚动统计),无历史时回落静态种子。
  const etaSeconds = estimateEtaSeconds({
    mediaType: task.mode === 'video' ? 'video' : 'image',
    model: task.model,
    size: task.size,
    durationSeconds: task.durationSeconds,
  });

  // 批量任务：渲染聚合卡（子任务进度 + 全部重试）。
  const isBatch = !!task.subtasks && task.subtasks.length > 0;
  const subtasks = task.subtasks ?? [];
  const doneCount = subtasks.filter(s => s.status === 'completed').length;
  const failedCount = subtasks.filter(s => s.status === 'failed').length;
  const processingCount = subtasks.filter(s => s.status === 'processing').length;
  const total = subtasks.length;

  const statusLabel = task.status === 'queued'
    ? t('playground.studio_task_queued')
    : task.status === 'failed'
      ? t('playground.studio_task_failed')
      : t('playground.studio_task_processing');

  const handleRetry = () => {
    if (!task.prompt) return;
    const retryRoute = task.platform && task.model && task.groupId && task.size
      ? {
          routeKey: task.routeKey || `${task.platform}:${task.model}`,
          platform: task.platform,
          model: task.model,
          groupId: task.groupId,
          size: task.size,
        }
      : null;
    if (task.mode === 'video') {
      setMediaType('video');
      if (retryRoute) setVideoModelId(retryRoute.model);
      if (generateVideo(task.prompt, {
        route: retryRoute,
        projectId: task.projectId,
        durationSeconds: task.durationSeconds,
      })) {
        void deleteTask(task.id).catch(() => {});
      }
      return;
    }
    const mode = task.mode;
    if (retryRoute) selectModelRoute(retryRoute.routeKey, retryRoute.groupId);
    else if (task.model) setSelectedModelKey(task.routeKey ?? task.model, task.platform);
    if (task.size) setImageSize(task.size);
    setImageMode(mode);
    if (generate(task.prompt, { mode, route: retryRoute, projectId: task.projectId })) {
      void deleteTask(task.id).catch(() => {});
    }
  };

  const handleDelete = async () => {
    if (!await confirm(t('playground.studio_confirm_delete_task'))) return;
    await deleteTask(task.id).catch(() => {});
  };

  // ── 批量聚合卡 ──────────────────────────────────────────────────────────
  if (isBatch) {
    const batchFailed = task.status === 'failed' || failedCount > 0;
    const batchProcessing = task.status !== 'failed' && processingCount > 0;
    return (
      <div style={taskCardStyles.card}>
        {batchProcessing ? (
          <div style={taskCardStyles.spinner} />
        ) : batchFailed ? (
          <div style={taskCardStyles.failedIcon}>!</div>
        ) : (
          <div style={{ ...taskCardStyles.failedIcon, border: `2px solid ${cssVar('borderSubtle')}`, color: cssVar('textSecondary') }}>✓</div>
        )}
        <div style={taskCardStyles.statusLabel}>
          {batchProcessing
            ? t('playground.studio_batch_progress', { done: doneCount, total })
            : failedCount > 0
              ? t('playground.studio_batch_partial', { done: doneCount, failed: failedCount })
              : task.status === 'failed'
                ? t('playground.studio_task_failed')
              : t('playground.studio_batch_done', { total })}
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
              title={s.status === 'failed' ? (s.error || t('playground.studio_task_failed')) : s.status === 'completed' ? t('playground.studio_task_success') : t('playground.studio_task_processing')}
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
            title={copied ? t('playground.studio_prompt_copied') : t('playground.studio_prompt_copy')}
          >
            {copied ? t('playground.studio_prompt_copied_label') : task.prompt}
          </div>
        )}
        {!batchProcessing && task.status === 'failed' && task.error && (
          <TaskFailureText task={task} />
        )}
        {!batchProcessing && batchFailed && (
          <div style={taskCardStyles.failedActions}>
            {failedCount > 0 && (
              <button
                type="button"
                style={taskCardStyles.retryBtn}
                className="studio-gallery-action"
                onClick={() => retryBatchFailures(task.id)}
              >
                {t('playground.studio_retry_failed', { count: failedCount })}
              </button>
            )}
            <button
              type="button"
              style={taskCardStyles.deleteBtn}
              className="studio-gallery-action"
              onClick={handleDelete}
            >
              {t('playground.studio_delete')}
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
              ? t('playground.studio_queue_position', { pos: queuePos })
              : etaDisplayState(elapsed, etaSeconds) === 'eta'
                ? t('playground.studio_eta_flex', {
                    defaultValue: '{{elapsed}} elapsed · ~{{eta}}',
                    elapsed: formatElapsedCompact(elapsed),
                    eta: formatEtaLabel(t, etaSeconds),
                  })
                : t('playground.studio_eta_overtime', {
                    defaultValue: '{{elapsed}} elapsed · taking longer than usual',
                    elapsed: formatElapsedCompact(elapsed),
                  })}
            {typeof task.progress === 'number' && task.progress > 0 ? ` · ${Math.round(task.progress)}%` : ''}
          </div>
        </>
      )}
      {task.status === 'failed' && task.error && (
        <TaskFailureText task={task} />
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
          title={copied ? t('playground.studio_prompt_copied') : t('playground.studio_prompt_copy')}
        >
          {copied ? t('playground.studio_prompt_copied_label') : task.prompt}
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
            {t('playground.studio_retry')}
          </button>
          <button
            type="button"
            style={taskCardStyles.deleteBtn}
            className="studio-gallery-action"
            onClick={handleDelete}
          >
            {t('playground.studio_delete')}
          </button>
        </div>
      )}
    </div>
  );
}

// ── GalleryCard ─────────────────────────────────────────────────────────────

const GALLERY_ESTIMATED_CARD_HEIGHT = 340;

// 过期/加载失败的媒体占位（视频 24h 后上游签名必然失效，不再渲染注定 410 的
// <video>；图片则只在真实加载失败时兜底）。
const mediaPlaceholderStyles: Record<string, CSSProperties> = {
  wrap: {
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: '18px 12px',
    boxSizing: 'border-box',
    textAlign: 'center',
    background: cssVar('bgDeep'),
    color: cssVar('textTertiary'),
  },
  title: {
    fontSize: 12,
    fontWeight: 600,
    color: cssVar('textSecondary'),
  },
  hint: {
    fontSize: 11,
    lineHeight: 1.5,
    color: cssVar('textTertiary'),
  },
  retryBtn: {
    marginTop: 4,
    height: 26,
    padding: '0 12px',
    border: `1px solid ${cssVar('borderSubtle')}`,
    borderRadius: 8,
    background: 'transparent',
    color: cssVar('textSecondary'),
    cursor: 'pointer',
    fontSize: 11,
    fontFamily: 'inherit',
  },
};

function MediaPlaceholderIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ opacity: 0.6 }}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

interface GalleryCardProps {
  item: GalleryItem;
  index: number;
}

function GalleryCard({ item, index }: GalleryCardProps) {
  const { t } = useTranslation();
  const vs = useVideoStrings();
  const { setPreviewItem, deleteGalleryItem, applyAsReference, regenerate, requestEdit, generatedAssetRetentionDays } = useStudio();
  const { copied, copy } = useCopyOnClick(item.prompt);
  const { copied: sourceCopied, copy: copySourceLink } = useCopyOnClick(item.sourceVideoUrl);
  const createdAtLabel = formatCreatedAt(item.createdAt);
  const expiryNotice = getExpiryNotice(t, item, generatedAssetRetentionDays);
  const { ref, near, placeholderHeight } = useNearViewport(GALLERY_ESTIMATED_CARD_HEIGHT);

  // 视频到点自动翻转为过期占位；媒体加载失败（提前失效/网络问题）由 onError 兜底。
  const [mediaError, setMediaError] = useState(false);
  const [expired, setExpired] = useState(() => item.mediaType === 'video' && isVideoExpired(item.createdAt));
  useEffect(() => {
    if (item.mediaType !== 'video') return;
    const createdMs = Date.parse(item.createdAt);
    if (!Number.isFinite(createdMs)) return;
    const remaining = createdMs + VIDEO_URL_TTL_MS - Date.now();
    if (remaining <= 0) {
      setExpired(true);
      return;
    }
    const timer = window.setTimeout(() => setExpired(true), remaining);
    return () => window.clearTimeout(timer);
  }, [item.createdAt, item.mediaType]);

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation();
    void downloadImage(item.url, item.alt);
  };

  // 「官方源链接」只负责复制上游透传地址；下载由相邻的下载按钮处理。
  // 与视频同为 24h 过期，过期后隐藏。
  const showSourceLink = item.mediaType === 'video' && !!item.sourceVideoUrl && !expired;

  const handleRegenerate = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!await confirm(t('playground.studio_confirm_regenerate'))) return;
    regenerate(item);
  };

  const handleUseAsReference = (e: React.MouseEvent) => {
    e.stopPropagation();
    applyAsReference(item);
  };

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!await confirm(t('playground.studio_confirm_delete'))) return;
    await deleteGalleryItem(item.id).catch(() => {});
  };

  const handlePreview = (e: React.MouseEvent) => {
    e.stopPropagation();
    setPreviewItem(item);
  };

  if (!near && placeholderHeight > 0) {
    return (
      <div
        ref={ref}
        style={{
          ...ss.galleryCard,
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
        animationDelay: `${Math.min(index * 50, 300)}ms`,
      }}
      className="studio-gallery-card"
    >
      {item.mediaType === 'video' && (expired || mediaError) ? (
        <div style={{ ...mediaPlaceholderStyles.wrap, aspectRatio: '4/3' }}>
          <MediaPlaceholderIcon />
          <div style={mediaPlaceholderStyles.title}>{vs(expired ? 'expired_title' : 'load_failed')}</div>
          <div style={mediaPlaceholderStyles.hint}>{vs('expired_hint')}</div>
          <button
            type="button"
            style={mediaPlaceholderStyles.retryBtn}
            className="studio-gallery-action"
            onClick={handleRegenerate}
          >
            {t('playground.studio_regenerate')}
          </button>
        </div>
      ) : item.mediaType === 'video' ? (
        <button
          type="button"
          style={ss.galleryVideoPreview}
          className="studio-gallery-video-preview"
          onClick={handlePreview}
          aria-label={vs('preview_video')}
        >
          <video
            src={item.url}
            muted
            playsInline
            preload="metadata"
            tabIndex={-1}
            aria-hidden="true"
            style={ss.galleryCardVideo}
            onError={() => setMediaError(true)}
          />
          <span style={ss.galleryVideoPlayBadge} aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7Z" />
            </svg>
          </span>
        </button>
      ) : mediaError ? (
        <div style={{ ...mediaPlaceholderStyles.wrap, aspectRatio: '4/3' }}>
          <MediaPlaceholderIcon />
          <div style={mediaPlaceholderStyles.title}>
            {t('playground.studio_image_unavailable', { defaultValue: 'Image failed to load — it may have expired' })}
          </div>
          <button
            type="button"
            style={mediaPlaceholderStyles.retryBtn}
            className="studio-gallery-action"
            onClick={handleRegenerate}
          >
            {t('playground.studio_regenerate')}
          </button>
        </div>
      ) : (
        <img
          src={item.url}
          srcSet={buildThumbSrcSet(item.url)}
          sizes="(max-width: 640px) 50vw, (max-width: 1023px) 50vw, 280px"
          alt={item.alt || item.prompt}
          style={ss.galleryCardImg}
          loading="lazy"
          decoding="async"
          fetchPriority="low"
          onClick={handlePreview}
          onError={() => setMediaError(true)}
        />
      )}
      <div style={ss.galleryCardOverlay}>
        <div style={ss.galleryCardMetaRow}>
          {item.size && (
            <span style={ss.galleryCardMetaItem}>{item.size}</span>
          )}
              <span style={ss.galleryCardMetaItem}>
                {t('playground.studio_created_at')}
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
                ? t('playground.studio_asset_expired')
                : item.mediaType === 'video'
                  ? t('playground.studio_video_expiring', {
                      defaultValue: 'Video link expires in {{time}} — download soon',
                      time: expiryNotice.remainingLabel,
                    })
                  : t('playground.studio_asset_expiring', { time: expiryNotice.remainingLabel })}
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
              title={copied ? t('playground.studio_prompt_copied') : t('playground.studio_prompt_copy')}
            >
              {copied ? t('playground.studio_prompt_copied_label') : item.prompt}
            </div>
          )}
        </div>
        <div style={ss.galleryCardActions}>
          <button
            type="button"
            style={ss.galleryCardActionBtn}
            className="studio-gallery-action"
            onClick={handleDownload}
            title={t('playground.studio_download')}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </button>
          {showSourceLink && (
            <button
              type="button"
              style={ss.galleryCardActionBtn}
              className="studio-gallery-action"
              onClick={copySourceLink}
              title={vs(sourceCopied ? 'source_copied' : 'copy_source_link')}
              aria-label={vs(sourceCopied ? 'source_copied' : 'copy_source_link')}
            >
              {sourceCopied ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="9" y="9" width="11" height="11" rx="2" />
                  <path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3" />
                </svg>
              )}
            </button>
          )}
          <button
            type="button"
            style={ss.galleryCardActionBtn}
            className="studio-gallery-action"
            onClick={handleRegenerate}
            title={t('playground.studio_regenerate')}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 4v6h6" />
              <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
            </svg>
          </button>
          {item.mediaType !== 'video' && (
            <button
              type="button"
              style={ss.galleryCardActionBtn}
              className="studio-gallery-action"
              onClick={handleUseAsReference}
              title={t('playground.studio_use_as_reference')}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M16 3h5v5" />
                <path d="M21 3l-7 7" />
                <path d="M8 21H3v-5" />
                <path d="M3 21l7-7" />
              </svg>
            </button>
          )}
          {item.mediaType !== 'video' && (
            <button
              type="button"
              style={ss.galleryCardActionBtn}
              className="studio-gallery-action"
              onClick={(e) => { e.stopPropagation(); requestEdit(item.url); }}
              title={t('playground.studio_edit_this')}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
              </svg>
            </button>
          )}
          <button
            type="button"
            style={ss.galleryCardActionBtn}
            className="studio-gallery-action"
            onClick={handleDelete}
            title={t('playground.studio_delete')}
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
  const { t } = useTranslation();
  const vs = useVideoStrings();
  const { previewItem, setPreviewItem } = useStudio();
  const { copied: previewSourceCopied, copy: copyPreviewSourceLink } = useCopyOnClick(previewItem?.sourceVideoUrl);
  const [videoError, setVideoError] = useState(false);
  useEffect(() => {
    setVideoError(false);
  }, [previewItem]);
  const [hiResReady, setHiResReady] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ id: number; startX: number; startY: number; panX: number; panY: number } | null>(null);
  const zoomImage = useCallback((delta: number) => {
    setZoom(value => Math.max(0.5, Math.min(3, Math.round((value + delta) * 10) / 10)));
  }, []);
  const resetView = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  useEffect(() => {
    if (!previewItem) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPreviewItem(null);
      if (e.key === '+' || e.key === '=') zoomImage(0.25);
      if (e.key === '-' || e.key === '_') zoomImage(-0.25);
      if (e.key === '0') resetView();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [previewItem, resetView, setPreviewItem, zoomImage]);

  // Preload the original off-DOM. When ready, swap the displayed src from the
  // 512-wide thumb (often already cached by the gallery grid) to the full-res
  // image. Reset on every previewItem change so navigation between items
  // re-shows the placeholder until the new hi-res arrives.
  useEffect(() => {
    setHiResReady(false);
    resetView();
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
  }, [previewItem, resetView]);

  const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const delta = e.deltaY < 0 ? 0.14 : -0.14;
    setZoom(value => Math.max(0.5, Math.min(3, Math.round((value + delta) * 100) / 100)));
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLImageElement>) => {
    e.stopPropagation();
    if (zoom <= 1) return;
    dragRef.current = {
      id: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      panX: pan.x,
      panY: pan.y,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  }, [pan.x, pan.y, zoom]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLImageElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.id !== e.pointerId) return;
    e.preventDefault();
    e.stopPropagation();
    setPan({
      x: drag.panX + e.clientX - drag.startX,
      y: drag.panY + e.clientY - drag.startY,
    });
  }, []);

  const endDrag = useCallback((e: React.PointerEvent<HTMLImageElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.id !== e.pointerId) return;
    dragRef.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
  }, []);

  const handleDoubleClick = useCallback((e: React.MouseEvent<HTMLImageElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (zoom > 1) {
      resetView();
    } else {
      setZoom(1.8);
      setPan({ x: 0, y: 0 });
    }
  }, [resetView, zoom]);

  if (!previewItem) return null;

  const useProgressive = isLocalRuntimeAsset(previewItem.url) && !hiResReady;
  const displaySrc = useProgressive
    ? `${previewItem.url}${previewItem.url.includes('?') ? '&' : '?'}w=512`
    : previewItem.url;

  // 视频预览：原生播放器，不套图像的缩放/平移手势。
  if (previewItem.mediaType === 'video') {
    return (
      <div style={ss.previewOverlay} onClick={() => setPreviewItem(null)}>
        <button
          type="button"
          style={ss.previewCloseBtn}
          className="studio-preview-close"
          onClick={() => setPreviewItem(null)}
        >
          ×
        </button>
        <div style={ss.previewStage} onClick={e => e.stopPropagation()}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            {videoError ? (
              <div style={{ padding: '48px 32px', color: 'rgba(255,255,255,0.85)', fontSize: 14, textAlign: 'center' }}>
                {vs('load_failed')}
              </div>
            ) : (
              <video
                src={previewItem.url}
                controls
                autoPlay
                playsInline
                style={{ maxWidth: '90vw', maxHeight: '82vh', borderRadius: 12, background: '#000' }}
                onError={() => setVideoError(true)}
              />
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 11, color: 'rgba(255,255,255,0.55)', textAlign: 'center' }}>
              <span>{vs('expire_hint')}</span>
              {/* 官方源链接：复制上游透传地址（与视频同 24h 过期，过期后隐藏） */}
              {previewItem.sourceVideoUrl && !isVideoExpired(previewItem.createdAt) && (
                <button
                  type="button"
                  style={{ padding: 0, border: 0, background: 'transparent', color: 'rgba(255,255,255,0.75)', textDecoration: 'underline', whiteSpace: 'nowrap', cursor: 'pointer', font: 'inherit' }}
                  onClick={copyPreviewSourceLink}
                  aria-live="polite"
                >
                  {vs(previewSourceCopied ? 'source_copied' : 'copy_source_link')}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={ss.previewOverlay} onClick={() => setPreviewItem(null)}>
      <div style={ss.previewToolbar} onClick={e => e.stopPropagation()}>
        <button type="button" style={ss.previewZoomBtn} onClick={() => zoomImage(-0.25)} aria-label={t('playground.studio_zoom_out')}>−</button>
        <span style={ss.previewZoomLabel}>{Math.round(zoom * 100)}%</span>
        <button type="button" style={ss.previewZoomBtn} onClick={() => zoomImage(0.25)} aria-label={t('playground.studio_zoom_in')}>+</button>
        <button type="button" style={ss.previewZoomBtn} onClick={resetView} aria-label={t('playground.studio_fit_screen')}>{t('playground.studio_fit')}</button>
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
          cursor: zoom > 1 ? 'grab' : 'zoom-in',
        }}
        onClick={e => e.stopPropagation()}
        onWheel={handleWheel}
      >
        <img
          src={displaySrc}
          alt={previewItem.alt || previewItem.prompt}
          style={useProgressive
            ? { ...ss.previewOverlayImg, transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`, filter: 'blur(6px)', transition: dragRef.current ? 'filter 0.25s' : 'transform 0.12s ease, filter 0.25s', cursor: zoom > 1 ? 'grab' : 'zoom-in' }
            : { ...ss.previewOverlayImg, transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`, filter: 'blur(0)', transition: dragRef.current ? 'filter 0.25s' : 'transform 0.12s ease, filter 0.25s', cursor: zoom > 1 ? 'grab' : 'zoom-in' }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onDoubleClick={handleDoubleClick}
          draggable={false}
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
      <div style={emptyStyles.title}>{t('playground.studio_gallery_empty')}</div>
      <div style={emptyStyles.hint}>
        {t('playground.studio_gallery_empty_hint')}
      </div>
      <div style={emptyStyles.shortcutRow}>
        <div style={emptyStyles.shortcutItem}>
          <span style={emptyStyles.kbd}>Enter</span>
          <span>{t('playground.studio_shortcut_send')}</span>
        </div>
        <div style={emptyStyles.shortcutItem}>
          <span style={emptyStyles.kbd}>Shift</span>
          <span>+</span>
          <span style={emptyStyles.kbd}>Enter</span>
          <span>{t('playground.studio_shortcut_newline')}</span>
        </div>
      </div>
    </div>
  );
}

// ── GalleryView ─────────────────────────────────────────────────────────────

type GalleryMediaFilter = 'all' | 'image' | 'video';

const galleryToolbarStyles: Record<string, CSSProperties> = {
  bar: {
    position: 'sticky',
    top: 0,
    zIndex: 12,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    padding: '6px 0 10px',
    marginBottom: 4,
    background: cssVar('bgElevated'),
  },
  segmented: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 2,
    padding: 2,
    border: `1px solid ${cssVar('borderSubtle')}`,
    borderRadius: 8,
    background: cssVar('bgDeep'),
  },
  button: {
    width: 30,
    height: 26,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
    border: 0,
    borderRadius: 6,
    background: 'transparent',
    color: cssVar('textTertiary'),
    cursor: 'pointer',
  },
  buttonActive: {
    background: cssVar('bgHover'),
    color: cssVar('text'),
    boxShadow: `inset 0 0 0 1px ${cssVar('borderSubtle')}`,
  },
  count: {
    minWidth: 24,
    fontSize: 11,
    color: cssVar('textTertiary'),
    fontFamily: cssVar('fontMono'),
    textAlign: 'right',
    fontVariantNumeric: 'tabular-nums',
  },
  paginationAction: {
    display: 'flex',
    justifyContent: 'center',
    padding: '14px 0 2px',
  },
  paginationButton: {
    minHeight: 30,
    padding: '0 14px',
    border: `1px solid ${cssVar('borderSubtle')}`,
    borderRadius: 7,
    background: 'transparent',
    color: cssVar('textSecondary'),
    cursor: 'pointer',
    font: 'inherit',
    fontSize: 11,
  },
  filteredEmpty: {
    minHeight: 220,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    color: cssVar('textTertiary'),
    fontSize: 12,
  },
};

function GalleryFilterIcon({ filter }: { filter: GalleryMediaFilter }) {
  if (filter === 'video') {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="2" y="5" width="14" height="14" rx="2" /><path d="M22 8.5l-6 3.5 6 3.5z" />
      </svg>
    );
  }
  if (filter === 'image') {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" />
      </svg>
    );
  }
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}

function FilteredEmptyState({ filter }: { filter: Exclude<GalleryMediaFilter, 'all'> }) {
  const vs = useVideoStrings();
  return (
    <div style={galleryToolbarStyles.filteredEmpty}>
      <GalleryFilterIcon filter={filter} />
      <span>{vs(filter === 'video' ? 'gallery_empty_video' : 'gallery_empty_image')}</span>
    </div>
  );
}

export function GalleryView() {
  const { t } = useTranslation();
  const vs = useVideoStrings();
  const { gallery, tasks, previewItem, hasMore, loadingMore, loadMoreError, loadMore, activeProjectId } = useStudio();
  const scrollRef = useRef<HTMLDivElement>(null);
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null);
  const [mediaFilter, setMediaFilter] = useState<GalleryMediaFilter>('all');

  useEffect(() => {
    const root = scrollRef.current;
    const sentinel = loadMoreSentinelRef.current;
    if (
      !root ||
      !sentinel ||
      !hasMore ||
      loadMoreError ||
      mediaFilter !== 'all' ||
      typeof IntersectionObserver === 'undefined'
    ) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !loadingMore) void loadMore();
      },
      { root, rootMargin: '600px 0px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadMore, loadMoreError, loadingMore, mediaFilter]);

  const activeTasks = tasks.filter(task => (
    task.status !== 'completed' &&
    (activeProjectId === 0 || task.projectId === activeProjectId)
  ));
  const visibleTasks = activeTasks.filter(task =>
    (mediaFilter === 'all' || (task.mode === 'video' ? 'video' : 'image') === mediaFilter),
  );
  const visibleGallery = gallery.filter(item =>
    mediaFilter === 'all' || (item.mediaType === 'video' ? 'video' : 'image') === mediaFilter,
  );
  const isEmpty = visibleGallery.length === 0 && visibleTasks.length === 0 && !hasMore && !loadingMore;
  const filterLabels: Record<GalleryMediaFilter, string> = {
    all: t('playground.studio_all_works'),
    image: vs('media_image'),
    video: vs('media_video'),
  };

  return (
    <div ref={scrollRef} style={ss.gallery} className="studio-gallery">
      {previewItem && <PreviewOverlay />}

      <div style={galleryToolbarStyles.bar}>
        <div style={galleryToolbarStyles.segmented} role="tablist" aria-label={t('playground.studio_all_works')}>
          {(['all', 'image', 'video'] as GalleryMediaFilter[]).map(filter => (
            <button
              key={filter}
              type="button"
              role="tab"
              aria-selected={mediaFilter === filter}
              aria-label={filterLabels[filter]}
              title={filterLabels[filter]}
              style={{
                ...galleryToolbarStyles.button,
                ...(mediaFilter === filter ? galleryToolbarStyles.buttonActive : {}),
              }}
              className="studio-gallery-action"
              onClick={() => setMediaFilter(filter)}
            >
              <GalleryFilterIcon filter={filter} />
            </button>
          ))}
        </div>
        <span style={galleryToolbarStyles.count} aria-live="polite">
          {visibleGallery.length + visibleTasks.length}
        </span>
      </div>

      {isEmpty ? (
        mediaFilter === 'all' ? <EmptyState /> : <FilteredEmptyState filter={mediaFilter} />
      ) : (
        <div style={ss.galleryGrid} className="studio-gallery-grid">
          {visibleTasks.map(task => (
            <TaskCard key={task.id} task={task} />
          ))}
          {visibleGallery.map((item, i) => (
            <GalleryCard
              key={item.id}
              item={item}
              index={i}
            />
          ))}
        </div>
      )}
      <div ref={loadMoreSentinelRef} style={{ height: hasMore ? 1 : 0 }} aria-hidden="true" />
      {loadingMore && (
        <div style={{ textAlign: 'center', padding: '16px 0', color: cssVar('textTertiary'), fontSize: 12 }}>{t('playground.studio_loading')}</div>
      )}
      {!loadingMore && hasMore && (loadMoreError || mediaFilter !== 'all') && (
        <div style={galleryToolbarStyles.paginationAction} aria-live="polite">
          <button
            type="button"
            style={galleryToolbarStyles.paginationButton}
            className="studio-gallery-action"
            onClick={() => { void loadMore(); }}
          >
            {loadMoreError ? t('playground.studio_retry') : vs('gallery_load_more')}
          </button>
        </div>
      )}
    </div>
  );
}
