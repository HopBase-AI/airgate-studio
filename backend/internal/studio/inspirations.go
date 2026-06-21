package studio

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const (
	inspirationCatalogVersion = "2026-06-22"
	inspirationRemoteCacheTTL = 5 * time.Minute
)

type InspirationCatalog struct {
	Version string              `json:"version"`
	Sources []InspirationSource `json:"sources,omitempty"`
	Items   []InspirationItem   `json:"items"`
}

type InspirationSource struct {
	Name string `json:"name"`
	URL  string `json:"url,omitempty"`
	Note string `json:"note,omitempty"`
}

type InspirationItem struct {
	ID          string   `json:"id"`
	Category    string   `json:"category"`
	Scenario    string   `json:"scenario,omitempty"`
	Title       string   `json:"title"`
	Description string   `json:"description,omitempty"`
	Kind        string   `json:"kind"`
	Image       string   `json:"image,omitempty"`
	Prompt      string   `json:"prompt"`
	Tags        []string `json:"tags,omitempty"`
	Source      string   `json:"source,omitempty"`
}

func (p *StudioPlugin) handleListInspirations(w http.ResponseWriter, r *http.Request) {
	catalog := builtInInspirationCatalog()
	if p.inspirationCatalogURL != "" {
		remote, err := p.loadRemoteInspirationCatalog(r.Context(), p.inspirationCatalogURL)
		if err != nil {
			p.logger.Warn("studio remote inspiration catalog unavailable", "url", p.inspirationCatalogURL, "error", err)
		} else {
			catalog = mergeInspirationCatalogs(catalog, remote)
		}
	}
	writeJSON(w, http.StatusOK, catalog)
}

func (p *StudioPlugin) loadRemoteInspirationCatalog(ctx context.Context, rawURL string) (InspirationCatalog, error) {
	now := time.Now()
	p.inspirationCacheMu.Lock()
	if p.inspirationCacheURL == rawURL && now.Before(p.inspirationCacheUntil) && len(p.inspirationCache.Items) > 0 {
		cached := p.inspirationCache
		p.inspirationCacheMu.Unlock()
		return cached, nil
	}
	p.inspirationCacheMu.Unlock()

	catalog, err := fetchRemoteInspirationCatalog(ctx, rawURL)
	if err != nil {
		return InspirationCatalog{}, err
	}

	p.inspirationCacheMu.Lock()
	p.inspirationCacheURL = rawURL
	p.inspirationCache = catalog
	p.inspirationCacheUntil = now.Add(inspirationRemoteCacheTTL)
	p.inspirationCacheMu.Unlock()
	return catalog, nil
}

func fetchRemoteInspirationCatalog(ctx context.Context, rawURL string) (InspirationCatalog, error) {
	parsed, err := url.Parse(rawURL)
	if err != nil || parsed == nil || parsed.Host == "" || (parsed.Scheme != "https" && parsed.Scheme != "http") {
		return InspirationCatalog{}, fmt.Errorf("invalid catalog url")
	}

	ctx, cancel := context.WithTimeout(ctx, 3500*time.Millisecond)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return InspirationCatalog{}, err
	}
	req.Header.Set("Accept", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return InspirationCatalog{}, err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return InspirationCatalog{}, fmt.Errorf("remote catalog returned %s", resp.Status)
	}

	var catalog InspirationCatalog
	dec := json.NewDecoder(io.LimitReader(resp.Body, 1<<20))
	if err := dec.Decode(&catalog); err != nil {
		return InspirationCatalog{}, err
	}
	normalizeInspirationCatalog(&catalog, "remote")
	if len(catalog.Items) == 0 {
		return InspirationCatalog{}, errors.New("remote catalog has no valid items")
	}
	return catalog, nil
}

