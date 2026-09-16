const PLUGIN_ID = 'airgate-studio';

function baseURL(): string {
  return `/api/v1/ext-user/${PLUGIN_ID}`;
}

function getStoredToken(): string {
  if (typeof window === 'undefined') return '';
  try {
    return window.localStorage.getItem('token') || '';
  } catch {
    return '';
  }
}

interface ApiEnvelope<T> {
  code: number;
  data?: T;
  message?: string;
}

export class ApiRequestError extends Error {
  status: number;

  // 服务端错误码（如余额预检的 insufficient_balance）；展示层据此给可执行提示。
  code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
  }
}

async function request<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const url = `${baseURL()}${path}`;
  const headers: Record<string, string> = {};
  const token = getStoredToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const options: RequestInit = {
    method,
    headers,
    signal,
  };
  if (body !== undefined) {
    options.body = JSON.stringify(body);
  }
  const resp = await fetch(url, options);
  if (!resp.ok) {
    const err = (await resp.json().catch(() => ({ error: { message: resp.statusText } }))) as {
      error?: string | { message?: string };
      message?: string;
      code?: string;
    };
    const detail = typeof err?.error === 'string'
      ? err.error
      : err?.error?.message || err?.message;
    throw new ApiRequestError(resp.status, detail || `HTTP ${resp.status}`, err?.code);
  }
  return resp.json() as Promise<T>;
}

async function requestCore<T>(path: string): Promise<T> {
  const resp = await fetch(path, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  });
  const json = await resp.json().catch(() => null) as ApiEnvelope<T> | null;
  if (!resp.ok || !json || json.code !== 0) {
    throw new Error(json?.message || `HTTP ${resp.status}`);
  }
  return (json.data ?? ({} as T));
}

export interface GenerationTask {
  id: number;
  task_id: number;
  // Studio project captured when the task was created. Missing/0 means the
  // aggregate "all works" view and keeps older tasks backward-compatible.
  project_id?: number;
  status: string;
  progress: number;
  prompt: string;
  platform?: string;
  model?: string;
  group_id?: number;
  route_key?: string;
  operation?: string;
  // kind/duration 来自任务创建入参(image|video / 视频秒数),恢复链路用来
  // 还原媒体语义与 ETA 分桶;老后端不回传时缺省。
  kind?: string;
  duration?: number;
  size?: string;
  quality?: string;
  input_images?: string[];
  // 视频模式的参考视频 / 音频（已上传的资产地址），重新生成时回放。
  input_videos?: string[];
  input_audios?: string[];
  input_mask?: string;
  result_content?: string;
  video_urls?: string[];
  last_frame_url?: string;
  // 官方上游直链(seedance 视频,与中继地址同为 24h 有效),用于「官方源链接」溯源。
  source_outputs?: string[];
  error_message?: string;
  // 执行器写入的失败分类（如 content_policy / output_audio_copyright），只在失败终态下发；
  // 展示层据此给可执行提示（见 studio/video/failureHints.ts）。
  error_type?: string;
  error_code?: string;
  created_at: string;
  updated_at?: string;
  completed_at?: string;
}

export interface ReferenceUpload {
  kind: 'video' | 'audio';
  url: string;
  object_key?: string;
  content_type: string;
  size_bytes: number;
}

export interface PlatformInfo {
  name: string;
  display_name: string;
}

export interface ModelInfo {
  id: string;
  name: string;
  platform?: string;
  image_only?: boolean;
  capabilities?: string[];
}

export interface UserInfo {
  user_id: number;
  username: string;
  role: string;
}

export interface ImageGroup {
  id: number;
  name: string;
  platform: string;
  rate_multiplier: number;
  effective_rate: number;
  note?: string;
  fixed_image_prices?: {
    '1k'?: number;
    '2k'?: number;
    '4k'?: number;
    currency?: string;
  };
  // 通道（数据契约 plugin_settings.studio.channel）：standard / official /
  // domestic / overseas；插件后端从 groups.list 项透传，缺省按 standard。
  channel?: string;
  // 该模型在本分组近 30 天使用人数（热度排序）；core 未统计时缺省，
  // 前端按注册表顺序兜底。
  users_30d?: number;
}

// BudgetInfo studio /budget 的应答：core billing.budget 载荷原样透传，
// 外加执行插件给出的官方成本预估（estimated_official_cost，倍率前）。
// available = min(余额, 受限时的剩余额度) − 在途预留；estimate 是按分组倍率折算后的用户侧预估。
export interface BudgetInfo {
  balance: number;
  reserved: number;
  available: number;
  currency: string;
  limited: boolean;
  quota_remaining: number;
  estimate: number;
  sufficient: boolean;
  message: string;
  estimated_official_cost?: number;
}

