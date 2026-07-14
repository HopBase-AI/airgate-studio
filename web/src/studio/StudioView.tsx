import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type DragEvent, type ChangeEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { cssVar } from '@doudou-start/airgate-theme';
import { useStudio } from './StudioContext';
import { GalleryView } from './GalleryView';
import { studioStyles as ss, studioCSS } from './studioStyles';
import { SizeSelector } from './SizeSelector';
import { CustomSelect } from './CustomSelect';
import { EDIT_MODEL_REGISTRY, MODEL_REGISTRY } from './modelConfig';
import { VIDEO_MODEL_REGISTRY, VIDEO_DURATIONS, VIDEO_RATIOS, videoModelById, useVideoStrings } from './video/videoConfig';
import { ProjectSidebar, ThemeToggleButton } from './ProjectSidebar';
import { api, type InspirationCatalog, type InspirationItem } from '../api';

// ── Helpers ─────────────────────────────────────────────────────────────────

function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// ── MaskEditor (fullscreen overlay for drawing inpaint region) ──────────────

interface NormalizedRect { x: number; y: number; width: number; height: number }

function normalizeRect(
  sx: number, sy: number, ex: number, ey: number, cw: number, ch: number,
): NormalizedRect {
  if (cw <= 0 || ch <= 0) return { x: 0, y: 0, width: 0, height: 0 };
  const clamp = (value: number, max: number) => Math.max(0, Math.min(max, value));
  const x1 = clamp(sx, cw);
  const y1 = clamp(sy, ch);
  const x2 = clamp(ex, cw);
  const y2 = clamp(ey, ch);
  return {
    x: Math.min(x1, x2) / cw,
    y: Math.min(y1, y2) / ch,
    width: Math.abs(x2 - x1) / cw,
    height: Math.abs(y2 - y1) / ch,
  };
}

const me: Record<string, CSSProperties> = {
  overlay: {
    position: 'fixed', inset: 0, zIndex: 1100,
    background: 'rgba(0,0,0,0.82)',
    display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center',
    gap: 12, padding: 24,
  },
  hint: {
    fontSize: 12, color: 'rgba(255,255,255,0.5)',
    fontFamily: 'inherit', letterSpacing: '0.01em',
    userSelect: 'none',
  },
  canvas: {
    position: 'relative', borderRadius: 10, overflow: 'hidden',
    cursor: 'crosshair', userSelect: 'none', lineHeight: 0,
    boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
    margin: 'auto',
  },
  img: {
    display: 'block', maxWidth: '70vw', maxHeight: '60vh',
    objectFit: 'contain', pointerEvents: 'none',
  },
  stage: {
    width: 'min(92vw, 1280px)',
    height: 'min(72vh, 820px)',
    overflow: 'auto',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    boxSizing: 'border-box',
  },
  selRect: {
    position: 'absolute',
    border: '2px solid rgba(248,113,113,0.95)',
    background: 'rgba(248,113,113,0.32)',
    boxShadow: '0 0 0 9999px rgba(0,0,0,0.28), inset 0 0 0 1px rgba(255,255,255,0.65), 0 0 18px rgba(248,113,113,0.45)',
    borderRadius: 4, pointerEvents: 'none', boxSizing: 'border-box',
  } as CSSProperties,
  actions: {
    display: 'flex', gap: 8,
  },
  zoomBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '5px',
    borderRadius: 12,
    border: '1px solid rgba(255,255,255,0.12)',
    background: 'rgba(255,255,255,0.08)',
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
  },
  zoomBtn: {
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
  zoomLabel: {
    minWidth: 42,
    textAlign: 'center',
    color: 'rgba(255,255,255,0.72)',
    fontSize: 11,
    fontFamily: cssVar('fontMono'),
    userSelect: 'none',
  },
  btn: {
    padding: '8px 20px', border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 10, background: 'rgba(255,255,255,0.08)',
    color: '#fff', fontSize: 13, fontWeight: 600,
    cursor: 'pointer', fontFamily: 'inherit',
    transition: 'background 0.15s',
  },
  btnPrimary: {
    padding: '8px 20px', border: 'none',
    borderRadius: 10, background: cssVar('primary'),
    color: cssVar('primaryForeground'), fontSize: 13, fontWeight: 600,
    cursor: 'pointer', fontFamily: 'inherit',
    transition: 'opacity 0.15s',
  },
  btnDanger: {
    padding: '8px 20px', border: '1px solid rgba(248,113,113,0.3)',
    borderRadius: 10, background: 'transparent',
    color: '#f87171', fontSize: 13, fontWeight: 600,
    cursor: 'pointer', fontFamily: 'inherit',
    transition: 'background 0.15s',
    marginRight: 'auto',
  },
};

