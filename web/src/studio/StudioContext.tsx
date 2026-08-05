import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiRequestError } from '../api';
import type { GenerationTask, ImageGroup, Project, ProjectAsset } from '../api';
import type { GalleryItem, StudioGenerationTask, BatchSubtask, ImageMode, MediaType, StudioMode } from './types';
import { getModelConfig, getDefaultModel, MODEL_REGISTRY, type ModelConfig } from './modelConfig';
import {
  VIDEO_MODEL_REGISTRY,
  videoGroupsForModel,
  videoModelById,
  useVideoStrings,
  type VideoGroupsByModel,
  type VideoModelConfig,
} from './video/videoConfig';
import { recordRemoteTaskSample } from './etaStats';

// ── Constants ─────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 2000;
const POLL_MAX_ATTEMPTS = 300;
// 视频远慢于图片（2-10 分钟常态，4K 更久）：放宽到 60 分钟。
const VIDEO_POLL_MAX_ATTEMPTS = 1800;
const POLL_TRANSIENT_ERROR_ATTEMPTS = 2;
const MODEL_STORE_KEY = 'studio.selectedModelId';
const DELETED_TASK_STORE_KEY = 'studio.deletedGenerationTaskIds';
const DELETED_TASK_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const EMPTY_IMAGE_GROUPS: ImageGroup[] = [];

interface PollErrorMessages {
  failed: string;
  stopped: (status: string) => string;
  timeout: string;
}

const DEFAULT_POLL_ERROR_MESSAGES: PollErrorMessages = {
  failed: 'Image generation task failed',
  stopped: status => `Image generation stopped with status: ${status}`,
  timeout: 'Image generation timed out after waiting too long',
};

// activeProjectId 哨兵：0 = 「全部」视图（读 host tasks 的历史聚合，含老用户旧图），
// >=1 = 具体项目（读 studio_assets）。详见 StudioContext 的画廊加载逻辑。
const ALL_VIEW_ID = 0;

// ── Helpers ───────────────────────────────────────────────────────────────────

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function remoteGalleryItemID(taskID: number, outputIndex: number): string {
  return `r-${taskID}-${outputIndex}`;
}

function galleryItemIdentity(item: GalleryItem): string {
  if (item.taskId) return `task:${item.taskId}:url:${item.url}`;
  if (item.assetId) return `asset:${item.assetId}`;
  return `item:${item.id}`;
}

export function mergeGalleryItems(
  current: GalleryItem[],
  incoming: GalleryItem[],
  placement: 'append' | 'prepend',
): GalleryItem[] {
  const ordered = placement === 'prepend'
    ? [...incoming, ...current]
    : [...current, ...incoming];
  const result: GalleryItem[] = [];
  const indexByIdentity = new Map<string, number>();
  for (const item of ordered) {
    // A freshly completed output starts as r-{task}-{index}; after project
    // persistence the same output is returned as a-{asset}.  Task + URL keeps
    // those two representations from rendering as duplicate cards.
    const identity = galleryItemIdentity(item);
    const existingIndex = indexByIdentity.get(identity);
    if (existingIndex === undefined) {
      indexByIdentity.set(identity, result.length);
      result.push(item);
      continue;
    }
    const existing = result[existingIndex];
    // Preserve the ordering and display fields of the higher-priority copy,
    // but never discard persistence metadata carried by the duplicate. Without
    // assetId, deleting a project card would incorrectly delete its host task.
    result[existingIndex] = {
      ...item,
      ...existing,
      taskId: existing.taskId ?? item.taskId,
      assetId: existing.assetId ?? item.assetId,
      sourceUrl: existing.sourceUrl ?? item.sourceUrl,
      sourceVideoUrl: existing.sourceVideoUrl ?? item.sourceVideoUrl,
    };
  }
  return result;
}

export function filterDeletedGalleryItems(
  items: GalleryItem[],
  deletedTaskRecords: Record<string, number>,
  deletedAssetIDs: ReadonlySet<number> = new Set<number>(),
): GalleryItem[] {
  return items.filter(item => (
    !hasDeletedRemoteTaskId(deletedTaskRecords, item.taskId) &&
    (!item.assetId || !deletedAssetIDs.has(item.assetId))
  ));
}

export function isGalleryTargetVisible(targetProjectID: number, activeProjectID: number): boolean {
  return activeProjectID === ALL_VIEW_ID || activeProjectID === targetProjectID;
}

export function isExpectedGalleryView(
  expectedViewEpoch: number,
  expectedProjectID: number,
  currentViewEpoch: number,
  currentProjectID: number,
): boolean {
  return expectedViewEpoch === currentViewEpoch && expectedProjectID === currentProjectID;
}

function parseMarkdownImages(text: string): Array<{ url: string; alt: string }> {
  const regex = /!\[([^\]]*)\]\(([^)\s]+)\)/g;
  const results: Array<{ url: string; alt: string }> = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    results.push({ alt: match[1], url: match[2] });
  }
  return results;
}

function uniqueNumbers(values: Array<number | undefined | null>): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function operationToImageMode(operation: string): ImageMode {
  if (operation === 'inpaint') return 'inpaint';
  if (operation === 'edit') return 'img2img';
  return 'text2img';
}

// remoteTaskMediaType 判定 host task 的媒体类型:优先后端 DTO 的 kind,其次
// 产物字段,最后按视频模型/分辨率形态启发(兼容插件后端未升级的窗口期,
// 那时 kind 字段还没回传)。
function remoteTaskMediaType(t: GenerationTask): 'video' | 'image' {
  if (t.kind === 'video') return 'video';
  if ((t.video_urls?.length ?? 0) > 0) return 'video';
  if (t.model && VIDEO_MODEL_REGISTRY.some(m => m.id === t.model)) return 'video';
  if (t.size && /^(\d{3,4}p|4k)$/i.test(t.size)) return 'video';
  return 'image';
}

function remoteTaskMode(t: GenerationTask): StudioMode {
  return remoteTaskMediaType(t) === 'video' ? 'video' : operationToImageMode(t.operation ?? 'generate');
}

export function remoteTaskProjectID(task: GenerationTask): number {
  const projectID = task.project_id;
  return typeof projectID === 'number' && Number.isSafeInteger(projectID) && projectID > ALL_VIEW_ID
    ? projectID
    : ALL_VIEW_ID;
}

function modeToOperation(mode: ImageMode): 'generate' | 'edit' | 'inpaint' {
  if (mode === 'inpaint') return 'inpaint';
  if (mode === 'img2img') return 'edit';
  return 'generate';
}

interface GenerateOptions {
  mode?: ImageMode;
  sourceImage?: string;
  sourceImages?: string[];
  maskRegion?: { x: number; y: number; width: number; height: number };
  count?: number;
  prompts?: string[];
}

// projectAssetToGallery 把后端持久化的项目资产记录映射成画廊条目。
// mediaType 从已落库的 mode 推导('video' 自视频上线起就在写),不需要给
// studio_assets 加列;若未来同一媒体类型出现多种 mode(如 img2vid/vid2vid
// 细分),再迁移为独立 media_type 列。
function projectAssetToGallery(a: ProjectAsset): GalleryItem {
  return {
    id: `a-${a.id}`,
    taskId: a.task_id || undefined,
    url: a.url,
    alt: a.prompt || '',
    prompt: a.prompt || '',
    model: a.model || '',
    mode: (a.mode as StudioMode) || 'text2img',
    mediaType: a.mode === 'video' ? 'video' : 'image',
    size: a.size || undefined,
    createdAt: a.created_at,
    assetId: a.id,
    sourceVideoUrl: a.source_video_url || undefined,
  };
}

function taskRemoteIds(task: StudioGenerationTask | undefined): number[] {
  if (!task) return [];
  const recoveredId = task.id.startsWith('r-') ? Number(task.id.slice(2)) : undefined;
  return uniqueNumbers([
    ...(task.remoteTaskIds || []),
    recoveredId,
    ...(task.result || []).map(item => item.taskId),
  ]);
}

function taskMatchesRemoteIds(task: StudioGenerationTask, remoteIds: number[]): boolean {
  if (remoteIds.length === 0) return false;
  const ids = taskRemoteIds(task);
  return ids.some(id => remoteIds.includes(id));
}

function tasksShareRemoteIdentity(a: StudioGenerationTask, b: StudioGenerationTask): boolean {
  if (a.id === b.id) return true;
  return taskMatchesRemoteIds(a, taskRemoteIds(b));
}

function resolveGenerationMode(currentMode: ImageMode, options?: GenerateOptions): ImageMode {
  if (options?.mode) return options.mode;
  if (options?.maskRegion) return 'inpaint';
  if (options?.sourceImage || options?.sourceImages?.length) return 'img2img';
  return currentMode;
}

function taskSize(task: GenerationTask): string | undefined {
  return task.size ?? undefined;
}

function taskAssetCreatedAt(task: GenerationTask): string {
  return task.completed_at || task.created_at;
}

function taskSourceUrl(task: GenerationTask): string | undefined {
  return task.input_images?.find(url => !!url);
}

// 视频官方上游直链（与中继同为 24h 过期），取值口径收敛于此，勿在构造点内联。
function taskSourceVideoUrl(task: GenerationTask): string | undefined {
  return task.source_outputs?.[0];
}

function isRemoteTaskActive(status: string): boolean {
  return ['pending', 'queued', 'processing', 'retrying', 'running', 'in_progress'].includes(status);
}

function isRemoteTaskFailed(status: string): boolean {
  return ['failed', 'cancelled', 'canceled', 'error', 'errored', 'rejected'].includes(status);
}

function isLocalTaskTerminal(status: StudioGenerationTask['status'] | undefined): boolean {
  return status === 'failed' || status === 'completed';
}

function isLocalTaskActive(status: StudioGenerationTask['status'] | undefined): boolean {
  return status === 'queued' || status === 'processing';
}

function generationTaskError(task: GenerationTask, fallback = 'Image generation task failed'): string {
  return stringsTrim(task.error_message) || fallback;
}

function failedTaskPatchFromRemote(task: GenerationTask, fallback = 'Task failed'): Partial<StudioGenerationTask> {
  return {
    status: 'failed',
    error: generationTaskError(task, fallback),
    progress: task.progress,
    remoteTaskIds: [task.id],
  };
}

function hasTerminalRemoteError(task: GenerationTask): boolean {
  return stringsTrim(task.error_message) !== '';
}

function stringsTrim(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function errorMessageFromUnknown(err: unknown, fallback = 'Generation failed'): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string' && err.trim()) return err;
  return fallback;
}

function isNotFoundError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return /\bnot\s*found\b/i.test(msg) || /\bNotFound\b/.test(msg) || /\b404\b/.test(msg) || msg.includes('不存在');
}

function readDeletedTaskRecords(): Record<string, number> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(DELETED_TASK_STORE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    const now = Date.now();
    const records: Record<string, number> = {};
    if (Array.isArray(parsed)) {
      for (const value of parsed) {
        const id = Number(value);
        if (Number.isFinite(id) && id > 0) records[String(id)] = now;
      }
    } else if (parsed && typeof parsed === 'object') {
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        const id = Number(key);
        const deletedAt = Number(value);
        if (!Number.isFinite(id) || id <= 0 || !Number.isFinite(deletedAt)) continue;
        if (now - deletedAt <= DELETED_TASK_TTL_MS) records[String(id)] = deletedAt;
      }
    }
    window.localStorage.setItem(DELETED_TASK_STORE_KEY, JSON.stringify(records));
    return records;
  } catch {
    return {};
  }
}

