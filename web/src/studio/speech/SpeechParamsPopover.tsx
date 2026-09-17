import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { cssVar } from '@doudou-start/airgate-theme';
import {
  SPEECH_MAX_SPEED,
  SPEECH_MIN_SPEED,
  SPEECH_SPEED_STEP,
  SPEECH_VOICES,
  SPEECH_VOICE_LANGUAGES,
  clampSpeechSpeed,
  defaultSpeechVoiceFor,
  formatSpeechSpeed,
  speechVoiceById,
  speechVoiceChipKey,
  speechVoiceLanguageKey,
  type SpeechStrings,
  type SpeechVoiceLanguage,
} from './speechConfig';

// 语音参数（音色 + 语速）收进一个弹出面板，工具栏只留摘要按钮——与 VideoParamsPopover 同一
// 形态。面板内一律用 chip / 列表按钮 / 原生控件，不嵌套 CustomSelect（portal 里再开 portal
// 会被外层「点击外部即关闭」误关）。受控组件：音色 / 语速都由调用方持有。

interface Props {
  // voiceId 为空串 = 自动（按文本语言选默认音色）；列表外的值视为自定义音色 ID。
  voiceId: string;
  setVoiceId: (id: string) => void;
  speed: number;
  setSpeed: (speed: number) => void;
  // text 用于自动模式下显示当前会落到哪个默认音色。
  text: string;
  sp: SpeechStrings;
}

type PanelPos = { bottom: number; left: number; width: number };

const PANEL_WIDTH = 320;

// speechVoiceLabel 触发器 / 列表里的音色显示名：自动 → 「自动」；精选列表 → 官方标签；
// 其它 → 原样显示自定义 ID。
export function speechVoiceLabel(voiceId: string, sp: SpeechStrings): string {
  const trimmed = voiceId.trim();
  if (!trimmed) return sp('voice_auto');
  return speechVoiceById(trimmed)?.name ?? trimmed;
}

