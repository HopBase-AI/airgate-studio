// 画廊卡片在任务进度推进时不应重渲染。
//
// GalleryView 必须订阅 tasks（进度条要用），所以生成期间它每 2s 就重渲染一次。
// 卡片若不 memo，就会跟着整列重算：每张卡渲染时都要 Date.parse(createdAt)
// （formatCreatedAt + getExpiryNotice 各一次）、构造 srcSet、算过期状态——
// 画廊几十上百张时直接表现为列表卡顿。
//
// 探针：统计 Date.parse 调用次数。卡片被重渲染就会重复调用，次数随 tick 线性增长。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { GenerationTask } from '../../api';
import type { StudioContextValue } from '../StudioContext';

const listGenerationTasks = vi.fn();
const getGenerationTask = vi.fn();
const createGenerationTask = vi.fn();
const listProjects = vi.fn();
const listProjectAssets = vi.fn();
const addProjectAsset = vi.fn();
const listImageGroups = vi.fn();
const getPublicSettings = vi.fn();
const getBudget = vi.fn();

vi.mock('../../api', async () => {
  const actual = await vi.importActual<typeof import('../../api')>('../../api');
  return {
    ...actual,
    api: {
      listGenerationTasks, getGenerationTask, createGenerationTask,
      listProjects, listProjectAssets, addProjectAsset, listImageGroups,
      getPublicSettings, getBudget,
      deleteGenerationTask: vi.fn(), createProject: vi.fn(),
      deleteProject: vi.fn(), renameProject: vi.fn(), deleteProjectAsset: vi.fn(),
    },
  };
});

const DONE_TASK_ID = 900;
const LIVE_TASK_ID = 1001;

// 已完成任务 → 画廊里的一张卡
function completedTask(id: number): GenerationTask {
  return {
    id, task_id: id, status: 'completed', progress: 100,
    prompt: '完成的作品', created_at: '2026-09-08T00:00:00Z',
    platform: 'openai', model: 'gpt-image-2', kind: 'image',
    result_content: '![img](https://example.test/a.png)',
  };
}

// 进行中任务 → 让轮询持续 tick
function liveTask(progress: number): GenerationTask {
  return {
    id: LIVE_TASK_ID, task_id: LIVE_TASK_ID, status: 'processing', progress,
    prompt: '进行中', created_at: '2026-09-08T00:00:00Z',
    platform: 'openai', model: 'gpt-image-2', kind: 'image',
  };
}

describe('画廊卡片重渲染', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    window.localStorage.clear();
    vi.useFakeTimers();
    // happy-dom 提供的 IntersectionObserver 永不触发回调，卡片会停在懒渲染占位态。
    // 置为 undefined 走组件里「无观察器则直接渲染」的分支，让真实卡片挂出来。
    vi.stubGlobal('IntersectionObserver', undefined);

    listGenerationTasks.mockImplementation((params?: { status?: string }) => Promise.resolve(
      params?.status === 'completed'
        ? { tasks: [completedTask(DONE_TASK_ID)], total: 1 }
        : { tasks: [liveTask(10)], total: 1 },
    ));
    getGenerationTask.mockResolvedValue(liveTask(10));
    createGenerationTask.mockResolvedValue(liveTask(0));
    listProjects.mockRejectedValue(new Error('projects disabled'));
    listProjectAssets.mockResolvedValue({ assets: [], total: 0 });
    addProjectAsset.mockResolvedValue({});
    listImageGroups.mockResolvedValue([
      { id: 7, name: '标准组', platform: 'openai', rate_multiplier: 1, effective_rate: 1 },
    ]);
    getPublicSettings.mockResolvedValue({});
    getBudget.mockResolvedValue({
      balance: 100, reserved: 0, available: 100, currency: 'USD', limited: false,
      estimate: 0, sufficient: true, message: '',
    });
  });

  afterEach(async () => {
    if (root) await act(async () => root!.unmount());
    container?.remove();
    root = null;
    container = null;
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('任务进度推进时，已完成作品的卡片不重复做每卡计算', async () => {
    const { StudioProvider, useStudio } = await import('../StudioContext');
    const { GalleryView } = await import('../GalleryView');

    // 侧挂一个探针拿到 context API：恢复路径的轮询不回写进度（onPoll 为 undefined），
    // 必须走 generate() 才会每 2s 更新 tasks——那才是用户盯着进度条时的真实路径。
    let apiRef: StudioContextValue | null = null;
    function ApiProbe() {
      apiRef = useStudio();
      return null;
    }

    container = document.createElement('div');
    document.body.appendChild(container);
    await act(async () => {
      root = createRoot(container!);
      root.render(createElement(StudioProvider, null,
        createElement(ApiProbe), createElement(GalleryView)));
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    expect(apiRef, 'Provider 未就绪').toBeTruthy();
    await act(async () => {
      void apiRef!.generate('一只在屋顶上的猫');
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(
      createGenerationTask.mock.calls.length,
      '生成未真正发起，tasks 不会每 2s 变化，探针无效',
    ).toBeGreaterThan(0);

    // 自检：画廊里确实渲染出了卡片，否则本用例毫无意义
    expect(
      container.querySelectorAll('img, video').length,
      '画廊未渲染出任何作品卡，探针无效',
    ).toBeGreaterThan(0);

    const dateParseSpy = vi.spyOn(Date, 'parse');
    const pollsBefore = getGenerationTask.mock.calls.length;
    const ticks = 6;
    for (let i = 1; i <= ticks; i += 1) {
      getGenerationTask.mockResolvedValue(liveTask(10 + i * 10));
      await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    }
    expect(
      getGenerationTask.mock.calls.length - pollsBefore,
      '轮询未真正推进，断言无意义',
    ).toBeGreaterThanOrEqual(3);

    // 卡片被 memo 挡住时，每卡计算不随 tick 增长
    expect(
      dateParseSpy.mock.calls.length,
      `${ticks} 次进度推进中卡片重算了 ${dateParseSpy.mock.calls.length} 次 Date.parse`,
    ).toBeLessThanOrEqual(2);
  });
});
