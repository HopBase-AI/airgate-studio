import { useEffect, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { cssVar, getStoredTheme, setTheme, type ThemeName } from '@doudou-start/airgate-theme';
import { useStudio } from './StudioContext';

const s: Record<string, CSSProperties> = {
  sidebar: {
    height: '100%',
    width: 200,
    minWidth: 200,
    display: 'flex',
    flexDirection: 'column',
    background: cssVar('bgDeep'),
    borderRight: `1px solid ${cssVar('borderSubtle')}`,
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 12px 8px',
    gap: 8,
  },
  title: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.06em',
    color: cssVar('textTertiary'),
    fontFamily: cssVar('fontMono'),
    textTransform: 'uppercase',
  },
  addBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 24,
    height: 24,
    borderRadius: 6,
    border: 'none',
    background: 'transparent',
    color: cssVar('textSecondary'),
    cursor: 'pointer',
    padding: 0,
    transition: cssVar('transition'),
  },
  list: {
    flex: 1,
    overflowY: 'auto',
    overflowX: 'hidden',
    padding: '4px 8px 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  item: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '8px 10px',
    borderRadius: 8,
    cursor: 'pointer',
    color: cssVar('textSecondary'),
    fontSize: 13,
    transition: cssVar('transition'),
    border: '1px solid transparent',
    userSelect: 'none',
  },
  itemActive: {
    background: cssVar('primarySubtle'),
    color: cssVar('text'),
    fontWeight: 600,
  },
  itemName: {
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  itemAction: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 20,
    height: 20,
    borderRadius: 4,
    border: 'none',
    background: 'transparent',
    color: cssVar('textTertiary'),
    cursor: 'pointer',
    padding: 0,
    flexShrink: 0,
  },
  renameInput: {
    flex: 1,
    minWidth: 0,
    background: cssVar('bgElevated'),
    border: `1px solid ${cssVar('primary')}`,
    borderRadius: 6,
    color: cssVar('text'),
    fontSize: 13,
    padding: '4px 6px',
    outline: 'none',
    fontFamily: 'inherit',
  },
  footer: {
    flexShrink: 0,
    padding: '8px',
    borderTop: `1px solid ${cssVar('borderSubtle')}`,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  consoleLink: {
    display: 'flex',
    alignItems: 'center',
    gap: 7,
    padding: '8px 10px',
    borderRadius: 8,
    color: cssVar('textTertiary'),
    fontSize: 12,
    fontWeight: 600,
    textDecoration: 'none',
    transition: cssVar('transition'),
    minWidth: 0,
    flex: 1,
  },
  themeBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 32,
    height: 32,
    borderRadius: 8,
    border: `1px solid ${cssVar('borderSubtle')}`,
    background: 'transparent',
    color: cssVar('textTertiary'),
    cursor: 'pointer',
    padding: 0,
    transition: cssVar('transition'),
    flexShrink: 0,
  },
};

function IconPlus() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function IconGallery() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" />
    </svg>
  );
}

function IconFolder() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  );
}

function IconArrowLeft() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 12H5" /><path d="M12 19l-7-7 7-7" />
    </svg>
  );
}

