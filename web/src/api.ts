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

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const url = `${baseURL()}${path}`;
  const headers: Record<string, string> = {};
  const token = getStoredToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const options: RequestInit = {
    method,
    headers,
  };
  if (body !== undefined) {
    options.body = JSON.stringify(body);
  }
  const resp = await fetch(url, options);
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: { message: resp.statusText } }));
    throw new Error(err?.error?.message || `HTTP ${resp.status}`);
  }
  return resp.json();
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
  status: string;
  progress: number;
  prompt: string;
  model?: string;
  operation?: string;
  size?: string;
  quality?: string;
  input_images?: string[];
  input_mask?: string;
  result_content?: string;
  error_message?: string;
  created_at: string;
  updated_at?: string;
  completed_at?: string;
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
  model: string;
  mode: string;
  size: string;
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
    parameters?: Record<string, unknown>;
    inputs?: Array<{ type: string; role: string; url: string }>;
    mask?: { type: string; role: string; url: string };
  }): Promise<GenerationTask> {
    return request('POST', '/generation-tasks', params);
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
    model?: string;
    mode?: string;
    size?: string;
  }): Promise<ProjectAsset> {
    return request('POST', `/projects/${projectId}/assets`, asset);
  },

  deleteProjectAsset(projectId: number, assetId: number): Promise<void> {
    return request('DELETE', `/projects/${projectId}/assets/${assetId}`);
  },
};
