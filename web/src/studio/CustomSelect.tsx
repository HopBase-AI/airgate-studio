import {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { cssVar } from '@doudou-start/airgate-theme';

export interface CustomSelectOption {
  value: string;
  label: string;
  description?: string;
  // 右侧附注（如价格列），等宽字体、不参与省略。
  meta?: string;
}
interface CustomSelectProps {
  value: string;
  options: CustomSelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  compact?: boolean;
  minDropdownWidth?: number;
  disabled?: boolean;
  // 下拉顶部固定区（搜索框 / chips 等），随列表滚动时钉在顶端。
  header?: ReactNode;
  // options 为空时下拉里显示的提示（配合 header 做筛选空态）。
  emptyText?: string;
  // 触发器展示用的选中项：当 options 是筛选后的子集、当前值被过滤掉时仍能
  // 正确显示已选标签。缺省从 options 里找。
  selectedOption?: CustomSelectOption;
  onOpenChange?: (open: boolean) => void;
}

const triggerStyle: CSSProperties = {
  width: '100%',
  padding: '9px 14px',
  border: `1px solid ${cssVar('borderSubtle')}`,
  borderRadius: 10,
  background: cssVar('bgDeep'),
  color: cssVar('text'),
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  font: 'inherit',
  fontSize: 13,
  transition: 'border-color 0.2s, box-shadow 0.2s',
  boxSizing: 'border-box',
  minWidth: 0,
};

const triggerOpenStyle: CSSProperties = {
  borderColor: `color-mix(in oklab, ${cssVar('primary')} 30%, transparent)`,
  boxShadow: `0 0 0 3px ${cssVar('primaryGlow')}`,
};

const triggerCompactStyle: CSSProperties = {
  height: 26,
  minHeight: 26,
  maxHeight: 26,
  padding: '0 10px',
  borderRadius: 6,
  fontSize: 11,
};

const triggerDisabledStyle: CSSProperties = {
  opacity: 0.55,
  cursor: 'not-allowed',
};

const dropdownStyle: CSSProperties = {
  position: 'fixed',
  zIndex: 999999,
  background: cssVar('bgElevated'),
  border: `1px solid ${cssVar('glassBorder')}`,
  borderRadius: 12,
  boxShadow: '0 12px 40px rgba(0, 0, 0, 0.5), 0 4px 12px rgba(0, 0, 0, 0.3)',
  backdropFilter: 'blur(20px)',
  WebkitBackdropFilter: 'blur(20px)',
  overflowY: 'auto',
  padding: 5,
  animation: 'studioFadeIn 0.15s cubic-bezier(0.4, 0, 0.2, 1)',
  outline: 'none',
};

const headerStyle: CSSProperties = {
  position: 'sticky',
  top: -5,
  zIndex: 1,
  margin: '-5px -5px 4px',
  padding: '8px 8px 6px',
  background: cssVar('bgElevated'),
  borderBottom: `1px solid ${cssVar('borderSubtle')}`,
};

const optionStyle: CSSProperties = {
  width: '100%',
  padding: '9px 14px',
  border: 'none',
  background: 'transparent',
  color: cssVar('text'),
  textAlign: 'left',
  cursor: 'pointer',
  borderRadius: 8,
  fontSize: 13,
  font: 'inherit',
  transition: 'background 0.12s',
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  gap: 10,
};

const optionLabelStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const optionMetaStyle: CSSProperties = {
  flexShrink: 0,
  fontSize: 11,
  color: cssVar('textSecondary'),
  fontFamily: cssVar('fontMono'),
  whiteSpace: 'nowrap',
};

const optionCompactStyle: CSSProperties = {
  padding: '6px 9px',
  borderRadius: 7,
  fontSize: 11,
  lineHeight: 1.2,
};

const activeOptionStyle: CSSProperties = {
  background: cssVar('primarySubtle'),
  color: cssVar('text'),
  fontWeight: 600,
};

const highlightedOptionStyle: CSSProperties = {
  background: cssVar('bgHover'),
};

const emptyStyle: CSSProperties = {
  padding: '14px 12px',
  fontSize: 12,
  color: cssVar('textTertiary'),
  textAlign: 'center',
};

const hoverCSS = `
  .studio-select-option:hover {
    background: ${cssVar('bgHover')};
  }
  .studio-select-trigger:hover {
    border-color: ${cssVar('border')};
  }
`;

type DropdownPosition = {
  top?: number;
  bottom?: number;
  left: number;
  width: number;
  maxHeight: number;
};

export function CustomSelect({
  value,
  options,
  onChange,
  placeholder,
  compact,
  minDropdownWidth = 220,
  disabled,
  header,
  emptyText,
  selectedOption,
  onOpenChange,
}: CustomSelectProps) {
  const [open, setOpenRaw] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<DropdownPosition>({ top: 0, left: 0, width: minDropdownWidth, maxHeight: 260 });
  const uniqueOptions = useMemo(() => {
    const seen = new Set<string>();
    const result: CustomSelectOption[] = [];
    for (const option of options) {
      if (seen.has(option.value)) continue;
      seen.add(option.value);
      result.push(option);
    }
    return result;
  }, [options]);

  const setOpen = useCallback((next: boolean) => {
    setOpenRaw(next);
    onOpenChange?.(next);
  }, [onOpenChange]);

  const hasHeader = header != null;
  const maxDropdownHeight = hasHeader ? 400 : 320;

  const calcPos = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const margin = 8;
    const gap = 6;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.min(Math.max(rect.width, minDropdownWidth), vw - margin * 2);
    const left = Math.max(margin, Math.min(rect.left, vw - width - margin));
    const optionHeight = compact ? 27 : 36;
    const headerHeight = hasHeader ? 84 : 0;
    const desiredHeight = Math.min(
      maxDropdownHeight,
      Math.max(44, uniqueOptions.length * optionHeight + 10 + headerHeight),
    );
    const spaceBelow = vh - rect.bottom - gap - margin;
    const spaceAbove = rect.top - gap - margin;
    const openUp = spaceBelow < desiredHeight && spaceAbove > spaceBelow;
    if (openUp) {
      setPos({
        bottom: vh - rect.top + gap,
        left,
        width,
        maxHeight: Math.max(120, Math.min(maxDropdownHeight, spaceAbove)),
      });
    } else {
      setPos({
        top: rect.bottom + gap,
        left,
        width,
        maxHeight: Math.max(120, Math.min(maxDropdownHeight, spaceBelow)),
      });
    }
  }, [compact, hasHeader, maxDropdownHeight, minDropdownWidth, uniqueOptions.length]);

  const handleToggle = () => {
    if (disabled) return;
    if (!open) calcPos();
    setOpen(!open);
  };

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (dropdownRef.current?.contains(target)) return;
      setOpen(false);
    };
    const update = () => calcPos();
    document.addEventListener('mousedown', handler);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      document.removeEventListener('mousedown', handler);
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [calcPos, open, setOpen]);

  // 键盘高亮跟随可见列表：列表变化（筛选）时回到当前选中项，选中项被过滤掉则不高亮。
  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 与列表同步的派生状态
    setHighlighted(uniqueOptions.findIndex(o => o.value === value));
  }, [open, uniqueOptions, value]);

  useEffect(() => {
    if (!open || highlighted < 0) return;
    const el = dropdownRef.current?.querySelector<HTMLElement>(`[data-option-index="${highlighted}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [highlighted, open]);

  const choose = useCallback((next: string) => {
    onChange(next);
    setOpen(false);
    triggerRef.current?.focus();
  }, [onChange, setOpen]);

  // ↑↓ 只在当前可见（筛选后）的列表内移动；Enter 选中高亮项；Esc 关闭。
  const handleDropdownKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (uniqueOptions.length === 0) return;
      const delta = e.key === 'ArrowDown' ? 1 : -1;
      setHighlighted(prev => {
        const start = prev < 0 ? (delta > 0 ? -1 : uniqueOptions.length) : prev;
        return (start + delta + uniqueOptions.length) % uniqueOptions.length;
      });
    } else if (e.key === 'Enter') {
      const target = uniqueOptions[highlighted];
      if (target) {
        e.preventDefault();
        choose(target.value);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    }
  };

  const selected = selectedOption ?? uniqueOptions.find(o => o.value === value);
  const selectedLabel = selected?.label || placeholder || value;
  const selectedTitleLines = [selectedLabel];
  if (selected?.meta) selectedTitleLines.push(selected.meta);
  if (selected?.description) selectedTitleLines.push(selected.description);
  const selectedTitle = selectedTitleLines.join('\n');
  const renderedDropdown = open
    ? createPortal(
        <div
          ref={dropdownRef}
          role="listbox"
          tabIndex={-1}
          onKeyDown={handleDropdownKeyDown}
          style={{
            ...dropdownStyle,
            top: pos.top,
            bottom: pos.bottom,
            left: pos.left,
            width: pos.width,
            maxHeight: pos.maxHeight,
          }}
        >
          {hasHeader && <div style={headerStyle}>{header}</div>}
          {uniqueOptions.length === 0 && emptyText ? (
            <div style={emptyStyle}>{emptyText}</div>
          ) : null}
          {uniqueOptions.map((opt, index) => {
            const isActive = opt.value === value;
            const isHighlighted = index === highlighted && !isActive;
            const titleLines = [opt.label];
            if (opt.meta) titleLines.push(opt.meta);
            if (opt.description) titleLines.push(opt.description);
            return (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={isActive}
                data-option-index={index}
                style={{
                  ...optionStyle,
                  ...(compact ? optionCompactStyle : {}),
                  ...(isHighlighted ? highlightedOptionStyle : {}),
                  ...(isActive ? activeOptionStyle : {}),
                }}
                className={isActive ? '' : 'studio-select-option'}
                title={titleLines.join('\n')}
                onMouseEnter={() => setHighlighted(index)}
                onClick={() => choose(opt.value)}
              >
                <span style={optionLabelStyle}>{opt.label}</span>
                {opt.meta ? <span style={optionMetaStyle}>{opt.meta}</span> : null}
              </button>
            );
          })}
        </div>,
        document.body,
      )
    : null;

  return (
    <div style={{ minWidth: 0 }}>
      <style>{hoverCSS}</style>
      <button
        ref={triggerRef}
        type="button"
        onClick={handleToggle}
        disabled={disabled}
        title={selectedTitle}
        aria-expanded={open}
        aria-haspopup="listbox"
        style={{
          ...triggerStyle,
          ...(compact ? triggerCompactStyle : {}),
          ...(open ? triggerOpenStyle : {}),
          ...(disabled ? triggerDisabledStyle : {}),
        }}
        className="studio-select-trigger"
      >
        <span style={{ flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {selectedLabel}
        </span>
        <svg
          width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          style={{ opacity: 0.4, transition: 'transform 0.2s', transform: open ? 'rotate(180deg)' : 'rotate(0deg)', flexShrink: 0 }}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {renderedDropdown}
    </div>
  );
}
