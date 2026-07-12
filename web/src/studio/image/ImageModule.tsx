import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { cssVar } from '@doudou-start/airgate-theme';
import type { ImageMode } from '../types';
import { useStudio } from '../StudioContext';
import { TextToImagePanel } from './TextToImagePanel';
import { ImageToImagePanel } from './ImageToImagePanel';
import { InpaintPanel } from './InpaintPanel';
import { BatchPanel } from './BatchPanel';

// ── Styles ──────────────────────────────────────────────────────────────────

const s: Record<string, CSSProperties> = {
  tabBar: {
    display: 'flex',
    gap: 2,
    padding: '3px',
    background: cssVar('bgDeep'),
    borderRadius: 10,
    marginBottom: 14,
    margin: '0 12px 14px',
  },
  tab: {
    flex: '1 1 auto',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '7px 6px',
    border: 'none',
    borderRadius: 8,
    background: 'transparent',
    color: cssVar('textTertiary'),
    cursor: 'pointer',
    fontSize: 12,
    fontFamily: 'inherit',
    fontWeight: 500,
    transition: 'all 0.18s cubic-bezier(0.4, 0, 0.2, 1)',
    whiteSpace: 'nowrap',
  },
  tabActive: {
    flex: '1 1 auto',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '7px 6px',
    border: 'none',
    borderRadius: 8,
    background: cssVar('bgHover'),
    color: cssVar('text'),
    cursor: 'pointer',
    fontSize: 12,
    fontFamily: 'inherit',
    fontWeight: 700,
    transition: 'all 0.18s cubic-bezier(0.4, 0, 0.2, 1)',
    whiteSpace: 'nowrap',
    boxShadow: '0 1px 4px rgba(0, 0, 0, 0.12)',
  },
  panelWrap: {
    padding: '0 12px',
  },
};

// ── Types ───────────────────────────────────────────────────────────────────

interface TabDef {
  mode: ImageMode;
  labelKey: string;
}

const TABS: TabDef[] = [
  { mode: 'text2img', labelKey: 'playground.studio_mode_text2img' },
  { mode: 'img2img',  labelKey: 'playground.studio_mode_img2img' },
  { mode: 'inpaint',  labelKey: 'playground.studio_mode_inpaint' },
  { mode: 'batch',    labelKey: 'playground.studio_mode_batch' },
];

// ── ImageModule ─────────────────────────────────────────────────────────────

export function ImageModule() {
  const { t } = useTranslation();
  const { imageMode, setImageMode } = useStudio();

  return (
    <>
      <div style={s.tabBar}>
        {TABS.map(tab => (
          <button
            key={tab.mode}
            type="button"
            style={imageMode === tab.mode ? s.tabActive : s.tab}
            className="studio-mode-tab"
            onClick={() => setImageMode(tab.mode)}
          >
            {t(tab.labelKey)}
          </button>
        ))}
      </div>

      <div style={s.panelWrap}>
        {imageMode === 'text2img' && <TextToImagePanel />}
        {imageMode === 'img2img'  && <ImageToImagePanel />}
        {imageMode === 'inpaint'  && <InpaintPanel />}
        {imageMode === 'batch'    && <BatchPanel />}
      </div>
    </>
  );
}