function MaskEditor({ src, selection: initialSelection, onConfirm, onClose, onDelete, maskingEnabled = true }: {
  src: string;
  selection: NormalizedRect | null;
  onConfirm: (sel: NormalizedRect | null) => void;
  onClose: () => void;
  onDelete?: () => void;
  maskingEnabled?: boolean;
}) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [sel, setSel] = useState<NormalizedRect | null>(initialSelection);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [liveRect, setLiveRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const zoomImage = useCallback((delta: number) => {
    setZoom(value => Math.max(0.5, Math.min(3, Math.round((value + delta) * 10) / 10)));
  }, []);

  useEffect(() => {
    const handleKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === '+' || e.key === '=') zoomImage(0.25);
      if (e.key === '-' || e.key === '_') zoomImage(-0.25);
      if (e.key === '0') setZoom(1);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose, zoomImage]);

  const getImageMetrics = useCallback(() => {
    const container = containerRef.current;
    const img = imgRef.current;
    if (!container || !img) return null;
    const containerRect = container.getBoundingClientRect();
    const imageRect = img.getBoundingClientRect();
    const originLeft = containerRect.left + container.clientLeft;
    const originTop = containerRect.top + container.clientTop;
    return {
      offsetX: imageRect.left - originLeft,
      offsetY: imageRect.top - originTop,
      width: imageRect.width,
      height: imageRect.height,
      imageRect,
    };
  }, []);

  const getRelPos = useCallback((e: ReactMouseEvent): { x: number; y: number } | null => {
    const metrics = getImageMetrics();
    if (!metrics || metrics.width <= 0 || metrics.height <= 0) return null;
    const clamp = (value: number, max: number) => Math.max(0, Math.min(max, value));
    return {
      x: clamp(e.clientX - metrics.imageRect.left, metrics.width),
      y: clamp(e.clientY - metrics.imageRect.top, metrics.height),
    };
  }, [getImageMetrics]);

  const toContainerRect = useCallback((rect: { x: number; y: number; w: number; h: number }) => {
    const metrics = getImageMetrics();
    if (!metrics) return null;
    return {
      left: metrics.offsetX + rect.x,
      top: metrics.offsetY + rect.y,
      width: rect.w,
      height: rect.h,
    };
  }, [getImageMetrics]);

  const onDown = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    const pos = getRelPos(e);
    if (!pos) return;
    e.preventDefault();
    setDragStart(pos);
    setLiveRect({ x: pos.x, y: pos.y, w: 0, h: 0 });
    setSel(null);
  }, [getRelPos]);

  const onMove = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    if (!dragStart) return;
    const pos = getRelPos(e);
    if (!pos) return;
    setLiveRect({
      x: Math.min(dragStart.x, pos.x), y: Math.min(dragStart.y, pos.y),
      w: Math.abs(pos.x - dragStart.x), h: Math.abs(pos.y - dragStart.y),
    });
  }, [dragStart, getRelPos]);

  const onUp = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    if (!dragStart) return;
    const pos = getRelPos(e);
    const metrics = getImageMetrics();
    if (!pos || !metrics) { setDragStart(null); setLiveRect(null); return; }
    const norm = normalizeRect(dragStart.x, dragStart.y, pos.x, pos.y, metrics.width, metrics.height);
    if (norm.width > 0.01 && norm.height > 0.01) setSel(norm);
    setDragStart(null);
    setLiveRect(null);
  }, [dragStart, getImageMetrics, getRelPos]);

  const overlay = (() => {
    const rect = liveRect
      ? toContainerRect(liveRect)
      : sel
        ? (() => {
            const metrics = getImageMetrics();
            if (!metrics) return null;
            return {
              left: metrics.offsetX + sel.x * metrics.width,
              top: metrics.offsetY + sel.y * metrics.height,
              width: sel.width * metrics.width,
              height: sel.height * metrics.height,
            };
          })()
        : null;
    if (!rect || (rect.width < 2 && rect.height < 2)) return null;
    return <div style={{ ...me.selRect, ...rect }} />;
  })();

  return (
    <div style={me.overlay} onClick={onClose}>
      {maskingEnabled && (
        <div style={me.hint}>{t('playground.edit_image_modal_hint')}</div>
      )}
      <div style={me.zoomBar} onClick={e => e.stopPropagation()}>
        <button type="button" style={me.zoomBtn} onClick={() => zoomImage(-0.25)} aria-label={t('playground.studio_zoom_out')}>−</button>
        <span style={me.zoomLabel}>{Math.round(zoom * 100)}%</span>
        <button type="button" style={me.zoomBtn} onClick={() => zoomImage(0.25)} aria-label={t('playground.studio_zoom_in')}>+</button>
        <button type="button" style={me.zoomBtn} onClick={() => setZoom(1)} aria-label={t('playground.studio_fit_screen')}>{t('playground.studio_fit')}</button>
      </div>
      <div
        style={{
          ...me.stage,
          alignItems: zoom > 1 ? 'flex-start' : 'center',
          justifyContent: zoom > 1 ? 'flex-start' : 'center',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div
          ref={containerRef}
          style={maskingEnabled ? me.canvas : { ...me.canvas, cursor: 'default' }}
          onMouseDown={maskingEnabled ? onDown : undefined}
          onMouseMove={maskingEnabled ? onMove : undefined}
          onMouseUp={maskingEnabled ? onUp : undefined}
          onMouseLeave={maskingEnabled ? onUp : undefined}
        >
          <img
            ref={imgRef}
            src={src}
            alt="source"
            style={{ ...me.img, maxWidth: `${70 * zoom}vw`, maxHeight: `${60 * zoom}vh` }}
          />
          {maskingEnabled && overlay}
        </div>
      </div>
      <div style={me.actions} onClick={e => e.stopPropagation()}>
        {onDelete && (
          <button type="button" style={me.btnDanger} onClick={onDelete}>{t('playground.studio_remove_image')}</button>
        )}
        {maskingEnabled && sel && (
          <button type="button" style={me.btn} onClick={() => setSel(null)}>{t('playground.studio_clear_selection')}</button>
        )}
        <button type="button" style={me.btn} onClick={onClose}>{maskingEnabled ? t('playground.cancel') : t('playground.studio_close')}</button>
        {maskingEnabled && (
          <button type="button" style={me.btnPrimary} onClick={() => onConfirm(sel)}>{t('common.confirm')}</button>
        )}
      </div>
    </div>
  );
}

// ── Templates ───────────────────────────────────────────────────────────────

interface Inspiration {
  id?: string;
  category: string;
  scenario?: string;
  title: string;
  description?: string;
  kind?: 'image' | 'prompt' | string;
  image?: string;
  prompt: string;
  tags?: string[];
  source?: string;
}

const INSPIRATIONS: Inspiration[] = [
  { id: 'local-skincare-diorama', category: 'ecommerce', title: 'skincare_diorama', image: '/plugins/airgate-studio/assets/inspirations/skincare-diorama.jpg', prompt: 'A hyper-realistic miniature diorama product advertisement featuring an oversized luxury skincare pump bottle placed on a circular platform. Tiny figurine construction workers in yellow coveralls and white hard hats swarm around the bottle — climbing scaffolding, painting with rollers, operating a tower crane, working near industrial tanks. Warm beige, cream, gold, mustard yellow palette. Studio photography, soft diffused lighting, clean beige background. Tilt-shift miniature aesthetic, ultra-detailed, commercial product photography, 8K resolution, photorealistic CGI render.' },
  { id: 'local-burger-storyboard', category: 'ecommerce', title: 'burger_storyboard', image: '/plugins/airgate-studio/assets/inspirations/burger-storyboard.jpg', prompt: 'Create a cinematic hero image of a gourmet cheeseburger on a dark stone surface with glossy brioche bun, melted cheese, crisp lettuce, tomato, grilled patty, sauce, realistic texture, appetizing steam, warm side light, shallow depth of field, premium food commercial style.' },
  { id: 'local-luxury-watch', category: 'advertising', title: 'luxury_watch', image: '/plugins/airgate-studio/assets/inspirations/luxury-watch.jpg', prompt: 'A dramatic luxury product advertising image for a motorsport-inspired chronograph wristwatch in a dark studio. Stainless steel chronograph watch at a three-quarter angle, black dial, red-accent subdials, tachymeter bezel. Black leather strap with bold red stitching. Deep black background with cinematic red and white horizontal light streaks suggesting speed. Glossy wet ground plane with reflective texture. Ultra-polished commercial product photography, luxury watch campaign.' },
  { id: 'local-chocolate-brand', category: 'advertising', title: 'chocolate_brand', image: '/plugins/airgate-studio/assets/inspirations/chocolate-brand.jpg', prompt: 'Create a premium square product advertisement for a fictional luxury chocolate brand. High-end editorial campaign combining luxury food photography, refined packaging design, and cinematic lighting. Matte black wrapper, subtle gold foil, elegant serif typography, realistic product rendering. Chocolate bar as hero centerpiece with subtle reflections, shallow depth of field, luxury minimalism.' },
  { id: 'local-burger-hero', category: 'advertising', title: 'burger_hero', image: '/plugins/airgate-studio/assets/inspirations/burger-hero.jpg', prompt: 'A cinematic 9:16 vertical composition featuring a gourmet burger. A towering burger with a charcoal brioche bun, thick Wagyu beef patty with visible sear marks, melting aged gruyère dripping like lava, crispy maple-glazed bacon. Dark moody lighting with warm amber spotlight. The burger in a "deconstructed gravity" moment — top bun slightly hovering. Ultra-bold distressed sans-serif typeface "DEFY GRAVITY". 4K resolution, macro photography, neon-noir color grading.' },
  { id: 'local-matcha-granola', category: 'advertising', title: 'matcha_granola', image: '/plugins/airgate-studio/assets/inspirations/matcha-granola.jpg', prompt: 'Ultra-realistic premium food advertisement poster for a healthy breakfast granola brand, centered matte pouch packaging labeled "Matcha Oat Granola", green monochrome aesthetic, flat lay composition, soft studio lighting, vibrant matcha green background, surrounded by kiwi slices, almonds, oats, chia seeds, matcha powder bowl, granola bowls. Clean modern typography headline "SUPERFOOD MORNING BOWL". Luxury organic branding, 8K detail.' },
  { id: 'local-watercolor-fashion', category: 'portrait', title: 'watercolor_fashion', image: '/plugins/airgate-studio/assets/inspirations/watercolor-fashion.jpg', prompt: 'Transform the uploaded photo into a full-body watercolor fashion illustration in the style of an elegant runway design sketch. Preserve the original outfit, pose, silhouette, colors, fabrics. Use elongated fashion-sketch proportions, loose expressive ink lines, delicate pencil contour, transparent watercolor washes, soft shadows, painterly texture, minimalist editorial mood. White background, clean composition, full body centered.' },
  { id: 'local-retro-newsstand', category: 'portrait', title: 'retro_newsstand', image: '/plugins/airgate-studio/assets/inspirations/retro-newsstand.jpg', prompt: 'A cinematic fashion editorial scene of 8 diverse young adults gathered around a vintage urban newsstand kiosk with a bold "NEWSSTAND" sign. Gritty indoor street environment with worn concrete floors, dark industrial walls. Newspapers fly dynamically through the air with natural motion blur. Styled in coordinated 90s-inspired retro streetwear. Shot from slightly elevated angle, wide 35mm lens, soft cinematic lighting, high-end magazine aesthetic, 4K quality.' },
  { id: 'local-cafe-date', category: 'portrait', title: 'cafe_date', image: '/plugins/airgate-studio/assets/inspirations/cafe-date.jpg', prompt: 'Ultra-realistic cozy Japanese-Korean cafe photography featuring a cute young couple sitting together naturally in a trendy aesthetic cafe. Table beautifully filled with pancakes, strawberry cakes, macarons, croissants, iced coffees, matcha lattes. Cute scrapbook-style doodles and handwritten notes — tiny hearts, stars, sparkles, ribbons. Shallow depth of field, cinematic composition, ultra realistic food textures, 8K.' },
  { id: 'local-rainy-street', category: 'portrait', title: 'rainy_street', image: '/plugins/airgate-studio/assets/inspirations/rainy-street.jpg', prompt: 'Ultra-realistic cinematic street photography of a young man standing alone on a rainy urban sidewalk during golden hour sunset. Wearing oversized black hoodie, loose dark blue cargo jeans, clean white sneakers. Moody introspective vibe. Wide-angle composition with dramatic depth. Reflective rain-soaked street surface glowing with warm sunset light. Historic Gothic architecture visible. Shot on Sony A7R IV, 35mm lens, f/1.8, HDR photography, cinematic color grading, 8K ultra resolution.' },
  { id: 'local-peacock-art', category: 'poster', title: 'peacock_art', image: '/plugins/airgate-studio/assets/inspirations/peacock-art.jpg', prompt: 'Symmetrical design featuring two elegant blue peacocks with detailed feather patterns, surrounded by blue floral elements, intricate vintage botanical ornament, soft beige background, classical floral decor style with rich navy and sky blue details, decorative art illustration.' },
  { id: 'local-liquid-3d', category: 'poster', title: 'liquid_3d', image: '/plugins/airgate-studio/assets/inspirations/3d-liquid.jpg', prompt: 'A mesmerizing explosively colorful vertical poster featuring giant 3D liquid fluid sculpture forms. Enormous glossy morphing blob shapes — massive melting form in hot magenta pink flowing downward, intersecting with a giant swirling wave of electric cobalt blue, a third liquid mass in neon lime green curling upward. All three collide at center in a spectacular splash explosion with hundreds of flying colorful droplets frozen mid-air. Clean bright white background. Bold rounded white typography "LET IT FLOW".' },
  { id: 'local-creative-collage', category: 'poster', title: 'creative_collage', image: '/plugins/airgate-studio/assets/inspirations/collage-art.jpg', prompt: 'Transform the attached image into a collage artwork. Make it appear as if hand-torn from newspapers, magazines, and flyers and pasted. Every single expression completed using large torn pieces of paper. Represent in detail the torn edges, wrinkles, overlaps, and glue marks. Use relatively large pieces of paper placed randomly at different angles and directions. Create it to look like an actual collage roughly hand-pasted by a person.' },
  { id: 'local-isometric-travel', category: 'poster', title: 'isometric_travel', image: '/plugins/airgate-studio/assets/inspirations/isometric-travel.jpg', prompt: 'Design a vertical retro mid-century travel poster showcasing a city landmark. Stick to a tight 3-color scheme: cream-toned paper background, black technical line drawing, plus one accent color. Aesthetic: minimalist isometric top-down aerial perspective with very fine cross-hatching and silkscreen print grain. Zero gradients allowed. Large bold sans-serif city name at top.' },
  { id: 'local-miniature-travel', category: 'poster', title: 'miniature_travel', image: '/plugins/airgate-studio/assets/inspirations/miniature-travel.jpg', prompt: 'A cinematic hyper-detailed miniature travel diorama resting inside an open human palm. A realistic passport and official travel visa card stand upright in the center of a tiny landscape, surrounded by miniature travelers with luggage, scattered suitcases, local vegetation, iconic cultural elements. Famous skyline and landmarks rise softly with atmospheric depth. A commercial airplane flies overhead in bright blue sky. Ultra-realistic textures, shallow depth of field, warm sunlight, macro photography style, tilt-shift miniature effect.' },
  { id: 'local-dark-western', category: 'poster', title: 'dark_western', image: '/plugins/airgate-studio/assets/inspirations/dark-western.jpg', prompt: 'Dark cinematic western outlaw poster, vertical 2:3 composition. A mysterious masked cowboy with a black horse standing at a desert border. Wide-brim cowboy hat, patterned face cloth, dark leather jacket with multi-layer leather gear, bullet belt, revolver holster. Stormy desert background with lightning, dark clouds, canyon walls. Vintage parchment texture, ink splatters, wanted poster information, character profile, compass graphic, stamp seal. Ultra-detailed leather and metal textures, 8K.' },
  { id: 'local-wildlife-infographic', category: 'poster', title: 'wildlife_infographic', image: '/plugins/airgate-studio/assets/inspirations/wildlife-infographic.jpg', prompt: 'A premium cinematic wildlife infographic poster centered around a visually unique animal species. Ultra-detailed photorealistic fur, realistic eyes, moisture textures, cinematic shadows, powerful eye contact. Dense layered infographic storytelling: anatomy callouts, adaptation systems, prey and diet visuals, ecosystem overlays, conservation status, geographic range maps. Asymmetric editorial composition, premium typography, holographic UI elements. Cinematic documentary realism meets futuristic infographic design. 8K, museum-quality composition.' },
  { id: 'local-mecha-girl', category: 'character', title: 'mecha_girl', image: '/plugins/airgate-studio/assets/inspirations/mecha-girl.jpg', prompt: 'A mecha girl mid-teens, pale skin smudged with soot and salt spray, sharp amber eyes with glowing HUD reticles, waist-length ash-white hair tied in a high ponytail whipping in the sea wind, matte gunmetal exoskeleton armor plating her shoulders forearms and shins, exposed hydraulic pistons at the joints, chest rig with glowing cyan coolant lines, massive rail cannon resting on her right shoulder. Standing on rusted steel platform jutting out over dark water. Vast derelict sea-city at dusk, colossal megastructures rising from the ocean. Cinematic anime key visual, 16:9.' },
  { id: 'local-gta-market', category: 'character', title: 'gta_market', image: '/plugins/airgate-studio/assets/inspirations/gta-market.jpg', prompt: 'GTA 6 style artwork set in a vibrant Bangalore flower market in India. Bold stylized characters, dramatic poses, vivid colors, urban street energy mixed with traditional Indian market atmosphere. Game cover art composition, cinematic lighting, detailed environment.' },
  { id: 'local-anime-streetwear', category: 'character', title: 'anime_streetwear', image: '/plugins/airgate-studio/assets/inspirations/anime-streetwear.jpg', prompt: 'Stylized anime streetwear brand poster of a fast-food mascot character, full-body dynamic pose, highly detailed manga illustration, modern urban fashion outfit inspired by restaurant brand colors, oversized hoodie, tactical straps, sneakers, chains, branded accessories, holding signature food item. Bold graphic typography, editorial magazine layout, Japanese text elements, grunge textures, paint splashes. Collectible poster aesthetic, cyber street fashion meets commercial advertising, vibrant red/orange/black/white palette.' },
  { id: 'local-white-background-listing', category: 'ecommerce', scenario: 'product_hero', kind: 'prompt', title: 'white_background_listing', description: 'white_background_listing', tags: ['white_bg', 'listing', 'product_hero'], prompt: 'Create a clean e-commerce product listing image for [PRODUCT]. Center the product on a pure white background, accurate proportions, true-to-life materials, soft shadow directly under the product, crisp edges, no props, no text, no logo changes, commercial packshot photography, high-resolution, ready for marketplace listing.' },
  { id: 'local-lifestyle-product-scene', category: 'ecommerce', scenario: 'lifestyle', kind: 'prompt', title: 'lifestyle_product_scene', description: 'lifestyle_product_scene', tags: ['lifestyle', 'detail_page', 'scene'], prompt: 'Create a premium lifestyle product photo for [PRODUCT] used by [TARGET CUSTOMER] in a realistic [SCENE]. Keep the product clearly visible as the hero, natural hand placement if relevant, warm daylight, believable scale, editorial composition, shallow depth of field, aspirational but not stock-like, no text, no extra logos.' },
  { id: 'local-a-plus-detail-module', category: 'ecommerce', scenario: 'detail_page', kind: 'prompt', title: 'a_plus_detail_module', description: 'a_plus_detail_module', tags: ['a_plus', 'detail_page', 'benefits'], prompt: 'Design an Amazon A+ content visual for [PRODUCT] highlighting [BENEFIT]. Use a clean premium layout, product on one side, contextual background related to [USE CASE], subtle callout spaces without rendering text, organized negative space for copy placement, accurate product shape and material, commercial studio lighting.' },
  { id: 'local-benefit-infographic-background', category: 'ecommerce', scenario: 'benefit_graphic', kind: 'prompt', title: 'benefit_infographic_background', description: 'benefit_infographic_background', tags: ['benefit_graphic', 'infographic', 'detail_page'], prompt: 'Create a clean product benefit infographic background for [PRODUCT]. Show the product large and sharp, include 3-4 empty visual callout zones with subtle lines or icon placeholders but no readable text, use brand color accents [BRAND COLORS], bright commercial lighting, high clarity, suitable for adding Chinese copy later.' },
  { id: 'local-before-after-comparison', category: 'ecommerce', scenario: 'comparison', kind: 'prompt', title: 'before_after_comparison', description: 'before_after_comparison', tags: ['comparison', 'result_preview'], prompt: 'Create a split-screen before-and-after product result image for [PRODUCT]. Left side shows the problem state [BEFORE STATE], right side shows the improved state [AFTER STATE]. Keep lighting and perspective consistent, realistic transformation, clean divider space for labels added later, no text, no exaggerated impossible claims.' },
  { id: 'local-bundle-flatlay', category: 'ecommerce', scenario: 'bundle', kind: 'prompt', title: 'bundle_flatlay', description: 'bundle_flatlay', tags: ['flatlay', 'bundle', 'gift_box'], prompt: 'Create a top-down flatlay product bundle photo for [PRODUCT SET]. Arrange all items neatly with balanced spacing, premium textured background, soft natural shadows, coherent color palette, realistic packaging, clear view of every component, no text, commercial catalog photography.' },
  { id: 'local-social-ad-background', category: 'ecommerce', scenario: 'social_ad', kind: 'prompt', title: 'social_ad_background', description: 'social_ad_background', tags: ['xiaohongshu', 'tiktok', 'social_ad'], prompt: 'Create a 9:16 vertical social ad visual for [PRODUCT]. Product must be the first focal point, energetic composition, one strong use-case moment, space at top and bottom for copy overlays, modern direct-to-consumer brand aesthetic, bright but natural lighting, no generated text, no fake UI.' },
  { id: 'local-ugc-handheld', category: 'ecommerce', scenario: 'ugc', kind: 'prompt', title: 'ugc_handheld', description: 'ugc_handheld', tags: ['ugc', 'product_seeding', 'buyer_show'], prompt: 'Create a realistic UGC-style handheld photo of [PRODUCT] being used by [TARGET CUSTOMER]. Casual but polished framing, natural indoor light, slight phone-camera realism, authentic environment, product label readable only if supplied, no over-retouching, no text overlay, trustworthy review-photo mood.' },
  { id: 'local-ghost-mannequin', category: 'fashion', scenario: 'product_hero', kind: 'prompt', title: 'ghost_mannequin', description: 'ghost_mannequin', tags: ['fashion', 'product_hero', 'ghost_mannequin'], prompt: 'Create a ghost mannequin e-commerce photo for [GARMENT]. Show the garment floating naturally with correct structure and fit, front view, clean light gray or white studio background, accurate fabric texture, realistic folds, no human body visible, no text, premium fashion catalog lighting.' },
  { id: 'local-lookbook-model', category: 'fashion', scenario: 'model', kind: 'prompt', title: 'lookbook_model', description: 'lookbook_model', tags: ['lookbook', 'model', 'fashion'], prompt: 'Create an editorial lookbook image for [GARMENT] worn by [MODEL DESCRIPTION] in [SCENE]. Preserve garment details, natural pose, full-body composition, premium fashion photography, soft directional light, clean background, realistic fabric movement, no text or logos beyond the garment.' },
  { id: 'local-holiday-campaign-kv', category: 'advertising', scenario: 'holiday', kind: 'prompt', title: 'holiday_campaign_kv', description: 'holiday_campaign_kv', tags: ['promotion', 'festival', 'kv'], prompt: 'Create a premium seasonal campaign key visual for [PRODUCT] during [FESTIVAL OR SHOPPING EVENT]. Product centered as hero, festive but restrained props, brand color palette [BRAND COLORS], elegant commercial lighting, space for promotional copy, no generated text, high-end e-commerce campaign style.' },
];

// The Studio API serves the same built-in catalogue with durable IDs. Map its
// metadata to the local translation keys while keeping API-managed prompts and
// image URLs untouched.
const BUILT_IN_INSPIRATION_KEYS: Record<string, string> = {
  'ecommerce-skincare-diorama': 'skincare_diorama',
  'ecommerce-burger-storyboard': 'burger_storyboard',
  'ecommerce-white-background-packshot': 'white_background_listing',
  'ecommerce-lifestyle-hero': 'lifestyle_product_scene',
  'ecommerce-amazon-a-plus-module': 'a_plus_detail_module',
  'ecommerce-benefit-infographic': 'benefit_infographic_background',
  'ecommerce-before-after': 'before_after_comparison',
  'ecommerce-flatlay-bundle': 'bundle_flatlay',
  'ecommerce-social-ad-vertical': 'social_ad_background',
  'ecommerce-ugc-handheld': 'ugc_handheld',
  'fashion-watercolor-sketch': 'watercolor_fashion',
  'fashion-ghost-mannequin': 'ghost_mannequin',
  'fashion-model-lookbook': 'lookbook_model',
  'ad-luxury-watch': 'luxury_watch',
  'ad-chocolate-premium': 'chocolate_brand',
  'ad-burger-hero': 'burger_hero',
  'ad-matcha-granola': 'matcha_granola',
  'ad-festival-campaign': 'holiday_campaign_kv',
  'poster-peacock-floral': 'peacock_art',
  'poster-liquid-3d': 'liquid_3d',
  'poster-collage-art': 'creative_collage',
  'poster-isometric-travel': 'isometric_travel',
  'poster-miniature-travel': 'miniature_travel',
  'poster-dark-western': 'dark_western',
  'poster-wildlife-infographic': 'wildlife_infographic',
  'portrait-retro-newsstand': 'retro_newsstand',
  'portrait-cafe-date': 'cafe_date',
  'portrait-rainy-street': 'rainy_street',
  'character-mecha-girl': 'mecha_girl',
  'character-gta-market': 'gta_market',
  'character-anime-streetwear': 'anime_streetwear',
};

const BUILT_IN_INSPIRATION_METADATA = new Map(INSPIRATIONS.map(item => [item.title, item]));

// ── InspirationSidebar ─────────────────────────────────────────────────────────

const tpl: Record<string, CSSProperties> = {
  collapseBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 40,
    minWidth: 40,
    height: 40,
    border: 'none',
    borderRadius: cssVar('radiusSm'),
    background: 'transparent',
    color: cssVar('textSecondary'),
    cursor: 'pointer',
    padding: 0,
    transition: cssVar('transition'),
    flexShrink: 0,
  },
  catLabel: {
    fontSize: 10,
    fontWeight: 700,
    color: cssVar('textTertiary'),
    letterSpacing: '0.04em',
    padding: '8px 4px 6px',
    fontFamily: cssVar('fontMono'),
    opacity: 0.6,
  },
  sectionHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    padding: '8px 4px 6px',
  },
  catCount: {
    fontSize: 10,
    color: cssVar('textTertiary'),
    fontFamily: cssVar('fontMono'),
    opacity: 0.55,
  },
  grid: {
    columns: '160px',
    columnGap: 10,
  } as CSSProperties,
  card: {
    width: '100%',
    textAlign: 'left',
    borderRadius: 10,
    overflow: 'hidden',
    cursor: 'pointer',
    border: `1px solid ${cssVar('borderSubtle')}`,
    boxShadow: '0 1px 4px rgba(0, 0, 0, 0.06)',
    transition: 'all 0.15s',
    background: cssVar('bgElevated'),
    breakInside: 'avoid',
    marginBottom: 10,
    padding: 0,
    font: 'inherit',
    color: 'inherit',
  } as CSSProperties,
  promptCard: {
    width: '100%',
    textAlign: 'left',
    borderRadius: 10,
    cursor: 'pointer',
    border: `1px solid ${cssVar('borderSubtle')}`,
    boxShadow: '0 1px 4px rgba(0, 0, 0, 0.05)',
    transition: 'all 0.15s',
    background: cssVar('bgElevated'),
    breakInside: 'avoid',
    marginBottom: 10,
    padding: '10px 10px 9px',
    display: 'flex',
    flexDirection: 'column',
    gap: 7,
    font: 'inherit',
    color: 'inherit',
  } as CSSProperties,
  thumb: {
    width: '100%',
    height: 110,
    display: 'block',
    objectFit: 'cover',
    background: cssVar('bgDeep'),
  },
  cardBottom: {
    padding: '5px 8px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardLabel: {
    fontSize: 11,
    fontWeight: 600,
    color: cssVar('textSecondary'),
    letterSpacing: '0.01em',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  useBtn: {
    fontSize: 10,
    color: cssVar('primary'),
    fontWeight: 600,
    flexShrink: 0,
    cursor: 'pointer',
  },
  cardScenario: {
    fontSize: 10,
    color: cssVar('primary'),
    fontWeight: 700,
    fontFamily: cssVar('fontMono'),
  },
  cardDesc: {
    fontSize: 11,
    lineHeight: 1.45,
    color: cssVar('textTertiary'),
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical',
    overflow: 'hidden',
  },
  tagRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 4,
  },
  tag: {
    fontSize: 10,
    lineHeight: 1.2,
    padding: '2px 5px',
    borderRadius: 5,
    background: cssVar('bgHover'),
    color: cssVar('textTertiary'),
  },
  drawerTools: {
    padding: '10px 14px 8px',
    borderBottom: `1px solid ${cssVar('borderSubtle')}`,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    flexShrink: 0,
  },
  searchInput: {
    width: '100%',
    height: 34,
    padding: '0 10px',
    border: `1px solid ${cssVar('borderSubtle')}`,
    borderRadius: 8,
    background: cssVar('bgDeep'),
    color: cssVar('text'),
    fontSize: 12,
    outline: 'none',
    boxSizing: 'border-box',
    fontFamily: 'inherit',
  },
  filterRow: {
    display: 'flex',
    gap: 6,
    overflowX: 'auto',
    paddingBottom: 2,
  },
  filterBtn: {
    flexShrink: 0,
    height: 26,
    padding: '0 9px',
    border: `1px solid ${cssVar('borderSubtle')}`,
    borderRadius: 7,
    background: 'transparent',
    color: cssVar('textTertiary'),
    cursor: 'pointer',
    fontSize: 11,
    fontFamily: 'inherit',
    transition: 'all 0.15s',
  },
  filterBtnActive: {
    background: cssVar('primarySubtle'),
    border: `1px solid color-mix(in oklab, ${cssVar('primary')} 32%, transparent)`,
    color: cssVar('text'),
    fontWeight: 700,
  },
  emptyState: {
    padding: '28px 12px',
    textAlign: 'center',
    color: cssVar('textTertiary'),
    fontSize: 12,
    lineHeight: 1.5,
  },
  sourceNote: {
    fontSize: 10,
    color: cssVar('textTertiary'),
    opacity: 0.62,
    padding: '0 2px',
  },
  drawerHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '14px 16px 10px',
    borderBottom: `1px solid ${cssVar('borderSubtle')}`,
    flexShrink: 0,
  },
  drawerTitle: {
    fontSize: 14,
    fontWeight: 700,
    color: cssVar('text'),
    letterSpacing: '-0.01em',
  },
  drawerBody: {
    flex: 1,
    overflowY: 'auto',
    overflowX: 'hidden',
    padding: '12px 14px 24px',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
};

