import { useTranslation } from 'react-i18next';
import { useStudio } from './StudioContext';
import { CustomSelect } from './CustomSelect';
import { formatImageGroupLabel, localizeRouteLabel, sanitizeVendorTokens } from './modelRoutes';
import { studioStyles as ss } from './studioStyles';

// 计费分组（通道）选择器：让用户在同平台的不同倍率分组间自选（高质量/低价等）。
// 只有一个可选分组时不渲染——没有选择余地，交给默认行为即可。
export function GroupSelector() {
  const { t, i18n } = useTranslation();
  const { imageGroups, selectedGroupId, setSelectedGroupId } = useStudio();

  if (imageGroups.length <= 1) return null;

  const options = imageGroups.map(g => ({
    value: String(g.id),
    label: localizeRouteLabel(formatImageGroupLabel(g), t, i18n.language),
    description: sanitizeVendorTokens(g.note?.trim() ?? '') || undefined,
  }));

  return (
    <div style={ss.formRow}>
      <label style={ss.formLabel}>
        {t('playground.studio_group')}
      </label>
      <CustomSelect
        value={selectedGroupId != null ? String(selectedGroupId) : ''}
        options={options}
        onChange={value => {
          const id = Number.parseInt(value, 10);
          if (Number.isFinite(id)) setSelectedGroupId(id);
        }}
      />
    </div>
  );
}
