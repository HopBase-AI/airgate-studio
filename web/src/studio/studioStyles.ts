import type { CSSProperties } from 'react';
import { cssVar } from '@doudou-start/airgate-theme';

export const studioStyles: Record<string, CSSProperties> = {
  // ── Layout ────────────────────────────────────────────────────────────────

  layout: {
    position: 'fixed',
    top: 0,
    left: 0,
    width: '100vw',
    height: '100vh',
    display: 'flex',
    flexDirection: 'row',
    background: cssVar('bgElevated'),
    color: cssVar('text'),
    fontFamily: cssVar('fontSans'),
    overflow: 'hidden',
  },

  // ── Sidebar ───────────────────────────────────────────────────────────────

  sidebar: {
    width: 320,
    minWidth: 320,
    maxWidth: 320,
    height: '100%',
    alignSelf: 'stretch',
    display: 'flex',
    flexDirection: 'column',
    background: cssVar('glass'),
    backdropFilter: 'blur(24px) saturate(1.2)',
    WebkitBackdropFilter: 'blur(24px) saturate(1.2)',
    borderLeft: `1px solid ${cssVar('glassBorder')}`,
    overflowY: 'auto',
    overflowX: 'hidden',
    flexShrink: 0,
    boxShadow: `-1px 0 32px rgba(0, 0, 0, 0.3)`,
  },

  sidebarHeader: {
    padding: '14px 14px 6px 14px',
    fontSize: 10,
    fontWeight: 800,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    color: cssVar('textTertiary'),
    fontFamily: cssVar('fontMono'),
    userSelect: 'none',
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },

  // ── Media type selector ───────────────────────────────────────────────────

  mediaTypeRow: {
    display: 'flex',
    gap: 6,
    padding: '8px 16px 16px',
  },

  mediaTypeBtn: {
    flex: 1,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 36,
    padding: '0 12px',
    border: `1px solid ${cssVar('borderSubtle')}`,
    borderRadius: 10,
    background: 'transparent',
    color: cssVar('textSecondary'),
    fontSize: 12,
    fontWeight: 500,
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
    whiteSpace: 'nowrap',
  },

  mediaTypeBtnActive: {
    background: cssVar('primarySubtle'),
    borderColor: `color-mix(in oklab, ${cssVar('primary')} 30%, transparent)`,
    color: cssVar('text'),
    fontWeight: 600,
    boxShadow: `0 0 16px ${cssVar('primaryGlow')}`,
  },

  mediaTypeBtnDisabled: {
    opacity: 0.3,
    cursor: 'not-allowed',
    pointerEvents: 'none',
  },

  // ── Mode tabs (text2img / img2img / inpaint / batch) ──────────────────────

  modeTabRow: {
    display: 'flex',
    gap: 2,
    padding: '0 16px 14px',
    flexWrap: 'wrap',
  },

  modeTab: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: 30,
    padding: '0 14px',
    border: 'none',
    borderRadius: 8,
    background: 'transparent',
    color: cssVar('textTertiary'),
    fontSize: 12,
    fontWeight: 500,
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'all 0.18s cubic-bezier(0.4, 0, 0.2, 1)',
    whiteSpace: 'nowrap',
  },

  modeTabActive: {
    background: cssVar('bgHover'),
    color: cssVar('text'),
    fontWeight: 700,
    boxShadow: '0 1px 4px rgba(0, 0, 0, 0.15)',
  },

  // ── Panel body ────────────────────────────────────────────────────────────

  panelBody: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
    padding: '4px 16px 80px',
    overflowY: 'auto',
    overflowX: 'hidden',
  },

  // ── Shared form controls ──────────────────────────────────────────────────

  formLabel: {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: '0.08em',
    color: cssVar('textTertiary'),
    textTransform: 'uppercase',
    fontFamily: cssVar('fontMono'),
    marginBottom: 6,
    display: 'block',
    userSelect: 'none',
  },

  formRow: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },

  formTextarea: {
    width: '100%',
    minHeight: 88,
    maxHeight: 200,
    padding: '12px 14px',
    border: `1px solid ${cssVar('borderSubtle')}`,
    borderRadius: 10,
    background: cssVar('bgDeep'),
    color: cssVar('text'),
    fontSize: 13,
    fontFamily: 'inherit',
    resize: 'vertical',
    outline: 'none',
    lineHeight: 1.55,
    boxSizing: 'border-box',
    transition: 'border-color 0.2s, box-shadow 0.2s',
  },

  formInput: {
    width: '100%',
    height: 36,
    padding: '0 12px',
    border: `1px solid ${cssVar('borderSubtle')}`,
    borderRadius: 10,
    background: cssVar('bgDeep'),
    color: cssVar('text'),
    fontSize: 12,
    fontFamily: 'inherit',
    outline: 'none',
    boxSizing: 'border-box',
    transition: 'border-color 0.2s, box-shadow 0.2s',
  },

  formSelect: {
    width: '100%',
    height: 36,
    padding: '0 12px',
    border: `1px solid ${cssVar('borderSubtle')}`,
    borderRadius: 10,
    background: cssVar('bgDeep'),
    color: cssVar('text'),
    fontSize: 12,
    fontFamily: 'inherit',
    outline: 'none',
    cursor: 'pointer',
    appearance: 'none',
    boxSizing: 'border-box',
    transition: 'border-color 0.2s, box-shadow 0.2s',
  },

  formCountGroup: {
    display: 'flex',
    gap: 6,
  },

  formCountBtn: {
    flex: 1,
    padding: '7px 0',
    border: `1px solid ${cssVar('borderSubtle')}`,
    borderRadius: 8,
    background: 'transparent',
    color: cssVar('textSecondary'),
    cursor: 'pointer',
    fontSize: 13,
    fontFamily: 'inherit',
    fontVariantNumeric: 'tabular-nums',
    transition: 'all 0.18s cubic-bezier(0.4, 0, 0.2, 1)',
  },

  formCountBtnActive: {
    flex: 1,
    padding: '7px 0',
    border: `1px solid color-mix(in oklab, ${cssVar('primary')} 40%, transparent)`,
    borderRadius: 8,
    background: cssVar('primarySubtle'),
    color: cssVar('text'),
    cursor: 'pointer',
    fontSize: 13,
    fontFamily: 'inherit',
    fontWeight: 600,
    fontVariantNumeric: 'tabular-nums',
    boxShadow: `0 0 12px ${cssVar('primaryGlow')}`,
    transition: 'all 0.18s cubic-bezier(0.4, 0, 0.2, 1)',
  },

  formGenerateBtn: {
    width: '100%',
    padding: '11px 0',
    border: 'none',
    borderRadius: 10,
    background: cssVar('primary'),
    color: cssVar('primaryForeground'),
    fontSize: 13,
    fontWeight: 700,
    fontFamily: 'inherit',
    cursor: 'pointer',
    transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
    letterSpacing: '0.02em',
    marginTop: 6,
    position: 'relative',
    overflow: 'hidden',
  },

  formGenerateBtnDisabled: {
    width: '100%',
    padding: '11px 0',
    border: `1px solid ${cssVar('borderSubtle')}`,
    borderRadius: 10,
    background: 'transparent',
    color: cssVar('textTertiary'),
    fontSize: 13,
    fontWeight: 700,
    fontFamily: 'inherit',
    cursor: 'not-allowed',
    opacity: 0.5,
    marginTop: 6,
    letterSpacing: '0.02em',
  },

  formUploadArea: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 100,
    padding: '20px 16px',
    border: `1.5px dashed ${cssVar('borderSubtle')}`,
    borderRadius: 12,
    background: 'transparent',
    color: cssVar('textTertiary'),
    fontSize: 12,
    cursor: 'pointer',
    transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
    textAlign: 'center',
    userSelect: 'none',
  },

  formUploadAreaDragging: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 100,
    padding: '20px 16px',
    border: `1.5px dashed ${cssVar('primary')}`,
    borderRadius: 12,
    background: cssVar('primarySubtle'),
    color: cssVar('text'),
    fontSize: 12,
    cursor: 'pointer',
    transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
    textAlign: 'center',
    userSelect: 'none',
  },

  formHint: {
    fontSize: 11,
    color: cssVar('textTertiary'),
    marginTop: 2,
    fontFamily: cssVar('fontMono'),
  },

  // ── Upload area ───────────────────────────────────────────────────────────

  uploadArea: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 100,
    padding: '16px 12px',
    border: `1.5px dashed ${cssVar('borderSubtle')}`,
    borderRadius: 12,
    background: 'transparent',
    color: cssVar('textTertiary'),
    fontSize: 12,
    cursor: 'pointer',
    transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
    textAlign: 'center',
    userSelect: 'none',
  },

  uploadPreview: {
    position: 'relative',
    width: '100%',
    borderRadius: 12,
    overflow: 'hidden',
    background: cssVar('bgDeep'),
    border: `1px solid ${cssVar('borderSubtle')}`,
    aspectRatio: '1 / 1',
  },

  uploadPreviewImg: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    display: 'block',
  },

  // ── Generate button ───────────────────────────────────────────────────────

  generateBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    width: '100%',
    height: 42,
    border: 'none',
    borderRadius: 10,
    background: cssVar('primary'),
    color: cssVar('primaryForeground'),
    fontSize: 13,
    fontWeight: 700,
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
    letterSpacing: '0.02em',
    flexShrink: 0,
    position: 'relative',
    overflow: 'hidden',
  },

  generateBtnDisabled: {
    opacity: 0.35,
    cursor: 'not-allowed',
    pointerEvents: 'none',
  },

  // ── Slider ────────────────────────────────────────────────────────────────

  slider: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },

  sliderLabel: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: 11,
    color: cssVar('textSecondary'),
    fontWeight: 500,
  },

  sliderInput: {
    width: '100%',
    cursor: 'pointer',
    accentColor: cssVar('primary'),
  },

  // ── Gallery (left pane) ───────────────────────────────────────────────────

  gallery: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    width: '100%',
    overflowY: 'auto',
    overflowX: 'hidden',
    padding: '20px',
    boxSizing: 'border-box',
    background: cssVar('bgElevated'),
  } as CSSProperties,

  galleryGrid: {
    columns: '200px',
    columnGap: 14,
    width: '100%',
  } as CSSProperties,

  galleryEmpty: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    minHeight: 400,
    color: cssVar('textTertiary'),
    fontSize: 13,
    textAlign: 'center',
    userSelect: 'none',
  },

  galleryCard: {
    position: 'relative',
    borderRadius: 14,
    overflow: 'hidden',
    background: cssVar('bgElevated'),
    border: `1px solid ${cssVar('borderSubtle')}`,
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08), 0 1px 3px rgba(0, 0, 0, 0.06)',
    cursor: 'pointer',
    display: 'flex',
    flexDirection: 'column',
    marginBottom: 14,
    breakInside: 'avoid',
    transition: 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
  } as CSSProperties,

  galleryCardImg: {
    width: '100%',
    objectFit: 'cover',
    display: 'block',
  },

  galleryCardOverlay: {
    display: 'flex',
    flexDirection: 'column',
    gap: 7,
    padding: '8px 10px',
    background: cssVar('bgElevated'),
  } as CSSProperties,

  galleryCardMetaRow: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  } as CSSProperties,

  galleryCardMetaItem: {
    display: 'inline-flex',
    alignItems: 'center',
    fontSize: 10,
    lineHeight: 1.2,
    color: cssVar('textTertiary'),
    fontFamily: cssVar('fontMono'),
    whiteSpace: 'nowrap',
    letterSpacing: '0.01em',
  } as CSSProperties,

  galleryCardExpiryBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '2px 6px',
    borderRadius: 999,
    fontSize: 10,
    lineHeight: 1.2,
    fontWeight: 600,
    whiteSpace: 'nowrap',
    letterSpacing: '0.01em',
  } as CSSProperties,

  galleryCardExpiryBadgeWarning: {
    background: cssVar('warningSubtle'),
    color: cssVar('warning'),
    border: `1px solid color-mix(in oklab, ${cssVar('warning')} 22%, transparent)`,
  } as CSSProperties,

  galleryCardExpiryBadgeDanger: {
    background: cssVar('dangerSubtle'),
    color: cssVar('danger'),
    border: `1px solid color-mix(in oklab, ${cssVar('danger')} 22%, transparent)`,
  } as CSSProperties,

  galleryCardPrompt: {
    fontSize: 11,
    color: cssVar('textTertiary'),
    lineHeight: 1.45,
    overflow: 'hidden',
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical',
    letterSpacing: '0.01em',
  },

  galleryCardActions: {
    display: 'flex',
    gap: 6,
  },

  galleryCardActionBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 28,
    height: 28,
    padding: 0,
    border: `1px solid ${cssVar('borderSubtle')}`,
    borderRadius: 7,
    background: 'transparent',
    color: cssVar('textTertiary'),
    cursor: 'pointer',
    transition: 'background 0.15s, color 0.15s',
  },

  // ── Quick input bar (floating) ────────────────────────────────────────────

  quickInput: {
    position: 'absolute',
    bottom: 20,
    left: 20,
    right: 20,
    maxWidth: 900,
    margin: '0 auto',
    zIndex: 10,
    display: 'flex',
    alignItems: 'flex-end',
    gap: 10,
    padding: '12px 16px',
    borderRadius: 16,
    background: cssVar('glass'),
    backdropFilter: 'blur(24px) saturate(1.2)',
    WebkitBackdropFilter: 'blur(24px) saturate(1.2)',
    border: `1px solid ${cssVar('glassBorder')}`,
    boxShadow: '0 8px 40px rgba(0, 0, 0, 0.4), 0 2px 12px rgba(0, 0, 0, 0.2)',
    transition: 'box-shadow 0.3s',
  },

  quickInputTextarea: {
    flex: 1,
    minHeight: 24,
    maxHeight: 120,
    padding: 0,
    border: 'none',
    background: 'transparent',
    color: cssVar('text'),
    fontSize: 13,
    fontFamily: 'inherit',
    resize: 'none',
    outline: 'none',
    lineHeight: 1.5,
  },

  quickInputSendBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 36,
    height: 36,
    border: 'none',
    borderRadius: 10,
    background: cssVar('primary'),
    color: cssVar('primaryForeground'),
    cursor: 'pointer',
    flexShrink: 0,
    padding: 0,
    transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
    boxShadow: `0 0 16px ${cssVar('primaryGlow')}`,
  },

  // ── Section divider ───────────────────────────────────────────────────────

  sectionDivider: {
    height: 1,
    margin: '4px 16px',
    background: `linear-gradient(to right, transparent, ${cssVar('borderSubtle')}, transparent)`,
    flexShrink: 0,
  },

  // ── Badge ─────────────────────────────────────────────────────────────────

  badge: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: 18,
    padding: '0 6px',
    borderRadius: 5,
    background: cssVar('bgHover'),
    color: cssVar('textTertiary'),
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    flexShrink: 0,
    fontFamily: cssVar('fontMono'),
  },

  badgeProcessing: {
    background: cssVar('primarySubtle'),
    color: cssVar('primary'),
  },

  badgeCompleted: {
    background: 'rgba(74, 222, 128, 0.12)',
    color: '#4ade80',
  },

  badgeFailed: {
    background: 'rgba(248, 113, 113, 0.12)',
    color: '#f87171',
  },

  // ── Preview overlay ───────────────────────────────────────────────────────

  previewOverlay: {
    position: 'fixed',
    inset: 0,
    zIndex: 1000,
    background: 'rgba(0, 0, 0, 0.75)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  },

  previewStage: {
    width: 'min(92vw, 1280px)',
    height: 'min(76vh, 860px)',
    overflow: 'auto',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    boxSizing: 'border-box',
  },

  previewOverlayImg: {
    maxWidth: '60vw',
    maxHeight: '65vh',
    borderRadius: 12,
    objectFit: 'contain',
    boxShadow: '0 12px 40px rgba(0, 0, 0, 0.5)',
    cursor: 'default',
  },

  previewToolbar: {
    position: 'absolute',
    top: 20,
    left: '50%',
    transform: 'translateX(-50%)',
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: 5,
    borderRadius: 12,
    background: 'rgba(255, 255, 255, 0.08)',
    border: '1px solid rgba(255, 255, 255, 0.12)',
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
    color: '#fff',
    cursor: 'default',
  },

  previewZoomBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 30,
    height: 28,
    border: 'none',
    borderRadius: 8,
    background: 'transparent',
    color: '#fff',
    cursor: 'pointer',
    fontSize: 14,
    fontWeight: 700,
    fontFamily: 'inherit',
  },

  previewZoomLabel: {
    minWidth: 42,
    textAlign: 'center',
    color: 'rgba(255,255,255,0.72)',
    fontSize: 11,
    fontFamily: cssVar('fontMono'),
    userSelect: 'none',
  },

  previewCloseBtn: {
    position: 'absolute',
    top: 20,
    right: 20,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 40,
    height: 40,
    border: '1px solid rgba(255, 255, 255, 0.12)',
    borderRadius: 12,
    background: 'rgba(255, 255, 255, 0.08)',
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
    color: '#fff',
    fontSize: 20,
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'background 0.15s',
  },

  // ── Advanced workflow link ─────────────────────────────────────────────────

  advancedLink: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    padding: '10px 16px 14px',
    fontSize: 11,
    fontWeight: 600,
    color: cssVar('textTertiary'),
    cursor: 'pointer',
    textDecoration: 'none',
    transition: 'color 0.15s',
    letterSpacing: '0.01em',
    userSelect: 'none',
  },
};

