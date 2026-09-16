import { describe, expect, it } from 'vitest';
import type { GenerationTask } from '../api';
import type { GalleryItem } from './types';
import {
  canonicalVideoRoute,
  filterDeletedGalleryItems,
  imageEditSources,
  isExpectedGalleryView,
  isGalleryTargetVisible,
  mergeGalleryItems,
  remoteTaskProjectID,
  remoteTaskReferences,
} from './StudioContext';
import { LEGACY_SEEDANCE25_MODEL_ID, VIDEO_MODEL_IDS } from './video/videoConfig';

function galleryItem(id: string, url = `https://example.test/${id}.png`): GalleryItem {
  return {
    id,
    url,
    alt: id,
    prompt: id,
    model: 'test-model',
    mode: 'text2img',
    createdAt: '2026-08-04T00:00:00Z',
  };
}

describe('mergeGalleryItems', () => {
  it('prepends fresh results and keeps the incoming copy of a duplicate', () => {
    const current = [galleryItem('r-1-0', 'old'), galleryItem('r-2-0')];
    const incoming = [galleryItem('r-1-0', 'fresh'), galleryItem('r-3-0')];

    expect(mergeGalleryItems(current, incoming, 'prepend')).toEqual([
      galleryItem('r-1-0', 'fresh'),
      galleryItem('r-3-0'),
      galleryItem('r-2-0'),
    ]);
  });

  it('appends a page without replacing items that are already rendered', () => {
    const current = [galleryItem('r-1-0', 'current')];
    const incoming = [galleryItem('r-1-0', 'duplicate'), galleryItem('r-2-0')];

    expect(mergeGalleryItems(current, incoming, 'append')).toEqual([
      galleryItem('r-1-0', 'current'),
      galleryItem('r-2-0'),
    ]);
  });

  it('preserves a result completed while an older first-page request was in flight', () => {
    const justCompleted = galleryItem('r-9-0');
    const staleFirstPage = [galleryItem('r-1-0'), galleryItem('r-2-0')];

    expect(mergeGalleryItems([justCompleted], staleFirstPage, 'append')).toEqual([
      justCompleted,
      ...staleFirstPage,
    ]);
  });

  it('deduplicates the raw and persisted IDs for the same task output', () => {
    const raw = { ...galleryItem('r-42-0'), taskId: 42 };
    const persisted = { ...galleryItem('a-7', raw.url), taskId: 42, assetId: 7 };

    expect(mergeGalleryItems([raw], [persisted], 'append')).toEqual([{ ...raw, assetId: 7 }]);
    expect(mergeGalleryItems([persisted], [raw], 'prepend')).toEqual([{ ...raw, assetId: 7 }]);
  });
});

describe('gallery deletion tombstones', () => {
  it('filters late task and asset responses after the user deleted them', () => {
    const active = galleryItem('active');
    const deletedTask = { ...galleryItem('r-42-0'), taskId: 42 };
    const deletedAsset = { ...galleryItem('a-7'), assetId: 7 };

    expect(filterDeletedGalleryItems(
      [deletedTask, deletedAsset, active],
      { '42': Date.now() },
      new Set([7]),
    )).toEqual([active]);
  });
});

describe('gallery project guards', () => {
  it('shows a completed result only in its target project or the aggregate view', () => {
    expect(isGalleryTargetVisible(12, 12)).toBe(true);
    expect(isGalleryTargetVisible(12, 0)).toBe(true);
    expect(isGalleryTargetVisible(12, 24)).toBe(false);
    expect(isGalleryTargetVisible(0, 24)).toBe(false);
  });

  it('rejects stale pagination and rollback responses after a project switch', () => {
    expect(isExpectedGalleryView(4, 12, 4, 12)).toBe(true);
    expect(isExpectedGalleryView(4, 12, 5, 12)).toBe(false);
    expect(isExpectedGalleryView(4, 12, 4, 24)).toBe(false);
  });

  it('restores a valid project id from a remote task and defaults older tasks to all works', () => {
    expect(remoteTaskProjectID({ project_id: 12 } as GenerationTask)).toBe(12);
    expect(remoteTaskProjectID({} as GenerationTask)).toBe(0);
    expect(remoteTaskProjectID({ project_id: -1 } as GenerationTask)).toBe(0);
    expect(remoteTaskProjectID({ project_id: 1.5 } as GenerationTask)).toBe(0);
  });
});

