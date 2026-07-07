import { useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { cssVar } from '@doudou-start/airgate-theme';
import { useStudio } from '../StudioContext';
import { CustomSelect } from '../CustomSelect';
import { SizeSelector } from '../SizeSelector';
import { GroupSelector } from '../GroupSelector';
import { MODEL_REGISTRY } from '../modelConfig';
import { studioStyles as ss } from '../studioStyles';

const modelBadge: CSSProperties = {
  padding: '9px 14px',
  borderRadius: 10,
  background: cssVar('bgDeep'),
  border: `1px solid ${cssVar('borderSubtle')}`,
  color: cssVar('text'),
  fontSize: 13,
  fontFamily: 'inherit',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
};

const modelDot: CSSProperties = {
  width: 6,
  height: 6,
  borderRadius: '50%',
  background: '#4ade80',
  flexShrink: 0,
  boxShadow: '0 0 6px rgba(74, 222, 128, 0.4)',
};

const COUNT_OPTIONS = [1, 2, 3, 4];

export function TextToImagePanel() {
  const { t } = useTranslation();
  const {
    currentModel,
    selectedModelId,
    setSelectedModelId,
    imageSize,
    setImageSize,
    imageGroupsLoaded,
    hasImageGroupsForModel,
    isGenerating,
    generate,
  } = useStudio();

  const [prompt, setPrompt] = useState('');
  const [count, setCount] = useState(1);
  const modelOptions = imageGroupsLoaded
    ? MODEL_REGISTRY.filter(model => hasImageGroupsForModel(model))
    : MODEL_REGISTRY;

  const canGenerate = prompt.trim().length > 0 && modelOptions.length > 0;

  const handleGenerate = () => {
    const trimmed = prompt.trim();
    if (!trimmed || isGenerating) return;
    const fireAll = async () => {
      for (let i = 0; i < count; i++) {
        generate(trimmed, { mode: 'text2img', count: 1 });
      }
    };
    void fireAll();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={ss.formRow}>
        <label style={ss.formLabel}>
          {t('playground.studio_prompt', { defaultValue: '提示词' })}
        </label>
        <textarea
          style={ss.formTextarea}
          className="studio-textarea"
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          placeholder={t('playground.studio_prompt_placeholder', { defaultValue: '描述你想生成的图片...' })}
          rows={4}
        />
      </div>

      <div style={ss.formRow}>
        <label style={ss.formLabel}>
          {t('playground.studio_model', { defaultValue: '模型' })}
        </label>
        {modelOptions.length === 1 ? (
          <div style={modelBadge}><span style={modelDot} />{currentModel.name}</div>
        ) : (
          <CustomSelect
            value={selectedModelId}
            options={modelOptions.map(m => ({ value: m.id, label: m.name }))}
            onChange={setSelectedModelId}
          />
        )}
      </div>

      <GroupSelector />

      <div style={ss.formRow}>
        <label style={ss.formLabel}>
          {t('playground.studio_size', { defaultValue: '尺寸' })}
        </label>
        <SizeSelector
          value={imageSize}
          sizes={currentModel.sizes}
          onChange={setImageSize}
        />
      </div>

      <div style={ss.formRow}>
        <label style={ss.formLabel}>
          {t('playground.studio_count', { defaultValue: '数量' })}
        </label>
        <div style={ss.formCountGroup}>
          {COUNT_OPTIONS.map(n => (
            <button
              key={n}
              type="button"
              style={count === n ? ss.formCountBtnActive : ss.formCountBtn}
              className={count === n ? 'studio-count-active' : 'studio-count-btn'}
              onClick={() => setCount(n)}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      <button
        type="button"
        style={canGenerate ? ss.formGenerateBtn : ss.formGenerateBtnDisabled}
        className={canGenerate ? 'studio-gen-btn' : ''}
        disabled={!canGenerate}
        onClick={handleGenerate}
      >
        {isGenerating
          ? t('playground.studio_generating', { defaultValue: '生成中...' })
          : t('playground.studio_generate', { defaultValue: '生成' })}
      </button>
    </div>
  );
}
