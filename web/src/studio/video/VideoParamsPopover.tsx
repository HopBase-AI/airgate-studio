import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { cssVar } from '@doudou-start/airgate-theme';
import { VIDEO_DURATIONS, VIDEO_RATIOS, type VideoStringKey } from './videoConfig';

// 视频次要参数（时长/分辨率/画幅/音频）收进一个弹出面板，工具栏只留摘要按钮，
// 避免多控件挤占整行。chip 式选项（非嵌套下拉）规避 portal 点击穿透。

interface Props {
  duration: number;
  setDuration: (v: number) => void;
  resolution: string;
  setResolution: (v: string) => void;
  ratio: string;
  setRatio: (v: string) => void;
  audio: boolean;
  setAudio: (v: boolean) => void;
  resolutions: string[];
  vs: (key: VideoStringKey) => string;
}

type PanelPos = { bottom: number; left: number; width: number };

export function VideoParamsPopover({
  duration, setDuration, resolution, setResolution, ratio, setRatio, audio, setAudio, resolutions, vs,
}: Props) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<PanelPos>({ bottom: 0, left: 0, width: 260 });

  const calcPos = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const margin = 8;
    const width = 260;
    const left = Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin));
    // 始终向上弹出（composer 在屏幕底部）
    setPos({ bottom: window.innerHeight - rect.top + 6, left, width });
  }, []);

  const handleToggle = () => {
    if (!open) calcPos();
    setOpen(v => !v);
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    const update = () => calcPos();
    document.addEventListener('mousedown', onDown);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open, calcPos]);

  const summary = `${duration}${vs('duration_seconds')} · ${resolution} · ${ratio}`;

  const chip = (active: boolean): CSSProperties => ({
    height: 28,
    padding: '0 12px',
    borderRadius: 8,
    border: `1px solid ${active ? 'transparent' : cssVar('borderSubtle')}`,
    background: active ? cssVar('primarySubtle') : 'transparent',
    color: active ? cssVar('text') : cssVar('textSecondary'),
    fontWeight: active ? 600 : 400,
    fontSize: 12,
    fontFamily: 'inherit',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    transition: 'all 0.15s',
  });

  const panel = open
    ? createPortal(
        <div ref={panelRef} style={{ ...s.panel, bottom: pos.bottom, left: pos.left, width: pos.width }}>
          <ParamRow label={vs('duration')}>
            {VIDEO_DURATIONS.map(d => (
              <button key={d} type="button" style={chip(d === duration)} onClick={() => setDuration(d)}>
                {d}{vs('duration_seconds')}
              </button>
            ))}
          </ParamRow>
          <ParamRow label={vs('resolution')}>
            {resolutions.map(r => (
              <button key={r} type="button" style={chip(r === resolution)} onClick={() => setResolution(r)}>
                {r}
              </button>
            ))}
          </ParamRow>
          <ParamRow label={vs('ratio')}>
            {VIDEO_RATIOS.map(r => (
              <button key={r} type="button" style={chip(r === ratio)} onClick={() => setRatio(r)}>
                {r}
              </button>
            ))}
          </ParamRow>
          <div style={s.audioRow}>
            <span style={s.rowLabel}>{vs('audio')}</span>
            <button
              type="button"
              role="switch"
              aria-checked={audio}
              style={{ ...s.switch, ...(audio ? s.switchOn : null) }}
              onClick={() => setAudio(!audio)}
            >
              <span style={{ ...s.switchKnob, ...(audio ? s.switchKnobOn : null) }} />
            </button>
          </div>
        </div>,
        document.body,
      )
    : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={handleToggle}
        style={{ ...s.trigger, ...(open ? s.triggerOpen : null) }}
        className="studio-select-trigger"
        title={summary}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0, opacity: 0.7 }}>
          <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" />
        </svg>
        <span style={s.summary}>{summary}</span>
        {audio && (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={cssVar('primary')} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
            <path d="M11 5 6 9H2v6h4l5 4z" /><path d="M15.5 8.5a5 5 0 0 1 0 7" />
          </svg>
        )}
      </button>
      {panel}
    </>
  );
}

function ParamRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={s.paramRow}>
      <span style={s.rowLabel}>{label}</span>
      <div style={s.chipRow}>{children}</div>
    </div>
  );
}

const s: Record<string, CSSProperties> = {
  trigger: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    height: 26,
    padding: '0 10px',
    border: `1px solid ${cssVar('borderSubtle')}`,
    borderRadius: 6,
    background: cssVar('bgDeep'),
    color: cssVar('text'),
    cursor: 'pointer',
    fontSize: 11,
    fontFamily: 'inherit',
    whiteSpace: 'nowrap',
    flexShrink: 0,
    transition: 'border-color 0.2s',
  },
  triggerOpen: {
    borderColor: `color-mix(in oklab, ${cssVar('primary')} 30%, transparent)`,
    boxShadow: `0 0 0 3px ${cssVar('primaryGlow')}`,
  },
  summary: {
    fontVariantNumeric: 'tabular-nums',
  },
  panel: {
    position: 'fixed',
    zIndex: 999999,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    padding: 12,
    background: cssVar('bgElevated'),
    border: `1px solid ${cssVar('glassBorder')}`,
    borderRadius: 12,
    boxShadow: '0 12px 40px rgba(0, 0, 0, 0.5), 0 4px 12px rgba(0, 0, 0, 0.3)',
    backdropFilter: 'blur(20px)',
    WebkitBackdropFilter: 'blur(20px)',
    animation: 'studioFadeIn 0.15s cubic-bezier(0.4, 0, 0.2, 1)',
  },
  paramRow: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  rowLabel: {
    fontSize: 11,
    color: cssVar('textTertiary'),
    fontWeight: 500,
  },
  chipRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
  },
  audioRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 2,
  },
  switch: {
    width: 40,
    height: 23,
    borderRadius: 999,
    border: 'none',
    background: cssVar('bgHover'),
    cursor: 'pointer',
    padding: 2,
    display: 'inline-flex',
    alignItems: 'center',
    transition: 'background 0.18s',
  },
  switchOn: {
    background: cssVar('primary'),
  },
  switchKnob: {
    width: 19,
    height: 19,
    borderRadius: '50%',
    background: '#fff',
    boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
    transition: 'transform 0.18s',
  },
  switchKnobOn: {
    transform: 'translateX(17px)',
  },
};