// ── TopNav (fixed global nav bar) ──────────────────────────────────────────

const floatNav: Record<string, CSSProperties> = {
  wrap: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 0 12px',
    flexShrink: 0,
  },
  btn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    padding: '5px 10px',
    borderRadius: 8,
    border: `1px solid ${cssVar('borderSubtle')}`,
    background: 'transparent',
    color: cssVar('textTertiary'),
    fontSize: 11,
    fontWeight: 500,
    textDecoration: 'none',
    fontFamily: 'inherit',
    cursor: 'pointer',
    transition: 'all 0.15s',
  },
  iconBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 28,
    height: 28,
    borderRadius: 8,
    border: `1px solid ${cssVar('borderSubtle')}`,
    background: 'transparent',
    color: cssVar('textTertiary'),
    cursor: 'pointer',
    padding: 0,
    transition: 'all 0.15s',
  },
  bottomLeft: {
    position: 'absolute',
    left: 20,
    bottom: 18,
    zIndex: 31,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  mobileBottomLeft: {
    position: 'absolute',
    left: 20,
    bottom: 178,
    zIndex: 31,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  compactThemeBtn: {
    width: 28,
    height: 28,
  },
};

const createPanelBase: CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
  background: cssVar('bgElevated'),
  overflow: 'hidden',
  position: 'relative',
};

