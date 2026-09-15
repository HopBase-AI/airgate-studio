import { describe, expect, it } from 'vitest';

import { selectOptionsSignature, type CustomSelectOption } from './CustomSelect';

const MODELS = ['dreamina-seedance-2-5-260628', 'doubao-seedance-2-5-260628-a', 'MiniMax-H3'];

function buildOptions(ids: string[]): CustomSelectOption[] {
  return ids.map(id => ({ value: id, label: `label ${id}` }));
}

describe('selectOptionsSignature', () => {
  it('stays equal when the caller rebuilds identical options on every render', () => {
    // 工作坊的视频模型下拉每次渲染都 map 出新数组；签名不变，高亮与滚动就不会被拉回选中项。
    const first = buildOptions(MODELS);
    const rebuilt = buildOptions(MODELS);
    expect(rebuilt).not.toBe(first);
    expect(selectOptionsSignature(rebuilt)).toBe(selectOptionsSignature(first));
  });

  it('ignores label changes that keep the same values', () => {
    const relabeled = MODELS.map(id => ({ value: id, label: `other ${id}` }));
    expect(selectOptionsSignature(relabeled)).toBe(selectOptionsSignature(buildOptions(MODELS)));
  });

  it('changes when the visible list content changes (filtering, reordering)', () => {
    const full = selectOptionsSignature(buildOptions(MODELS));
    expect(selectOptionsSignature(buildOptions(MODELS.slice(1)))).not.toBe(full);
    expect(selectOptionsSignature(buildOptions([...MODELS].reverse()))).not.toBe(full);
    expect(selectOptionsSignature([])).not.toBe(full);
  });

  it('does not collide when values contain the joiner-like text', () => {
    expect(selectOptionsSignature(buildOptions(['a,b', 'c']))).not.toBe(selectOptionsSignature(buildOptions(['a', 'b,c'])));
  });
});
