import { useCallback, useMemo, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { cssVar } from '@doudou-start/airgate-theme';
import { CustomSelect, type CustomSelectOption } from './CustomSelect';
import { MODEL_FAMILY_LABELS, type ModelFamily } from './modelConfig';
import { localizeRouteLabel, type ModelRouteOption } from './modelRoutes';
import {
  availableModelFamilies,
  filterModelRouteOptions,
  formatModelRoutePricing,
  readFamilyFilter,
  writeFamilyFilter,
} from './modelRouteFilter';
import { useModelSelectorStrings, type ModelSelectorStrings } from './modelSelectorStrings';

// 模型选择器（规范 2026-09-10）：包一层 CustomSelect，下拉顶部固定搜索框 + 「系列」chips。
// - 一个供给一行，标签与价格列由 modelRoutes/modelRouteFilter 生成，这里只做展示与筛选；
// - 筛选只影响可见项，不改变顺序与当前选中；chips 状态按会话记忆，搜索词关闭即清空；
// - 图生图 / 局部重绘复用同一组件，只是 options 候选集不同。

interface ModelRouteSelectProps {
  value: string;
  options: ModelRouteOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  compact?: boolean;
  minDropdownWidth?: number;
  disabled?: boolean;
}

function safeSessionStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

const searchInputStyle: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '6px 9px',
  border: `1px solid ${cssVar('borderSubtle')}`,
  borderRadius: 7,
  background: cssVar('bgDeep'),
  color: cssVar('text'),
  font: 'inherit',
  fontSize: 12,
  outline: 'none',
};

const chipRowStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 6,
  marginTop: 6,
};

const chipStyle: CSSProperties = {
  padding: '2px 9px',
  border: `1px solid ${cssVar('borderSubtle')}`,
  borderRadius: 999,
  background: 'transparent',
  color: cssVar('textSecondary'),
  font: 'inherit',
  fontSize: 11,
  lineHeight: '16px',
  cursor: 'pointer',
  transition: 'background 0.12s, border-color 0.12s, color 0.12s',
};

const chipActiveStyle: CSSProperties = {
  background: cssVar('primarySubtle'),
  borderColor: `color-mix(in oklab, ${cssVar('primary')} 40%, transparent)`,
  color: cssVar('text'),
  fontWeight: 600,
};

interface ModelRouteSelectHeaderProps {
  query: string;
  onQueryChange: (query: string) => void;
  families: ModelFamily[];
  family: ModelFamily | null;
  onFamilyChange: (family: ModelFamily | null) => void;
  strings: ModelSelectorStrings;
  autoFocus?: boolean;
}

// 下拉头部：搜索框 + 系列 chips（单选，再点一次取消）。拆成独立组件便于静态渲染测试。
export function ModelRouteSelectHeader({
  query,
  onQueryChange,
  families,
  family,
  onFamilyChange,
  strings,
  autoFocus,
}: ModelRouteSelectHeaderProps) {
  return (
    <div>
      <input
        type="search"
        value={query}
        onChange={e => onQueryChange(e.target.value)}
        placeholder={strings('model_search_placeholder')}
        aria-label={strings('model_search_placeholder')}
        autoFocus={autoFocus}
        autoComplete="off"
        spellCheck={false}
        style={searchInputStyle}
        className="studio-model-search"
      />
      <div style={chipRowStyle} role="group">
        <button
          type="button"
          aria-pressed={family == null}
          style={{ ...chipStyle, ...(family == null ? chipActiveStyle : {}) }}
          className="studio-model-family-chip"
          onClick={() => onFamilyChange(null)}
        >
          {strings('family_all')}
        </button>
        {families.map(item => {
          const active = item === family;
          return (
            <button
              key={item}
              type="button"
              aria-pressed={active}
              data-family={item}
              style={{ ...chipStyle, ...(active ? chipActiveStyle : {}) }}
              className="studio-model-family-chip"
              onClick={() => onFamilyChange(active ? null : item)}
            >
              {MODEL_FAMILY_LABELS[item]}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function ModelRouteSelect({
  value,
  options,
  onChange,
  placeholder,
  compact,
  minDropdownWidth = 420,
  disabled,
}: ModelRouteSelectProps) {
  const { t, i18n } = useTranslation();
  const strings = useModelSelectorStrings();
  const [query, setQuery] = useState('');
  const [storedFamily, setStoredFamily] = useState<ModelFamily | null>(() => readFamilyFilter(safeSessionStorage()));

  const families = useMemo(() => availableModelFamilies(options), [options]);
  // 记忆的系列当前没有供给时按「全部」处理，但不清掉记忆——候选集切换（如进入
  // 局部重绘）只是暂时缩小，回来后仍沿用用户的选择。
  const family = storedFamily != null && families.includes(storedFamily) ? storedFamily : null;

  const setFamily = useCallback((next: ModelFamily | null) => {
    setStoredFamily(next);
    writeFamilyFilter(safeSessionStorage(), next);
  }, []);

  const toSelectOption = useCallback((option: ModelRouteOption): CustomSelectOption => ({
    value: option.value,
    label: localizeRouteLabel(option.label, t, i18n.language),
    description: option.description,
    meta: formatModelRoutePricing(option.pricing, strings),
  }), [i18n.language, strings, t]);

  const visibleOptions = useMemo(
    () => filterModelRouteOptions(options, query, family).map(toSelectOption),
    [family, options, query, toSelectOption],
  );
  const selectedOption = useMemo(() => {
    const match = options.find(option => option.value === value);
    return match ? toSelectOption(match) : undefined;
  }, [options, toSelectOption, value]);

  const handleOpenChange = useCallback((open: boolean) => {
    if (!open) setQuery('');
  }, []);

  return (
    <CustomSelect
      value={value}
      options={visibleOptions}
      selectedOption={selectedOption}
      onChange={onChange}
      placeholder={placeholder}
      compact={compact}
      minDropdownWidth={minDropdownWidth}
      disabled={disabled}
      emptyText={strings('no_model_match')}
      onOpenChange={handleOpenChange}
      header={(
        <ModelRouteSelectHeader
          query={query}
          onQueryChange={setQuery}
          families={families}
          family={family}
          onFamilyChange={setFamily}
          strings={strings}
          autoFocus
        />
      )}
    />
  );
}