function ConsoleBackLink() {
  const { t } = useTranslation();
  return (
    <a href="/" style={floatNav.btn} className="studio-console-link">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M19 12H5" /><path d="M12 19l-7-7 7-7" />
      </svg>
      <span>{t('playground.studio_console')}</span>
    </a>
  );
}

function FloatingStudioControls({ showConsoleLink }: { showConsoleLink: boolean }) {
  return (
    <div style={floatNav.bottomLeft} className="studio-corner-controls">
      {showConsoleLink && <ConsoleBackLink />}
      <ThemeToggleButton style={floatNav.compactThemeBtn} />
    </div>
  );
}

function MobileStudioControls() {
  return (
    <div style={floatNav.mobileBottomLeft} className="studio-mobile-corner-controls">
      <ThemeToggleButton style={floatNav.compactThemeBtn} />
    </div>
  );
}

const fallbackInspirationCatalog: InspirationCatalog = {
  version: 'local',
  items: INSPIRATIONS.map((item, index) => ({
    id: item.id ?? `local-${index}-${item.title}`,
    category: item.category,
    scenario: item.scenario,
    title: item.title,
    description: item.description,
    kind: item.kind ?? (item.image ? 'image' : 'prompt'),
    image: item.image,
    prompt: item.prompt,
    tags: item.tags,
    source: item.source ?? 'local',
  })),
};

function normalizeCatalogItem(item: InspirationItem): Inspiration {
  return {
    id: item.id,
    category: item.category,
    scenario: item.scenario,
    title: item.title,
    description: item.description,
    kind: item.kind,
    image: item.image,
    prompt: item.prompt,
    tags: item.tags,
    source: item.source,
  };
}

function itemMatchesQuery(item: Inspiration, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    item.category,
    item.scenario,
    item.title,
    item.description,
    item.prompt,
    ...(item.tags ?? []),
  ].filter(Boolean).join(' ').toLowerCase();
  return haystack.includes(q);
}

