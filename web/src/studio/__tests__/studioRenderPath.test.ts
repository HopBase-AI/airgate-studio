// 创作工作台渲染与轮询路径的行为回归。
//
// 覆盖两件「用户能感觉到、但类型系统看不见」的性质：
//   1. 生成任务每 2s 回写一次进度，不应把整棵 useStudio 消费者树（画廊里的每张
//      卡片）一起重渲染——卡片自身的 Date.parse、srcSet 构造、过期计算都不便宜；
//   2. 5s 兜底刷新的 interval 不能被 tasks 变化反复拆建，否则它永远等不到触发。
//
// 两个用例都用假定时器真正把时间推过去，并各带一条自检断言确认被测路径确实跑到，
// 避免在「什么都没发生」上空转通过。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { GenerationTask } from '../../api';
import type { StudioContextValue } from '../StudioContext';

// api 模块整体替身：StudioContext 只经 api.* 触达后端，替身比 stub fetch 更可控。
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
      listGenerationTasks,
      getGenerationTask,
      createGenerationTask,
      listProjects,
      listProjectAssets,
      addProjectAsset,
      listImageGroups,
      getPublicSettings,
      getBudget,
      deleteGenerationTask: vi.fn(),
      createProject: vi.fn(),
      deleteProject: vi.fn(),
      renameProject: vi.fn(),
      deleteProjectAsset: vi.fn(),
    },
  };
});

const REMOTE_TASK_ID = 1001;
const GROUP_ID = 7;

function remoteTask(status: string, progress: number): GenerationTask {
  return {
    id: REMOTE_TASK_ID,
    task_id: REMOTE_TASK_ID,
    status,
    progress,
    prompt: '一只在屋顶上的猫',
    created_at: '2026-09-08T00:00:00Z',
    platform: 'openai',
    model: 'gpt-image-2',
    kind: 'image',
  };
}

// vi.spyOn 的返回类型不便直接书写，用工厂函数反推
function spyOnSetInterval() {
  return vi.spyOn(window, 'setInterval');
}

interface Probe {
  studioRenders: number;
  api: StudioContextValue | null;
}

async function mountProvider(probe: Probe): Promise<{ root: Root; container: HTMLDivElement }> {
  const { StudioProvider, useStudio } = await import('../StudioContext');

  function Consumer() {
    // 画廊卡片正是这样订阅 context 的（GalleryCard 内部就调用 useStudio）
    probe.api = useStudio();
    probe.studioRenders += 1;
    return null;
  }
  function Tree() {
    return createElement(StudioProvider, null, createElement(Consumer));
  }

  const container = document.createElement('div');
  document.body.appendChild(container);
  let root!: Root;
  await act(async () => {
    root = createRoot(container);
    root.render(createElement(Tree));
  });
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  return { root, container };
}

