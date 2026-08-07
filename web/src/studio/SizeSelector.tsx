import { useState, useRef, useEffect, useCallback, type CSSProperties } from 'react';
import { cssVar } from '@doudou-start/airgate-theme';
import type { SizeOption } from './modelConfig';

interface SizeSelectorProps {
  value: string;
  sizes: SizeOption[];
  onChange: (value: string) => void;
  upward?: boolean;
  compact?: boolean;
}

export function formatImagePrice(price: number): string {
  return price.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

function imagePriceSymbol(currency?: string): string {
  return currency?.toUpperCase() === 'CNY' ? '¥' : '$';
}

function AspectIcon({ aspect, size = 16 }: { aspect?: string; size?: number }) {
  if (!aspect) return null;
  const [aw, ah] = aspect.split(':').map(Number);
  const innerSize = size - 4;
  const ratio = aw / ah;
  let w: number, h: number;
  if (ratio >= 1) {
    w = innerSize;
    h = Math.round(innerSize / ratio);
  } else {
    h = innerSize;
    w = Math.round(innerSize * ratio);
  }
  w = Math.max(3, w);
  h = Math.max(3, h);
  const x = Math.round((size - w) / 2);
  const y = Math.round((size - h) / 2);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0, opacity: 0.45 }}>
      <rect x={x} y={y} width={w} height={h} rx={1.5} fill="currentColor" />
    </svg>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────

const s: Record<string, CSSProperties> = {
  trigger: {
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
  },
  triggerOpen: {
    borderColor: `color-mix(in oklab, ${cssVar('primary')} 30%, transparent)`,
    boxShadow: `0 0 0 3px ${cssVar('primaryGlow')}`,
  },
  triggerCompact: {
    height: 26,
    minHeight: 26,
    padding: '0 10px',
    borderRadius: 6,
    fontSize: 11,
  },
  dropdown: {
    position: 'fixed',
    zIndex: 999999,
    background: cssVar('bgElevated'),
    border: `1px solid ${cssVar('glassBorder')}`,
    borderRadius: 12,
    boxShadow: '0 12px 40px rgba(0, 0, 0, 0.5), 0 4px 12px rgba(0, 0, 0, 0.3)',
    maxHeight: 320,
    overflowY: 'auto',
    padding: 5,
    minWidth: 220,
  },
  tierHeader: {
    padding: '8px 14px 4px',
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: cssVar('textTertiary'),
    fontFamily: cssVar('fontMono'),
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    userSelect: 'none',
  },
  option: {
    width: '100%',
    padding: '8px 14px',
    border: 'none',
    background: 'transparent',
    color: cssVar('text'),
    textAlign: 'left',
    cursor: 'pointer',
    borderRadius: 8,
    fontSize: 13,
    font: 'inherit',
    transition: 'background 0.12s',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    boxSizing: 'border-box',
  },
  optionActive: {
    background: cssVar('primarySubtle'),
    fontWeight: 600,
  },
  optionAspect: {
    fontSize: 11,
    color: cssVar('textTertiary'),
    fontFamily: cssVar('fontMono'),
  },
  optionMeta: {
    marginLeft: 'auto',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    flexShrink: 0,
  },
  price: {
    fontSize: 11,
    color: cssVar('textSecondary'),
    fontFamily: cssVar('fontMono'),
    whiteSpace: 'nowrap',
    flexShrink: 0,
  },
  divider: {
    height: 1,
    margin: '4px 10px',
    background: cssVar('borderSubtle'),
  },
};

const sizeHoverCSS = `
  .studio-size-trigger:hover {
    border-color: ${cssVar('border')};
  }
  .studio-size-option:hover {
    background: ${cssVar('bgHover')};
  }
`;

// ── Component ───────────────────────────────────────────────────────────────