function useInspirationCatalog() {
  const { t, i18n } = useTranslation();
  const [catalog, setCatalog] = useState<InspirationCatalog>(fallbackInspirationCatalog);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'fallback'>('loading');

  useEffect(() => {
    let alive = true;
    api.listInspirations()
      .then(next => {
        if (!alive) return;
        setCatalog(next.items.length ? next : fallbackInspirationCatalog);
        setLoadState('ready');
      })
      .catch(() => {
        if (!alive) return;
        setCatalog(fallbackInspirationCatalog);
        setLoadState('fallback');
      });
    return () => { alive = false; };
  }, []);

  const items = useMemo(() => catalog.items.map(item => {
    // Built-in catalog metadata is translated client-side. API-managed items remain
    // server-provided so the catalog can evolve independently of this extension.
    const builtInKey = item.id.startsWith('local-')
      ? item.title
      : BUILT_IN_INSPIRATION_KEYS[item.id];
    const metadata = builtInKey ? BUILT_IN_INSPIRATION_METADATA.get(builtInKey) : undefined;
    if (!metadata || !builtInKey) return normalizeCatalogItem(item);
    const titleKey = `playground.studio_inspiration_item_${builtInKey}`;
    return {
      ...normalizeCatalogItem(item),
      category: t(`playground.studio_inspiration_category_${metadata.category}`),
      scenario: metadata.scenario ? t(`playground.studio_inspiration_scenario_${metadata.scenario}`) : undefined,
      title: t(`${titleKey}_title`),
      description: metadata.description ? t(`${titleKey}_description`) : undefined,
      tags: metadata.tags?.map(tag => t(`playground.studio_inspiration_tag_${tag}`)),
    };
  }), [catalog.items, i18n.language, t]);

  return {
    catalog,
    loadState,
    items,
  };
}

function InspirationCard({ item, onSelect }: { item: Inspiration; onSelect: (prompt: string) => void }) {
  const { t } = useTranslation();
  const tags = item.tags?.slice(0, 3) ?? [];
  const isPromptOnly = !item.image || item.kind === 'prompt';
  if (isPromptOnly) {
    return (
      <button
        type="button"
        style={tpl.promptCard}
        className="studio-template-card"
        onClick={() => onSelect(item.prompt)}
        title={item.prompt.slice(0, 160) + '...'}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <span style={tpl.cardScenario}>{item.scenario || item.category}</span>
          <span style={tpl.useBtn}>{t('playground.studio_use')}</span>
        </div>
        <div style={{ ...tpl.cardLabel, whiteSpace: 'normal' }}>{item.title}</div>
        {item.description && <div style={tpl.cardDesc}>{item.description}</div>}
        {tags.length > 0 && (
          <div style={tpl.tagRow}>
            {tags.map(tag => <span key={tag} style={tpl.tag}>{tag}</span>)}
          </div>
        )}
      </button>
    );
  }
  return (
    <button
      type="button"
      style={tpl.card}
      className="studio-template-card"
      onClick={() => onSelect(item.prompt)}
      title={item.prompt.slice(0, 160) + '...'}
    >
      <img src={item.image} alt={item.title} style={tpl.thumb} loading="lazy" />
      <div style={tpl.cardBottom}>
        <span style={tpl.cardLabel}>{item.title}</span>
        <span style={tpl.useBtn}>{t('playground.studio_use')}</span>
      </div>
    </button>
  );
}

