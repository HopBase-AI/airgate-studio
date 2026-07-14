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
import { VIDEO_MODEL_REGISTRY, videoModelById, useVideoStrings } from './video/videoConfig';
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
      id: uid(),
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
    }];
  }
  return parseMarkdownImages(task.result_content || '').map(img => ({
    id: uid(),
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
  selectedModelId: string;
  setSelectedModelId: (id: string) => void;
  selectedPlatform: string;
  imageSize: string;
  setImageSize: (size: string) => void;

  // 计费分组选择（按当前平台拉取，用户可自选高/低倍率通道；null = 交给
  // core 自动选最便宜分组，与不传 group_id 的历史行为一致）。
  imageGroups: ImageGroup[];
  availableImagePlatforms: string[];
  hasImageGroupsForModel: (model: ModelConfig) => boolean;
  imageGroupsLoaded: boolean;
  selectedGroupId: number | null;
  setSelectedGroupId: (id: number) => void;

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
  loadMore: () => void;
  generatedAssetRetentionDays: number | null;
  previewItem: GalleryItem | null;
  setPreviewItem: (item: GalleryItem | null) => void;
  deleteGalleryItem: (id: string) => Promise<void>;
  deleteTask: (uiId: string) => Promise<void>;
  retryBatchFailures: (uiId: string) => void;
  useAsReference: (item: GalleryItem) => void;
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
  const [videoGroups, setVideoGroups] = useState<ImageGroup[]>([]);
  const [videoGroupsLoaded, setVideoGroupsLoaded] = useState(false);
  const [selectedVideoGroupId, setSelectedVideoGroupId] = useState<number | null>(null);

  // 换档时收敛分辨率到该档支持范围（fast/mini 无 1080p/4k）。
  const setVideoModelId = useCallback((id: string) => {
    setVideoModelIdRaw(id);
    setVideoResolution(prev => (videoModelById(id).resolutions.includes(prev) ? prev : '720p'));
  }, []);

  // 切到视频或换模型时拉取可用分组（seedance 平台，不要求图片能力）。
  useEffect(() => {
    if (mediaType !== 'video') return;
    let cancelled = false;
    setVideoGroupsLoaded(false);
    api.listImageGroups('seedance', videoModelId, 'video')
      .then(groups => {
        if (cancelled) return;
        setVideoGroups(groups);
        setVideoGroupsLoaded(true);
        setSelectedVideoGroupId(prev => (prev != null && groups.some(g => g.id === prev)) ? prev : (groups[0]?.id ?? null));
      })
      .catch(() => {
        if (cancelled) return;
        setVideoGroups([]);
        setVideoGroupsLoaded(true);
      });
    return () => { cancelled = true; };
  }, [mediaType, videoModelId]);

  // Model selection (hardcoded registry)
  const [selectedModelId, setSelectedModelIdRaw] = useState(() => getInitialModel().id);
  const selectedModelIdRef = useRef(selectedModelId);
  const [imageSize, setImageSizeRaw] = useState(() => {
    const model = getModelConfig(selectedModelId) ?? getDefaultModel();
    return model.defaultSize;
  });

  // Reference images (accumulated via "use as reference" from gallery)
  const [referenceImages, setReferenceImages] = useState<string[]>([]);

  // Generation
  const [isGenerating, setIsGenerating] = useState(false);
  const [tasks, setTasks] = useState<StudioGenerationTask[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const deletedTaskRecordsRef = useRef<Record<string, number>>(readDeletedTaskRecords());

  // Gallery
  const [gallery, setGallery] = useState<GalleryItem[]>([]);
  const [previewItem, setPreviewItem] = useState<GalleryItem | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [generatedAssetRetentionDays, setGeneratedAssetRetentionDays] = useState<number | null>(null);
  const galleryOffsetRef = useRef(0);

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

  // Derived from hardcoded registry
  const currentModel = getModelConfig(selectedModelId) ?? getDefaultModel();
  const selectedPlatform = currentModel.platform;

  const setSelectedModelId = useCallback((id: string) => {
    selectedModelIdRef.current = id;
    setSelectedModelIdRaw(id);
    try {
      window.localStorage.setItem(MODEL_STORE_KEY, id);
    } catch { /* ignore */ }
    const newModel = getModelConfig(id);
    if (newModel) {
      setImageSizeRaw(prev => supportedSizeForModel(newModel, prev));
    }
  }, []);

  const setImageSize = useCallback((size: string) => {
    const model = getModelConfig(selectedModelIdRef.current) ?? getDefaultModel();
    setImageSizeRaw(supportedSizeForModel(model, size));
  }, []);

  useEffect(() => {
    selectedModelIdRef.current = selectedModelId;
    setImageSizeRaw(prev => supportedSizeForModel(currentModel, prev));
  }, [currentModel, selectedModelId]);

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
  const hasImageGroupsForModel = useCallback((model: ModelConfig) => (
    (imageGroupsByModel[imageGroupCacheKey(model.platform, model.id)]?.length ?? 0) > 0
  ), [imageGroupsByModel]);

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
    if (fallback && fallback.id !== selectedModelId) setSelectedModelId(fallback.id);
  }, [imageGroups, imageGroupsByModel, imageGroupsLoaded, selectedModelId, setSelectedModelId]);

  const setSelectedGroupId = useCallback((id: number) => {
    setSelectedGroupIdRaw(id);
    try {
      window.localStorage.setItem(GROUP_STORE_PREFIX + selectedPlatform + ':' + selectedModelId, String(id));
    } catch { /* ignore */ }
  }, [selectedModelId, selectedPlatform]);

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

  function tasksToGallery(taskList: GenerationTask[]): GalleryItem[] {
    const items: GalleryItem[] = [];
    for (const t of taskList) {
      if (t.status !== 'completed') continue;
      // 视频任务:产物是视频 URL,单独成卡(修复「全部」视图里历史视频消失)。
      if (remoteTaskMediaType(t) === 'video') {
        const url = t.video_urls?.[0] || (t.result_content || '').trim();
        if (!url) continue;
        items.push({
          id: uid(),
          taskId: t.id,
          url,
          alt: t.prompt,
          prompt: t.prompt,
          model: t.model ?? '',
          mode: 'video',
          mediaType: 'video',
          size: taskSize(t),
          createdAt: taskAssetCreatedAt(t),
          sourceUrl: taskSourceUrl(t),
        });
        continue;
      }
      if (!t.result_content) continue;
      for (const img of parseMarkdownImages(t.result_content)) {
        items.push({
          id: uid(),
          taskId: t.id,
          url: img.url,
          alt: img.alt,
          prompt: t.prompt,
          model: t.model ?? '',
          mode: operationToImageMode(t.operation ?? 'generate'),
          size: taskSize(t),
          createdAt: taskAssetCreatedAt(t),
          sourceUrl: taskSourceUrl(t),
        });
      }
    }
    return items;
  }

  const recoverTasks = useCallback(async (signal: AbortSignal) => {
    try {
      const [
        { tasks: completedTasks, total: completedTotal },
        { tasks: recentTasks },
      ] = await Promise.all([
        api.listGenerationTasks({ limit: PAGE_SIZE, offset: 0, status: 'completed' }),
        api.listGenerationTasks({ limit: PAGE_SIZE, offset: 0 }),
      ]);
      if (signal.aborted) return;

      const deletedTaskRecords = deletedTaskRecordsRef.current;
      const visibleCompletedTasks = filterDeletedRemoteTasks(completedTasks, deletedTaskRecords);
      const visibleRecentTasks = filterDeletedRemoteTasks(recentTasks, deletedTaskRecords);

      setGallery(tasksToGallery(visibleCompletedTasks));
      galleryOffsetRef.current = completedTasks.length;
      setHasMore(completedTasks.length < completedTotal);

      const failed = visibleRecentTasks.filter(t => isRemoteTaskFailed(t.status) || hasTerminalRemoteError(t));
      const inFlight = visibleRecentTasks.filter(t => isRemoteTaskActive(t.status) && !hasTerminalRemoteError(t));

      const recoveredTasks: StudioGenerationTask[] = [
        ...failed.map(t => ({
          id: `r-${t.id}`,
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
        const merged = recoveredTasks.map(remote => {
          const local = prev.find(item => tasksShareRemoteIdentity(item, remote));
          if (!local) return remote;
          return mergeTaskPatch(local, { ...remote, id: local.id }, taskRemoteIds(remote));
        });
        const localOnly = prev.filter(local =>
          !recoveredTasks.some(remote => tasksShareRemoteIdentity(local, remote)) &&
          !taskRemoteIds(local).some(id => hasDeletedRemoteTaskId(deletedTaskRecords, id)),
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
            if (signal.aborted) return;
            recordRemoteTaskSample(done);
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
            setGallery(prev => [...items, ...prev]);
            setTasks(prev => prev.map(gt => gt.id === taskUiId
              ? mergeTaskPatch(gt, { status: 'completed', result: items }, [done.id])
              : gt));
          })
          .catch(err => {
            if (signal.aborted) return;
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
            if (signal.aborted) return;
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
  }, [pollErrorMessages, t, vs]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      if (activeProjectIdRef.current >= 1) {
        // 项目视图：分页读 studio_assets
        const projectId = activeProjectIdRef.current;
        const { assets, total } = await api.listProjectAssets(projectId, {
          limit: PAGE_SIZE,
          offset: galleryOffsetRef.current,
        });
        setGallery(prev => [...prev, ...assets.map(projectAssetToGallery)]);
        galleryOffsetRef.current += assets.length;
        setHasMore(galleryOffsetRef.current < total);
      } else {
        // 全部视图：分页读 host tasks（含老用户历史图）
        const { tasks: moreTasks, total } = await api.listGenerationTasks({
          limit: PAGE_SIZE,
          offset: galleryOffsetRef.current,
          status: 'completed',
        });
        const visibleMoreTasks = filterDeletedRemoteTasks(moreTasks, deletedTaskRecordsRef.current);
        const newItems = tasksToGallery(visibleMoreTasks);
        setGallery(prev => [...prev, ...newItems]);
        galleryOffsetRef.current += moreTasks.length;
        setHasMore(galleryOffsetRef.current < total);
      }
    } catch { /* non-fatal */ }
    setLoadingMore(false);
  }, [loadingMore, hasMore]);

  // selectProject 切换当前项目并重载画廊。id=0 → 全部视图（host tasks）；id>=1 → 项目资产。
  const selectProject = useCallback((id: number) => {
    setActiveProjectId(id);
    activeProjectIdRef.current = id;
    galleryOffsetRef.current = 0;
    setGallery([]);
    setHasMore(true);
    if (id >= 1) {
      void (async () => {
        try {
          const { assets, total } = await api.listProjectAssets(id, { limit: PAGE_SIZE, offset: 0 });
          setGallery(assets.map(projectAssetToGallery));
          galleryOffsetRef.current = assets.length;
          setHasMore(assets.length < total);
        } catch { /* non-fatal */ }
      })();
    } else {
      // 全部视图：重新拉 host tasks 历史
      const controller = new AbortController();
      void recoverTasks(controller.signal);
    }
  }, [recoverTasks]);

  // persistActiveProjectAssets 把新生成的图写入当前项目（仅项目视图）。返回带 assetId 的副本，
  // 失败时静默降级（图仍在画廊里，只是没持久化到项目）。
  const persistActiveProjectAssets = useCallback(async (items: GalleryItem[]): Promise<void> => {
    const projectId = activeProjectIdRef.current;
    if (projectId < 1 || items.length === 0) return;
    await Promise.all(items.map(async (item) => {
      try {
        const saved = await api.addProjectAsset(projectId, {
          task_id: item.taskId,
          url: item.url,
          prompt: item.prompt,
          model: item.model,
          mode: item.mode,
          size: item.size,
        });
        // 回填 assetId，让删除走项目资产删除而非 host task 删除
        setGallery(prev => prev.map(g => (g.id === item.id ? { ...g, assetId: saved.id } : g)));
      } catch { /* 持久化失败不阻塞展示 */ }
    }));
  }, []);

  useEffect(() => {
    if (!recoveryPromiseRef.current) {
      let active = true;
      const controller = new AbortController();
      recoveryPromiseRef.current = recoverTasks(controller.signal).finally(() => {
        if (active) setGalleryRecovered(true);
      });
      return () => { active = false; };
    }
  }, [recoverTasks]);

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
        try {
          const remote = await api.getGenerationTask(remoteId);
          if (remote.status === 'completed') {
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
            setGallery(prev => [...items, ...prev]);
            setTasks(prev => prev.map(gt => gt.id === uiTask.id
              ? mergeTaskPatch(gt, { status: 'completed', result: items }, [remote.id])
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
  }, [pollErrorMessages, t, tasks, vs]);

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

      const failLocalTask = (message: string) => {
        setTasks(prev => [{
          id: uid(),
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
                parameters: imageSize ? { size: imageSize } : undefined,
                inputs: batchSources.length > 0
                  ? batchSources.map(url => ({ type: 'image' as const, role: 'source' as const, url }))
                  : undefined,
              });
              remoteTaskIds.push(created.id);
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
              setGallery(prev => [...items, ...prev]);
              void persistActiveProjectAssets(items);
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

            const galleryItems: GalleryItem[] = images.map(img => ({
              id: uid(),
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

            setGallery(prev => [...galleryItems, ...prev]);
            updateTask({ status: 'completed', result: galleryItems, remoteTaskIds: [created.id] });
            void persistActiveProjectAssets(galleryItems);
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
      persistActiveProjectAssets,
      pollErrorMessages,
      t,
    ],
  );

  // generateVideo 视频生成（Seedance）：单任务直达 task 系统，
  // 轮询窗口放宽到 60 分钟；产物是网关签发的中继地址，不落 core 资产库。
  const generateVideo = useCallback(
    (prompt: string, options?: { sourceImages?: string[] }) => {
      if (!prompt.trim()) return;
      const model = videoModelId;
      const taskId = uid();
      const now = new Date().toISOString();
      const groupId = selectedVideoGroupId ?? undefined;
      const sources = options?.sourceImages ?? [];

      const task: StudioGenerationTask = {
        id: taskId,
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
            id: uid(),
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
          };
          setGallery(prev => [item, ...prev]);
          updateTask({ status: 'completed', result: [item], remoteTaskIds: [created.id] });
          void persistActiveProjectAssets([item]);
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
      persistActiveProjectAssets,
      pollErrorMessages,
      t,
      vs,
    ],
  );

  // ── Gallery helpers ───────────────────────────────────────────────────────

  const deleteTask = useCallback(async (uiId: string): Promise<void> => {
    const task = tasks.find(t => t.id === uiId);
    const remoteIds = uniqueNumbers([
      ...(task ? taskRemoteIds(task) : []),
      ...((uiId.startsWith('r-') ? [Number(uiId.slice(2))] : [])),
    ]);
    const previousTasks = tasks;
    const previousGallery = gallery;
    const previousDeletedTaskRecords = { ...deletedTaskRecordsRef.current };
    if (remoteIds.length > 0) {
      const now = Date.now();
      const nextDeletedTaskRecords = { ...deletedTaskRecordsRef.current };
      for (const remoteId of remoteIds) nextDeletedTaskRecords[String(remoteId)] = now;
      deletedTaskRecordsRef.current = nextDeletedTaskRecords;
      writeDeletedTaskRecords(nextDeletedTaskRecords);
    }
    setTasks(prev => prev.filter(t => t.id !== uiId));
    if (remoteIds.length > 0) {
      setGallery(prev => prev.filter(item => !item.taskId || !remoteIds.includes(item.taskId)));
    }
    try {
      await Promise.all(remoteIds.map(remoteId => deleteGenerationTaskIfPresent(remoteId)));
    } catch (err) {
      deletedTaskRecordsRef.current = previousDeletedTaskRecords;
      writeDeletedTaskRecords(previousDeletedTaskRecords);
      setTasks(previousTasks);
      setGallery(previousGallery);
      const msg = errorMessageFromUnknown(err, t('playground.studio_error_delete_failed'));
      setTasks(prev => prev.map(t => t.id === uiId ? { ...t, status: 'failed', error: msg } : t));
      throw err;
    }
  }, [gallery, t, tasks]);

  const deleteGalleryItem = useCallback(async (id: string): Promise<void> => {
    const item = gallery.find(g => g.id === id);
    if (!item) return;
    // 项目视图条目：删 studio_assets 记录（不动底层 host task / 资产对象，可能被「全部」视图共享）。
    if (item.assetId && activeProjectIdRef.current >= 1) {
      const projectId = activeProjectIdRef.current;
      const previousGallery = gallery;
      setGallery(prev => prev.filter(g => g.id !== id));
      try {
        await api.deleteProjectAsset(projectId, item.assetId);
      } catch (err) {
        setGallery(previousGallery);
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
    const previousGallery = gallery;
    setGallery(prev => (item.taskId
      ? prev.filter(g => g.taskId !== item.taskId)
      : prev.filter(g => g.id !== id)));
    if (item.taskId) {
      try {
        await deleteGenerationTaskIfPresent(item.taskId);
      } catch (err) {
        setGallery(previousGallery);
        throw err;
      }
    }
  }, [deleteTask, gallery, tasks]);

  const useAsReference = useCallback((item: GalleryItem) => {
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
    setSelectedModelId(item.model);
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
  }, [generate, generateVideo, setVideoModelId, setSelectedModelId, setImageMode, setImageSize]);

  // variations —— 「变体」：同 prompt 出 4 张（gpt-image-2 无固定 seed，自然各异），复用批量路径。
  const variations = useCallback((item: GalleryItem) => {
    if (item.mediaType === 'video' || item.mode === 'video') {
      regenerate(item);
      return;
    }
    const mode = item.mode === 'batch' ? 'text2img' : item.mode;
    const sourceImage = item.sourceUrl ?? (mode === 'img2img' || mode === 'inpaint' ? item.url : undefined);
    setSelectedModelId(item.model);
    setImageMode(mode);
    if (item.size) setImageSize(item.size);
    setReferenceImages(sourceImage ? [sourceImage] : []);
    setTimeout(() => {
      generate(item.prompt, { mode: 'batch', count: 4, sourceImages: sourceImage ? [sourceImage] : undefined });
    }, 0);
  }, [generate, regenerate, setSelectedModelId, setImageMode, setImageSize]);

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
    const sources = task.batchSources ?? [];
    const operation: 'generate' | 'edit' = sources.length > 0 ? 'edit' : 'generate';

    const patchSubtask = (subId: string, patch: Partial<BatchSubtask>) => {
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
            parameters: size ? { size } : undefined,
            inputs: sources.length > 0
              ? sources.map(url => ({ type: 'image' as const, role: 'source' as const, url }))
              : undefined,
          });
          patchSubtask(sub.id, { remoteTaskId: created.id });
          const completed = await waitForGenerationTask(created, signal, POLL_MAX_ATTEMPTS, undefined, pollErrorMessages);
          const items = galleryItemsFromCompletedTask(completed, {
            prompt: sub.prompt,
            model,
            mode: 'batch' as ImageMode,
          }).map(item => ({
            ...item,
            sourceUrl: sources[0],
          }));
          if (items.length === 0) {
            throw new Error(t('playground.studio_error_no_result_image'));
          }
          setGallery(prev => [...items, ...prev]);
          void persistActiveProjectAssets(items);
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
  }, [persistActiveProjectAssets, pollErrorMessages, selectedModelId, selectedPlatform, t, tasks]);

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
    selectedModelId,
    setSelectedModelId,
    selectedPlatform,
    imageSize,
    setImageSize,
    imageGroups,
    availableImagePlatforms,
    hasImageGroupsForModel,
    imageGroupsLoaded,
    selectedGroupId,
    setSelectedGroupId,
    referenceImages,
    setReferenceImages,
    isGenerating,
    tasks,
    generate,
    cancelGeneration,
    gallery,
    hasMore,
    loadingMore,
    loadMore,
    generatedAssetRetentionDays,
    previewItem,
    setPreviewItem,
    deleteGalleryItem,
    deleteTask,
    retryBatchFailures,
    useAsReference,
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