export interface Project {
  id: number;
  user_id: number;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface ProjectAsset {
  id: number;
  user_id: number;
  project_id: number;
  task_id: number;
  url: string;
  prompt: string;
  platform?: string;
  model: string;
  group_id?: number;
  route_key?: string;
  mode: string;
  size: string;
  // 视频官方上游直链(24h 有效);老记录/图片为空串。
  source_video_url?: string;
  // 介质：语音合成为 audio；存量图片 / 视频记录缺省，按 mode 推断。
  kind?: string;
  // 语音资产专属：音色、上游回报的计费字符数、时长（毫秒）。
  voice_id?: string;
  usage_characters?: number;
  audio_length_ms?: number;
  created_at: string;
}

// SpeechResult POST /speech 的应答：音频已由后端落成持久资产（url），并在项目里记了
// 一条 kind=audio 的记录（asset；项目存储未配置时缺省）。计费字符数以上游回报为准。
export interface SpeechResult {
  asset?: ProjectAsset;
  project_id: number;
  url: string;
  content_type: string;
  format: string;
  platform: string;
  model: string;
  group_id: number;
  route_key: string;
  voice_id: string;
  speed: number;
  emotion?: string;
  language_boost?: string;
  text: string;
  text_chars: number;
  usage_characters: number;
  audio_length_ms: number;
  audio_size_bytes: number;
  usage_id?: number;
  created_at: string;
}

export interface InspirationSource {
  name: string;
  url?: string;
  note?: string;
}

export interface InspirationItem {
  id: string;
  category: string;
  scenario?: string;
  title: string;
  description?: string;
  kind: 'image' | 'prompt' | string;
  image?: string;
  prompt: string;
  tags?: string[];
  source?: string;
}

export interface InspirationCatalog {
  version: string;
  sources?: InspirationSource[];
  items: InspirationItem[];
}

export const api = {
  createGenerationTask(params: {
    kind: string;
    operation: string;
    platform: string;
    model: string;
    prompt: string;
    group_id?: number;
    project_id?: number;
    parameters?: Record<string, unknown>;
    inputs?: Array<{ type: string; role: string; url: string }>;
    mask?: { type: string; role: string; url: string };
  }): Promise<GenerationTask> {
    return request('POST', '/generation-tasks', params);
  },

  // 余额 / 在途预留 / 本条预估。带上 model 与参数域时，后端会先经 gateway.forward
  // 问执行插件估价再判定（浏览器够不着网关插件，这两跳必须在后端做）。
  getBudget(params: {
    platform: string;
    group_id?: number;
    model?: string;
    parameters?: Record<string, unknown>;
    reference_images?: number;
    reference_videos?: number;
    reference_audios?: number;
    // 参考视频合计秒数（读自文件元数据），参考视频按输入时长计费的模型据此估价。
    input_video_seconds?: number;
  }, signal?: AbortSignal): Promise<BudgetInfo> {
    return request<BudgetInfo>('POST', '/budget', params, signal);
  },

  // 参考视频 / 音频先上传成资产，建任务时只带回的地址。用 XHR 是为了拿上传进度。
  uploadReference(
    file: Blob,
    kind: 'video' | 'audio',
    options?: { onProgress?: (fraction: number) => void; signal?: AbortSignal },
  ): Promise<ReferenceUpload> {
    return new Promise((resolve, reject) => {
      if (options?.signal?.aborted) {
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${baseURL()}/reference-uploads?kind=${kind}`);
      const token = getStoredToken();
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
      xhr.upload.onprogress = event => {
        if (event.lengthComputable && event.total > 0) options?.onProgress?.(event.loaded / event.total);
      };
      xhr.onload = () => {
        let body: Partial<ReferenceUpload> & { error?: string | { message?: string }; message?: string; code?: string } = {};
        try {
          body = JSON.parse(xhr.responseText || '{}') as typeof body;
        } catch {
          // 非 JSON（如反代直接回的 413 页面）按状态码报错。
        }
        if (xhr.status >= 200 && xhr.status < 300 && typeof body.url === 'string' && body.url) {
          resolve(body as ReferenceUpload);
          return;
        }
        const detail = typeof body.error === 'string' ? body.error : body.error?.message || body.message;
        reject(new ApiRequestError(xhr.status, detail || `HTTP ${xhr.status}`, body.code));
      };
      xhr.onerror = () => reject(new ApiRequestError(0, 'Network error'));
      xhr.onabort = () => reject(new DOMException('Aborted', 'AbortError'));
      options?.signal?.addEventListener('abort', () => xhr.abort(), { once: true });
      xhr.send(file);
    });
  },

  getGenerationTask(taskId: number): Promise<GenerationTask> {
    return request('GET', `/generation-tasks/${taskId}`);
  },

  listGenerationTasks(params?: { limit?: number; offset?: number; status?: string }): Promise<{ tasks: GenerationTask[]; total: number }> {
    const qs = new URLSearchParams();
    if (params?.limit) qs.set('limit', String(params.limit));
    if (params?.offset) qs.set('offset', String(params.offset));
    if (params?.status) qs.set('status', params.status);
    const suffix = qs.toString() ? `?${qs}` : '';
    return request<{ tasks: GenerationTask[]; total: number }>('GET', `/generation-tasks${suffix}`)
      .then(r => ({ tasks: r.tasks || [], total: r.total || 0 }));
  },

  deleteGenerationTask(taskId: number): Promise<void> {
    return request('DELETE', `/generation-tasks/${taskId}`);
  },

  listPlatforms(): Promise<PlatformInfo[]> {
    return request<{ platforms: PlatformInfo[] }>('GET', '/platforms').then(r => r.platforms || []);
  },

  listModels(platform?: string, capability?: string): Promise<ModelInfo[]> {
    const qs = new URLSearchParams();
    if (platform) qs.set('platform', platform);
    if (capability) qs.set('capability', capability);
    const suffix = qs.toString() ? `?${qs}` : '';
    return request<{ models: ModelInfo[] }>('GET', `/models${suffix}`).then(r => r.models || []);
  },

  // 语音合成：同步等音频（文本越长越久，上游建议 3,000 字以上走流式，工作坊 v1 只做同步）。
  synthesizeSpeech(params: {
    text: string;
    model: string;
    voice_id?: string;
    speed?: number;
    emotion?: string;
    format?: string;
    language_boost?: string;
    group_id: number;
    project_id?: number;
  }, signal?: AbortSignal): Promise<SpeechResult> {
    return request<SpeechResult>('POST', '/speech', params, signal);
  },

  // 跨项目分页列语音资产（「全部作品」视图合并用：语音没有 host task 可回放）。
  listSpeechAssets(params?: { limit?: number; offset?: number }): Promise<{ assets: ProjectAsset[]; total: number }> {
    const qs = new URLSearchParams();
    if (params?.limit) qs.set('limit', String(params.limit));
    if (params?.offset) qs.set('offset', String(params.offset));
    const suffix = qs.toString() ? `?${qs}` : '';
    return request<{ assets: ProjectAsset[]; total: number }>('GET', `/speech${suffix}`)
      .then(r => ({ assets: r.assets || [], total: r.total || 0 }));
  },

  // 当前用户在指定平台下可选的生成计费分组（最便宜优先）。
  // media='video' | 'audio' 时不要求图片能力（视频平台分组，如 seedance；语音合成分组）。
  listImageGroups(platform: string, model?: string, media?: 'image' | 'video' | 'audio', signal?: AbortSignal): Promise<ImageGroup[]> {
    const qs = new URLSearchParams({ platform });
    if (model) qs.set('model', model);
    if (media) qs.set('media', media);
    return request<{ groups: ImageGroup[] }>('GET', `/image-groups?${qs}`, undefined, signal).then(r => r.groups || []);
  },

  listInspirations(): Promise<InspirationCatalog> {
    return request<InspirationCatalog>('GET', '/inspirations')
      .then(r => ({ ...r, items: r.items || [] }));
  },

  getPublicSettings(): Promise<Record<string, string>> {
    return requestCore<Record<string, string>>('/api/v1/settings/public');
  },

  // ── Projects ──

  listProjects(): Promise<Project[]> {
    return request<{ projects: Project[] }>('GET', '/projects').then(r => r.projects || []);
  },

  createProject(name?: string): Promise<Project> {
    return request('POST', '/projects', { name: name || '' });
  },

  renameProject(id: number, name: string): Promise<void> {
    return request('PUT', `/projects/${id}`, { name });
  },

  deleteProject(id: number): Promise<void> {
    return request('DELETE', `/projects/${id}`);
  },

  listProjectAssets(projectId: number, params?: { limit?: number; offset?: number }): Promise<{ assets: ProjectAsset[]; total: number }> {
    const qs = new URLSearchParams();
    if (params?.limit) qs.set('limit', String(params.limit));
    if (params?.offset) qs.set('offset', String(params.offset));
    const suffix = qs.toString() ? `?${qs}` : '';
    return request<{ assets: ProjectAsset[]; total: number }>('GET', `/projects/${projectId}/assets${suffix}`)
      .then(r => ({ assets: r.assets || [], total: r.total || 0 }));
  },

  addProjectAsset(projectId: number, asset: {
    task_id?: number;
    url: string;
    prompt?: string;
    platform?: string;
    model?: string;
    group_id?: number;
    route_key?: string;
    mode?: string;
    size?: string;
    source_video_url?: string;
  }): Promise<ProjectAsset> {
    return request('POST', `/projects/${projectId}/assets`, asset);
  },

  deleteProjectAsset(projectId: number, assetId: number): Promise<void> {
    return request('DELETE', `/projects/${projectId}/assets/${assetId}`);
  },
};