function InspirationGrid({
  onSelect,
  gridStyle,
  items,
}: {
  onSelect: (prompt: string) => void;
  gridStyle?: CSSProperties;
  items?: Inspiration[];
}) {
  const sourceItems = items ?? fallbackInspirationCatalog.items.map(normalizeCatalogItem);
  const categories = [...new Set(sourceItems.map(i => i.category))];
  return (
    <>
      {categories.map(cat => (
        <div key={cat}>
          <div style={tpl.sectionHeader}>
            <div style={tpl.catLabel}>{cat}</div>
            <span style={tpl.catCount}>{sourceItems.filter(i => i.category === cat).length}</span>
          </div>
          <div style={gridStyle ?? tpl.grid}>
            {sourceItems.filter(i => i.category === cat).map(item => (
              <InspirationCard key={item.id ?? item.title} item={item} onSelect={onSelect} />
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

function InspirationHomeGrid({ onSelect, gridStyle }: { onSelect: (prompt: string) => void; gridStyle?: CSSProperties }) {
  const { items } = useInspirationCatalog();
  return <InspirationGrid onSelect={onSelect} gridStyle={gridStyle} items={items} />;
}

// InspirationDrawer —— 从右侧滑入的灵感抽屉。点击卡片填词后自动关闭。
function InspirationDrawer({ onSelect, onClose }: { onSelect: (prompt: string) => void; onClose: () => void }) {
  const { t } = useTranslation();
  const { items: allItems, loadState } = useInspirationCatalog();
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<'all' | 'image' | 'prompt'>('all');
  const allLabel = t('playground.studio_all');
  const [category, setCategory] = useState(allLabel);

  const categories = [allLabel, ...new Set(allItems.map(item => item.category))];
  const visibleItems = allItems.filter(item => {
    const itemKind = item.image && item.kind !== 'prompt' ? 'image' : 'prompt';
    if (kind !== 'all' && itemKind !== kind) return false;
    if (category !== allLabel && item.category !== category) return false;
    return itemMatchesQuery(item, query);
  });

  return (
    <>
      <div className="studio-inspiration-drawer-backdrop" onClick={onClose} />
      <div className="studio-inspiration-drawer">
        <div style={tpl.drawerHeader}>
          <span style={tpl.drawerTitle}>{t('playground.studio_inspiration_gallery')}</span>
          <button type="button" style={tpl.collapseBtn} className="studio-console-link" onClick={onClose} title={t('playground.studio_close')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6L6 18" /><path d="M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div style={tpl.drawerTools}>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            style={tpl.searchInput}
            placeholder={t('playground.studio_inspiration_search_placeholder')}
          />
          <div style={tpl.filterRow} className="studio-inspiration-filters">
            {(['all', 'image', 'prompt'] as const).map(nextKind => (
              <button
                key={nextKind}
                type="button"
                style={kind === nextKind ? { ...tpl.filterBtn, ...tpl.filterBtnActive } : tpl.filterBtn}
                onClick={() => setKind(nextKind)}
              >
                {nextKind === 'all' ? t('playground.studio_all') : nextKind === 'image' ? t('playground.studio_inspiration_examples') : t('playground.studio_inspiration_prompts')}
              </button>
            ))}
          </div>
          <div style={tpl.filterRow} className="studio-inspiration-filters">
            {categories.map(cat => (
              <button
                key={cat}
                type="button"
                style={category === cat ? { ...tpl.filterBtn, ...tpl.filterBtnActive } : tpl.filterBtn}
                onClick={() => setCategory(cat)}
              >
                {cat}
              </button>
            ))}
          </div>
          <div style={tpl.sourceNote}>
            {loadState === 'loading'
              ? t('playground.studio_inspiration_loading')
              : loadState === 'fallback'
              ? t('playground.studio_inspiration_builtin')
              : t('playground.studio_inspiration_count', { visible: visibleItems.length, total: allItems.length })}
          </div>
        </div>
        <div style={tpl.drawerBody} className="studio-gallery">
          {visibleItems.length > 0 ? (
            <InspirationGrid items={visibleItems} onSelect={(p) => { onSelect(p); onClose(); }} />
          ) : (
            <div style={tpl.emptyState}>{t('playground.studio_inspiration_empty')}</div>
          )}
        </div>
      </div>
    </>
  );
}

// ── ComposerBar ─────────────────────────────────────────────────────────────

const COUNT_OPTIONS = [1, 2, 3, 4];
const COMPOSER_TEXTAREA_HEIGHT = 112;

function ComposerBar({ promptRef, onOpenInspiration }: { promptRef?: React.MutableRefObject<{ set: (v: string) => void } | null>; onOpenInspiration?: () => void }) {
  const { t } = useTranslation();
  const vs = useVideoStrings();
  const {
    mediaType, setMediaType,
    setImageMode,
    currentModel,
    selectedModelId, setSelectedModelId,
    hasImageGroupsForModel, imageGroupsLoaded,
    imageSize, setImageSize,
    generate,
    generateVideo,
    videoModelId, setVideoModelId,
    videoDuration, setVideoDuration,
    videoResolution, setVideoResolution,
    videoRatio, setVideoRatio,
    videoAudio, setVideoAudio,
    videoGroups, videoGroupsLoaded,
    selectedVideoGroupId, setSelectedVideoGroupId,
    referenceImages, setReferenceImages,
    editRequest, clearEditRequest,
  } = useStudio();

  const isVideo = mediaType === 'video';

  const [prompt, setPrompt] = useState('');
  const [count, setCount] = useState(1);
  const [sourceImages, setSourceImages] = useState<string[]>([]);
  const [isDragging, setIsDragging] = useState(false);

  // mask state (only for single image → inpaint)
  const [selection, setSelection] = useState<NormalizedRect | null>(null);
  // Index into allSources for the thumbnail currently open in the preview/mask editor.
  // null when closed. Multi-image opens in preview-only mode (no mask drawing).
  const [editorIndex, setEditorIndex] = useState<number | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (promptRef) {
      promptRef.current = {
        set: (v: string) => { setPrompt(v); textareaRef.current?.focus(); },
      };
    }
  }, [promptRef]);

  // 「编辑这张」：结果卡片请求编辑某图 → 载入主框为唯一源图并打开蒙版编辑器（局部重绘）。
  useEffect(() => {
    if (!editRequest) return;
    setSourceImages([editRequest]);
    setSelection(null);
    setEditorIndex(0);
    clearEditRequest();
    textareaRef.current?.focus();
  }, [editRequest, clearEditRequest]);

  // Union: composer uploads come first, then gallery "use as reference" picks.
  // Both can coexist now (previously gallery picks only showed when composer
  // was empty, which made it impossible to combine).
  const allSources = [...sourceImages, ...referenceImages];
  const hasSource = allSources.length > 0;
  const isSingleSource = allSources.length === 1;
  const baseModelOptions = hasSource ? EDIT_MODEL_REGISTRY : MODEL_REGISTRY;
  const modelOptions = useMemo(() => {
    if (!imageGroupsLoaded) return baseModelOptions;
    const filtered = baseModelOptions.filter(model => hasImageGroupsForModel(model));
    return filtered;
  }, [baseModelOptions, hasImageGroupsForModel, imageGroupsLoaded]);
  const hasSelectableModel = !imageGroupsLoaded || modelOptions.length > 0;
  const hasVideoGroup = !videoGroupsLoaded || videoGroups.length > 0;
  const canSend = prompt.trim().length > 0 && (isVideo ? hasVideoGroup : hasSelectableModel);

  useEffect(() => {
    if (!modelOptions.some(m => m.id === selectedModelId) && modelOptions.length > 0) {
      setSelectedModelId(modelOptions[0].id);
    }
  }, [modelOptions, selectedModelId, setSelectedModelId]);

  const handleSend = () => {
    const trimmed = prompt.trim();
    if (!trimmed) return;

    if (isVideo) {
      void generateVideo(trimmed, { sourceImages: hasSource ? allSources : undefined });
      setPrompt('');
      return;
    }

    if (isSingleSource && selection) {
      // 局部重绘：单图单次，count 不适用
      setImageMode('inpaint');
      void generate(trimmed, { mode: 'inpaint', sourceImage: allSources[0], maskRegion: selection });
    } else if (count > 1) {
      // 批量：N 张聚成一个任务组（batch 模式）。带参考图则每张走 img2img，否则 text2img。
      setImageMode(hasSource ? 'img2img' : 'text2img');
      void generate(trimmed, {
        mode: 'batch',
        count,
        sourceImages: hasSource ? allSources : undefined,
      });
    } else if (hasSource) {
      setImageMode('img2img');
      void generate(trimmed, { mode: 'img2img', sourceImages: allSources, count: 1 });
    } else {
      setImageMode('text2img');
      void generate(trimmed, { mode: 'text2img', count: 1 });
    }
    setPrompt('');
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleFile = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) return;
    try {
      const dataUrl = await readFileAsDataURL(file);
      setSourceImages(prev => [...prev, dataUrl]);
      setSelection(null);
    } catch { /* ignore */ }
  }, []);

  const handleFileInput = (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files) {
      for (const file of files) void handleFile(file);
    }
    e.target.value = '';
  };

  const handleDragOver = (e: DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = () => setIsDragging(false);
  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files) {
      for (const file of files) void handleFile(file);
    }
  };

  const handlePaste = useCallback((e: ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) void handleFile(file);
        return;
      }
    }
  }, [handleFile]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.addEventListener('paste', handlePaste as EventListener);
    return () => el.removeEventListener('paste', handlePaste as EventListener);
  }, [handlePaste]);

  const removeSource = (index: number) => {
    // Index addresses allSources = [...sourceImages, ...referenceImages].
    // Route the removal to the right backing array.
    if (index < sourceImages.length) {
      setSourceImages(prev => prev.filter((_, i) => i !== index));
    } else {
      const refIdx = index - sourceImages.length;
      setReferenceImages(referenceImages.filter((_, i) => i !== refIdx));
    }
    setSelection(null);
  };

  const handleSourceThumbKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      e.stopPropagation();
      removeSource(index);
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setEditorIndex(index);
    }
  };

  const clearAllSources = () => {
    setSourceImages([]);
    setReferenceImages([]);
    setSelection(null);
  };

  const modeHint = hasSource
    ? (isSingleSource && selection ? t('playground.studio_mode_inpaint') : t('playground.studio_mode_img2img'))
    : null;

  return (
    <div
      style={isDragging ? { ...c.card, ...c.cardDragging } : c.card}
      className="studio-quick-input"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Source image thumbnails */}
      {hasSource && (
        <div style={c.sourceStrip}>
          {allSources.map((src, i) => (
            <div
              key={i}
              style={c.thumbWrap}
              className="studio-source-thumb"
            >
              <button
                type="button"
                style={c.thumbOpenBtn}
                onClick={() => setEditorIndex(i)}
                onKeyDown={e => handleSourceThumbKeyDown(e, i)}
                aria-label={t('playground.studio_source_image_keyboard_hint')}
                title={t('playground.studio_source_image_keyboard_hint')}
              >
                <img
                  src={src}
                  alt="source"
                  style={c.thumbImg}
                />
                {isSingleSource && selection && (
                  <div
                    style={{
                      ...c.thumbMaskOverlay,
                      left: `${selection.x * 100}%`,
                      top: `${selection.y * 100}%`,
                      width: `max(${selection.width * 100}%, 10px)`,
                      height: `max(${selection.height * 100}%, 10px)`,
                    }}
                    title={t('playground.studio_source_image_selected')}
                  />
                )}
              </button>
              <button
                type="button"
                style={c.thumbRemoveBtn}
                className="studio-source-thumb-remove"
                onClick={e => {
                  e.stopPropagation();
                  removeSource(i);
                }}
                onKeyDown={e => {
                  if (e.key === 'Delete' || e.key === 'Backspace') {
                    e.preventDefault();
                    e.stopPropagation();
                    removeSource(i);
                    return;
                  }
                  e.stopPropagation();
                }}
                aria-label={t('playground.studio_remove_source_image')}
                title={t('playground.studio_remove_source_image')}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              </button>
            </div>
          ))}
          {allSources.length > 1 && (
            <button type="button" style={c.sourceActionBtn} className="studio-gallery-action" onClick={clearAllSources}>
              {t('playground.studio_clear_all')}
            </button>
          )}
          {isSingleSource && selection && (
            <button type="button" style={c.sourceActionBtn} className="studio-gallery-action" onClick={() => setSelection(null)}>
              {t('playground.studio_clear_selection')}
            </button>
          )}
          {modeHint && <span style={c.modeHint}>{modeHint}</span>}
        </div>
      )}
      {editorIndex !== null && allSources[editorIndex] && (
        <MaskEditor
          src={allSources[editorIndex]}
          selection={isSingleSource ? selection : null}
          maskingEnabled={isSingleSource}
          onConfirm={(sel) => {
            if (isSingleSource) setSelection(sel);
            setEditorIndex(null);
          }}
          onClose={() => setEditorIndex(null)}
          onDelete={() => {
            removeSource(editorIndex);
            setEditorIndex(null);
          }}
        />
      )}
      <input ref={fileInputRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={handleFileInput} />

      {/* Prompt textarea */}
      <div style={c.promptArea}>
        <button
          type="button"
          style={c.promptUploadBtn}
          className="studio-gallery-action"
          onClick={() => fileInputRef.current?.click()}
          title={t('playground.studio_add_reference')}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" />
          </svg>
        </button>
        <textarea
          ref={textareaRef}
          style={c.textareaWithUpload}
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isVideo
            ? vs('video_placeholder')
            : hasSource
            ? (isSingleSource && selection ? t('playground.studio_inpaint_placeholder') : t('playground.studio_img2img_placeholder'))
            : t('playground.studio_quick_placeholder')}
          rows={5}
        />
      </div>

      {/* Toolbar row */}
      <div style={c.toolbar}>
        <div style={c.toolbarLeft} className="studio-composer-toolbar-left">
          {/* 媒体切换：图像 / 视频（分段控件，与选择器同高） */}
          <div style={c.mediaToggle} role="tablist">
            <button
              type="button"
              style={!isVideo ? c.mediaBtnActive : c.mediaBtn}
              className="studio-media-btn"
              onClick={() => setMediaType('image')}
              aria-selected={!isVideo}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" />
              </svg>
              {vs('media_image')}
            </button>
            <button
              type="button"
              style={isVideo ? c.mediaBtnActive : c.mediaBtn}
              className="studio-media-btn"
              onClick={() => setMediaType('video')}
              aria-selected={isVideo}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="2" y="5" width="14" height="14" rx="2" /><path d="M22 8.5l-6 3.5 6 3.5z" />
              </svg>
              {vs('media_video')}
            </button>
          </div>
          {isVideo ? (
            <>
              <div style={c.modelSelect}>
                <CustomSelect
                  value={videoModelId}
                  options={VIDEO_MODEL_REGISTRY.map(m => ({ value: m.id, label: vs(m.nameKey) }))}
                  onChange={setVideoModelId}
                  compact
                  minDropdownWidth={220}
                />
              </div>
              <div style={c.videoOption}>
                <CustomSelect
                  value={String(videoDuration)}
                  options={VIDEO_DURATIONS.map(d => ({ value: String(d), label: `${d}${vs('duration_seconds')}` }))}
                  onChange={v => setVideoDuration(Number(v))}
                  compact
                />
              </div>
              <div style={c.videoOption}>
                <CustomSelect
                  value={videoResolution}
                  options={videoModelById(videoModelId).resolutions.map(r => ({ value: r, label: r }))}
                  onChange={setVideoResolution}
                  compact
                />
              </div>
              <div style={c.videoOption}>
                <CustomSelect
                  value={videoRatio}
                  options={VIDEO_RATIOS.map(r => ({ value: r, label: r }))}
                  onChange={setVideoRatio}
                  compact
                />
              </div>
              <button
                type="button"
                style={videoAudio ? c.audioBtnActive : c.audioBtn}
                className="studio-gallery-action"
                onClick={() => setVideoAudio(!videoAudio)}
                title={vs('audio')}
                aria-pressed={videoAudio}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M11 5 6 9H2v6h4l5 4z" />
                  <path d="M15.5 8.5a5 5 0 0 1 0 7" />
                  {videoAudio && <path d="M19 5a9 9 0 0 1 0 14" />}
                </svg>
                {vs('audio')}
              </button>
              {videoGroups.length > 1 && (
                <div style={c.videoOption}>
                  <CustomSelect
                    value={selectedVideoGroupId != null ? String(selectedVideoGroupId) : ''}
                    options={videoGroups.map(g => ({ value: String(g.id), label: g.name }))}
                    onChange={v => setSelectedVideoGroupId(Number(v))}
                    compact
                  />
                </div>
              )}
            </>
          ) : (
            <>
              <div style={c.modelSelect}>
                <CustomSelect
                  value={selectedModelId}
                  options={modelOptions.map(m => ({ value: m.id, label: m.name }))}
                  onChange={setSelectedModelId}
                  placeholder={imageGroupsLoaded ? t('playground.studio_no_image_model_available') : t('playground.studio_image_models_loading')}
                  compact
                  minDropdownWidth={420}
                  disabled={!hasSelectableModel}
                />
              </div>
              <div style={c.sizePicker} className="studio-size-picker">
                <SizeSelector value={imageSize} sizes={currentModel.sizes} onChange={setImageSize} upward compact />
              </div>
              {onOpenInspiration && (
                <button
                  type="button"
                  style={{ ...c.imgUploadBtn, width: 'auto', gap: 4, padding: '0 9px' }}
                  className="studio-gallery-action"
                  onClick={onOpenInspiration}
                  title={t('playground.studio_inspiration_gallery')}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 18h6" /><path d="M10 22h4" /><path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.1V18h6v-1.2c0-.8.4-1.6 1-2.1A7 7 0 0 0 12 2z" />
                  </svg>
                  <span style={{ fontSize: 11, fontWeight: 500 }}>{t('playground.studio_inspiration_gallery')}</span>
                </button>
              )}
              <div style={c.countGroup} title={t('playground.studio_quantity')}>
                {COUNT_OPTIONS.map(n => (
                  <button
                    key={n}
                    type="button"
                    style={count === n ? c.countBtnActive : c.countBtn}
                    onClick={() => setCount(n)}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        <button
          type="button"
          style={{
            ...c.sendBtn,
            ...(canSend ? {} : c.sendBtnDisabled),
          }}
          className={canSend ? 'studio-send-btn' : ''}
          onClick={handleSend}
          disabled={!canSend}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 19V5" />
            <path d="M5 12l7-7 7 7" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// ── ComposerBar styles ──────────────────────────────────────────────────────

const c: Record<string, CSSProperties> = {
  card: {
    width: '100%',
    maxWidth: 720,
    display: 'flex',
    flexDirection: 'column',
    gap: 0,
    padding: '6px 6px 10px',
    borderRadius: 20,
    background: cssVar('bgElevated'),
    border: `1px solid ${cssVar('glassBorder')}`,
    boxShadow: '0 8px 48px rgba(0, 0, 0, 0.4), 0 2px 12px rgba(0, 0, 0, 0.2)',
    transition: 'box-shadow 0.3s, border-color 0.15s',
    pointerEvents: 'auto',
  },
  cardDragging: {
    borderColor: cssVar('primary'),
    boxShadow: `0 0 0 2px ${cssVar('primaryGlow')}, 0 8px 48px rgba(0, 0, 0, 0.4)`,
  },
  skillError: {
    fontSize: 12,
    color: cssVar('danger'),
    padding: '0 4px 6px',
    lineHeight: 1.4,
  },
  sourceStrip: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '6px 12px 2px',
  },
  thumbWrap: {
    position: 'relative',
    borderRadius: 8,
    overflow: 'hidden',
    border: `1px solid ${cssVar('borderSubtle')}`,
    cursor: 'pointer',
    lineHeight: 0,
    flexShrink: 0,
    background: cssVar('bgDeep'),
    transition: 'border-color 0.16s, box-shadow 0.16s, transform 0.16s',
  },
  thumbOpenBtn: {
    display: 'block',
    position: 'relative',
    border: 'none',
    background: 'transparent',
    color: 'inherit',
    cursor: 'pointer',
    lineHeight: 0,
    padding: 0,
    font: 'inherit',
    outline: 'none',
  },
  thumbImg: {
    display: 'block',
    height: 48,
    width: 'auto',
    maxWidth: 100,
    objectFit: 'cover',
    pointerEvents: 'none',
  },
  thumbMaskOverlay: {
    position: 'absolute',
    borderRadius: 3,
    border: '2px solid rgba(248, 113, 113, 0.95)',
    background: 'rgba(248, 113, 113, 0.42)',
    boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.18), inset 0 0 0 1px rgba(255, 255, 255, 0.65), 0 0 12px rgba(248, 113, 113, 0.65)',
    boxSizing: 'border-box',
    pointerEvents: 'none',
  },
  thumbRemoveBtn: {
    position: 'absolute',
    top: 4,
    right: 4,
    zIndex: 3,
    width: 22,
    height: 22,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: '1px solid rgba(255, 255, 255, 0.28)',
    borderRadius: 999,
    background: 'rgba(20, 20, 20, 0.58)',
    color: 'rgba(255, 255, 255, 0.92)',
    cursor: 'pointer',
    padding: 0,
    lineHeight: 1,
    outline: 'none',
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
    transition: 'opacity 0.16s, transform 0.16s, background 0.16s, border-color 0.16s',
  },
  sourceActionBtn: {
    padding: '3px 8px',
    border: `1px solid ${cssVar('borderSubtle')}`,
    borderRadius: 5,
    background: 'transparent',
    color: cssVar('textTertiary'),
    cursor: 'pointer',
    fontSize: 10,
    fontFamily: 'inherit',
    fontWeight: 500,
    transition: 'all 0.15s',
  },
  modeHint: {
    marginLeft: 'auto',
    fontSize: 10,
    color: cssVar('textTertiary'),
    fontFamily: cssVar('fontMono'),
    letterSpacing: '0.02em',
    opacity: 0.6,
  },
  promptArea: {
    position: 'relative',
    minHeight: COMPOSER_TEXTAREA_HEIGHT,
  },
  promptUploadBtn: {
    position: 'absolute',
    left: 14,
    top: 8,
    zIndex: 2,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 42,
    height: 36,
    border: `1px solid ${cssVar('borderSubtle')}`,
    borderRadius: 9,
    background: 'transparent',
    color: cssVar('textTertiary'),
    cursor: 'pointer',
    padding: 0,
    transition: 'all 0.15s',
  },
  textarea: {
    width: '100%',
    height: COMPOSER_TEXTAREA_HEIGHT,
    minHeight: COMPOSER_TEXTAREA_HEIGHT,
    maxHeight: COMPOSER_TEXTAREA_HEIGHT,
    padding: '8px 14px',
    border: 'none',
    background: 'transparent',
    color: cssVar('text'),
    fontSize: 14,
    fontFamily: 'inherit',
    resize: 'none',
    outline: 'none',
    lineHeight: 1.6,
    overflowY: 'auto',
    boxSizing: 'border-box',
  },
  textareaWithUpload: {
    width: '100%',
    height: COMPOSER_TEXTAREA_HEIGHT,
    minHeight: COMPOSER_TEXTAREA_HEIGHT,
    maxHeight: COMPOSER_TEXTAREA_HEIGHT,
    padding: '8px 14px 8px 68px',
    border: 'none',
    background: 'transparent',
    color: cssVar('text'),
    fontSize: 14,
    fontFamily: 'inherit',
    resize: 'none',
    outline: 'none',
    lineHeight: 1.6,
    overflowY: 'auto',
    boxSizing: 'border-box',
  },
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    padding: '2px 8px 0',
  },
  toolbarLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    rowGap: 6,
    flex: 1,
    minWidth: 0,
    flexWrap: 'wrap',
    overflow: 'visible',
  },
  // 图像/视频 分段切换（与选择器同高，不随空间被压扁）
  mediaToggle: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 2,
    padding: 2,
    background: cssVar('bgDeep'),
    border: `1px solid ${cssVar('borderSubtle')}`,
    borderRadius: 9,
    flexShrink: 0,
  },
  mediaBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    height: 26,
    padding: '0 10px',
    border: 'none',
    borderRadius: 7,
    background: 'transparent',
    color: cssVar('textTertiary'),
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 500,
    fontFamily: 'inherit',
    whiteSpace: 'nowrap',
    flexShrink: 0,
    transition: 'all 0.18s cubic-bezier(0.4, 0, 0.2, 1)',
  },
  mediaBtnActive: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    height: 26,
    padding: '0 10px',
    border: 'none',
    borderRadius: 7,
    background: cssVar('bgHover'),
    color: cssVar('text'),
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 700,
    fontFamily: 'inherit',
    whiteSpace: 'nowrap',
    flexShrink: 0,
    boxShadow: '0 1px 4px rgba(0, 0, 0, 0.14)',
    transition: 'all 0.18s cubic-bezier(0.4, 0, 0.2, 1)',
  },
  // 视频参数选择器的包裹（防止被压缩到文字换行；不撑开，按内容取宽）
  videoOption: {
    flexShrink: 0,
    minWidth: 64,
  },
  // 生成音频开关（胶囊态，选中带主题色）
  audioBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    height: 30,
    padding: '0 10px',
    border: `1px solid ${cssVar('borderSubtle')}`,
    borderRadius: 8,
    background: 'transparent',
    color: cssVar('textSecondary'),
    cursor: 'pointer',
    fontSize: 12,
    fontFamily: 'inherit',
    whiteSpace: 'nowrap',
    flexShrink: 0,
    transition: 'all 0.18s',
  },
  audioBtnActive: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    height: 30,
    padding: '0 10px',
    border: `1px solid color-mix(in oklab, ${cssVar('primary')} 40%, transparent)`,
    borderRadius: 8,
    background: cssVar('primarySubtle'),
    color: cssVar('text'),
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 600,
    fontFamily: 'inherit',
    whiteSpace: 'nowrap',
    flexShrink: 0,
    transition: 'all 0.18s',
  },
  // 不撑开（grow=0）：按基准宽度取宽，空间不足时可收缩到 minWidth，
  // 避免独占整行造成大片空白。基准放到能容下「Seedance 2.0 标准」不截断。
  modelSelect: {
    flex: '0 1 218px',
    minWidth: 150,
    maxWidth: 240,
  },
  sizePicker: {
    flex: '0 1 150px',
    minWidth: 120,
  },
  countGroup: {
    display: 'flex',
    gap: 2,
    flexShrink: 0,
  },
  countBtn: {
    width: 26,
    height: 26,
    border: `1px solid ${cssVar('borderSubtle')}`,
    borderRadius: 6,
    background: 'transparent',
    color: cssVar('textSecondary'),
    cursor: 'pointer',
    fontSize: 11,
    fontFamily: 'inherit',
    fontVariantNumeric: 'tabular-nums',
    transition: 'all 0.15s',
    padding: 0,
  },
  countBtnActive: {
    width: 26,
    height: 26,
    border: `1px solid color-mix(in oklab, ${cssVar('primary')} 40%, transparent)`,
    borderRadius: 6,
    background: cssVar('primarySubtle'),
    color: cssVar('text'),
    cursor: 'pointer',
    fontSize: 11,
    fontFamily: 'inherit',
    fontWeight: 700,
    fontVariantNumeric: 'tabular-nums',
    transition: 'all 0.15s',
    padding: 0,
  },
  batchHint: {
    fontSize: 11,
    color: cssVar('textTertiary'),
    fontFamily: cssVar('fontMono'),
    whiteSpace: 'nowrap',
  },
  consoleLink: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: '4px 8px',
    borderRadius: 6,
    color: cssVar('textTertiary'),
    fontSize: 11,
    fontWeight: 500,
    textDecoration: 'none',
    fontFamily: 'inherit',
    transition: 'color 0.15s',
    flexShrink: 0,
    whiteSpace: 'nowrap',
  },
  imgUploadBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 30,
    height: 26,
    border: `1px solid ${cssVar('borderSubtle')}`,
    borderRadius: 6,
    background: 'transparent',
    color: cssVar('textTertiary'),
    cursor: 'pointer',
    padding: 0,
    flexShrink: 0,
    transition: 'all 0.15s',
  },
  sendBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 34,
    height: 34,
    border: 'none',
    borderRadius: 10,
    background: cssVar('primary'),
    color: cssVar('primaryForeground'),
    cursor: 'pointer',
    flexShrink: 0,
    padding: 0,
    transition: 'all 0.2s',
    boxShadow: `0 0 12px ${cssVar('primaryGlow')}`,
  },
  sendBtnDisabled: {
    background: cssVar('bgHover'),
    color: cssVar('textTertiary'),
    cursor: 'not-allowed',
    boxShadow: 'none',
    opacity: 0.4,
  },
};