func mergeInspirationCatalogs(base InspirationCatalog, remote InspirationCatalog) InspirationCatalog {
	seen := make(map[string]struct{}, len(base.Items)+len(remote.Items))
	out := InspirationCatalog{
		Version: base.Version,
		Sources: append(append([]InspirationSource(nil), base.Sources...), remote.Sources...),
		Items:   make([]InspirationItem, 0, len(base.Items)+len(remote.Items)),
	}
	for _, item := range append(base.Items, remote.Items...) {
		if item.ID == "" {
			continue
		}
		if _, ok := seen[item.ID]; ok {
			continue
		}
		seen[item.ID] = struct{}{}
		out.Items = append(out.Items, item)
	}
	return out
}

func normalizeInspirationCatalog(catalog *InspirationCatalog, fallbackSource string) {
	clean := make([]InspirationItem, 0, len(catalog.Items))
	for _, item := range catalog.Items {
		item.ID = strings.TrimSpace(item.ID)
		item.Category = strings.TrimSpace(item.Category)
		item.Title = strings.TrimSpace(item.Title)
		item.Prompt = strings.TrimSpace(item.Prompt)
		item.Kind = strings.TrimSpace(item.Kind)
		if item.Kind == "" {
			item.Kind = "prompt"
			if strings.TrimSpace(item.Image) != "" {
				item.Kind = "image"
			}
		}
		if item.Source == "" {
			item.Source = fallbackSource
		}
		if item.ID == "" || item.Category == "" || item.Title == "" || item.Prompt == "" {
			continue
		}
		clean = append(clean, item)
	}
	catalog.Items = clean
}

func builtInInspirationCatalog() InspirationCatalog {
	return InspirationCatalog{
		Version: inspirationCatalogVersion,
		Sources: []InspirationSource{
			{
				Name: "HopBase Studio curated catalog",
				Note: "电商场景、广告视觉和设计师常用提示词模板，内置在插件中，可叠加远程 JSON catalog。",
			},
			{
				Name: "Open prompt gallery patterns",
				Note: "参考开源 prompt gallery 常见做法：结构化 metadata、可搜索分类、案例图与纯 prompt 分离。",
			},
		},
		Items: builtInInspirationItems(),
	}
}