function ThemeToggleButton({ style }: { style?: CSSProperties }) {
  const [theme, setThemeState] = useState<ThemeName>(() => getStoredTheme());

  useEffect(() => {
    const syncTheme = () => setThemeState(getStoredTheme());
    window.addEventListener('storage', syncTheme);
    window.addEventListener('airgate-theme-change', syncTheme);
    return () => {
      window.removeEventListener('storage', syncTheme);
      window.removeEventListener('airgate-theme-change', syncTheme);
    };
  }, []);

  const toggleTheme = () => {
    const current = getStoredTheme();
    const next: ThemeName = current === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.classList.toggle('light', next === 'light');
    document.documentElement.classList.toggle('dark', next === 'dark');
    setThemeState(next);
    window.dispatchEvent(new Event('airgate-theme-change'));
  };
  return (
    <button
      type="button"
      style={{ ...s.themeBtn, ...style }}
      className="studio-console-link"
      onClick={toggleTheme}
      title={theme === 'dark' ? '浅色模式' : '深色模式'}
      aria-label="切换主题"
    >
      {theme === 'dark' ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" /><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" /><line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" /><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      )}
    </button>
  );
}

export { ThemeToggleButton };

export function ProjectSidebar() {
  const { t } = useTranslation();
  const { projects, activeProjectId, selectProject, createProject, renameProject, deleteProject } = useStudio();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draftName, setDraftName] = useState('');

  const startRename = (id: number, current: string) => {
    setEditingId(id);
    setDraftName(current);
  };

  const commitRename = async (id: number) => {
    const name = draftName.trim();
    setEditingId(null);
    if (name) {
      try { await renameProject(id, name); } catch { /* ignore */ }
    }
  };

  const handleDelete = async (id: number, name: string) => {
    const ok = window.confirm(t('playground.studio_project_delete_confirm', { defaultValue: `删除项目「${name}」？项目内的图片记录会一并移除（原图不受影响）。`, name }));
    if (!ok) return;
    try { await deleteProject(id); } catch { /* ignore */ }
  };

  return (
    <div style={s.sidebar} className="studio-project-sidebar">
      <div style={s.header}>
        <span style={s.title}>{t('playground.studio_projects', { defaultValue: '项目' })}</span>
        <button
          type="button"
          style={s.addBtn}
          className="studio-console-link"
          title={t('playground.studio_project_new', { defaultValue: '新建项目' })}
          onClick={() => void createProject()}
        >
          <IconPlus />
        </button>
      </div>
      <div style={s.list}>
        {/* 全部视图：聚合历史（含老用户旧图） */}
        <div
          style={{ ...s.item, ...(activeProjectId === 0 ? s.itemActive : {}) }}
          className="studio-project-item"
          onClick={() => selectProject(0)}
        >
          <IconGallery />
          <span style={s.itemName}>{t('playground.studio_all_works', { defaultValue: '全部作品' })}</span>
        </div>

        {projects.map(p => {
          const active = p.id === activeProjectId;
          return (
            <div
              key={p.id}
              style={{ ...s.item, ...(active ? s.itemActive : {}) }}
              className="studio-project-item"
              onClick={() => editingId === p.id ? undefined : selectProject(p.id)}
            >
              <IconFolder />
              {editingId === p.id ? (
                <input
                  style={s.renameInput}
                  value={draftName}
                  autoFocus
                  onChange={e => setDraftName(e.target.value)}
                  onBlur={() => void commitRename(p.id)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') void commitRename(p.id);
                    if (e.key === 'Escape') setEditingId(null);
                  }}
                  onClick={e => e.stopPropagation()}
                />
              ) : (
                <>
                  <span style={s.itemName}>{p.name}</span>
                  {active && (
                    <>
                      <button
                        type="button"
                        style={s.itemAction}
                        title={t('playground.studio_project_rename', { defaultValue: '重命名' })}
                        onClick={e => { e.stopPropagation(); startRename(p.id, p.name); }}
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        style={s.itemAction}
                        title={t('playground.studio_project_delete', { defaultValue: '删除' })}
                        onClick={e => { e.stopPropagation(); void handleDelete(p.id, p.name); }}
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                        </svg>
                      </button>
                    </>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
      <div style={s.footer}>
        <a
          href="/"
          style={s.consoleLink}
          className="studio-console-link"
          title={t('playground.studio_back_console', { defaultValue: '返回控制台' })}
        >
          <IconArrowLeft />
          <span style={s.itemName}>{t('playground.studio_back_console', { defaultValue: '返回控制台' })}</span>
        </a>
        <ThemeToggleButton />
      </div>
    </div>
  );
}
