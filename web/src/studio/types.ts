export type MediaType = 'image' | 'video' | 'music';

export type ImageMode = 'text2img' | 'img2img' | 'inpaint' | 'batch';

export interface GalleryItem {
  id: string;
  taskId?: number; // core task ID for API operations
  assetId?: number; // studio_assets row id (when loaded from a project)
  url: string;
  alt: string;
  prompt: string;
  model: string;
  mode: ImageMode;
  size?: string;
  createdAt: string;
  sourceUrl?: string; // for img2img/inpaint, the reference image
}

// BatchSubtask —— 批量生成里的单个子任务状态。批量任务把 N 张图聚成一个
// StudioGenerationTask，内部用 subtasks 跟踪每张的进度，失败的子任务保留下来
// 以支持「全部重试」。
export interface BatchSubtask {
  id: string;
  status: 'processing' | 'completed' | 'failed';
  prompt: string;
  remoteTaskId?: number;
  error?: string;
}

export interface StudioGenerationTask {
  id: string;
  prompt: string;
  mode: ImageMode;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  progress?: number;
  result?: GalleryItem[];
  remoteTaskIds?: number[];
  error?: string;
  createdAt: string;
  platform?: string;
  model?: string;
  size?: string;
  // 批量专用：子任务状态 + 重试所需的执行上下文（不依赖当前 UI state，
  // 避免用户切换项目/模型后重试时上下文错乱）。
  subtasks?: BatchSubtask[];
  batchSources?: string[];
}