export function SpeechParamsPopover({ voiceId, setVoiceId, speed, setSpeed, text, sp }: Props) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<PanelPos>({ bottom: 0, left: 0, width: PANEL_WIDTH });
  const currentVoice = speechVoiceById(voiceId.trim());
  const isCustom = voiceId.trim() !== '' && !currentVoice;
  const [language, setLanguage] = useState<SpeechVoiceLanguage | 'all'>(() => currentVoice?.language ?? 'all');
  // 自定义 ID 输入框：外部给的自定义值（如「重新生成」回放）直接显示；否则显示本地草稿——
  // 用户把列表里的 ID 完整敲出来时 isCustom 会翻成 false，草稿让输入框不至于突然清空。
  const [customDraft, setCustomDraft] = useState('');
  const customValue = isCustom ? voiceId : customDraft;

  const calcPos = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const margin = 8;
    const width = Math.min(PANEL_WIDTH, window.innerWidth - margin * 2);
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

  const visibleVoices = useMemo(
    () => (language === 'all' ? SPEECH_VOICES : SPEECH_VOICES.filter(voice => voice.language === language)),
    [language],
  );
  const autoVoice = speechVoiceById(defaultSpeechVoiceFor(text));
  const autoLabel = autoVoice ? `${sp('voice_auto')} · ${autoVoice.name}` : sp('voice_auto');
  const summary = `${speechVoiceLabel(voiceId, sp)} · ${formatSpeechSpeed(speed)}`;

  // 芯片文案自带「音色」后明显变长：padding 11 + minWidth 80 是实测出的折行配方——五语
  // 在 320px 面板里分别折成 3+3（中/繁/日）与 2+2+2（英/西），不会出现末行只剩一个芯片
  // 的散架排布，也不横向溢出。改这两个数前先按 PR 里的量法复测五语。
  const chip = (active: boolean): CSSProperties => ({
    height: 26,
    minWidth: 80,
    padding: '0 11px',
    borderRadius: 8,
    border: `1px solid ${active ? 'transparent' : cssVar('borderSubtle')}`,
    background: active ? cssVar('primarySubtle') : 'transparent',
    color: active ? cssVar('text') : cssVar('textSecondary'),
    fontWeight: active ? 600 : 400,
    fontSize: 11,
    fontFamily: 'inherit',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    transition: 'all 0.15s',
  });

  const voiceRow = (active: boolean): CSSProperties => ({
    ...s.voiceRow,
    background: active ? cssVar('primarySubtle') : 'transparent',
    color: active ? cssVar('text') : cssVar('textSecondary'),
    fontWeight: active ? 600 : 400,
  });

  const selectVoice = (id: string) => {
    setVoiceId(id);
    if (id === '' || speechVoiceById(id)) setCustomDraft('');
  };

  const panel = open
    ? createPortal(
        <div ref={panelRef} style={{ ...s.panel, bottom: pos.bottom, left: pos.left, width: pos.width }} role="dialog" aria-label={sp('voice')}>
          <div style={s.section}>
            <span style={s.rowLabel}>{sp('voice')}</span>
            <div style={s.chipRow} role="group" aria-label={sp('voice_lang_filter')}>
              <button type="button" style={chip(language === 'all')} onClick={() => setLanguage('all')}>
                {sp('voice_lang_chip_all')}
              </button>
              {SPEECH_VOICE_LANGUAGES.map(lang => (
                <button key={lang} type="button" style={chip(language === lang)} onClick={() => setLanguage(lang)}>
                  {sp(speechVoiceChipKey(lang))}
                </button>
              ))}
            </div>
            {/* 语言 chip 筛的是配音员母语，不是输出语言。光秃秃一排「西班牙语」挂在「音色」
                标题下会被读成「输出西班牙语」，所以 chip 文案自带「音色」二字先消歧；下面这
                行说明退居兜底，只讲「不翻译 / 要外语语音就改文本」（2026-09-16 用户反馈）。 */}
            <span style={s.hint}>{sp('voice_lang_hint')}</span>
            <div style={s.voiceList} role="listbox" aria-label={sp('voice')}>
              <button
                type="button"
                role="option"
                aria-selected={voiceId.trim() === ''}
                style={voiceRow(voiceId.trim() === '')}
                className="studio-speech-voice"
                onClick={() => selectVoice('')}
              >
                <span style={s.voiceName}>{autoLabel}</span>
              </button>
              {visibleVoices.map(voice => {
                const active = voice.id === voiceId.trim();
                return (
                  <button
                    key={voice.id}
                    type="button"
                    role="option"
                    aria-selected={active}
                    style={voiceRow(active)}
                    className="studio-speech-voice"
                    onClick={() => selectVoice(voice.id)}
                    title={voice.id}
                  >
                    <span style={s.voiceName}>{voice.name}</span>
                    <span style={s.voiceLang}>{sp(speechVoiceLanguageKey(voice.language))}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <div style={s.section}>
            <span style={s.rowLabel}>{sp('voice_custom')}</span>
            <input
              type="text"
              value={customValue}
              onChange={e => {
                const next = e.target.value;
                setCustomDraft(next);
                setVoiceId(next.trim());
              }}
              placeholder={sp('voice_custom_placeholder')}
              spellCheck={false}
              autoComplete="off"
              style={{ ...s.input, ...(isCustom ? s.inputActive : null) }}
              aria-label={sp('voice_custom')}
            />
            <span style={s.hint}>{sp('voice_custom_hint')}</span>
          </div>
          <div style={s.section}>
            <div style={s.speedHeader}>
              <span style={s.rowLabel}>{sp('speed')}</span>
              <span style={s.speedValue}>{formatSpeechSpeed(speed)}</span>
            </div>
            <input
              type="range"
              min={SPEECH_MIN_SPEED}
              max={SPEECH_MAX_SPEED}
              step={SPEECH_SPEED_STEP}
              value={clampSpeechSpeed(speed)}
              onChange={e => setSpeed(clampSpeechSpeed(Number(e.target.value)))}
              style={s.slider}
              aria-label={sp('speed')}
              aria-valuemin={SPEECH_MIN_SPEED}
              aria-valuemax={SPEECH_MAX_SPEED}
              aria-valuenow={clampSpeechSpeed(speed)}
            />
            <div style={s.speedScale} aria-hidden="true">
              <span>{formatSpeechSpeed(SPEECH_MIN_SPEED)}</span>
              <span>{formatSpeechSpeed(1)}</span>
              <span>{formatSpeechSpeed(SPEECH_MAX_SPEED)}</span>
            </div>
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
        data-onboarding-target="studio-speech-params"
        onClick={handleToggle}
        style={{ ...s.trigger, ...(open ? s.triggerOpen : null) }}
        className="studio-select-trigger"
        title={summary}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0, opacity: 0.7 }}>
          <path d="M12 3v18" /><path d="M8 7v10" /><path d="M16 7v10" /><path d="M4 10v4" /><path d="M20 10v4" />
        </svg>
        <span style={s.summary}>{summary}</span>
      </button>
      {panel}
    </>
  );
}

const s: Record<string, CSSProperties> = {
  trigger: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    height: 26,
    maxWidth: 220,
    padding: '0 10px',
    border: `1px solid ${cssVar('borderSubtle')}`,
    borderRadius: 6,
    background: cssVar('bgDeep'),
    color: cssVar('text'),
    cursor: 'pointer',
    fontSize: 11,
    fontFamily: 'inherit',
    whiteSpace: 'nowrap',
    flexShrink: 1,
    minWidth: 0,
    transition: 'border-color 0.2s',
  },
  triggerOpen: {
    borderColor: `color-mix(in oklab, ${cssVar('primary')} 30%, transparent)`,
    boxShadow: `0 0 0 3px ${cssVar('primaryGlow')}`,
  },
  summary: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    fontVariantNumeric: 'tabular-nums',
  },
  panel: {
    position: 'fixed',
    zIndex: 999999,
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    padding: 12,
    boxSizing: 'border-box',
    background: cssVar('bgElevated'),
    border: `1px solid ${cssVar('glassBorder')}`,
    borderRadius: 12,
    boxShadow: '0 12px 40px rgba(0, 0, 0, 0.5), 0 4px 12px rgba(0, 0, 0, 0.3)',
    backdropFilter: 'blur(20px)',
    WebkitBackdropFilter: 'blur(20px)',
    animation: 'studioFadeIn 0.15s cubic-bezier(0.4, 0, 0.2, 1)',
  },
  section: {
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
  voiceList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    maxHeight: 190,
    overflowY: 'auto',
    padding: 3,
    border: `1px solid ${cssVar('borderSubtle')}`,
    borderRadius: 8,
    background: cssVar('bgDeep'),
  },
  voiceRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    width: '100%',
    padding: '6px 9px',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    font: 'inherit',
    fontSize: 12,
    textAlign: 'left',
    boxSizing: 'border-box',
    transition: 'background 0.12s',
  },
  voiceName: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  voiceLang: {
    flexShrink: 0,
    fontSize: 10,
    color: cssVar('textTertiary'),
    fontFamily: cssVar('fontMono'),
  },
  input: {
    width: '100%',
    boxSizing: 'border-box',
    height: 30,
    padding: '0 9px',
    border: `1px solid ${cssVar('borderSubtle')}`,
    borderRadius: 7,
    background: cssVar('bgDeep'),
    color: cssVar('text'),
    font: 'inherit',
    fontSize: 12,
    outline: 'none',
  },
  inputActive: {
    borderColor: `color-mix(in oklab, ${cssVar('primary')} 40%, transparent)`,
  },
  hint: {
    fontSize: 10,
    lineHeight: 1.4,
    color: cssVar('textTertiary'),
  },
  speedHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  speedValue: {
    fontSize: 11,
    color: cssVar('text'),
    fontFamily: cssVar('fontMono'),
    fontVariantNumeric: 'tabular-nums',
  },
  slider: {
    width: '100%',
    cursor: 'pointer',
    accentColor: cssVar('primary'),
    margin: 0,
  },
  speedScale: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: 9,
    color: cssVar('textTertiary'),
    fontFamily: cssVar('fontMono'),
  },
};