function writeDeletedTaskRecords(records: Record<string, number>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(DELETED_TASK_STORE_KEY, JSON.stringify(records));
  } catch { /* ignore */ }
}

function hasDeletedRemoteTaskId(records: Record<string, number>, taskId: number | undefined | null): boolean {
  return !!taskId && !!records[String(taskId)];
}

function filterDeletedRemoteTasks(taskList: GenerationTask[], records: Record<string, number>): GenerationTask[] {
  return taskList.filter(t => !hasDeletedRemoteTaskId(records, t.id));
}

function mergeTaskPatch(
  task: StudioGenerationTask,
  patch: Partial<StudioGenerationTask>,
  patchRemoteIds: number[],
): StudioGenerationTask {
  const remoteTaskIds = uniqueNumbers([
    ...taskRemoteIds(task),
    ...patchRemoteIds,
  ]);
  if (isLocalTaskTerminal(task.status) && isLocalTaskActive(patch.status)) {
    return {
      ...task,
      progress: patch.progress ?? task.progress,
      remoteTaskIds,
    };
  }
  return {
    ...task,
    ...patch,
    remoteTaskIds,
  };
}

async function deleteGenerationTaskIfPresent(taskId: number): Promise<void> {
  try {
    await api.deleteGenerationTask(taskId);
  } catch (err) {
    if (isNotFoundError(err)) return;
    throw err;
  }
}

function galleryItemsFromCompletedTask(
  task: GenerationTask,
  fallback: Pick<GalleryItem, 'prompt' | 'model' | 'mode'>,
): GalleryItem[] {
  // 视频任务:产物是单条视频 URL(中继地址),不走 markdown 图片解析。
  if (remoteTaskMediaType(task) === 'video') {
    const url = task.video_urls?.[0] || (task.result_content || '').trim();
    if (!url) return [];
    return [{
      id: remoteGalleryItemID(task.id, 0),
      taskId: task.id,
      url,
      alt: task.prompt || fallback.prompt,
      prompt: task.prompt || fallback.prompt,
      model: task.model ?? fallback.model,
      mode: 'video',
      mediaType: 'video',
      size: taskSize(task),
      createdAt: taskAssetCreatedAt(task),
      sourceUrl: taskSourceUrl(task),
      sourceVideoUrl: taskSourceVideoUrl(task),
    }];
  }
  return parseMarkdownImages(task.result_content || '').map((img, index) => ({
    id: remoteGalleryItemID(task.id, index),
    taskId: task.id,
    url: img.url,
    alt: img.alt,
    prompt: task.prompt || fallback.prompt,
    model: task.model ?? fallback.model,
    mode: operationToImageMode(task.operation ?? 'generate') || fallback.mode,
    size: taskSize(task),
    createdAt: taskAssetCreatedAt(task),
    sourceUrl: taskSourceUrl(task),
  }));
}

async function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    }
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

async function createMaskDataUrl(
  sourceUrl: string,
  region: { x: number; y: number; width: number; height: number },
  errorMessages = {
    sourceImage: 'Failed to load source image for mask',
    canvas: 'Cannot create canvas context',
  },
): Promise<string> {
  const img = new window.Image();
  img.src = sourceUrl;
  await new Promise<void>((res, rej) => {
    img.onload = () => res();
    img.onerror = () => rej(new Error(errorMessages.sourceImage));
  });
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error(errorMessages.canvas);
  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
  const x1 = clamp(Math.round(region.x * canvas.width), 0, canvas.width);
  const y1 = clamp(Math.round(region.y * canvas.height), 0, canvas.height);
  const x2 = clamp(Math.round((region.x + region.width) * canvas.width), 0, canvas.width);
  const y2 = clamp(Math.round((region.y + region.height) * canvas.height), 0, canvas.height);
  const x = Math.min(x1, x2);
  const y = Math.min(y1, y2);
  const w = Math.max(1, Math.abs(x2 - x1));
  const h = Math.max(1, Math.abs(y2 - y1));
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.clearRect(x, y, w, h);
  return canvas.toDataURL('image/png');
}

function getInitialModel(): ModelConfig {
  if (typeof window === 'undefined') return getDefaultModel();
  try {
    const stored = window.localStorage.getItem(MODEL_STORE_KEY);
    if (stored) return getModelConfig(stored) ?? getDefaultModel();
  } catch { /* ignore */ }
  return getDefaultModel();
}

function supportedSizeForModel(model: ModelConfig, size: string): string {
  return model.sizes.some(s => s.value === size) ? size : model.defaultSize;
}

function imageGroupCacheKey(platform: string, modelId: string): string {
  return `${platform}:${modelId}`;
}

async function pollGenerationTask(
  taskId: number,
  signal: AbortSignal,
  maxAttempts = POLL_MAX_ATTEMPTS,
  onPoll?: (task: GenerationTask) => void,
  errorMessages = DEFAULT_POLL_ERROR_MESSAGES,
): Promise<GenerationTask> {
  let networkErrors = 0;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    let task: GenerationTask | null = null;
    try {
      task = await api.getGenerationTask(taskId);
      networkErrors = 0;
    } catch (err) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      networkErrors++;
      if (err instanceof ApiRequestError || networkErrors > POLL_TRANSIENT_ERROR_ATTEMPTS) throw err;
    }
    if (task) {
      onPoll?.(task);
      if (task.status === 'completed') return task;
      if (isRemoteTaskFailed(task.status)) {
        throw new Error(generationTaskError(task, errorMessages.failed));
      }
      if (hasTerminalRemoteError(task)) {
        throw new Error(generationTaskError(task, errorMessages.failed));
      }
      if (!isRemoteTaskActive(task.status)) {
        throw new Error(generationTaskError(task, errorMessages.stopped(task.status)));
      }
    }
    const backoff = networkErrors > 0 ? Math.min(POLL_INTERVAL_MS * 2, 6000) : POLL_INTERVAL_MS;
    await delay(backoff, signal);
  }
  throw new Error(errorMessages.timeout);
}

async function waitForGenerationTask(
  task: GenerationTask,
  signal: AbortSignal,
  maxAttempts = POLL_MAX_ATTEMPTS,
  onPoll?: (task: GenerationTask) => void,
  errorMessages = DEFAULT_POLL_ERROR_MESSAGES,
): Promise<GenerationTask> {
  onPoll?.(task);
  if (task.status === 'completed') return task;
  if (isRemoteTaskFailed(task.status)) {
    throw new Error(generationTaskError(task, errorMessages.failed));
  }
  if (hasTerminalRemoteError(task)) {
    throw new Error(generationTaskError(task, errorMessages.failed));
  }
  if (!isRemoteTaskActive(task.status)) {
    throw new Error(generationTaskError(task, errorMessages.stopped(task.status)));
  }
  return pollGenerationTask(task.id, signal, maxAttempts, onPoll, errorMessages);
}

// ── Context type ──────────────────────────────────────────────────────────────

export interface StudioContextValue {
  // Initial shell/data recovery
  initialLoadComplete: boolean;

  // Media type
  mediaType: MediaType;
  setMediaType: (type: MediaType) => void;

  // Image mode
  imageMode: ImageMode;
  setImageMode: (mode: ImageMode) => void;

  // Model config
  currentModel: ModelConfig;
  selectedModelKey: string;
  setSelectedModelKey: (keyOrModelId: string, preferredPlatform?: string) => void;
  selectedPlatform: string;
  imageSize: string;
  setImageSize: (size: string) => void;

  // 计费分组选择（按当前平台拉取，用户可自选高/低倍率通道；null = 交给
  // core 自动选最便宜分组，与不传 group_id 的历史行为一致）。
  imageGroups: ImageGroup[];
  availableImagePlatforms: string[];
  getImageGroupsForModel: (model: ModelConfig) => ImageGroup[];
  hasImageGroupsForModel: (model: ModelConfig) => boolean;
  imageGroupsLoaded: boolean;
  selectedGroupId: number | null;
  setSelectedGroupId: (id: number) => void;
  selectModelRoute: (modelKey: string, groupId: number) => void;

  // Reference images (for img2img / inpaint).
  // Array so multiple gallery items can be added as references; ComposerBar
  // unions this with its locally uploaded sourceImages.
  referenceImages: string[];
  setReferenceImages: (urls: string[]) => void;

  // Generation
  isGenerating: boolean;
  tasks: StudioGenerationTask[];
  generate: (prompt: string, options?: GenerateOptions) => void;
  cancelGeneration: () => void;

  // Video generation（Seedance；与图像互不影响的独立参数域）
  availableVideoModels: VideoModelConfig[];
  videoModelId: string;
  setVideoModelId: (id: string) => void;
  videoDuration: number;
  setVideoDuration: (seconds: number) => void;
  videoResolution: string;
  setVideoResolution: (resolution: string) => void;
  videoRatio: string;
  setVideoRatio: (ratio: string) => void;
  videoAudio: boolean;
  setVideoAudio: (enabled: boolean) => void;
  videoGroups: ImageGroup[];
  videoGroupsLoaded: boolean;
  selectedVideoGroupId: number | null;
  setSelectedVideoGroupId: (id: number) => void;
  generateVideo: (prompt: string, options?: { sourceImages?: string[] }) => void;

  // Gallery
  gallery: GalleryItem[];
  hasMore: boolean;
  loadingMore: boolean;
  loadMoreError: boolean;
  loadMore: () => Promise<void>;
  generatedAssetRetentionDays: number | null;
  previewItem: GalleryItem | null;
  setPreviewItem: (item: GalleryItem | null) => void;
  deleteGalleryItem: (id: string) => Promise<void>;
  deleteTask: (uiId: string) => Promise<void>;
  retryBatchFailures: (uiId: string) => void;
  applyAsReference: (item: GalleryItem) => void;
  regenerate: (item: GalleryItem) => void;
  variations: (item: GalleryItem) => void;
  // 「编辑这张」：把某张结果图载入主创作框并打开蒙版编辑器（ComposerBar 监听 editRequest）。
  editRequest: string | null;
  requestEdit: (url: string) => void;
  clearEditRequest: () => void;

  // Projects (轻量项目维度). projectsEnabled=false 时（后端未配置 DB）退回「全部」视图。
  projectsEnabled: boolean;
  projects: Project[];
  activeProjectId: number; // 0 = 全部视图
  selectProject: (id: number) => void;
  createProject: (name?: string) => Promise<Project | null>;
  renameProject: (id: number, name: string) => Promise<void>;
  deleteProject: (id: number) => Promise<void>;
}

// ── Context + hook ────────────────────────────────────────────────────────────

const StudioContext = createContext<StudioContextValue | null>(null);

export function useStudio(): StudioContextValue {
  const ctx = useContext(StudioContext);
  if (!ctx) throw new Error('useStudio must be used within StudioProvider');
  return ctx;
}

// ── Provider ──────────────────────────────────────────────────────────────────