describe('创作工作台渲染与轮询路径', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  let probe: Probe;
  let setIntervalSpy: ReturnType<typeof spyOnSetInterval>;

  beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    window.localStorage.clear();
    probe = { studioRenders: 0, api: null };

    // 轮询用 setTimeout 排期，真实时钟下测试里根本不会触发；必须用假定时器
    // 真正把时间推过去，否则断言会在「什么都没发生」上空转通过。
    vi.useFakeTimers();

    listGenerationTasks.mockResolvedValue({ tasks: [], total: 0 });
    getGenerationTask.mockResolvedValue(remoteTask('processing', 10));
    createGenerationTask.mockResolvedValue(remoteTask('processing', 0));
    listProjects.mockRejectedValue(new Error('projects disabled'));
    listProjectAssets.mockResolvedValue({ assets: [], total: 0 });
    addProjectAsset.mockResolvedValue({});
    listImageGroups.mockResolvedValue([
      { id: GROUP_ID, name: '标准组', platform: 'openai', rate_multiplier: 1, effective_rate: 1 },
    ]);
    getPublicSettings.mockResolvedValue({});
    getBudget.mockResolvedValue({
      balance: 100, reserved: 0, available: 100, currency: 'USD', limited: false,
      estimate: 0, sufficient: true, message: '',
    });

    setIntervalSpy = spyOnSetInterval();
  });

  afterEach(async () => {
    if (root) await act(async () => root!.unmount());
    container?.remove();
    root = null;
    container = null;
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  // 只统计兜底刷新那条 5s 定时器，忽略轮询等其它计时器
  function fallbackIntervalCount(): number {
    return setIntervalSpy.mock.calls.filter(call => call[1] === 5000).length;
  }

  async function advanceOnePoll(): Promise<void> {
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  }

  // 发起一次真实生成：走 generate() → createGenerationTask → 轮询 onPoll 回写进度，
  // 这正是用户看着进度条时每 2s 发生的事。
  async function startGeneration(): Promise<void> {
    expect(probe.api, 'Provider 未就绪').toBeTruthy();
    await act(async () => {
      void probe.api!.generate('一只在屋顶上的猫');
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(
      createGenerationTask.mock.calls.length,
      '生成未真正发起（多半是分组/模型前置条件没满足）',
    ).toBeGreaterThan(0);
  }

  it('进度回写不重建 5s 兜底刷新定时器', async () => {
    const mounted = await mountProvider(probe);
    root = mounted.root;
    container = mounted.container;
    await startGeneration();

    const created = fallbackIntervalCount();
    expect(created, '挂载后应建立兜底刷新定时器').toBeGreaterThan(0);

    const pollsBefore = getGenerationTask.mock.calls.length;
    for (let i = 1; i <= 5; i += 1) {
      getGenerationTask.mockResolvedValue(remoteTask('processing', 10 + i * 10));
      await advanceOnePoll();
    }
    expect(
      getGenerationTask.mock.calls.length - pollsBefore,
      '轮询未真正推进，断言无意义',
    ).toBeGreaterThanOrEqual(3);

    expect(
      fallbackIntervalCount(),
      'tasks 变化不应重建兜底刷新定时器——反复重建会让它永远等不到 5s 触发',
    ).toBe(created);
  });

  it('兜底刷新不与主轮询重复请求同一任务', async () => {
    const mounted = await mountProvider(probe);
    root = mounted.root;
    container = mounted.container;
    await startGeneration();

    // 观测窗口 20s：主轮询按退避节奏 800/1120/1568/2195/3073/4000… 约 8 次；
    // 兜底刷新每 5s 一次（4 次）。若两者不去重，总数会明显高出主轮询单独的次数。
    const before = getGenerationTask.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    const total = getGenerationTask.mock.calls.length - before;

    // 自检：确实发生了轮询
    expect(total, '窗口内没有任何轮询请求，断言无意义').toBeGreaterThan(3);

    // 20s 内主轮询自身的理论次数（动态导入：静态 import 会在 vi.mock 的
    // 替身常量初始化前加载模块，触发 TDZ）
    const { pollDelayMs } = await import('../StudioContext');
    let slept = 0;
    let mainPolls = 0;
    for (let attempt = 0; slept < 20_000; attempt += 1) {
      slept += pollDelayMs(attempt);
      mainPolls += 1;
    }
    expect(
      total,
      `20s 内发出 ${total} 次请求，主轮询自身仅需 ${mainPolls} 次——兜底刷新在重复查同一任务`,
    ).toBeLessThanOrEqual(mainPolls + 1);
  });

  it('进度回写不连带重渲染 useStudio 消费者（画廊卡片）', async () => {
    const mounted = await mountProvider(probe);
    root = mounted.root;
    container = mounted.container;
    await startGeneration();

    const before = probe.studioRenders;
    const pollsBefore = getGenerationTask.mock.calls.length;
    const ticks = 8;
    for (let i = 1; i <= ticks; i += 1) {
      getGenerationTask.mockResolvedValue(remoteTask('processing', 10 + i * 5));
      await advanceOnePoll();
    }
    expect(
      getGenerationTask.mock.calls.length - pollsBefore,
      '轮询未真正推进，断言无意义',
    ).toBeGreaterThanOrEqual(ticks - 2);

    const delta = probe.studioRenders - before;
    // 拆分前：tasks 在主 context 里，每次进度回写都会重渲染全部卡片。
    // 拆分后：卡片不订阅 tasks，进度推进与它们无关。
    expect(delta, `画廊消费者在 ${ticks} 次进度回写中重渲染了 ${delta} 次`).toBeLessThanOrEqual(2);
  });
});
