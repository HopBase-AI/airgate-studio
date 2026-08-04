import { describe, expect, it } from 'vitest';
import type { GenerationTask } from '../api';
import type { GalleryItem } from './types';
import {
  filterDeletedGalleryItems,
  isExpectedGalleryView,
  isGalleryTargetVisible,
  mergeGalleryItems,
  remoteTaskProjectID,
} from './StudioContext';

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
