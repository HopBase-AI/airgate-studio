import { useState, type CSSProperties, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { cssVar } from '@doudou-start/airgate-theme';
import { useStudio } from './StudioContext';

// 后端默认项目名硬编码简体中文（backend/internal/studio/service.go
// defaultProjectName）。这里只做展示层映射，不改数据：非中文界面把该字面量
// 换成本地化文案；重命名输入框仍回填原始 name，避免把翻译后的文本误存回库。
const UNTITLED_PROJECT_NAME = '未命名项目';

type Translate = (key: string, options?: Record<string, unknown>) => string;

export function displayProjectName(name: string, t: Translate): string {
  return name === UNTITLED_PROJECT_NAME
    ? t('playground.studio_untitled_project', { defaultValue: 'Untitled project' })
    : name;
}

const s: Record<string, CSSProperties> = {
  sidebar: {
    height: '100%',
    width: 200,
    minWidth: 200,
    display: 'flex',
    flexDirection: 'column',
    // 与画廊同底色:控制台图标栏已经是一条竖线,项目栏再来一条深色分区就成了「三栏线」
    background: cssVar('bgElevated'),
    borderRight: `1px solid ${cssVar('borderSubtle')}`,
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
    padding: '0 12px',
    gap: 8,
    marginBottom: 2,
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
    borderRadius: 6,
    cursor: 'pointer',
    color: cssVar('textSecondary'),
    fontSize: 13,
    transition: cssVar('transition'),
    border: '1px solid transparent',
    userSelect: 'none',
  },
  itemActive: {
    background: cssVar('bgHover'),
    color: cssVar('text'),
    fontWeight: 600,
  },
  // 当前项右侧的 6px 强调色圆点(HopBase 为橙),替代实心块与竖线
  itemDot: {
    width: 6,
    height: 6,
    flexShrink: 0,
    borderRadius: 999,
    background: 'var(--ag-accent, var(--ag-primary))',
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



// 同理：项目左栏不依赖 tasks，StudioLayout 每 2s 的重渲染不该带上它。
export const ProjectSidebar = memo(function ProjectSidebar() {
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
    const ok = window.confirm(t('playground.studio_project_delete_confirm', { name: displayProjectName(name, t) }));
    if (!ok) return;
    try { await deleteProject(id); } catch { /* ignore */ }
  };

  return (
    <div style={s.sidebar} className="studio-project-sidebar">
      <div style={s.header}>
        <span style={s.title}>{t('playground.studio_projects')}</span>
        <button
          type="button"
          style={s.addBtn}
          className="studio-console-link"
          title={t('playground.studio_project_new')}
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
          <span style={s.itemName}>{t('playground.studio_all_works')}</span>
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
                  <span style={s.itemName}>{displayProjectName(p.name, t)}</span>
                  {active && (
                    <>
                      <span aria-hidden="true" style={s.itemDot} />
                      <button
                        type="button"
                        style={s.itemAction}
                        title={t('playground.studio_project_rename')}
                        onClick={e => { e.stopPropagation(); startRename(p.id, p.name); }}
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        style={s.itemAction}
                        title={t('playground.studio_project_delete')}
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
    </div>
  );
});