func builtInInspirationItems() []InspirationItem {
	return []InspirationItem{
		{
			ID: "ecommerce-skincare-diorama", Category: "电商", Scenario: "商品主图", Kind: "image",
			Title: "微缩护肤品广告", Image: "/plugins/airgate-studio/assets/inspirations/skincare-diorama.jpg",
			Description: "适合护肤品、香氛、小家电等高质感主视觉。",
			Tags:        []string{"商品摄影", "微缩场景", "主图"},
			Prompt:      "A hyper-realistic miniature diorama product advertisement featuring an oversized luxury skincare pump bottle placed on a circular platform. Tiny figurine construction workers in yellow coveralls and white hard hats swarm around the bottle — climbing scaffolding, painting with rollers, operating a tower crane, working near industrial tanks. Warm beige, cream, gold, mustard yellow palette. Studio photography, soft diffused lighting, clean beige background. Tilt-shift miniature aesthetic, ultra-detailed, commercial product photography, 8K resolution, photorealistic CGI render.",
		},
		{
			ID: "ecommerce-burger-storyboard", Category: "电商", Scenario: "食品广告", Kind: "image",
			Title: "汉堡广告分镜", Image: "/plugins/airgate-studio/assets/inspirations/burger-storyboard.jpg",
			Description: "适合餐饮、零食、饮品的质感海报底稿。",
			Tags:        []string{"食品摄影", "广告", "海报"},
			Prompt:      "Create a cinematic hero image of a gourmet cheeseburger on a dark stone surface with glossy brioche bun, melted cheese, crisp lettuce, tomato, grilled patty, sauce, realistic texture, appetizing steam, warm side light, shallow depth of field, premium food commercial style.",
		},
		{
			ID: "ecommerce-white-background-packshot", Category: "电商", Scenario: "商品主图", Kind: "prompt",
			Title:       "白底平台主图",
			Description: "适合亚马逊、独立站、天猫京东首图，强调主体真实、干净和可裁切。",
			Tags:        []string{"白底图", "Listing", "商品摄影"},
			Prompt:      "Create a clean e-commerce product listing image for [PRODUCT]. Center the product on a pure white background, accurate proportions, true-to-life materials, soft shadow directly under the product, crisp edges, no props, no text, no logo changes, commercial packshot photography, high-resolution, ready for marketplace listing.",
		},
		{
			ID: "ecommerce-lifestyle-hero", Category: "电商", Scenario: "场景图", Kind: "prompt",
			Title:       "生活方式场景图",
			Description: "把单品放进用户真实使用环境，适合详情页首屏和社媒落地页。",
			Tags:        []string{"Lifestyle", "场景图", "详情页"},
			Prompt:      "Create a premium lifestyle product photo for [PRODUCT] used by [TARGET CUSTOMER] in a realistic [SCENE]. Keep the product clearly visible as the hero, natural hand placement if relevant, warm daylight, believable scale, editorial composition, shallow depth of field, aspirational but not stock-like, no text, no extra logos.",
		},
		{
			ID: "ecommerce-amazon-a-plus-module", Category: "电商", Scenario: "A+详情", Kind: "prompt",
			Title:       "A+ 详情页模块",
			Description: "用于商品卖点解释图，适合做横幅、对比或功能模块。",
			Tags:        []string{"A+内容", "详情页", "卖点"},
			Prompt:      "Design an Amazon A+ content visual for [PRODUCT] highlighting [BENEFIT]. Use a clean premium layout, product on one side, contextual background related to [USE CASE], subtle callout spaces without rendering text, organized negative space for copy placement, accurate product shape and material, commercial studio lighting.",
		},
		{
			ID: "ecommerce-benefit-infographic", Category: "电商", Scenario: "卖点图", Kind: "prompt",
			Title:       "卖点信息图底图",
			Description: "生成可后期加字的卖点图，不让模型直接画文字。",
			Tags:        []string{"卖点图", "信息图", "详情页"},
			Prompt:      "Create a clean product benefit infographic background for [PRODUCT]. Show the product large and sharp, include 3-4 empty visual callout zones with subtle lines or icon placeholders but no readable text, use brand color accents [BRAND COLORS], bright commercial lighting, high clarity, suitable for adding Chinese copy later.",
		},
		{
			ID: "ecommerce-before-after", Category: "电商", Scenario: "效果对比", Kind: "prompt",
			Title:       "前后对比图",
			Description: "适合清洁、护肤、收纳、修复等强结果类商品。",
			Tags:        []string{"对比图", "效果展示", "详情页"},
			Prompt:      "Create a split-screen before-and-after product result image for [PRODUCT]. Left side shows the problem state [BEFORE STATE], right side shows the improved state [AFTER STATE]. Keep lighting and perspective consistent, realistic transformation, clean divider space for labels added later, no text, no exaggerated impossible claims.",
		},
		{
			ID: "ecommerce-flatlay-bundle", Category: "电商", Scenario: "套装陈列", Kind: "prompt",
			Title:       "套装 Flatlay",
			Description: "适合礼盒、套装、配件组合和内容物展示。",
			Tags:        []string{"Flatlay", "套装", "礼盒"},
			Prompt:      "Create a top-down flatlay product bundle photo for [PRODUCT SET]. Arrange all items neatly with balanced spacing, premium textured background, soft natural shadows, coherent color palette, realistic packaging, clear view of every component, no text, commercial catalog photography.",
		},
		{
			ID: "ecommerce-social-ad-vertical", Category: "电商", Scenario: "社媒广告", Kind: "prompt",
			Title:       "9:16 社媒广告底图",
			Description: "适合小红书、TikTok、Reels 的竖版广告图。",
			Tags:        []string{"小红书", "TikTok", "社媒广告"},
			Prompt:      "Create a 9:16 vertical social ad visual for [PRODUCT]. Product must be the first focal point, energetic composition, one strong use-case moment, space at top and bottom for copy overlays, modern direct-to-consumer brand aesthetic, bright but natural lighting, no generated text, no fake UI.",
		},
		{
			ID: "ecommerce-ugc-handheld", Category: "电商", Scenario: "UGC素材", Kind: "prompt",
			Title:       "UGC 手持实拍感",
			Description: "适合达人种草图、买家秀和真实使用反馈素材。",
			Tags:        []string{"UGC", "种草", "买家秀"},
			Prompt:      "Create a realistic UGC-style handheld photo of [PRODUCT] being used by [TARGET CUSTOMER]. Casual but polished framing, natural indoor light, slight phone-camera realism, authentic environment, product label readable only if supplied, no over-retouching, no text overlay, trustworthy review-photo mood.",
		},
		{
			ID: "fashion-watercolor-sketch", Category: "服饰", Scenario: "风格化改图", Kind: "image",
			Title: "水彩时装素描", Image: "/plugins/airgate-studio/assets/inspirations/watercolor-fashion.jpg",
			Description: "适合服装图转设计稿或视觉海报。",
			Tags:        []string{"服装", "水彩", "图生图"},
			Prompt:      "Transform the uploaded photo into a full-body watercolor fashion illustration in the style of an elegant runway design sketch. Preserve the original outfit, pose, silhouette, colors, fabrics. Use elongated fashion-sketch proportions, loose expressive ink lines, delicate pencil contour, transparent watercolor washes, soft shadows, painterly texture, minimalist editorial mood. White background, clean composition, full body centered.",
		},
		{
			ID: "fashion-ghost-mannequin", Category: "服饰", Scenario: "商品主图", Kind: "prompt",
			Title:       "服装幽灵模特图",
			Description: "适合上衣、裤装、裙装的电商主图形态。",
			Tags:        []string{"服饰", "主图", "Ghost mannequin"},
			Prompt:      "Create a ghost mannequin e-commerce photo for [GARMENT]. Show the garment floating naturally with correct structure and fit, front view, clean light gray or white studio background, accurate fabric texture, realistic folds, no human body visible, no text, premium fashion catalog lighting.",
		},
		{
			ID: "fashion-model-lookbook", Category: "服饰", Scenario: "模特图", Kind: "prompt",
			Title:       "Lookbook 模特图",
			Description: "适合服装品牌调性展示和店铺首页素材。",
			Tags:        []string{"Lookbook", "模特", "服饰"},
			Prompt:      "Create an editorial lookbook image for [GARMENT] worn by [MODEL DESCRIPTION] in [SCENE]. Preserve garment details, natural pose, full-body composition, premium fashion photography, soft directional light, clean background, realistic fabric movement, no text or logos beyond the garment.",
		},
		{
			ID: "ad-luxury-watch", Category: "广告", Scenario: "奢侈品广告", Kind: "image",
			Title: "奢华手表广告", Image: "/plugins/airgate-studio/assets/inspirations/luxury-watch.jpg",
			Tags:   []string{"手表", "奢侈品", "广告"},
			Prompt: "A dramatic luxury product advertising image for a motorsport-inspired chronograph wristwatch in a dark studio. Stainless steel chronograph watch at a three-quarter angle, black dial, red-accent subdials, tachymeter bezel. Black leather strap with bold red stitching. Deep black background with cinematic red and white horizontal light streaks suggesting speed. Glossy wet ground plane with reflective texture. Ultra-polished commercial product photography, luxury watch campaign.",
		},
		{
			ID: "ad-chocolate-premium", Category: "广告", Scenario: "包装广告", Kind: "image",
			Title: "巧克力品牌广告", Image: "/plugins/airgate-studio/assets/inspirations/chocolate-brand.jpg",
			Tags:   []string{"包装", "食品", "广告"},
			Prompt: "Create a premium square product advertisement for a fictional luxury chocolate brand. High-end editorial campaign combining luxury food photography, refined packaging design, and cinematic lighting. Matte black wrapper, subtle gold foil, elegant serif typography, realistic product rendering. Chocolate bar as hero centerpiece with subtle reflections, shallow depth of field, luxury minimalism.",
		},
		{
			ID: "ad-burger-hero", Category: "广告", Scenario: "食品海报", Kind: "image",
			Title: "汉堡英雄海报", Image: "/plugins/airgate-studio/assets/inspirations/burger-hero.jpg",
			Tags:   []string{"食品", "海报", "动势"},
			Prompt: "A cinematic 9:16 vertical composition featuring a gourmet burger. A towering burger with a charcoal brioche bun, thick Wagyu beef patty with visible sear marks, melting aged gruyère dripping like lava, crispy maple-glazed bacon. Dark moody lighting with warm amber spotlight. The burger in a \"deconstructed gravity\" moment — top bun slightly hovering. Ultra-bold distressed sans-serif typeface \"DEFY GRAVITY\". 4K resolution, macro photography, neon-noir color grading.",
		},
		{
			ID: "ad-matcha-granola", Category: "广告", Scenario: "健康食品", Kind: "image",
			Title: "抹茶燕麦广告", Image: "/plugins/airgate-studio/assets/inspirations/matcha-granola.jpg",
			Tags:   []string{"健康食品", "海报", "包装"},
			Prompt: "Ultra-realistic premium food advertisement poster for a healthy breakfast granola brand, centered matte pouch packaging labeled \"Matcha Oat Granola\", green monochrome aesthetic, flat lay composition, soft studio lighting, vibrant matcha green background, surrounded by kiwi slices, almonds, oats, chia seeds, matcha powder bowl, granola bowls. Clean modern typography headline \"SUPERFOOD MORNING BOWL\". Luxury organic branding, 8K detail.",
		},
		{
			ID: "ad-festival-campaign", Category: "广告", Scenario: "节日营销", Kind: "prompt",
			Title:       "节日营销KV",
			Description: "适合大促、礼赠、节日活动首图。",
			Tags:        []string{"大促", "节日", "KV"},
			Prompt:      "Create a premium seasonal campaign key visual for [PRODUCT] during [FESTIVAL OR SHOPPING EVENT]. Product centered as hero, festive but restrained props, brand color palette [BRAND COLORS], elegant commercial lighting, space for promotional copy, no generated text, high-end e-commerce campaign style.",
		},
		{
			ID: "poster-peacock-floral", Category: "海报", Scenario: "装饰画", Kind: "image",
			Title: "孔雀花艺装饰画", Image: "/plugins/airgate-studio/assets/inspirations/peacock-art.jpg",
			Tags:   []string{"装饰画", "花艺", "对称"},
			Prompt: "Symmetrical design featuring two elegant blue peacocks with detailed feather patterns, surrounded by blue floral elements, intricate vintage botanical ornament, soft beige background, classical floral decor style with rich navy and sky blue details, decorative art illustration.",
		},
		{
			ID: "poster-liquid-3d", Category: "海报", Scenario: "视觉冲击", Kind: "image",
			Title: "3D 液体艺术", Image: "/plugins/airgate-studio/assets/inspirations/3d-liquid.jpg",
			Tags:   []string{"3D", "液体", "海报"},
			Prompt: "A mesmerizing explosively colorful vertical poster featuring giant 3D liquid fluid sculpture forms. Enormous glossy morphing blob shapes — massive melting form in hot magenta pink flowing downward, intersecting with a giant swirling wave of electric cobalt blue, a third liquid mass in neon lime green curling upward. All three collide at center in a spectacular splash explosion with hundreds of flying colorful droplets frozen mid-air. Clean bright white background. Bold rounded white typography \"LET IT FLOW\".",
		},
		{
			ID: "poster-collage-art", Category: "海报", Scenario: "风格化改图", Kind: "image",
			Title: "创意拼贴", Image: "/plugins/airgate-studio/assets/inspirations/collage-art.jpg",
			Tags:   []string{"拼贴", "图生图", "纸张"},
			Prompt: "Transform the attached image into a collage artwork. Make it appear as if hand-torn from newspapers, magazines, and flyers and pasted. Every single expression completed using large torn pieces of paper. Represent in detail the torn edges, wrinkles, overlaps, and glue marks. Use relatively large pieces of paper placed randomly at different angles and directions. Create it to look like an actual collage roughly hand-pasted by a person.",
		},
		{
			ID: "poster-isometric-travel", Category: "海报", Scenario: "旅行海报", Kind: "image",
			Title: "等距线稿旅行海报", Image: "/plugins/airgate-studio/assets/inspirations/isometric-travel.jpg",
			Tags:   []string{"旅行", "线稿", "复古"},
			Prompt: "Design a vertical retro mid-century travel poster showcasing a city landmark. Stick to a tight 3-color scheme: cream-toned paper background, black technical line drawing, plus one accent color. Aesthetic: minimalist isometric top-down aerial perspective with very fine cross-hatching and silkscreen print grain. Zero gradients allowed. Large bold sans-serif city name at top.",
		},
		{
			ID: "poster-miniature-travel", Category: "海报", Scenario: "微缩世界", Kind: "image",
			Title: "微缩旅行世界", Image: "/plugins/airgate-studio/assets/inspirations/miniature-travel.jpg",
			Tags:   []string{"微缩", "旅行", "商业海报"},
			Prompt: "A cinematic hyper-detailed miniature travel diorama resting inside an open human palm. A realistic passport and official travel visa card stand upright in the center of a tiny landscape, surrounded by miniature travelers with luggage, scattered suitcases, local vegetation, iconic cultural elements. Famous skyline and landmarks rise softly with atmospheric depth. A commercial airplane flies overhead in bright blue sky. Ultra-realistic textures, shallow depth of field, warm sunlight, macro photography style, tilt-shift miniature effect.",
		},
		{
			ID: "poster-dark-western", Category: "海报", Scenario: "角色海报", Kind: "image",
			Title: "暗黑西部亡命徒", Image: "/plugins/airgate-studio/assets/inspirations/dark-western.jpg",
			Tags:   []string{"角色", "西部", "海报"},
			Prompt: "Dark cinematic western outlaw poster, vertical 2:3 composition. A mysterious masked cowboy with a black horse standing at a desert border. Wide-brim cowboy hat, patterned face cloth, dark leather jacket with multi-layer leather gear, bullet belt, revolver holster. Stormy desert background with lightning, dark clouds, canyon walls. Vintage parchment texture, ink splatters, wanted poster information, character profile, compass graphic, stamp seal. Ultra-detailed leather and metal textures, 8K.",
		},
		{
			ID: "poster-wildlife-infographic", Category: "海报", Scenario: "信息图", Kind: "image",
			Title: "动物百科信息图", Image: "/plugins/airgate-studio/assets/inspirations/wildlife-infographic.jpg",
			Tags:   []string{"信息图", "自然", "百科"},
			Prompt: "A premium cinematic wildlife infographic poster centered around a visually unique animal species. Ultra-detailed photorealistic fur, realistic eyes, moisture textures, cinematic shadows, powerful eye contact. Dense layered infographic storytelling: anatomy callouts, adaptation systems, prey and diet visuals, ecosystem overlays, conservation status, geographic range maps. Asymmetric editorial composition, premium typography, holographic UI elements. Cinematic documentary realism meets futuristic infographic design. 8K, museum-quality composition.",
		},
		{
			ID: "portrait-retro-newsstand", Category: "人像", Scenario: "时尚大片", Kind: "image",
			Title: "复古报刊亭", Image: "/plugins/airgate-studio/assets/inspirations/retro-newsstand.jpg",
			Tags:   []string{"人像", "街头", "时尚"},
			Prompt: "A cinematic fashion editorial scene of 8 diverse young adults gathered around a vintage urban newsstand kiosk with a bold \"NEWSSTAND\" sign. Gritty indoor street environment with worn concrete floors, dark industrial walls. Newspapers fly dynamically through the air with natural motion blur. Styled in coordinated 90s-inspired retro streetwear. Shot from slightly elevated angle, wide 35mm lens, soft cinematic lighting, high-end magazine aesthetic, 4K quality.",
		},
		{
			ID: "portrait-cafe-date", Category: "人像", Scenario: "生活方式", Kind: "image",
			Title: "咖啡厅约会", Image: "/plugins/airgate-studio/assets/inspirations/cafe-date.jpg",
			Tags:   []string{"人像", "咖啡厅", "生活方式"},
			Prompt: "Ultra-realistic cozy Japanese-Korean cafe photography featuring a cute young couple sitting together naturally in a trendy aesthetic cafe. Table beautifully filled with pancakes, strawberry cakes, macarons, croissants, iced coffees, matcha lattes. Cute scrapbook-style doodles and handwritten notes — tiny hearts, stars, sparkles, ribbons. Shallow depth of field, cinematic composition, ultra realistic food textures, 8K.",
		},
		{
			ID: "portrait-rainy-street", Category: "人像", Scenario: "街拍", Kind: "image",
			Title: "雨中金色街拍", Image: "/plugins/airgate-studio/assets/inspirations/rainy-street.jpg",
			Tags:   []string{"街拍", "雨景", "电影感"},
			Prompt: "Ultra-realistic cinematic street photography of a young man standing alone on a rainy urban sidewalk during golden hour sunset. Wearing oversized black hoodie, loose dark blue cargo jeans, clean white sneakers. Moody introspective vibe. Wide-angle composition with dramatic depth. Reflective rain-soaked street surface glowing with warm sunset light. Historic Gothic architecture visible. Shot on Sony A7R IV, 35mm lens, f/1.8, HDR photography, cinematic color grading, 8K ultra resolution.",
		},
		{
			ID: "character-mecha-girl", Category: "角色", Scenario: "角色设定", Kind: "image",
			Title: "机甲少女", Image: "/plugins/airgate-studio/assets/inspirations/mecha-girl.jpg",
			Tags:   []string{"角色", "机甲", "动漫"},
			Prompt: "A mecha girl mid-teens, pale skin smudged with soot and salt spray, sharp amber eyes with glowing HUD reticles, waist-length ash-white hair tied in a high ponytail whipping in the sea wind, matte gunmetal exoskeleton armor plating her shoulders forearms and shins, exposed hydraulic pistons at the joints, chest rig with glowing cyan coolant lines, massive rail cannon resting on her right shoulder. Standing on rusted steel platform jutting out over dark water. Vast derelict sea-city at dusk, colossal megastructures rising from the ocean. Cinematic anime key visual, 16:9.",
		},
		{
			ID: "character-gta-market", Category: "角色", Scenario: "游戏封面", Kind: "image",
			Title: "GTA 风格花市", Image: "/plugins/airgate-studio/assets/inspirations/gta-market.jpg",
			Tags:   []string{"游戏", "封面", "街头"},
			Prompt: "GTA 6 style artwork set in a vibrant Bangalore flower market in India. Bold stylized characters, dramatic poses, vivid colors, urban street energy mixed with traditional Indian market atmosphere. Game cover art composition, cinematic lighting, detailed environment.",
		},
		{
			ID: "character-anime-streetwear", Category: "角色", Scenario: "潮牌角色", Kind: "image",
			Title: "动漫街头潮牌", Image: "/plugins/airgate-studio/assets/inspirations/anime-streetwear.jpg",
			Tags:   []string{"潮牌", "动漫", "角色"},
			Prompt: "Stylized anime streetwear brand poster of a fast-food mascot character, full-body dynamic pose, highly detailed manga illustration, modern urban fashion outfit inspired by restaurant brand colors, oversized hoodie, tactical straps, sneakers, chains, branded accessories, holding signature food item. Bold graphic typography, editorial magazine layout, Japanese text elements, grunge textures, paint splashes. Collectible poster aesthetic, cyber street fashion meets commercial advertising, vibrant red/orange/black/white palette.",
		},
	}
}