export function SizeSelector({ value, sizes, onChange, upward, compact }: SizeSelectorProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number }>({ top: 0, left: 0, width: 220 });

  const calcPos = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    // 下拉是 fixed 定位，会逃逸父级 overflow；窄屏下钳制 width/left 保证不冲出视口。
    const vw = window.innerWidth;
    const width = Math.min(Math.max(rect.width, 220), vw - 16);
    const left = Math.max(8, Math.min(rect.left, vw - width - 8));
    if (upward) {
      setPos({ top: rect.top - 6, left, width });
    } else {
      setPos({ top: rect.bottom + 6, left, width });
    }
  }, [upward]);

  const handleToggle = () => {
    if (!open) calcPos();
    setOpen(v => !v);
  };

  useEffect(() => {
    if (!open) return;
    const handleOutside = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t)) return;
      if (dropdownRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [open]);

  const selected = sizes.find(sz => sz.value === value);
  const autoOption = sizes.find(sz => sz.value === 'auto');

  const tierOrder: string[] = [];
  const tierGroups = new Map<string, SizeOption[]>();
  for (const sz of sizes) {
    if (sz.value === 'auto') continue;
    if (!tierGroups.has(sz.tier)) {
      tierOrder.push(sz.tier);
      tierGroups.set(sz.tier, []);
    }
    tierGroups.get(sz.tier)!.push(sz);
  }

  const triggerLabel = selected
    ? selected.value === 'auto'
      ? 'Auto'
      : `${selected.label}${selected.aspect ? ` · ${selected.aspect}` : ''}`
    : value;

  const select = (v: string) => { onChange(v); setOpen(false); };

  const dropdownStyle: CSSProperties = upward
    ? { ...s.dropdown, bottom: `calc(100vh - ${pos.top}px)`, left: pos.left, width: pos.width, top: 'auto' }
    : { ...s.dropdown, top: pos.top, left: pos.left, width: pos.width };

  return (
    <>
      <style>{sizeHoverCSS}</style>
      <button
        ref={triggerRef}
        type="button"
        onClick={handleToggle}
        style={{ ...s.trigger, ...(compact ? s.triggerCompact : {}), ...(open ? s.triggerOpen : {}) }}
        className="studio-size-trigger"
      >
        {selected?.aspect && <AspectIcon aspect={selected.aspect} size={compact ? 14 : 16} />}
        <span style={{ flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {triggerLabel}
        </span>
        {selected?.showPrice && (
          <span style={s.price}>{imagePriceSymbol(selected.currency)}{formatImagePrice(selected.price)}/张</span>
        )}
        <svg
          width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          style={{ opacity: 0.4, transition: 'transform 0.2s', transform: open ? 'rotate(180deg)' : 'rotate(0deg)', flexShrink: 0 }}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div ref={dropdownRef} style={dropdownStyle} className="studio-sidebar">
          {autoOption && (
            <button
              type="button"
              onClick={() => select('auto')}
              style={{ ...s.option, ...(value === 'auto' ? s.optionActive : {}) }}
              className={value === 'auto' ? '' : 'studio-size-option'}
            >
              <span style={{ flex: 1 }}>Auto</span>
            </button>
          )}

          {tierOrder.map((tier, i) => {
            const options = tierGroups.get(tier)!;
            return (
              <div key={tier}>
                {(i > 0 || autoOption) && <div style={s.divider} />}
                <div style={s.tierHeader}>
                  <span>{tier}</span>
                </div>
                {options.map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => select(opt.value)}
                    style={{ ...s.option, ...(opt.value === value ? s.optionActive : {}) }}
                    className={opt.value === value ? '' : 'studio-size-option'}
                  >
                    {opt.aspect && <AspectIcon aspect={opt.aspect} />}
                    <span>{opt.label}</span>
                    {(opt.aspect || opt.showPrice) && (
                      <span style={s.optionMeta}>
                        {opt.aspect && <span style={s.optionAspect}>{opt.aspect}</span>}
                        {opt.showPrice && <span style={s.price}>{imagePriceSymbol(opt.currency)}{formatImagePrice(opt.price)}/张</span>}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