export const studioCSS = `
  .studio-gallery-card:hover {
    transform: translateY(-3px) scale(1.005);
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5), 0 4px 16px rgba(0, 0, 0, 0.3);
  }
  .studio-gallery-card:active {
    transform: translateY(-1px) scale(1.0);
  }

  .studio-gallery-action:hover {
    background: ${cssVar('bgHover')} !important;
    color: ${cssVar('text')} !important;
  }

  .studio-gen-btn:hover:not(:disabled) {
    opacity: 0.92;
    box-shadow: 0 0 24px ${cssVar('primaryGlow')};
    transform: translateY(-1px);
  }
  .studio-gen-btn:active:not(:disabled) {
    transform: translateY(0);
    opacity: 1;
  }

  .studio-send-btn:hover:not(:disabled) {
    transform: scale(1.06);
    box-shadow: 0 0 20px ${cssVar('primaryGlow')};
  }

  .studio-quick-input:focus-within {
    border-color: color-mix(in oklab, ${cssVar('primary')} 35%, transparent);
    box-shadow: 0 8px 40px rgba(0, 0, 0, 0.4), 0 2px 12px rgba(0, 0, 0, 0.2), 0 0 0 1px color-mix(in oklab, ${cssVar('primary')} 12%, transparent);
  }

  .studio-textarea:focus {
    border-color: color-mix(in oklab, ${cssVar('primary')} 30%, transparent) !important;
    box-shadow: 0 0 0 3px ${cssVar('primaryGlow')};
  }

  .studio-media-btn:hover:not(:disabled) {
    background: ${cssVar('bgHover')};
    border-color: ${cssVar('border')};
  }

  .studio-template-card:hover {
    border-color: ${cssVar('border')};
    transform: translateY(-2px);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
  }

  .studio-skill-pill:hover:not(:disabled) {
    border-color: ${cssVar('primary')};
    color: ${cssVar('text')};
    background: ${cssVar('bgHover')};
  }

  .studio-skill-preset:hover {
    background: ${cssVar('primarySubtle')};
  }

  .studio-console-link:hover {
    color: ${cssVar('text')} !important;
    background: ${cssVar('bgHover')};
  }

  .studio-mode-tab:hover {
    background: ${cssVar('bgHover')};
    color: ${cssVar('textSecondary')};
  }


  .studio-preview-close:hover {
    background: rgba(255, 255, 255, 0.16) !important;
  }

  .studio-count-btn:hover:not(.studio-count-active) {
    background: ${cssVar('bgHover')};
    border-color: ${cssVar('border')};
    color: ${cssVar('text')};
  }

  .studio-upload-area:hover {
    border-color: ${cssVar('border')};
    background: ${cssVar('bgHover')};
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  @keyframes studioFadeIn {
    from { opacity: 0; transform: translateY(8px) scale(0.97); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }

  @keyframes studioPulse {
    0%, 100% { opacity: 0.4; }
    50% { opacity: 1; }
  }

  @keyframes studioShimmer {
    0% { background-position: -200% 0; }
    100% { background-position: 200% 0; }
  }

  .studio-gallery-card {
    animation: studioFadeIn 0.35s cubic-bezier(0.4, 0, 0.2, 1) backwards;
  }

  .studio-sidebar::-webkit-scrollbar {
    width: 4px;
  }
  .studio-sidebar::-webkit-scrollbar-track {
    background: transparent;
  }
  .studio-sidebar::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.08);
    border-radius: 4px;
  }
  .studio-sidebar::-webkit-scrollbar-thumb:hover {
    background: rgba(255, 255, 255, 0.14);
  }

  .studio-gallery {
    scrollbar-width: none;
  }
  .studio-gallery::-webkit-scrollbar {
    display: none;
  }

  .studio-panel-projects {
    flex: 0 0 200px;
    overflow: hidden;
  }

  .studio-inspiration-drawer-backdrop {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    z-index: 60;
    opacity: 0;
    animation: studioFadeIn 0.2s ease forwards;
  }
  .studio-inspiration-drawer {
    position: absolute;
    top: 0;
    right: 0;
    height: 100%;
    width: 360px;
    max-width: 86vw;
    z-index: 61;
    background: ${cssVar('bgDeep')};
    border-left: 1px solid ${cssVar('borderSubtle')};
    box-shadow: -16px 0 48px rgba(0, 0, 0, 0.32);
    display: flex;
    flex-direction: column;
    transform: translateX(100%);
    animation: studioDrawerIn 0.22s cubic-bezier(0.4, 0, 0.2, 1) forwards;
  }
  @keyframes studioDrawerIn {
    to { transform: translateX(0); }
  }

  @media (max-width: 1023px) {
    .studio-mobile-tabs {
      display: flex !important;
    }
    [data-mobile-tab] {
      flex-direction: column !important;
    }
    [data-mobile-tab="create"] .studio-panel-projects {
      display: none !important;
    }
    [data-mobile-tab="projects"] .studio-panel-create {
      display: none !important;
    }
    .studio-panel-projects,
    .studio-panel-create {
      flex: 1 !important;
      min-height: 0 !important;
      width: 100% !important;
    }
    .studio-project-sidebar {
      width: 100% !important;
    }
    .studio-composer-toolbar-left {
      flex-wrap: wrap;
      gap: 4px !important;
      overflow: visible !important;
    }
    .studio-composer-toolbar-left .studio-size-picker {
      width: 140px !important;
    }
    .studio-hide-mobile {
      display: none !important;
    }
  }
`;