// ── Landing ─────────────────────────────────────────────────────────────────

const landing: Record<string, CSSProperties> = {
  wrapper: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    background: cssVar('bgDeep'),
    overflow: 'hidden',
  },
  emptyScroll: {
    flex: 1,
    overflowY: 'auto',
    overflowX: 'hidden',
    display: 'flex',
    flexDirection: 'column',
  },
  hero: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 12,
    padding: '48px 32px 8px',
    userSelect: 'none',
  },
  iconWrap: {
    width: 72,
    height: 72,
    borderRadius: 22,
    background: 'radial-gradient(circle at 40% 35%, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.01) 70%, transparent 100%)',
    border: '1px solid rgba(255,255,255,0.06)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 8px 32px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.04)',
    marginBottom: 4,
  },
  title: {
    fontSize: 22,
    fontWeight: 700,
    color: cssVar('text'),
    letterSpacing: '-0.02em',
  },
  subtitle: {
    fontSize: 13,
    color: cssVar('textTertiary'),
    opacity: 0.6,
  },
  inspireSection: {
    width: '100%',
    maxWidth: 720,
    margin: '0 auto',
    padding: '28px 24px 40px',
  },
  inspireHeading: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.08em',
    color: cssVar('textTertiary'),
    fontFamily: cssVar('fontMono'),
    textTransform: 'uppercase',
    opacity: 0.7,
    padding: '0 4px 12px',
  },
  inspireGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
    gap: 12,
    marginBottom: 8,
  },
  loadingGallery: {
    flex: 1,
    minHeight: 0,
    padding: '20px 20px 220px',
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
    gridAutoRows: 'minmax(140px, 220px)',
    gap: 14,
    overflow: 'hidden',
  },
  loadingCard: {
    minHeight: 160,
    borderRadius: 14,
    border: `1px solid ${cssVar('borderSubtle')}`,
    background: `linear-gradient(110deg, ${cssVar('bgDeep')} 0%, ${cssVar('bgHover')} 42%, ${cssVar('bgDeep')} 78%)`,
    backgroundSize: '200% 100%',
    animation: 'studioShimmer 1.4s linear infinite',
    opacity: 0.62,
  },
};

