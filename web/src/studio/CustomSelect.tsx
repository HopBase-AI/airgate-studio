import { useState, useRef, useEffect, useCallback, useMemo, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { cssVar } from '@doudou-start/airgate-theme';

interface Option { value: string; label: string }
interface CustomSelectProps {
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  placeholder?: string;
  compact?: boolean;
  minDropdownWidth?: number;
  disabled?: boolean;
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
  overflowWrap: 'anywhere',
  whiteSpace: 'normal',
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
}: CustomSelectProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<DropdownPosition>({ top: 0, left: 0, width: minDropdownWidth, maxHeight: 260 });
  const uniqueOptions = useMemo(() => {
    const seen = new Set<string>();
    const result: Option[] = [];
    for (const option of options) {
      if (seen.has(option.value)) continue;
      seen.add(option.value);
      result.push(option);
    }
    return result;
  }, [options]);

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
    const desiredHeight = Math.min(320, Math.max(44, uniqueOptions.length * optionHeight + 10));
    const spaceBelow = vh - rect.bottom - gap - margin;
    const spaceAbove = rect.top - gap - margin;
    const openUp = spaceBelow < desiredHeight && spaceAbove > spaceBelow;
    if (openUp) {
      setPos({
        bottom: vh - rect.top + gap,
        left,
        width,
        maxHeight: Math.max(120, Math.min(320, spaceAbove)),
      });
    } else {
      setPos({
        top: rect.bottom + gap,
        left,
        width,
        maxHeight: Math.max(120, Math.min(320, spaceBelow)),
      });
    }
  }, [compact, minDropdownWidth, uniqueOptions.length]);

  const handleToggle = () => {
    if (disabled) return;
    if (!open) calcPos();
    setOpen(v => !v);
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
  }, [calcPos, open]);

  const selected = uniqueOptions.find(o => o.value === value);
  const selectedLabel = selected?.label || placeholder || value;
  const renderedDropdown = open
    ? createPortal(
        <div
          ref={dropdownRef}
          style={{
            ...dropdownStyle,
            top: pos.top,
            bottom: pos.bottom,
            left: pos.left,
            width: pos.width,
            maxHeight: pos.maxHeight,
          }}
        >
          {uniqueOptions.map(opt => (
            <button
              key={opt.value}
              type="button"
              style={{
                ...optionStyle,
                ...(compact ? optionCompactStyle : {}),
                ...(opt.value === value ? activeOptionStyle : {}),
              }}
              className={opt.value === value ? '' : 'studio-select-option'}
              title={opt.label}
              onClick={() => { onChange(opt.value); setOpen(false); }}
            >
              {opt.label}
            </button>
          ))}
        </div>,
        document.body,
      )
    : null;

  return (
    <div>
      <style>{hoverCSS}</style>
      <button
        ref={triggerRef}
        type="button"
        onClick={handleToggle}
        disabled={disabled}
        title={selectedLabel}
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