export function StudioProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const pollErrorMessages = useMemo<PollErrorMessages>(() => ({
    failed: t('playground.studio_error_generation_failed'),
    stopped: status => t('playground.studio_error_task_stopped', { status }),
    timeout: t('playground.studio_error_generation_timeout'),
  }), [t]);
  // Media type & mode
  const [mediaType, setMediaType] = useState<MediaType>('image');
  const [imageMode, setImageMode] = useState<ImageMode>('text2img');

  // ── Video（Seedance）参数域 ────────────────────────────────────────────────
  const vs = useVideoStrings();
  const [videoModelId, setVideoModelIdRaw] = useState(VIDEO_MODEL_REGISTRY[0].id);
  const [videoDuration, setVideoDuration] = useState<number>(5);
  const [videoResolution, setVideoResolution] = useState('720p');
  const [videoRatio, setVideoRatio] = useState('16:9');
  const [videoAudio, setVideoAudio] = useState(false);
  const [videoGroupsByModel, setVideoGroupsByModel] = useState<VideoGroupsByModel>({});
  const [videoGroupsLoaded, setVideoGroupsLoaded] = useState(false);
  const [selectedVideoGroupId, setSelectedVideoGroupId] = useState<number | null>(null);
  const videoGroups = useMemo(
    () => videoGroupsForModel(videoModelId, videoGroupsByModel),
    [videoGroupsByModel, videoModelId],
  );
  const availableVideoModels = useMemo(
    () => videoGroupsLoaded
      ? VIDEO_MODEL_REGISTRY.filter(model => videoGroupsForModel(model.id, videoGroupsByModel).length > 0)
      : VIDEO_MODEL_REGISTRY,
    [videoGroupsByModel, videoGroupsLoaded],
  );

  // 换档时收敛分辨率到该版本支持范围，并清空上一版本的分组选择。
  const setVideoModelId = useCallback((id: string) => {
    if (!VIDEO_MODEL_REGISTRY.some(model => model.id === id)) return;
    setVideoModelIdRaw(id);
    setSelectedVideoGroupId(null);
    setVideoResolution(prev => (videoModelById(id).resolutions.includes(prev) ? prev : '720p'));
  }, []);

  // 切到视频时一次性拉取所有版本的可用分组。海外标准 ID 也会命中国内的
  // API 兼容别名，因此由 videoGroupsForModel 用国内原生 ID 的结果做集合排除。
  useEffect(() => {
    if (mediaType !== 'video') return;
    let cancelled = false;
    setVideoGroupsByModel({});
    setVideoGroupsLoaded(false);
    setSelectedVideoGroupId(null);
    void Promise.all(VIDEO_MODEL_REGISTRY.map(async model => (
      [model.id, await api.listImageGroups('seedance', model.id, 'video')] as const
    )))
      .then(entries => {
        if (cancelled) return;
        const next: VideoGroupsByModel = {};
        for (const [modelId, groups] of entries) next[modelId] = groups;
        setVideoGroupsByModel(next);
        setVideoGroupsLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        // 区域隔离依赖完整的模型/分组集合；任一查询失败都禁用视频提交，
        // 避免把国内兼容别名误判为海外路由。
        setVideoGroupsByModel({});
        setVideoGroupsLoaded(true);
      });
    return () => { cancelled = true; };
  }, [mediaType]);

  // 默认海外版本对当前用户不可用时，自动落到第一个真实可用的版本。
  useEffect(() => {
    if (mediaType !== 'video' || !videoGroupsLoaded || videoGroups.length > 0) return;
    const fallback = availableVideoModels[0];
    if (fallback && fallback.id !== videoModelId) setVideoModelId(fallback.id);
  }, [availableVideoModels, mediaType, setVideoModelId, videoGroups.length, videoGroupsLoaded, videoModelId]);

  useEffect(() => {
    if (!videoGroupsLoaded) return;
    setSelectedVideoGroupId(prev => (
      prev != null && videoGroups.some(group => group.id === prev)
        ? prev
        : (videoGroups[0]?.id ?? null)
    ));
  }, [videoGroups, videoGroupsLoaded]);

  // Model selection (hardcoded registry)
  const [selectedModelKey, setSelectedModelKeyRaw] = useState(() => getInitialModel().routeKey);
  const selectedModelKeyRef = useRef(selectedModelKey);
  const [imageSize, setImageSizeRaw] = useState(() => {
    const model = getModelConfig(selectedModelKey) ?? getDefaultModel();
    return model.defaultSize;
  });

  // Reference images (accumulated via "use as reference" from gallery)
  const [referenceImages, setReferenceImages] = useState<string[]>([]);

  // Generation
  const [isGenerating, setIsGenerating] = useState(false);
  const [tasks, setTasks] = useState<StudioGenerationTask[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const deletedTaskRecordsRef = useRef<Record<string, number>>(readDeletedTaskRecords());
  const deletedLocalTaskIDsRef = useRef<Set<string>>(new Set());
  const deletedProjectAssetIDsRef = useRef<Set<number>>(new Set());

  // Gallery
  const [gallery, setGallery] = useState<GalleryItem[]>([]);
  const [previewItem, setPreviewItem] = useState<GalleryItem | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState(false);
  const [generatedAssetRetentionDays, setGeneratedAssetRetentionDays] = useState<number | null>(null);
  const galleryOffsetRef = useRef(0);
  const loadingMoreRef = useRef(false);
  const galleryViewEpochRef = useRef(0);
  const galleryRequestIDRef = useRef(0);
  const recoveryControllerRef = useRef<AbortController | null>(null);

  const recoveryPromiseRef = useRef<Promise<void> | null>(null);
  const [galleryRecovered, setGalleryRecovered] = useState(false);

  // Projects
  const [projectsEnabled, setProjectsEnabled] = useState(false);
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<number>(ALL_VIEW_ID);
  // activeProjectId 的 ref 副本，供 generate 的异步回调读取最新值（避免闭包捕获旧值）。
  const activeProjectIdRef = useRef<number>(ALL_VIEW_ID);
  useEffect(() => { activeProjectIdRef.current = activeProjectId; }, [activeProjectId]);

  const markRemoteTaskIDsDeleted = useCallback((remoteIDs: number[]) => {
    const ids = uniqueNumbers(remoteIDs);
    const marker = Date.now();
    const previous = new Map<string, number | undefined>();
    if (ids.length === 0) return { marker, previous };
    const next = { ...deletedTaskRecordsRef.current };
    for (const remoteID of ids) {
      const key = String(remoteID);
      previous.set(key, next[key]);
      next[key] = marker;
    }
    deletedTaskRecordsRef.current = next;
    writeDeletedTaskRecords(next);
    return { marker, previous };
  }, []);

  const restoreRemoteTaskDeletion = useCallback((snapshot: {
    marker: number;
    previous: Map<string, number | undefined>;
  }) => {
    if (snapshot.previous.size === 0) return;
    const restored = { ...deletedTaskRecordsRef.current };
    for (const [remoteID, previousValue] of snapshot.previous) {
      // Do not undo a newer delete request for the same remote task.
      if (restored[remoteID] !== snapshot.marker) continue;
      if (previousValue === undefined) delete restored[remoteID];
      else restored[remoteID] = previousValue;
    }
    deletedTaskRecordsRef.current = restored;
    writeDeletedTaskRecords(restored);
  }, []);

  const stopCreatedTaskIfDeleted = useCallback(async (localTaskID: string, remoteTaskID: number): Promise<boolean> => {
    if (
      !deletedLocalTaskIDsRef.current.has(localTaskID) &&
      !hasDeletedRemoteTaskId(deletedTaskRecordsRef.current, remoteTaskID)
    ) return false;
    markRemoteTaskIDsDeleted([remoteTaskID]);
    setTasks(prev => prev.filter(task => (
      task.id !== localTaskID && !taskMatchesRemoteIds(task, [remoteTaskID])
    )));
    setGallery(prev => prev.filter(item => item.taskId !== remoteTaskID));
    try {
      await deleteGenerationTaskIfPresent(remoteTaskID);
    } catch {
      // Keep the tombstone even when upstream cancellation fails. The user
      // explicitly deleted the task, so late responses must remain hidden.
    }
    return true;
  }, [markRemoteTaskIDsDeleted]);

  const visibleGeneratedItems = useCallback((localTaskID: string | undefined, items: GalleryItem[]): GalleryItem[] => {
    if (localTaskID && deletedLocalTaskIDsRef.current.has(localTaskID)) {
      const remoteIDs = uniqueNumbers(items.map(item => item.taskId));
      markRemoteTaskIDsDeleted(remoteIDs);
      void Promise.all(remoteIDs.map(deleteGenerationTaskIfPresent)).catch(() => {});
      return [];
    }
    return filterDeletedGalleryItems(items, deletedTaskRecordsRef.current, deletedProjectAssetIDsRef.current);
  }, [markRemoteTaskIDsDeleted]);

  // Derived from hardcoded registry
  const currentModel = getModelConfig(selectedModelKey) ?? getDefaultModel();
  const selectedModelId = currentModel.id;
  const selectedPlatform = currentModel.platform;

  const setSelectedModelKey = useCallback((keyOrModelId: string, preferredPlatform?: string) => {
    const currentPlatform = getModelConfig(selectedModelKeyRef.current)?.platform;
    const newModel = getModelConfig(keyOrModelId, preferredPlatform ?? currentPlatform) ?? getDefaultModel();
    selectedModelKeyRef.current = newModel.routeKey;
    setSelectedModelKeyRaw(newModel.routeKey);
    try {
      window.localStorage.setItem(MODEL_STORE_KEY, newModel.routeKey);
    } catch { /* ignore */ }
    setImageSizeRaw(prev => supportedSizeForModel(newModel, prev));
  }, []);

  const setImageSize = useCallback((size: string) => {
    const model = getModelConfig(selectedModelKeyRef.current) ?? getDefaultModel();
    setImageSizeRaw(supportedSizeForModel(model, size));
  }, []);

  useEffect(() => {
    selectedModelKeyRef.current = selectedModelKey;
    setImageSizeRaw(prev => supportedSizeForModel(currentModel, prev));
  }, [currentModel, selectedModelKey]);

  // ── 计费分组选择 ──────────────────────────────────────────────────────────
  // 平台切换时重新拉取该用户可用的分组（core 已按最便宜优先排序）。
  // 用户的选择按平台记在 localStorage；拉取失败或没有分组时回到 null，
  // 请求不带 group_id，由 core 自动选组（兼容历史行为）。

  const GROUP_STORE_PREFIX = 'studio.imageGroup.';
  const [imageGroupsByModel, setImageGroupsByModel] = useState<Record<string, ImageGroup[]>>({});
  const [imageGroupsLoaded, setImageGroupsLoaded] = useState(false);
  const [selectedGroupId, setSelectedGroupIdRaw] = useState<number | null>(null);
  const imageGroups = imageGroupsByModel[imageGroupCacheKey(selectedPlatform, selectedModelId)] ?? EMPTY_IMAGE_GROUPS;
  const availableImagePlatforms = useMemo(
    () => Array.from(new Set(
      MODEL_REGISTRY
        .filter(model => (imageGroupsByModel[imageGroupCacheKey(model.platform, model.id)]?.length ?? 0) > 0)
        .map(model => model.platform),
    )),
    [imageGroupsByModel],
  );
  const getImageGroupsForModel = useCallback((model: ModelConfig) => (
    imageGroupsByModel[imageGroupCacheKey(model.platform, model.id)] ?? EMPTY_IMAGE_GROUPS
  ), [imageGroupsByModel]);
  const hasImageGroupsForModel = useCallback(
    (model: ModelConfig) => getImageGroupsForModel(model).length > 0,
    [getImageGroupsForModel],
  );

  useEffect(() => {
    let active = true;
    setImageGroupsLoaded(false);
    void Promise.all(MODEL_REGISTRY.map(async (model) => {
      try {
        const groups = await api.listImageGroups(model.platform, model.id);
        return [imageGroupCacheKey(model.platform, model.id), groups] as const;
      } catch {
        return [imageGroupCacheKey(model.platform, model.id), [] as ImageGroup[]] as const;
      }
    })).then((entries) => {
      if (!active) return;
      const next: Record<string, ImageGroup[]> = {};
      for (const [key, groups] of entries) next[key] = groups;
      setImageGroupsByModel(next);
      setImageGroupsLoaded(true);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    setSelectedGroupIdRaw(null);
    if (!imageGroupsLoaded || imageGroups.length === 0) return;
    let preferred: number | null = null;
    try {
      const raw = window.localStorage.getItem(GROUP_STORE_PREFIX + selectedPlatform + ':' + selectedModelId);
      if (raw) preferred = Number.parseInt(raw, 10);
    } catch { /* ignore */ }
    const match = imageGroups.find(g => g.id === preferred);
    setSelectedGroupIdRaw((match ?? imageGroups[0]).id);
  }, [imageGroups, imageGroupsLoaded, selectedModelId, selectedPlatform]);

  useEffect(() => {
    if (!imageGroupsLoaded || imageGroups.length > 0) return;
    const fallback = MODEL_REGISTRY.find(model => (imageGroupsByModel[imageGroupCacheKey(model.platform, model.id)]?.length ?? 0) > 0);
    if (fallback && fallback.routeKey !== selectedModelKey) setSelectedModelKey(fallback.routeKey);
  }, [imageGroups, imageGroupsByModel, imageGroupsLoaded, selectedModelKey, setSelectedModelKey]);

  const setSelectedGroupId = useCallback((id: number) => {
    setSelectedGroupIdRaw(id);
    try {
      window.localStorage.setItem(GROUP_STORE_PREFIX + selectedPlatform + ':' + selectedModelId, String(id));
    } catch { /* ignore */ }
  }, [selectedModelId, selectedPlatform]);

  const selectModelRoute = useCallback((modelKey: string, groupId: number) => {
    const model = getModelConfig(modelKey);
    if (!model || !getImageGroupsForModel(model).some(group => group.id === groupId)) return;
    setSelectedModelKey(model.routeKey);
    setSelectedGroupIdRaw(groupId);
    try {
      window.localStorage.setItem(GROUP_STORE_PREFIX + imageGroupCacheKey(model.platform, model.id), String(groupId));
    } catch { /* ignore */ }
  }, [getImageGroupsForModel, setSelectedModelKey]);

  // ── Initialization ────────────────────────────────────────────────────────

  const PAGE_SIZE = 20;

  useEffect(() => {
    let active = true;
    api.getPublicSettings()
      .then((settings) => {
        if (!active) return;
        const raw = settings.asset_retention_generated_days?.trim();
        const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
        setGeneratedAssetRetentionDays(Number.isFinite(parsed) && parsed > 0 ? parsed : null);
      })
      .catch(() => {
        if (active) setGeneratedAssetRetentionDays(null);
      });
    return () => {
      active = false;
    };
  }, []);

  // Persist generated output in the project captured when its host task was
  // created. The backend treats task/project/url as an idempotency key, so
  // recovery polling and the foreground poller may safely converge here.
  const persistProjectAssets = useCallback(async (
    projectId: number,
    items: GalleryItem[],
    localTaskID?: string,
  ): Promise<void> => {
    if (projectId < 1 || items.length === 0) return;
    const itemsToPersist = visibleGeneratedItems(localTaskID, items);
    await Promise.all(itemsToPersist.map(async (item) => {
      try {
        const saved = await api.addProjectAsset(projectId, {
          task_id: item.taskId,
          url: item.url,
          prompt: item.prompt,
          model: item.model,
          mode: item.mode,
          size: item.size,
          // 视频官方直链一并落库,重载会话后 24h 内仍能显示「官方源链接」。
          source_video_url: item.sourceVideoUrl,
        });
        if (visibleGeneratedItems(localTaskID, [item]).length === 0) {
          // The user deleted the task while addProjectAsset was in flight.
          // Remove the row that just committed and never put it back on screen.
          deletedProjectAssetIDsRef.current.add(saved.id);
          try {
            await api.deleteProjectAsset(projectId, saved.id);
          } catch { /* the task tombstone still keeps a late row hidden */ }
          return;
        }
        // 回填 assetId；若持久化期间刚切回目标项目且列表请求尚未包含该条，则补进当前视图。
        setGallery(prev => {
          const identity = galleryItemIdentity(item);
          if (prev.some(g => galleryItemIdentity(g) === identity)) {
            return prev.map(g => (galleryItemIdentity(g) === identity ? { ...g, assetId: saved.id } : g));
          }
          if (activeProjectIdRef.current === projectId) {
            const savedItems = filterDeletedGalleryItems(
              [projectAssetToGallery(saved)],
              deletedTaskRecordsRef.current,
              deletedProjectAssetIDsRef.current,
            );
            return mergeGalleryItems(prev, savedItems, 'prepend');
          }
          return prev;
        });
      } catch { /* 持久化失败不阻塞展示 */ }
    }));
  }, [visibleGeneratedItems]);

  const prependGalleryForTarget = useCallback((
    targetProjectID: number,
    items: GalleryItem[],
    localTaskID?: string,
  ) => {
    if (!isGalleryTargetVisible(targetProjectID, activeProjectIdRef.current)) return;
    const visibleItems = visibleGeneratedItems(localTaskID, items);
    if (visibleItems.length === 0) return;
    setGallery(prev => mergeGalleryItems(prev, visibleItems, 'prepend'));
  }, [visibleGeneratedItems]);

  function tasksToGallery(taskList: GenerationTask[]): GalleryItem[] {
    const items: GalleryItem[] = [];
    for (const task of taskList) {
      if (task.status !== 'completed') continue;
      items.push(...galleryItemsFromCompletedTask(task, {
        prompt: task.prompt,
        model: task.model ?? '',
        mode: remoteTaskMode(task),
      }));
    }
    return items;
  }

  const recoverTasks = useCallback(async (signal: AbortSignal, expectedViewEpoch = galleryViewEpochRef.current) => {
    try {
      // 历史图(completed)与「进行中/失败卡恢复」(recent)是两件独立的事,却共用一次
      // 拉取。用 allSettled 让二者解耦:任一请求瞬时抖动都不再把成功那半的结果一起丢掉
      // (旧代码 Promise.all 只要一条失败,catch 吞掉后历史整片空白且不重试)。
      const [completedRes, recentRes] = await Promise.allSettled([
        api.listGenerationTasks({ limit: PAGE_SIZE, offset: 0, status: 'completed' }),
        api.listGenerationTasks({ limit: PAGE_SIZE, offset: 0 }),
      ]);
      if (
        signal.aborted ||
        expectedViewEpoch !== galleryViewEpochRef.current ||
        activeProjectIdRef.current !== ALL_VIEW_ID
      ) return;

      const deletedTaskRecords = deletedTaskRecordsRef.current;

      // 历史图:completed 请求成功就渲染,与 recent 成败无关。
      if (completedRes.status === 'fulfilled') {
        const { tasks: completedTasks, total: completedTotal } = completedRes.value;
        const visibleCompletedTasks = filterDeletedRemoteTasks(completedTasks, deletedTaskRecords);
        const completedItems = tasksToGallery(visibleCompletedTasks);
        // Preserve results that completed after this list request took its
        // snapshot. The request epoch only protects against project switches;
        // a functional merge also protects writes within the same view.
        setGallery(prev => mergeGalleryItems(prev, completedItems, 'append'));
        // A task may have completed while the tab was closed. Reconcile its
        // project reference on startup; AddAsset is idempotent for this tuple.
        for (const completedTask of visibleCompletedTasks) {
          const targetProjectID = remoteTaskProjectID(completedTask);
          if (targetProjectID < 1) continue;
          const taskItems = galleryItemsFromCompletedTask(completedTask, {
            prompt: completedTask.prompt,
            model: completedTask.model ?? '',
            mode: remoteTaskMode(completedTask),
          });
          void persistProjectAssets(targetProjectID, taskItems, `r-${completedTask.id}`);
        }
        galleryOffsetRef.current = completedTasks.length;
        setHasMore(completedTasks.length < completedTotal);
        setLoadMoreError(false);
      } else {
        setLoadMoreError(true);
      }

      // 进行中/失败卡恢复:recent 请求失败就跳过(历史图已独立渲染)。
      if (recentRes.status !== 'fulfilled') return;
      const visibleRecentTasks = filterDeletedRemoteTasks(recentRes.value.tasks, deletedTaskRecords);

      const failed = visibleRecentTasks.filter(t => isRemoteTaskFailed(t.status) || hasTerminalRemoteError(t));
      const inFlight = visibleRecentTasks.filter(t => isRemoteTaskActive(t.status) && !hasTerminalRemoteError(t));

      const recoveredTasks: StudioGenerationTask[] = [
        ...failed.map(t => ({
          id: `r-${t.id}`,
          projectId: remoteTaskProjectID(t),
          prompt: t.prompt,
          mode: remoteTaskMode(t),
          status: 'failed' as const,
          error: t.error_message || pollErrorMessages.failed,
          createdAt: t.created_at,
          model: t.model,
          size: t.size,
          durationSeconds: t.duration,
          remoteTaskIds: [t.id],
        })),
        ...inFlight.map(t => ({
          id: `r-${t.id}`,
          projectId: remoteTaskProjectID(t),
          prompt: t.prompt,
          mode: remoteTaskMode(t),
          status: 'processing' as const,
          createdAt: t.created_at,
          model: t.model,
          size: t.size,
          durationSeconds: t.duration,
          remoteTaskIds: [t.id],
        })),
      ];
      setTasks(prev => {
        const currentDeletedTaskRecords = deletedTaskRecordsRef.current;
        const visibleRecoveredTasks = recoveredTasks.filter(remote => (
          !taskRemoteIds(remote).some(id => hasDeletedRemoteTaskId(currentDeletedTaskRecords, id))
        ));
        const merged = visibleRecoveredTasks.map(remote => {
          const local = prev.find(item => tasksShareRemoteIdentity(item, remote));
          if (!local) return remote;
          return mergeTaskPatch(local, {
            ...remote,
            id: local.id,
            projectId: local.projectId ?? remote.projectId,
          }, taskRemoteIds(remote));
        });
        const localOnly = prev.filter(local =>
          !visibleRecoveredTasks.some(remote => tasksShareRemoteIdentity(local, remote)) &&
          !taskRemoteIds(local).some(id => hasDeletedRemoteTaskId(currentDeletedTaskRecords, id)),
        );
        return [...merged, ...localOnly];
      });
      if (inFlight.length === 0) return;

      setIsGenerating(true);
      activeCountRef.current = inFlight.length;
      const noResultImageError = t('playground.studio_error_no_result_image');
      const noResultVideoError = vs('no_result');
      const recoveryFailedError = t('playground.studio_error_recovery_failed');
      for (const t of inFlight) {
        const taskUiId = `r-${t.id}`;
        const isVideoTask = remoteTaskMediaType(t) === 'video';
        pollGenerationTask(t.id, signal, isVideoTask ? VIDEO_POLL_MAX_ATTEMPTS : POLL_MAX_ATTEMPTS, undefined, pollErrorMessages)
          .then(done => {
            if (
              signal.aborted ||
              expectedViewEpoch !== galleryViewEpochRef.current ||
              activeProjectIdRef.current !== ALL_VIEW_ID ||
              hasDeletedRemoteTaskId(deletedTaskRecordsRef.current, done.id)
            ) return;
            recordRemoteTaskSample(done);
            const targetProjectID = remoteTaskProjectID(done) || remoteTaskProjectID(t);
            const items = galleryItemsFromCompletedTask(done, {
              prompt: t.prompt,
              model: t.model ?? '',
              mode: remoteTaskMode(t),
            });
            if (items.length === 0) {
              setTasks(prev => prev.map(gt => gt.id === taskUiId
                ? mergeTaskPatch(gt, { status: 'failed', error: isVideoTask ? noResultVideoError : noResultImageError }, [done.id])
                : gt));
              return;
            }
            const visibleItems = filterDeletedGalleryItems(
              items,
              deletedTaskRecordsRef.current,
              deletedProjectAssetIDsRef.current,
            );
            if (visibleItems.length > 0) {
              prependGalleryForTarget(targetProjectID, visibleItems, taskUiId);
              void persistProjectAssets(targetProjectID, visibleItems, taskUiId);
            }
            setTasks(prev => prev.map(gt => gt.id === taskUiId
              ? mergeTaskPatch(gt, { status: 'completed', result: items, projectId: targetProjectID }, [done.id])
              : gt));
          })
          .catch(err => {
            if (
              signal.aborted ||
              expectedViewEpoch !== galleryViewEpochRef.current ||
              activeProjectIdRef.current !== ALL_VIEW_ID ||
              hasDeletedRemoteTaskId(deletedTaskRecordsRef.current, t.id)
            ) return;
            const msg = errorMessageFromUnknown(err, recoveryFailedError);
            setTasks(prev =>
              prev.map(gt =>
                gt.id === taskUiId
                  ? mergeTaskPatch(gt, { status: 'failed', error: msg }, [t.id])
                  : gt,
              ),
            );
          })
          .finally(() => {
            activeCountRef.current -= 1;
            if (activeCountRef.current <= 0) {
              activeCountRef.current = 0;
              setIsGenerating(false);
            }
          });
      }
    } catch {
      // task recovery is non-fatal
    }
  }, [persistProjectAssets, pollErrorMessages, prependGalleryForTarget, t, vs]);

  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current || !hasMore) return;
    const expectedViewEpoch = galleryViewEpochRef.current;
    const expectedProjectID = activeProjectIdRef.current;
    const requestID = ++galleryRequestIDRef.current;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    setLoadMoreError(false);
    try {
      if (expectedProjectID >= 1) {
        // 项目视图：分页读 studio_assets
        const { assets, total } = await api.listProjectAssets(expectedProjectID, {
          limit: PAGE_SIZE,
          offset: galleryOffsetRef.current,
        });
        if (!isExpectedGalleryView(
          expectedViewEpoch,
          expectedProjectID,
          galleryViewEpochRef.current,
          activeProjectIdRef.current,
        )) return;
        const visibleAssets = filterDeletedGalleryItems(
          assets.map(projectAssetToGallery),
          deletedTaskRecordsRef.current,
          deletedProjectAssetIDsRef.current,
        );
        setGallery(prev => mergeGalleryItems(prev, visibleAssets, 'append'));
        galleryOffsetRef.current += assets.length;
        setHasMore(galleryOffsetRef.current < total);
      } else {
        // 全部视图：分页读 host tasks（含老用户历史图）
        const { tasks: moreTasks, total } = await api.listGenerationTasks({
          limit: PAGE_SIZE,
          offset: galleryOffsetRef.current,
          status: 'completed',
        });
        if (!isExpectedGalleryView(
          expectedViewEpoch,
          expectedProjectID,
          galleryViewEpochRef.current,
          activeProjectIdRef.current,
        )) return;
        const visibleMoreTasks = filterDeletedRemoteTasks(moreTasks, deletedTaskRecordsRef.current);
        const newItems = tasksToGallery(visibleMoreTasks);
        setGallery(prev => mergeGalleryItems(prev, newItems, 'append'));
        for (const completedTask of visibleMoreTasks) {
          const targetProjectID = remoteTaskProjectID(completedTask);
          if (targetProjectID < 1) continue;
          const taskItems = galleryItemsFromCompletedTask(completedTask, {
            prompt: completedTask.prompt,
            model: completedTask.model ?? '',
            mode: remoteTaskMode(completedTask),
          });
          void persistProjectAssets(targetProjectID, taskItems, `r-${completedTask.id}`);
        }
        galleryOffsetRef.current += moreTasks.length;
        setHasMore(galleryOffsetRef.current < total);
      }
    } catch {
      if (isExpectedGalleryView(
        expectedViewEpoch,
        expectedProjectID,
        galleryViewEpochRef.current,
        activeProjectIdRef.current,
      )) setLoadMoreError(true);
    } finally {
      if (requestID === galleryRequestIDRef.current) {
        loadingMoreRef.current = false;
        setLoadingMore(false);
      }
    }
  }, [hasMore, persistProjectAssets]);

  // selectProject 切换当前项目并重载画廊。id=0 → 全部视图（host tasks）；id>=1 → 项目资产。
  const selectProject = useCallback((id: number) => {
    recoveryControllerRef.current?.abort();
    recoveryControllerRef.current = null;
    const expectedViewEpoch = ++galleryViewEpochRef.current;
    const requestID = ++galleryRequestIDRef.current;
    setActiveProjectId(id);
    activeProjectIdRef.current = id;
    galleryOffsetRef.current = 0;
    loadingMoreRef.current = true;
    setGallery([]);
    setHasMore(true);
    setLoadingMore(true);
    setLoadMoreError(false);
    if (id >= 1) {
      void (async () => {
        try {
          const { assets, total } = await api.listProjectAssets(id, { limit: PAGE_SIZE, offset: 0 });
          if (!isExpectedGalleryView(
            expectedViewEpoch,
            id,
            galleryViewEpochRef.current,
            activeProjectIdRef.current,
          )) return;
          const visibleAssets = filterDeletedGalleryItems(
            assets.map(projectAssetToGallery),
            deletedTaskRecordsRef.current,
            deletedProjectAssetIDsRef.current,
          );
          setGallery(prev => mergeGalleryItems(prev, visibleAssets, 'append'));
          galleryOffsetRef.current = assets.length;
          setHasMore(assets.length < total);
        } catch {
          if (isExpectedGalleryView(
            expectedViewEpoch,
            id,
            galleryViewEpochRef.current,
            activeProjectIdRef.current,
          )) setLoadMoreError(true);
        } finally {
          if (requestID === galleryRequestIDRef.current) {
            loadingMoreRef.current = false;
            setLoadingMore(false);
          }
        }
      })();
    } else {
      // 全部视图：重新拉 host tasks 历史
      const controller = new AbortController();
      recoveryControllerRef.current = controller;
      void recoverTasks(controller.signal, expectedViewEpoch).finally(() => {
        if (requestID === galleryRequestIDRef.current) {
          loadingMoreRef.current = false;
          setLoadingMore(false);
        }
      });
    }
  }, [recoverTasks]);

  // 历史恢复只跑一次:recoverTasks 的身份会随 i18n 的 t/vs 变化,effect 会重跑,
  // 用 ref 兜住只发一次请求。
  // ⚠️ 不要再用「cleanup 翻 active 标志位」来门控 finally——effect 一旦因 t 变化重跑,
  // React 会先执行上一次 cleanup 把 active 置 false,而 ref 守卫又拦掉了重跑(不会 arm
  // 新的 active),于是这唯一一次恢复的 finally 里 setGalleryRecovered 永不执行,
  // initialLoadComplete 卡在 false,画廊永远停在骨架屏(历史加载不出来的真凶)。
  // 恢复结束就无条件置位;组件已卸载时 setState 是 no-op,无害。
  useEffect(() => {
    if (recoveryPromiseRef.current) return;
    const controller = new AbortController();
    recoveryControllerRef.current = controller;
    recoveryPromiseRef.current = recoverTasks(controller.signal).finally(() => {
      setGalleryRecovered(true);
    });
  }, [recoverTasks]);

  useEffect(() => () => {
    recoveryControllerRef.current?.abort();
  }, []);

  // 加载项目列表（探测后端是否启用了项目功能）。后端 /projects 在首次访问时会自动
  // 确保有一个默认项目；若返回 503（未配置 DB）则 projectsEnabled 保持 false，退回全部视图。
  useEffect(() => {
    let active = true;
    api.listProjects()
      .then((list) => {
        if (!active) return;
        setProjects(list);
        setProjectsEnabled(true);
      })
      .catch(() => {
        if (active) setProjectsEnabled(false);
      })
      .finally(() => {
        if (active) setProjectsLoaded(true);
      });
    return () => { active = false; };
  }, []);

  // Re-check processing tasks on visibility change / timer fallback (e.g. tab switch back, service restart).
  useEffect(() => {
    const refresh = async () => {
      const processing = tasks.filter(t => t.status === 'processing' || t.status === 'queued');
      if (processing.length === 0) return;
      const checks = processing.map(async (uiTask) => {
        const remoteId = taskRemoteIds(uiTask)[0] ?? null;
        if (!remoteId) return;
        if (
          deletedLocalTaskIDsRef.current.has(uiTask.id) ||
          hasDeletedRemoteTaskId(deletedTaskRecordsRef.current, remoteId)
        ) {
          setTasks(prev => prev.filter(task => task.id !== uiTask.id));
          return;
        }
        try {
          const remote = await api.getGenerationTask(remoteId);
          if (remote.status === 'completed') {
            const targetProjectID = remoteTaskProjectID(remote) || uiTask.projectId || ALL_VIEW_ID;
            recordRemoteTaskSample(remote, {
              mediaType: uiTask.mode === 'video' ? 'video' : 'image',
              model: uiTask.model,
              size: uiTask.size,
              durationSeconds: uiTask.durationSeconds,
            });
            const items = galleryItemsFromCompletedTask(remote, {
              prompt: uiTask.prompt,
              model: uiTask.model ?? '',
              mode: uiTask.mode,
            });
            if (items.length === 0) {
              setTasks(prev => prev.map(gt => gt.id === uiTask.id
                ? mergeTaskPatch(gt, { status: 'failed', error: uiTask.mode === 'video' ? vs('no_result') : t('playground.studio_error_no_result_image') }, [remote.id])
                : gt));
              return;
            }
            prependGalleryForTarget(targetProjectID, items, uiTask.id);
            void persistProjectAssets(targetProjectID, items, uiTask.id);
            setTasks(prev => prev.map(gt => gt.id === uiTask.id
              ? mergeTaskPatch(gt, { status: 'completed', result: items, projectId: targetProjectID }, [remote.id])
              : gt));
          } else if (isRemoteTaskFailed(remote.status) || hasTerminalRemoteError(remote)) {
            setTasks(prev => prev.map(gt => gt.id === uiTask.id
              ? mergeTaskPatch(gt, failedTaskPatchFromRemote(remote, pollErrorMessages.failed), [remote.id])
              : gt));
          } else if (isRemoteTaskActive(remote.status)) {
            setTasks(prev => prev.map(gt => gt.id === uiTask.id
              ? mergeTaskPatch(gt, { status: 'processing', progress: remote.progress }, [remote.id])
              : gt));
          } else {
            setTasks(prev => prev.map(gt => gt.id === uiTask.id
              ? mergeTaskPatch(gt, { status: 'failed', error: generationTaskError(remote, pollErrorMessages.stopped(remote.status)) }, [remote.id])
              : gt));
          }
        } catch (err) {
          if (err instanceof ApiRequestError && err.status === 404) {
            setTasks(prev => prev.filter(gt => gt.id !== uiTask.id));
            return;
          }
          if (err instanceof ApiRequestError || isNotFoundError(err)) {
            setTasks(prev => prev.map(gt => gt.id === uiTask.id
              ? mergeTaskPatch(gt, { status: 'failed', error: errorMessageFromUnknown(err, t('playground.studio_error_status_check_failed')) }, [remoteId])
              : gt));
          }
        }
      });
      await Promise.all(checks);
    };

    const onVisibility = () => { if (document.visibilityState === 'visible') void refresh(); };
    const onFocus = () => void refresh();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onFocus);
    const timer = window.setInterval(() => { void refresh(); }, 5000);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onFocus);
      window.clearInterval(timer);
    };
  }, [persistProjectAssets, pollErrorMessages, prependGalleryForTarget, t, tasks, vs]);

  // ── Generation ────────────────────────────────────────────────────────────

  const cancelGeneration = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const activeCountRef = useRef(0);

  const generate = useCallback(
    (
      prompt: string,
      options?: GenerateOptions,
    ) => {
      if (!prompt.trim()) return;
      const mode = resolveGenerationMode(imageMode, options);
      const targetProjectID = activeProjectIdRef.current;

      const failLocalTask = (message: string) => {
        setTasks(prev => [{
          id: uid(),
          projectId: targetProjectID,
          prompt,
          mode,
          status: 'failed',
          error: message,
          createdAt: new Date().toISOString(),
          platform: selectedPlatform,
          model: selectedModelId,
          size: imageSize,
          remoteTaskIds: [],
        }, ...prev]);
      };

      if (!imageGroupsLoaded) {
        failLocalTask(t('playground.studio_error_image_groups_loading'));
        return;
      }

      if (imageGroups.length === 0) {
        const platformLabel = selectedPlatform === 'gemini'
          ? 'Gemini'
          : selectedPlatform === 'openai'
          ? 'OpenAI'
          : selectedPlatform;
        failLocalTask(t('playground.studio_error_no_image_group', { platform: platformLabel }));
        return;
      }

      const controller = new AbortController();
      const signal = controller.signal;

      const taskId = uid();
      const now = new Date().toISOString();
      const remoteTaskIds: number[] = [];
      // 发起时刻的分组选择：写进 task 供「全部重试」沿用，避免用户中途切组导致错扣。
      const groupId = selectedGroupId ?? undefined;

      const task: StudioGenerationTask = {
        id: taskId,
        projectId: targetProjectID,
        prompt,
        mode,
        status: 'queued',
        createdAt: now,
        platform: selectedPlatform,
        model: selectedModelId,
        groupId,
        size: imageSize,
        remoteTaskIds: [],
      };

      setTasks(prev => [task, ...prev]);
      activeCountRef.current += 1;
      setIsGenerating(true);

      const updateTask = (patch: Partial<StudioGenerationTask>) => {
        if (deletedLocalTaskIDsRef.current.has(taskId)) return;
        const patchRemoteIds = uniqueNumbers(patch.remoteTaskIds || []);
        setTasks(prev => prev.map(t => (
          t.id === taskId || taskMatchesRemoteIds(t, patchRemoteIds)
            ? mergeTaskPatch(t, patch, patchRemoteIds)
            : t
        )));
      };

      const runTask = async () => {
        try {
          updateTask({ status: 'processing' });

          if (mode === 'batch') {
            const prompts = options?.prompts?.length
              ? options.prompts
              : Array.from({ length: options?.count ?? 4 }, () => prompt);

            // 批量子任务的执行上下文：捕获当前模型/尺寸/参考图，
            // 之后写进 task，供「全部重试」在不依赖即时 UI state 的前提下复用。
            const batchSources = options?.sourceImages?.length
              ? options.sourceImages
              : options?.sourceImage
              ? [options.sourceImage]
              : [];
            const batchOperation: 'generate' | 'edit' = batchSources.length > 0 ? 'edit' : 'generate';

            // 初始化 N 个子任务，全部置为 processing，立即渲染聚合卡。
            const subtasks: BatchSubtask[] = prompts.map((p) => ({
              id: uid(),
              status: 'processing' as const,
              prompt: p,
            }));
            updateTask({
              subtasks: subtasks.map(s => ({ ...s })),
              batchSources,
            });

            // patchSubtask 局部更新单个子任务状态（实时反映到聚合卡）。
            const patchSubtask = (subId: string, patch: Partial<BatchSubtask>) => {
              if (deletedLocalTaskIDsRef.current.has(taskId)) return;
              const subRemoteId = patch.remoteTaskId;
              setTasks(prev => prev.map(t => {
                if (t.id !== taskId && (!subRemoteId || !taskMatchesRemoteIds(t, [subRemoteId]))) return t;
                if (!t.subtasks) return t;
                return { ...t, subtasks: t.subtasks.map(s => (s.id === subId ? { ...s, ...patch } : s)) };
              }));
            };

            const runSubtask = async (sub: BatchSubtask): Promise<GalleryItem[]> => {
              const created = await api.createGenerationTask({
                kind: 'image',
                operation: batchOperation,
                platform: selectedPlatform,
                model: selectedModelId,
                prompt: sub.prompt,
                group_id: groupId,
                project_id: targetProjectID > ALL_VIEW_ID ? targetProjectID : undefined,
                parameters: imageSize ? { size: imageSize } : undefined,
                inputs: batchSources.length > 0
                  ? batchSources.map(url => ({ type: 'image' as const, role: 'source' as const, url }))
                  : undefined,
              });
              remoteTaskIds.push(created.id);
              if (await stopCreatedTaskIfDeleted(taskId, created.id)) return [];
              patchSubtask(sub.id, { remoteTaskId: created.id });
              updateTask({ remoteTaskIds: [...remoteTaskIds] });
              const completed = await waitForGenerationTask(created, signal, POLL_MAX_ATTEMPTS, undefined, pollErrorMessages);
              recordRemoteTaskSample(completed, { mediaType: 'image', model: selectedModelId, size: imageSize });
              const items = galleryItemsFromCompletedTask(completed, {
                prompt: sub.prompt,
                model: selectedModelId,
                mode,
              }).map(item => ({
                ...item,
                sourceUrl: batchSources[0],
              }));
              if (items.length === 0) {
                throw new Error(t('playground.studio_error_no_result_image'));
              }
              // 成功一张立即进画廊 + 落项目（不等整组完成）。
              prependGalleryForTarget(targetProjectID, items, taskId);
              void persistProjectAssets(targetProjectID, items, taskId);
              patchSubtask(sub.id, { status: 'completed' });
              return items;
            };

            const settled = await Promise.allSettled(
              subtasks.map(async (sub) => {
                try {
                  return await runSubtask(sub);
                } catch (err) {
                  if (signal.aborted) {
                    patchSubtask(sub.id, { status: 'failed', error: t('playground.studio_error_generation_cancelled') });
                  } else {
                    const msg = errorMessageFromUnknown(err, t('playground.studio_error_generation_failed'));
                    patchSubtask(sub.id, { status: 'failed', error: msg });
                  }
                  throw err;
                }
              }),
            );

            const okCount = settled.filter(s => s.status === 'fulfilled').length;
            const allItems = settled.flatMap(s => (s.status === 'fulfilled' ? s.value : []));
            // 整组状态：全成功 → completed；部分/全失败 → failed（聚合卡据此显示「全部重试」）。
            updateTask({
              status: okCount === subtasks.length ? 'completed' : 'failed',
              result: allItems,
              remoteTaskIds: [...remoteTaskIds],
              error: okCount === 0 ? t('playground.studio_error_batch_all_failed') : undefined,
            });

          } else {
            // text2img / img2img / inpaint — 统一走 task 系统
            const taskData: Parameters<typeof api.createGenerationTask>[0] = {
              kind: 'image',
              operation: modeToOperation(mode),
              platform: selectedPlatform,
              model: selectedModelId,
              prompt,
              group_id: groupId,
              project_id: targetProjectID > ALL_VIEW_ID ? targetProjectID : undefined,
              parameters: imageSize ? { size: imageSize } : undefined,
            };

            if (mode === 'img2img' || mode === 'inpaint') {
              // Source priority: caller-passed sources > caller's single source
              // > accumulated gallery references. The reference list can hold
              // multiple URLs now, so img2img can fan out to them all.
              const sources = options?.sourceImages?.length
                ? options.sourceImages
                : options?.sourceImage
                ? [options.sourceImage]
                : referenceImages;
              if (sources.length === 0 && mode === 'inpaint') throw new Error(t('playground.studio_error_inpaint_source_required'));
              if (sources.length > 0) {
                // 直接透传 source URL（data:、/assets-runtime/、http(s) 都行）。
                // core 的 normalizeTaskInputAssets 只对 data:image/* 大图落盘，已经是
                // URL 形式的会原样保留，避免"画廊 URL → 前端 fetch → data URI → 后端再落盘"
                // 的来回搬运。
                taskData.inputs = sources.map(url => ({ type: 'image' as const, role: 'source' as const, url }));
              }
            }

            if (mode === 'inpaint' && options?.maskRegion) {
              // Inpaint is single-source by API contract; use the first reference.
              const sourceUrl = options?.sourceImage ?? referenceImages[0] ?? '';
              taskData.mask = {
                type: 'image',
                role: 'mask',
                url: await createMaskDataUrl(sourceUrl, options.maskRegion, {
                  sourceImage: t('playground.studio_error_mask_source_load_failed'),
                  canvas: t('playground.studio_error_mask_canvas_unavailable'),
                }),
              };
            }

            const created = await api.createGenerationTask(taskData);
            if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
            if (await stopCreatedTaskIfDeleted(taskId, created.id)) return;
            updateTask({ remoteTaskIds: [created.id] });
            const completed = await waitForGenerationTask(created, signal, POLL_MAX_ATTEMPTS, (t) => {
              if (isRemoteTaskFailed(t.status) || hasTerminalRemoteError(t)) {
                updateTask(failedTaskPatchFromRemote(t, pollErrorMessages.failed));
                return;
              }
              if (typeof t.progress === 'number') updateTask({ progress: t.progress, remoteTaskIds: [t.id] });
            }, pollErrorMessages);
            if (isRemoteTaskFailed(completed.status) || hasTerminalRemoteError(completed)) {
              updateTask(failedTaskPatchFromRemote(completed, pollErrorMessages.failed));
              return;
            }
            recordRemoteTaskSample(completed, { mediaType: 'image', model: selectedModelId, size: imageSize });
            const images = parseMarkdownImages(completed.result_content || '');
            if (images.length === 0) {
              updateTask({ status: 'failed', error: t('playground.studio_error_no_result_image'), remoteTaskIds: [created.id] });
              return;
            }

            const galleryItems: GalleryItem[] = images.map((img, index) => ({
              id: remoteGalleryItemID(created.id, index),
              taskId: created.id,
              url: img.url,
              alt: img.alt,
              prompt,
              model: selectedModelId,
              mode,
              size: imageSize,
              createdAt: taskAssetCreatedAt(completed),
              // GalleryItem.sourceUrl is single-valued; record the first source
              // so "regenerate" can seed at least one reference. Multi-ref recall
              // would need a schema change to GalleryItem.
              sourceUrl: (mode === 'img2img' || mode === 'inpaint')
                ? (options?.sourceImage ?? options?.sourceImages?.[0] ?? referenceImages[0] ?? undefined)
                : undefined,
            }));

            prependGalleryForTarget(targetProjectID, galleryItems, taskId);
            updateTask({ status: 'completed', result: galleryItems, remoteTaskIds: [created.id] });
            void persistProjectAssets(targetProjectID, galleryItems, taskId);
          }
        } catch (err) {
          if (signal.aborted) {
            updateTask({ status: 'failed', error: t('playground.studio_error_generation_cancelled') });
          } else {
            const msg = errorMessageFromUnknown(err, t('playground.studio_error_generation_failed'));
            updateTask({ status: 'failed', error: msg });
          }
        } finally {
          activeCountRef.current -= 1;
          if (activeCountRef.current <= 0) {
            activeCountRef.current = 0;
            setIsGenerating(false);
          }
        }
      };

      void runTask();
    },
    [
      imageMode,
      imageSize,
      imageGroups,
      imageGroupsLoaded,
      referenceImages,
      selectedPlatform,
      selectedModelId,
      selectedGroupId,
      persistProjectAssets,
      pollErrorMessages,
      prependGalleryForTarget,
      stopCreatedTaskIfDeleted,
      t,
    ],
  );

  // generateVideo 视频生成（Seedance）：单任务直达 task 系统，
  // 轮询窗口放宽到 60 分钟；产物是网关签发的中继地址，不落 core 资产库。
  const generateVideo = useCallback(
    (prompt: string, options?: { sourceImages?: string[] }) => {
      if (!prompt.trim()) return;
      const model = videoModelId;
      const groupId = selectedVideoGroupId;
      if (!videoGroupsLoaded || groupId == null || !videoGroups.some(group => group.id === groupId)) return;
      const taskId = uid();
      const now = new Date().toISOString();
      const sources = options?.sourceImages ?? [];
      const targetProjectID = activeProjectIdRef.current;

      const task: StudioGenerationTask = {
        id: taskId,
        projectId: targetProjectID,
        prompt,
        mode: 'video',
        status: 'queued',
        createdAt: now,
        platform: 'seedance',
        model,
        groupId,
        size: videoResolution,
        durationSeconds: videoDuration,
        remoteTaskIds: [],
      };
      setTasks(prev => [task, ...prev]);
      activeCountRef.current += 1;
      setIsGenerating(true);

      const controller = new AbortController();
      const signal = controller.signal;
      const updateTask = (patch: Partial<StudioGenerationTask>) => {
        if (deletedLocalTaskIDsRef.current.has(taskId)) return;
        const patchRemoteIds = uniqueNumbers(patch.remoteTaskIds || []);
        setTasks(prev => prev.map(item => (
          item.id === taskId || taskMatchesRemoteIds(item, patchRemoteIds)
            ? mergeTaskPatch(item, patch, patchRemoteIds)
            : item
        )));
      };

      const runTask = async () => {
        try {
          updateTask({ status: 'processing' });
          if (videoGroupsLoaded && videoGroups.length === 0) {
            updateTask({ status: 'failed', error: vs('no_group') });
            return;
          }
          const created = await api.createGenerationTask({
            kind: 'video',
            operation: 'generate',
            platform: 'seedance',
            model,
            prompt,
            group_id: groupId,
            project_id: targetProjectID > ALL_VIEW_ID ? targetProjectID : undefined,
            parameters: {
              duration: videoDuration,
              resolution: videoResolution,
              ratio: videoRatio,
              generate_audio: videoAudio,
            },
            inputs: sources.length > 0
              ? sources.map(url => ({ type: 'image' as const, role: 'reference_image' as const, url }))
              : undefined,
          });
          if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
          if (await stopCreatedTaskIfDeleted(taskId, created.id)) return;
          updateTask({ remoteTaskIds: [created.id] });
          const completed = await waitForGenerationTask(created, signal, VIDEO_POLL_MAX_ATTEMPTS, (remote) => {
            if (isRemoteTaskFailed(remote.status) || hasTerminalRemoteError(remote)) {
              updateTask(failedTaskPatchFromRemote(remote, pollErrorMessages.failed));
              return;
            }
            if (typeof remote.progress === 'number') updateTask({ progress: remote.progress, remoteTaskIds: [remote.id] });
          }, pollErrorMessages);
          if (isRemoteTaskFailed(completed.status) || hasTerminalRemoteError(completed)) {
            updateTask(failedTaskPatchFromRemote(completed, pollErrorMessages.failed));
            return;
          }
          recordRemoteTaskSample(completed, { mediaType: 'video', model, size: videoResolution, durationSeconds: videoDuration });
          const videoUrl = completed.video_urls?.[0] || (completed.result_content || '').trim();
          if (!videoUrl) {
            updateTask({ status: 'failed', error: vs('no_result'), remoteTaskIds: [created.id] });
            return;
          }
          const item: GalleryItem = {
            id: remoteGalleryItemID(created.id, 0),
            taskId: created.id,
            url: videoUrl,
            alt: prompt,
            prompt,
            model,
            mode: 'video',
            mediaType: 'video',
            size: videoResolution,
            createdAt: taskAssetCreatedAt(completed),
            sourceUrl: sources[0],
            sourceVideoUrl: taskSourceVideoUrl(completed),
          };
          prependGalleryForTarget(targetProjectID, [item], taskId);
          updateTask({ status: 'completed', result: [item], remoteTaskIds: [created.id] });
          void persistProjectAssets(targetProjectID, [item], taskId);
        } catch (err) {
          if (signal.aborted) {
            updateTask({ status: 'failed', error: t('playground.studio_error_generation_cancelled') });
          } else {
            updateTask({ status: 'failed', error: errorMessageFromUnknown(err, pollErrorMessages.failed) });
          }
        } finally {
          activeCountRef.current -= 1;
          if (activeCountRef.current <= 0) {
            activeCountRef.current = 0;
            setIsGenerating(false);
          }
        }
      };
      void runTask();
    },
    [
      videoModelId,
      videoDuration,
      videoResolution,
      videoRatio,
      videoAudio,
      videoGroups,
      videoGroupsLoaded,
      selectedVideoGroupId,
      persistProjectAssets,
      pollErrorMessages,
      prependGalleryForTarget,
      stopCreatedTaskIfDeleted,
      t,
      vs,
    ],
  );

  // ── Gallery helpers ───────────────────────────────────────────────────────

  const deleteTask = useCallback(async (uiId: string): Promise<void> => {
    const task = tasks.find(t => t.id === uiId);
    const expectedViewEpoch = galleryViewEpochRef.current;
    const expectedProjectID = activeProjectIdRef.current;
    const remoteIds = uniqueNumbers([
      ...(task ? taskRemoteIds(task) : []),
      ...((uiId.startsWith('r-') ? [Number(uiId.slice(2))] : [])),
    ]);
    const removedGalleryItems = gallery.filter(item => item.taskId && remoteIds.includes(item.taskId));
    const hadLocalTombstone = deletedLocalTaskIDsRef.current.has(uiId);
    deletedLocalTaskIDsRef.current.add(uiId);
    const deletionSnapshot = markRemoteTaskIDsDeleted(remoteIds);
    setTasks(prev => prev.filter(t => t.id !== uiId));
    if (remoteIds.length > 0) {
      setGallery(prev => prev.filter(item => !item.taskId || !remoteIds.includes(item.taskId)));
    }
    try {
      await Promise.all(remoteIds.map(remoteId => deleteGenerationTaskIfPresent(remoteId)));
      const projectID = (task?.projectId ?? expectedProjectID) >= 1
        ? (task?.projectId ?? expectedProjectID)
        : null;
      const assetIDs = uniqueNumbers(removedGalleryItems.map(item => item.assetId));
      if (projectID) {
        await Promise.allSettled(assetIDs.map(assetID => api.deleteProjectAsset(projectID, assetID)));
      }
    } catch (err) {
      restoreRemoteTaskDeletion(deletionSnapshot);
      if (!hadLocalTombstone) deletedLocalTaskIDsRef.current.delete(uiId);
      const msg = errorMessageFromUnknown(err, t('playground.studio_error_delete_failed'));
      if (task) {
        setTasks(prev => {
          const failedTask: StudioGenerationTask = { ...task, status: 'failed', error: msg };
          return prev.some(item => item.id === uiId)
            ? prev.map(item => item.id === uiId ? failedTask : item)
            : [failedTask, ...prev];
        });
      }
      if (isExpectedGalleryView(
        expectedViewEpoch,
        expectedProjectID,
        galleryViewEpochRef.current,
        activeProjectIdRef.current,
      )) {
        setGallery(prev => mergeGalleryItems(prev, removedGalleryItems, 'prepend'));
      }
      throw err;
    }
  }, [gallery, markRemoteTaskIDsDeleted, restoreRemoteTaskDeletion, t, tasks]);

  const deleteGalleryItem = useCallback(async (id: string): Promise<void> => {
    const item = gallery.find(g => g.id === id);
    if (!item) return;
    const expectedViewEpoch = galleryViewEpochRef.current;
    const expectedProjectID = activeProjectIdRef.current;
    // 项目视图条目：删 studio_assets 记录（不动底层 host task / 资产对象，可能被「全部」视图共享）。
    if (item.assetId && activeProjectIdRef.current >= 1) {
      const projectId = activeProjectIdRef.current;
      const hadAssetTombstone = deletedProjectAssetIDsRef.current.has(item.assetId);
      deletedProjectAssetIDsRef.current.add(item.assetId);
      setGallery(prev => prev.filter(g => g.id !== id));
      try {
        await api.deleteProjectAsset(projectId, item.assetId);
      } catch (err) {
        if (!hadAssetTombstone) deletedProjectAssetIDsRef.current.delete(item.assetId);
        if (isExpectedGalleryView(
          expectedViewEpoch,
          expectedProjectID,
          galleryViewEpochRef.current,
          activeProjectIdRef.current,
        )) setGallery(prev => mergeGalleryItems(prev, [item], 'prepend'));
        throw err;
      }
      return;
    }
    const matchingTask = item.taskId
      ? tasks.find(task => taskRemoteIds(task).includes(item.taskId!))
      : undefined;
    if (matchingTask) {
      await deleteTask(matchingTask.id);
      return;
    }
    const removedGalleryItems = item.taskId
      ? gallery.filter(g => g.taskId === item.taskId)
      : [item];
    setGallery(prev => (item.taskId
      ? prev.filter(g => g.taskId !== item.taskId)
      : prev.filter(g => g.id !== id)));
    if (item.taskId) {
      const deletionSnapshot = markRemoteTaskIDsDeleted([item.taskId]);
      try {
        await deleteGenerationTaskIfPresent(item.taskId);
      } catch (err) {
        restoreRemoteTaskDeletion(deletionSnapshot);
        if (isExpectedGalleryView(
          expectedViewEpoch,
          expectedProjectID,
          galleryViewEpochRef.current,
          activeProjectIdRef.current,
        )) setGallery(prev => mergeGalleryItems(prev, removedGalleryItems, 'prepend'));
        throw err;
      }
    }
  }, [deleteTask, gallery, markRemoteTaskIDsDeleted, restoreRemoteTaskDeletion, tasks]);

  const applyAsReference = useCallback((item: GalleryItem) => {
    // 视频不能作图像参考。
    if (item.mediaType === 'video') return;
    // Dedupe-append rather than replace so multiple gallery items accumulate.
    setReferenceImages(prev => prev.includes(item.url) ? prev : [...prev, item.url]);
    setImageMode('img2img');
  }, []);

  const regenerate = useCallback((item: GalleryItem) => {
    if (item.mediaType === 'video' || item.mode === 'video') {
      setMediaType('video');
      if (VIDEO_MODEL_REGISTRY.some(m => m.id === item.model)) setVideoModelId(item.model);
      setTimeout(() => {
        generateVideo(item.prompt, { sourceImages: item.sourceUrl ? [item.sourceUrl] : undefined });
      }, 0);
      return;
    }
    const mode = item.mode === 'batch' ? 'text2img' : item.mode;
    const sourceImage = item.sourceUrl ?? (mode === 'img2img' || mode === 'inpaint' ? item.url : undefined);
    setSelectedModelKey(item.model);
    setImageMode(mode);
    if (item.size) setImageSize(item.size);
    // Regenerate resets references to the original source (one item only —
    // GalleryItem.sourceUrl can't carry multiple references today).
    setReferenceImages(sourceImage ? [sourceImage] : []);
    setTimeout(() => {
      generate(item.prompt, {
        mode,
        sourceImage,
      });
    }, 0);
  }, [generate, generateVideo, setVideoModelId, setSelectedModelKey, setImageMode, setImageSize]);

  // variations —— 「变体」：同 prompt 出 4 张（gpt-image-2 无固定 seed，自然各异），复用批量路径。
  const variations = useCallback((item: GalleryItem) => {
    if (item.mediaType === 'video' || item.mode === 'video') {
      regenerate(item);
      return;
    }
    const mode = item.mode === 'batch' ? 'text2img' : item.mode;
    const sourceImage = item.sourceUrl ?? (mode === 'img2img' || mode === 'inpaint' ? item.url : undefined);
    setSelectedModelKey(item.model);
    setImageMode(mode);
    if (item.size) setImageSize(item.size);
    setReferenceImages(sourceImage ? [sourceImage] : []);
    setTimeout(() => {
      generate(item.prompt, { mode: 'batch', count: 4, sourceImages: sourceImage ? [sourceImage] : undefined });
    }, 0);
  }, [generate, regenerate, setSelectedModelKey, setImageMode, setImageSize]);

  // editRequest —— 「编辑这张」桥接：GalleryCard 调 requestEdit(url)，ComposerBar 监听后
  // 把该图载入主框并打开蒙版编辑器（局部重绘），用完 clearEditRequest 清空。
  const [editRequest, setEditRequest] = useState<string | null>(null);
  const requestEdit = useCallback((url: string) => setEditRequest(url), []);
  const clearEditRequest = useCallback(() => setEditRequest(null), []);

  // retryBatchFailures —— 只重发某个批量任务里失败的子任务，复用 task 自身保存的
  // 执行上下文（model/size/sources），不依赖当前 UI state，因此用户切换
  // 项目或模型后重试也不会错乱。成功的子任务原样保留，不重复消耗额度。
  const retryBatchFailures = useCallback((uiId: string) => {
    const task = tasks.find(t => t.id === uiId);
    if (!task || !task.subtasks) return;
    const failed = task.subtasks.filter(s => s.status === 'failed');
    if (failed.length === 0) return;

    const controller = new AbortController();
    const signal = controller.signal;
    const model = task.model || selectedModelId;
    const platform = task.platform || selectedPlatform;
    const size = task.size;
    const groupId = task.groupId;
    const targetProjectID = task.projectId ?? ALL_VIEW_ID;
    const sources = task.batchSources ?? [];
    const operation: 'generate' | 'edit' = sources.length > 0 ? 'edit' : 'generate';

    const patchSubtask = (subId: string, patch: Partial<BatchSubtask>) => {
      if (deletedLocalTaskIDsRef.current.has(uiId)) return;
      setTasks(prev => prev.map(t => {
        if (t.id !== uiId || !t.subtasks) return t;
        return { ...t, subtasks: t.subtasks.map(s => (s.id === subId ? { ...s, ...patch } : s)) };
      }));
    };

    // 把失败子任务置回 processing，整组回到 processing。
    setTasks(prev => prev.map(t => {
      if (t.id !== uiId || !t.subtasks) return t;
      return {
        ...t,
        status: 'processing',
        error: undefined,
        subtasks: t.subtasks.map(s => (s.status === 'failed' ? { ...s, status: 'processing', error: undefined } : s)),
      };
    }));
    activeCountRef.current += 1;
    setIsGenerating(true);

    const runRetry = async () => {
      await Promise.allSettled(failed.map(async (sub) => {
        try {
          const created = await api.createGenerationTask({
            kind: 'image',
            operation,
            platform,
            model,
            prompt: sub.prompt,
            group_id: groupId,
            project_id: targetProjectID > ALL_VIEW_ID ? targetProjectID : undefined,
            parameters: size ? { size } : undefined,
            inputs: sources.length > 0
              ? sources.map(url => ({ type: 'image' as const, role: 'source' as const, url }))
              : undefined,
          });
          if (await stopCreatedTaskIfDeleted(uiId, created.id)) return;
          patchSubtask(sub.id, { remoteTaskId: created.id });
          const completed = await waitForGenerationTask(created, signal, POLL_MAX_ATTEMPTS, undefined, pollErrorMessages);
          const items = galleryItemsFromCompletedTask(completed, {
            prompt: sub.prompt,
            model,
            mode: 'batch',
          }).map(item => ({
            ...item,
            sourceUrl: sources[0],
          }));
          if (items.length === 0) {
            throw new Error(t('playground.studio_error_no_result_image'));
          }
          prependGalleryForTarget(targetProjectID, items, uiId);
          void persistProjectAssets(targetProjectID, items, uiId);
          patchSubtask(sub.id, { status: 'completed' });
        } catch (err) {
          const msg = errorMessageFromUnknown(err, t('playground.studio_error_generation_failed'));
          patchSubtask(sub.id, { status: 'failed', error: signal.aborted ? t('playground.studio_error_generation_cancelled') : msg });
        }
      }));
      // 重算整组状态
      const partialFailedMessage = t('playground.studio_error_batch_partial_failed');
      setTasks(prev => prev.map(taskItem => {
        if (taskItem.id !== uiId || !taskItem.subtasks) return taskItem;
        const stillFailed = taskItem.subtasks.some(s => s.status === 'failed');
        return { ...taskItem, status: stillFailed ? 'failed' : 'completed', error: stillFailed ? partialFailedMessage : undefined };
      }));
      activeCountRef.current -= 1;
      if (activeCountRef.current <= 0) {
        activeCountRef.current = 0;
        setIsGenerating(false);
      }
    };
    void runRetry();
  }, [persistProjectAssets, pollErrorMessages, prependGalleryForTarget, selectedModelId, selectedPlatform, stopCreatedTaskIfDeleted, t, tasks]);

  // ── Project CRUD ──────────────────────────────────────────────────────────

  const createProject = useCallback(async (name?: string): Promise<Project | null> => {
    try {
      const project = await api.createProject(name);
      setProjects(prev => [project, ...prev]);
      selectProject(project.id);
      return project;
    } catch {
      return null;
    }
  }, [selectProject]);

  const renameProject = useCallback(async (id: number, name: string): Promise<void> => {
    await api.renameProject(id, name);
    setProjects(prev => prev.map(p => (p.id === id ? { ...p, name } : p)));
  }, []);

  const deleteProject = useCallback(async (id: number): Promise<void> => {
    await api.deleteProject(id);
    setProjects(prev => prev.filter(p => p.id !== id));
    // 删的是当前项目则回退到全部视图
    if (activeProjectIdRef.current === id) {
      selectProject(ALL_VIEW_ID);
    }
  }, [selectProject]);

  // ── Context value ─────────────────────────────────────────────────────────

  const value: StudioContextValue = {
    initialLoadComplete: galleryRecovered && projectsLoaded,
    mediaType,
    setMediaType,
    imageMode,
    setImageMode,
    videoModelId,
    setVideoModelId,
    availableVideoModels,
    videoDuration,
    setVideoDuration,
    videoResolution,
    setVideoResolution,
    videoRatio,
    setVideoRatio,
    videoAudio,
    setVideoAudio,
    videoGroups,
    videoGroupsLoaded,
    selectedVideoGroupId,
    setSelectedVideoGroupId,
    generateVideo,
    currentModel,
    selectedModelKey,
    setSelectedModelKey,
    selectedPlatform,
    imageSize,
    setImageSize,
    imageGroups,
    availableImagePlatforms,
    getImageGroupsForModel,
    hasImageGroupsForModel,
    imageGroupsLoaded,
    selectedGroupId,
    setSelectedGroupId,
    selectModelRoute,
    referenceImages,
    setReferenceImages,
    isGenerating,
    tasks,
    generate,
    cancelGeneration,
    gallery,
    hasMore,
    loadingMore,
    loadMoreError,
    loadMore,
    generatedAssetRetentionDays,
    previewItem,
    setPreviewItem,
    deleteGalleryItem,
    deleteTask,
    retryBatchFailures,
    applyAsReference,
    regenerate,
    variations,
    editRequest,
    requestEdit,
    clearEditRequest,
    projectsEnabled,
    projects,
    activeProjectId,
    selectProject,
    createProject,
    renameProject,
    deleteProject,
  };

  return <StudioContext.Provider value={value}>{children}</StudioContext.Provider>;
}
