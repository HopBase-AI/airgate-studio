import type { ImageMode } from './types';

// SkillKind 决定技能触发后的行为。当前只开放 generate 类技能。
export type SkillKind = 'generate';

export interface SkillConfig {
  id: string;
  name: string;
  icon: string; // emoji，保持轻量、零额外资源
  kind: SkillKind;
  // generate 类技能用：目标生成模式
  mode?: ImageMode;
  // 是否需要参考图。没有图时前端会引导上传。
  needsImage: boolean;
  // generate 类技能的提示词包装：把用户输入（可空）包成完整 prompt。
  wrap?: (userInput: string) => string;
  // 简短的一句话说明，作为 tooltip。
  hint: string;
}

export const SKILL_REGISTRY: SkillConfig[] = [
  {
    id: 'style',
    name: '风格',
    icon: '🎨',
    kind: 'generate',
    mode: 'img2img',
    needsImage: true,
    hint: '把参考图迁移成指定艺术风格',
  },
  {
    id: 'bg',
    name: '换背景',
    icon: '🖼️',
    kind: 'generate',
    mode: 'img2img',
    needsImage: true,
    hint: '为参考图替换背景场景',
  },
];

// 风格迁移的预设风格选项（点开「风格」胶囊后的二级菜单）。
export interface StylePreset {
  id: string;
  label: string;
  prompt: string;
}

export const STYLE_PRESETS: StylePreset[] = [
  { id: 'watercolor', label: '水彩插画', prompt: 'Transform this image into a delicate watercolor illustration: soft washes, visible paper texture, loose expressive brush strokes, gentle color bleeding, airy negative space. Preserve the original subject, composition and colors.' },
  { id: 'anime', label: '日系动漫', prompt: 'Redraw this image in modern Japanese anime style: clean cel-shaded lines, vibrant flat colors, expressive eyes, soft gradient lighting, detailed background. Preserve the original subject, pose and composition.' },
  { id: 'oil', label: '厚涂油画', prompt: 'Repaint this image as a thick impasto oil painting: bold visible brush strokes, rich saturated pigments, dramatic chiaroscuro lighting, canvas texture, painterly edges. Preserve the original subject and composition.' },
  { id: '3d', label: '3D 渲染', prompt: 'Re-render this image as a polished 3D render: soft global illumination, subtle subsurface scattering, clean studio lighting, smooth materials, shallow depth of field, octane render quality. Preserve the original subject and composition.' },
  { id: 'pixel', label: '像素风', prompt: 'Convert this image into detailed retro pixel art: limited palette, crisp pixel grid, dithering for gradients, 16-bit game aesthetic. Preserve the original subject, silhouette and composition.' },
  { id: 'lineart', label: '线稿', prompt: 'Convert this image into a clean black-and-white line-art drawing: confident ink contours, minimal hatching, white background, no color fills. Preserve the original subject, proportions and composition.' },
];

// 换背景的预设场景。
export interface BgPreset {
  id: string;
  label: string;
  prompt: string;
}

export const BG_PRESETS: BgPreset[] = [
  { id: 'studio', label: '纯色影棚', prompt: 'Replace the background with a clean seamless studio backdrop, soft even product lighting, subtle floor reflection. Keep the main subject exactly as-is, perfectly cut out with natural edges.' },
  { id: 'nature', label: '自然户外', prompt: 'Replace the background with a bright natural outdoor scene: soft bokeh greenery, warm sunlight, shallow depth of field. Keep the main subject exactly as-is with natural lighting that matches the new scene.' },
  { id: 'marble', label: '大理石台面', prompt: 'Place the subject on an elegant white marble surface with a soft neutral background, premium product-photography lighting, gentle shadows. Keep the main subject exactly as-is.' },
  { id: 'gradient', label: '渐变背景', prompt: 'Replace the background with a smooth modern color gradient, soft studio lighting, minimal aesthetic. Keep the main subject exactly as-is with clean edges.' },
  { id: 'desk', label: '生活场景', prompt: 'Place the subject in a cozy lifestyle setting: warm wooden desk, soft window light, tasteful out-of-focus props. Keep the main subject exactly as-is, lighting harmonized with the scene.' },
];

export function getSkill(id: string): SkillConfig | undefined {
  return SKILL_REGISTRY.find(s => s.id === id);
}
