# Studio 灵感库 Catalog

Studio 内置一份电商优先的灵感库，也支持通过插件配置 `inspiration_catalog_url` 叠加远程 JSON catalog。

## 适合接入的资源

- 品牌素材库：不同客户、行业或店铺的专属 prompt。
- 运营模板库：大促、节日、上新、达人种草、详情页模块。
- 图片案例库：有参考图的 prompt 案例，图 URL 可指向 CDN 或插件资产。
- 纯业务提示词：没有参考图也可以展示为 recipe 卡片。

## 调研参考

公开资源里，电商垂直 prompt 库相对少，更多是通用图片 prompt collection 或产品摄影专项 workflow。比较适合借鉴的组织方式是：用结构化 metadata 描述 `category`、`scenario`、`kind`、`tags`，再让前端搜索和筛选，而不是把卡片写死在 UI 里。

- GitHub `product-photography` topic：能看到电商、商品摄影、GPT Image 相关的 prompt/workflow 项目。
- `cliprise/awesome-ai-product-photography-prompts`：产品摄影 prompt 公式和电商关键词组织。
- `devanshug2307/Awesome-AI-Image-Prompts`：通用图片 prompt collection，包含 JSON prompt 和 product photography 分类。
- `fattain-naime/ai-image-prompts`：每个 prompt 带 `prompt.md` 和示例图的 gallery 组织方式。
- `wuyoscar/GPT-Image2-Skill`：prompt gallery + agentic skill 的组合，包含产品/食品商业图案例。
- `EvoLinkAI/awesome-gpt-image-2-API-and-Prompts`：按案例文件组织 GPT Image prompt，包含 ecommerce 场景。

## JSON 格式

```json
{
  "version": "2026-06-22",
  "sources": [
    {
      "name": "Brand ecommerce recipes",
      "url": "https://example.com/catalog.json",
      "note": "品牌运营团队维护"
    }
  ],
  "items": [
    {
      "id": "brand-a-plus-module",
      "category": "电商",
      "scenario": "A+详情",
      "title": "品牌详情页模块",
      "description": "用于商品卖点解释图，留出后期加字区域。",
      "kind": "prompt",
      "prompt": "Design an Amazon A+ content visual for [PRODUCT]...",
      "tags": ["A+内容", "详情页", "卖点"]
    },
    {
      "id": "brand-lifestyle-hero",
      "category": "电商",
      "scenario": "场景图",
      "title": "生活方式主视觉",
      "kind": "image",
      "image": "https://cdn.example.com/inspirations/lifestyle.jpg",
      "prompt": "Create a premium lifestyle product photo for [PRODUCT]..."
    }
  ]
}
```

必填字段：`id`、`category`、`title`、`prompt`。

`kind` 可填 `image` 或 `prompt`；未填写时，存在 `image` 会按图片案例处理，否则按纯提示词处理。

远程 catalog 会叠加在内置 catalog 后面，`id` 重复时保留内置项。