// ── Gallery mode ────────────────────────────────────────────────────────────

const galleryLayout: Record<string, CSSProperties> = {
  wrapper: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    background: cssVar('bgElevated'),
    overflow: 'hidden',
  },
  composerWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: '0 20px 18px',
    display: 'flex',
    justifyContent: 'center',
    background: 'transparent',
    zIndex: 30,
    pointerEvents: 'none',
  },
};

// ── StudioLayout ────────────────────────────────────────────────────────────

const mobileTabStyle: Record<string, CSSProperties> = {
  bar: {
    display: 'none',
    gap: 0,
    borderBottom: `1px solid ${cssVar('borderSubtle')}`,
    background: cssVar('bgDeep'),
    flexShrink: 0,
  },
  tab: {
    flex: 1,
    padding: '10px 0',
    border: 'none',
    background: 'transparent',
    color: cssVar('textTertiary'),
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
    textAlign: 'center',
    transition: 'all 0.15s',
  },
  tabActive: {
    flex: 1,
    padding: '10px 0',
    border: 'none',
    borderBottom: `2px solid ${cssVar('primary')}`,
    background: 'transparent',
    color: cssVar('text'),
    fontSize: 12,
    fontWeight: 700,
    cursor: 'pointer',
    fontFamily: 'inherit',
    textAlign: 'center',
  },
};

function StudioLayout() {
  const { t } = useTranslation();
  const { gallery, tasks, projectsEnabled, initialLoadComplete } = useStudio();
  const promptRef = useRef<{ set: (v: string) => void } | null>(null);
  const [mobileTab, setMobileTab] = useState<'projects' | 'create'>('create');
  const [inspirationOpen, setInspirationOpen] = useState(false);

  const visibleTasks = tasks.filter(tk => tk.status !== 'completed');
  const isEmpty = gallery.length === 0 && visibleTasks.length === 0;

  const handleTemplate = (prompt: string) => {
    promptRef.current?.set(prompt);
    setMobileTab('create');
  };

  // 项目左栏（仅在后端启用项目功能时显示）。移动端作为一个 tab。
  const projectPanel = projectsEnabled ? (
    <div className="studio-panel-projects" style={{ minWidth: 0, overflow: 'hidden' }}>
      <ProjectSidebar />
    </div>
  ) : null;

  const mobileTabs = projectsEnabled ? (
    <div style={mobileTabStyle.bar} className="studio-mobile-tabs">
      <button type="button" style={mobileTab === 'projects' ? mobileTabStyle.tabActive : mobileTabStyle.tab} onClick={() => setMobileTab('projects')}>{t('playground.studio_mobile_projects')}</button>
      <button type="button" style={mobileTab === 'create' ? mobileTabStyle.tabActive : mobileTabStyle.tab} onClick={() => setMobileTab('create')}>{t('playground.studio_mobile_create')}</button>
    </div>
  ) : null;

  const drawer = inspirationOpen ? (
    <InspirationDrawer onSelect={handleTemplate} onClose={() => setInspirationOpen(false)} />
  ) : null;

  const showFallbackConsoleLink = initialLoadComplete && !projectsEnabled;
  const floatingControls = projectsEnabled
    ? <MobileStudioControls />
    : <FloatingStudioControls showConsoleLink={showFallbackConsoleLink} />;

  if (!initialLoadComplete) {
    return (
      <div style={ss.layout} data-mobile-tab={mobileTab}>
        <style>{studioCSS}</style>
        {mobileTabs}
        {projectPanel}
        <div className="studio-panel-create" style={createPanelBase}>
          {floatingControls}
          <div style={landing.loadingGallery} aria-busy="true" aria-label={t('playground.studio_loading_works')}>
            {Array.from({ length: 12 }).map((_, index) => (
              <div
                key={index}
                style={{
                  ...landing.loadingCard,
                  height: 140 + (index % 4) * 26,
                }}
              />
            ))}
          </div>
          <div style={galleryLayout.composerWrap}>
            <ComposerBar promptRef={promptRef} onOpenInspiration={() => setInspirationOpen(true)} />
          </div>
        </div>
      </div>
    );
  }

  if (isEmpty) {
    return (
      <div style={ss.layout} data-mobile-tab={mobileTab}>
        <style>{studioCSS}</style>
        {mobileTabs}
        {projectPanel}
        <div className="studio-panel-create" style={createPanelBase}>
          {floatingControls}
          <div style={landing.emptyScroll}>
            <div style={landing.hero}>
              <div style={landing.iconWrap}>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.25 }}>
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <path d="M21 15l-5-5L5 21" />
                </svg>
              </div>
              <div style={landing.title}>{t('playground.studio_workshop')}</div>
              <div style={landing.subtitle}>{t('playground.studio_quick_placeholder')}</div>
              <div style={{ width: '100%', maxWidth: 720, marginTop: 18 }}>
                <ComposerBar promptRef={promptRef} onOpenInspiration={() => setInspirationOpen(true)} />
              </div>
            </div>
            {/* 空状态把灵感网格铺在主区，回收原本浪费的空白 */}
            <div style={landing.inspireSection}>
              <div style={landing.inspireHeading}>{t('playground.studio_inspiration_gallery')}</div>
              <InspirationHomeGrid onSelect={handleTemplate} gridStyle={landing.inspireGrid} />
            </div>
          </div>
          {drawer}
        </div>
      </div>
    );
  }

  return (
    <div style={ss.layout} data-mobile-tab={mobileTab}>
      <style>{studioCSS}</style>
      {mobileTabs}
      {projectPanel}
      <div className="studio-panel-create" style={{ ...galleryLayout.wrapper, flex: 1, minWidth: 0, position: 'relative' }}>
        {floatingControls}
        <GalleryView />
        <div style={galleryLayout.composerWrap}>
          <ComposerBar promptRef={promptRef} onOpenInspiration={() => setInspirationOpen(true)} />
        </div>
        {drawer}
      </div>
    </div>
  );
}

// ── StudioView (entry point) ────────────────────────────────────────────────

export function StudioView() {
  return <StudioLayout />;
}