describe('historical video route compatibility', () => {
  it('normalizes the retired SD2.5 route to the official model ID', () => {
    expect(canonicalVideoRoute({
      routeKey: `seedance:${LEGACY_SEEDANCE25_MODEL_ID}`,
      platform: 'seedance',
      model: LEGACY_SEEDANCE25_MODEL_ID,
      groupId: 42,
      size: '720p',
    })).toEqual({
      routeKey: `seedance:${VIDEO_MODEL_IDS.seedance25}`,
      platform: 'seedance',
      model: VIDEO_MODEL_IDS.seedance25,
      groupId: 42,
      size: '720p',
    });
  });
});

// 2026-09-16 生产 #58490：失败卡「重试」只带 mode: 'img2img' 不带图，参考图又是作图框本地
// 上传（不在 context 的 referenceImages 里），结果 operation=edit 却没 images。这里钉死
// 参考图的取源顺序与「edit / inpaint 没图 = 空数组」（generate 据此在提交前拦下）。
describe('imageEditSources', () => {
  const gallery = ['https://example.test/gallery.png'];

  it('returns nothing for modes that do not take a reference image', () => {
    expect(imageEditSources('text2img', gallery, { sourceImage: 'data:image/png;base64,x' })).toEqual([]);
    expect(imageEditSources('batch', gallery, { sourceImages: gallery })).toEqual([]);
  });

  it('prefers caller-passed sources over the single source and the gallery references', () => {
    const passed = ['/assets-runtime/task-input/1/a.png', '/assets-runtime/task-input/1/b.png'];
    expect(imageEditSources('img2img', gallery, { sourceImages: passed, sourceImage: 'ignored' })).toEqual(passed);
    expect(imageEditSources('inpaint', gallery, { sourceImage: 'data:image/png;base64,y' })).toEqual(['data:image/png;base64,y']);
    expect(imageEditSources('img2img', gallery)).toEqual(gallery);
  });

  it('is empty when a retry carries only the mode and no reference is left anywhere', () => {
    expect(imageEditSources('img2img', [], { sourceImages: [] })).toEqual([]);
    expect(imageEditSources('inpaint', [], undefined)).toEqual([]);
  });
});

// 刷新后失败卡是从服务端恢复的，重试要带的参考素材只剩服务端的 input_*；没有的键必须不出现，
// 否则恢复结果 spread 到同源本地任务时会把本地记的参考图抹成 undefined。
describe('remoteTaskReferences', () => {
  it('carries the server-side reference media back onto the recovered task', () => {
    expect(remoteTaskReferences({
      input_images: ['/assets-runtime/task-input/7035/a.png'],
      input_videos: ['/assets-runtime/task-input/7035/b.mp4'],
      input_audios: ['/assets-runtime/task-input/7035/c.mp3'],
    } as GenerationTask)).toEqual({
      referenceImages: ['/assets-runtime/task-input/7035/a.png'],
      referenceVideos: ['/assets-runtime/task-input/7035/b.mp4'],
      referenceAudios: ['/assets-runtime/task-input/7035/c.mp3'],
    });
  });

  it('omits every key the server did not record instead of spreading undefined', () => {
    expect(remoteTaskReferences({ input_images: [] as string[] } as GenerationTask)).toEqual({});
    expect(Object.keys(remoteTaskReferences({} as GenerationTask))).toEqual([]);
  });
});
