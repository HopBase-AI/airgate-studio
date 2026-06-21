import { useState, useRef, useEffect, type CSSProperties } from 'react';
import { cssVar } from '@doudou-start/airgate-theme';
import { SKILL_REGISTRY, STYLE_PRESETS, BG_PRESETS, type SkillConfig } from './skillConfig';

const s: Record<string, CSSProperties> = {
  bar: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
    padding: '2px 2px 8px',
  },
  pill: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    padding: '5px 11px',
    borderRadius: 999,
    border: `1px solid ${cssVar('borderSubtle')}`,
    background: cssVar('bgElevated'),
    color: cssVar('textSecondary'),
    fontSize: 12.5,
    fontWeight: 500,
    cursor: 'pointer',
    transition: cssVar('transition'),
    fontFamily: 'inherit',
    whiteSpace: 'nowrap',
    userSelect: 'none',
  },
  pillBusy: {
    opacity: 0.6,
    cursor: 'wait',
  },
  pillIcon: {
    fontSize: 13,
    lineHeight: 1,
  },
  caret: {
    opacity: 0.5,
    marginLeft: -1,
  },
  popover: {
    position: 'absolute',
    bottom: 'calc(100% + 6px)',
    left: 0,
    zIndex: 50,
    minWidth: 168,
    padding: 5,
    borderRadius: 12,
    background: cssVar('bgElevated'),
    border: `1px solid ${cssVar('glassBorder')}`,
    boxShadow: '0 12px 40px rgba(0, 0, 0, 0.28)',
    display: 'flex',
    flexDirection: 'column',
    gap: 1,
  },
  presetItem: {
    display: 'flex',
    alignItems: 'center',
    padding: '8px 12px',
    borderRadius: 8,
    background: 'transparent',
    border: 'none',
    color: cssVar('text'),
    fontSize: 13,
    cursor: 'pointer',
    transition: cssVar('transition'),
    textAlign: 'left',
    width: '100%',
    fontFamily: 'inherit',
  },
  wrap: {
    position: 'relative',
    display: 'inline-flex',
  },
  spinner: {
    width: 12,
    height: 12,
    border: `2px solid ${cssVar('textTertiary')}`,
    borderTopColor: 'transparent',
    borderRadius: '50%',
    display: 'inline-block',
    animation: 'spin 0.7s linear infinite',
  },
};

export interface SkillBarProps {
  // 当前是否有参考图（决定 needsImage 技能的行为）
  hasImage: boolean;
  // 正在执行的技能 id（loading 态），null 表示空闲
  busySkillId: string | null;
  // 触发一个技能。preset 仅对 style/bg 有值。
  onTrigger: (skill: SkillConfig, preset?: { id: string; label: string; prompt: string }) => void;
  placement?: 'top' | 'bottom';
}

/**
 * SkillBar —— 输入框上方一行技能胶囊。
 * 设计原则：所有技能都把结果汇聚回输入框/生成管线，用户始终用同一个发送键，
 * 不在此处产生隐藏的最终操作。style / bg 点开二级预设菜单。
 */
export function SkillBar({ hasImage, busySkillId, onTrigger, placement = 'top' }: SkillBarProps) {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const skills = SKILL_REGISTRY.filter(skill => (
    placement === 'bottom'
      ? skill.id === 'style' || skill.id === 'bg'
      : skill.id !== 'style' && skill.id !== 'bg'
  ));

  // 点外部关闭弹层
  useEffect(() => {
    if (!openMenu) return;
    const onDown = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) setOpenMenu(null);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [openMenu]);

  const handlePillClick = (skill: SkillConfig) => {
    if (busySkillId) return;
    // style / bg 有预设二级菜单
    if (skill.id === 'style' || skill.id === 'bg') {
      setOpenMenu(prev => (prev === skill.id ? null : skill.id));
      return;
    }
    onTrigger(skill);
  };

  const handlePreset = (skill: SkillConfig, preset: { id: string; label: string; prompt: string }) => {
    setOpenMenu(null);
    onTrigger(skill, preset);
  };

  if (skills.length === 0) return null;

  return (
    <div style={s.bar} ref={barRef} className="studio-skillbar">
      {skills.map(skill => {
        const busy = busySkillId === skill.id;
        const hasMenu = skill.id === 'style' || skill.id === 'bg';
        const presets = skill.id === 'style' ? STYLE_PRESETS : skill.id === 'bg' ? BG_PRESETS : [];
        // needsImage 但无图：仍可点（caption 会引导上传），用淡一点的提示色暗示
        const dim = skill.needsImage && !hasImage;
        return (
          <div style={s.wrap} key={skill.id}>
            <button
              type="button"
              className="studio-skill-pill"
              style={{
                ...s.pill,
                ...(busy ? s.pillBusy : {}),
                ...(dim ? { opacity: 0.78 } : {}),
                ...(openMenu === skill.id ? { borderColor: cssVar('primary'), color: cssVar('text') } : {}),
              }}
              title={dim ? `${skill.hint}（需要先选择参考图）` : skill.hint}
              onClick={() => handlePillClick(skill)}
              disabled={busy}
            >
              {busy ? <span style={s.spinner} /> : <span style={s.pillIcon}>{skill.icon}</span>}
              {skill.name}
              {hasMenu && (
                <svg style={s.caret} width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 9l6 6 6-6" />
                </svg>
              )}
            </button>
            {hasMenu && openMenu === skill.id && (
              <div style={s.popover} className="studio-skill-popover">
                {presets.map(preset => (
                  <button
                    key={preset.id}
                    type="button"
                    className="studio-skill-preset"
                    style={s.presetItem}
                    onClick={() => handlePreset(skill, preset)}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
