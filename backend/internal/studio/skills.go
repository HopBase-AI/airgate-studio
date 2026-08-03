package studio

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
)

// rewritePromptSystem 指导模型把粗略想法扩写成高质量的英文生图提示词。
const rewritePromptSystem = `你是专业的 AI 生图提示词专家。用户会给你一段粗略的想法或中文描述，` +
	`请把它改写成一段详细、结构清晰、适合图像生成模型的英文提示词。` +
	`要点：补充主体、风格、构图、光线、色彩、镜头、质感、画质等维度；保留用户原意；` +
	`只输出改写后的提示词本身，不要解释、不要加引号、不要 markdown。`

// captionImageInstruction 指导 vision 模型把图片反推成可编辑的生图提示词。
const captionImageInstruction = `请仔细观察这张图片，反推出一段可用于重新生成相似图片的详细英文提示词。` +
	`涵盖主体、风格、构图、光线、色彩、镜头、质感等。只输出提示词本身，不要解释、不要加引号、不要 markdown。`

// chatCompletionsPath 是 OpenAI 兼容对话补全路径。
const chatCompletionsPath = "/v1/chat/completions"

const (
	skillModelCapChat            = "chat"
	skillModelCapImageGeneration = "image_generation"
	skillModelCapImageEdit       = "image_edit"
)

type rewritePromptRequest struct {
	Text     string `json:"text"`
	Platform string `json:"platform,omitempty"`
	Model    string `json:"model,omitempty"`
}

type captionImageRequest struct {
	ImageURL    string `json:"image_url,omitempty"`    // /assets-runtime/... 或 http(s) 或 data URL
	ImageBase64 string `json:"image_base64,omitempty"` // 纯 base64（无 data: 前缀）
	ContentType string `json:"content_type,omitempty"` // 配合 image_base64，默认 image/png
	Platform    string `json:"platform,omitempty"`
	Model       string `json:"model,omitempty"`
}

// Keep the disabled skills endpoints type-checked until their routes are enabled.
var (
	_ = (*StudioPlugin).handleRewritePrompt
	_ = (*StudioPlugin).handleCaptionImage
)

func (p *StudioPlugin) handleRewritePrompt(w http.ResponseWriter, r *http.Request) {
	userID := parseUserIDInt64(r)
	if userID <= 0 {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "missing user identity"})
		return
	}
	var req rewritePromptRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	if strings.TrimSpace(req.Text) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "text is required"})
		return
	}

	platform, model := p.resolveSkillModel(r.Context(), req.Platform, req.Model, false)
	if model == "" {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "没有可用的对话模型，请在插件配置里设置 skill_text_model"})
		return
	}

	messages := []map[string]interface{}{
		{"role": "system", "content": rewritePromptSystem},
		{"role": "user", "content": req.Text},
	}
	content, err := p.callChat(r.Context(), userID, platform, model, messages, 0.7)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "改写失败: " + err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"result": content, "model": model})
}

func (p *StudioPlugin) handleCaptionImage(w http.ResponseWriter, r *http.Request) {
	userID := parseUserIDInt64(r)
	if userID <= 0 {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "missing user identity"})
		return
	}
	var req captionImageRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	imageURL, err := p.resolveImageURL(r.Context(), userID, req)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}

	platform, model := p.resolveSkillModel(r.Context(), req.Platform, req.Model, true)
	if model == "" {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "没有可用的视觉模型，请在插件配置里设置 skill_vision_model"})
		return
	}

	messages := []map[string]interface{}{
		{
			"role": "user",
			"content": []interface{}{
				map[string]interface{}{"type": "text", "text": captionImageInstruction},
				map[string]interface{}{"type": "image_url", "image_url": map[string]interface{}{"url": imageURL}},
			},
		},
	}
	content, err := p.callChat(r.Context(), userID, platform, model, messages, 0.5)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "反推失败: " + err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"result": content, "model": model})
}

// resolveImageURL 把请求里的图片来源统一成 gateway 可消费的 URL。
// image_base64 → data URL；image_url 已是 data:/http(s) 则原样；/assets-runtime/ 通过 get_bytes 转 data URL。
func (p *StudioPlugin) resolveImageURL(ctx context.Context, userID int64, req captionImageRequest) (string, error) {
	if b64 := strings.TrimSpace(req.ImageBase64); b64 != "" {
		ct := strings.TrimSpace(req.ContentType)
		if ct == "" {
			ct = "image/png"
		}
		return "data:" + ct + ";base64," + b64, nil
	}
	raw := strings.TrimSpace(req.ImageURL)
	if raw == "" {
		return "", fmt.Errorf("image_url 或 image_base64 必填")
	}
	if strings.HasPrefix(raw, "data:") || strings.HasPrefix(raw, "http://") || strings.HasPrefix(raw, "https://") {
		return raw, nil
	}
	// /assets-runtime/<objectKey> → 取字节转 data URL（vision 模型无法访问内网相对路径）
	if key, ok := assetObjectKeyFromRuntimeURL(raw); ok {
		dataURL, err := hostGetAssetDataURL(ctx, p.host, key)
		if err != nil {
			return "", fmt.Errorf("读取图片失败: %w", err)
		}
		return dataURL, nil
	}
	return "", fmt.Errorf("不支持的图片地址")
}

// resolveSkillModel 解析 skills 使用的 platform/model：
// 请求显式指定 > ConfigSchema 默认 > models.list 取首个可用的对话模型。
func (p *StudioPlugin) resolveSkillModel(ctx context.Context, reqPlatform, reqModel string, vision bool) (platform, model string) {
	platform = strings.TrimSpace(reqPlatform)
	if platform == "" {
		platform = p.skillPlatform
	}
	if platform == "" {
		platform = "openai"
	}
	model = strings.TrimSpace(reqModel)
	if model == "" {
		if vision {
			model = p.skillVisionModel
		} else {
			model = p.skillTextModel
		}
	}
	if model != "" {
		if isSkillChatModelID(model) {
			return platform, model
		}
		return platform, ""
	}
	// 回退：取该平台下首个可用于 chat.completions 的模型。Core 老版本可能忽略
	// capability 参数，所以这里仍做本地过滤，避免把 gpt-image-* 发到 chat 接口。
	models, err := hostListModels(ctx, p.host, platform, skillModelCapChat)
	if err != nil || len(models) == 0 {
		return platform, ""
	}
	return platform, selectSkillModel(models, vision)
}

func selectSkillModel(models []interface{}, vision bool) string {
	if vision {
		for _, item := range models {
			m, ok := item.(map[string]interface{})
			if !ok {
				continue
			}
			id := strings.TrimSpace(stringFromAny(firstValue(m, "id", "name")))
			if id == "" || !isSkillChatModelID(id) || !isLikelyVisionChatModelID(id) {
				continue
			}
			if !isSkillChatModelByCapabilities(m["capabilities"]) {
				continue
			}
			return id
		}
		return ""
	}
	for _, item := range models {
		m, ok := item.(map[string]interface{})
		if !ok {
			continue
		}
		id := strings.TrimSpace(stringFromAny(firstValue(m, "id", "name")))
		if id == "" || !isSkillChatModelID(id) {
			continue
		}
		if !isSkillChatModelByCapabilities(m["capabilities"]) {
			continue
		}
		return id
	}
	return ""
}

func isLikelyVisionChatModelID(model string) bool {
	id := strings.ToLower(strings.TrimSpace(model))
	if id == "" || strings.Contains(id, "codex") {
		return false
	}
	switch {
	case strings.Contains(id, "vision"),
		strings.Contains(id, "vlm"),
		strings.Contains(id, "-vl"),
		strings.Contains(id, "vl-"),
		strings.Contains(id, "qwen-vl"),
		strings.Contains(id, "gpt-4o"),
		strings.Contains(id, "gpt-4.1"),
		strings.Contains(id, "gpt-5"),
		strings.Contains(id, "o3"),
		strings.Contains(id, "o4"),
		strings.Contains(id, "gemini"),
		strings.Contains(id, "claude"):
		return true
	default:
		return false
	}
}

func isSkillChatModelID(model string) bool {
	id := strings.ToLower(strings.TrimSpace(model))
	if id == "" {
		return false
	}
	return !strings.Contains(id, "image")
}

func isSkillChatModelByCapabilities(value interface{}) bool {
	caps := stringSliceFromAny(value)
	if len(caps) == 0 {
		return true
	}
	hasChat := false
	for _, cap := range caps {
		switch strings.ToLower(strings.TrimSpace(cap)) {
		case skillModelCapChat:
			hasChat = true
		case skillModelCapImageGeneration, skillModelCapImageEdit:
			return false
		}
	}
	return hasChat
}

// callChat 发起一次非流式对话补全，解析出 assistant 文本。
func (p *StudioPlugin) callChat(ctx context.Context, userID int64, platform, model string, messages []map[string]interface{}, temperature float64) (string, error) {
	body, err := json.Marshal(map[string]interface{}{
		"model":       model,
		"messages":    messages,
		"temperature": temperature,
		"stream":      false,
	})
	if err != nil {
		return "", err
	}
	headers := http.Header{}
	headers.Set("Content-Type", "application/json")
	headers.Set("X-Airgate-Platform", platform)

	resp, err := hostForward(ctx, p.host, hostForwardRequest{
		UserID:  userID,
		GroupID: p.skillGroupID, // 0 = 不绑分组按标准价；配了折扣分组则走折扣计费
		Model:   model,
		Method:  http.MethodPost,
		Path:    chatCompletionsPath,
		Headers: headers,
		Body:    body,
	})
	if err != nil {
		return "", err
	}
	if resp.StatusCode >= 400 {
		return "", fmt.Errorf("上游返回 %d: %s", resp.StatusCode, truncate(string(resp.Body), 300))
	}
	content := extractChatContent(resp.Body)
	if strings.TrimSpace(content) == "" {
		return "", fmt.Errorf("模型未返回内容")
	}
	return content, nil
}

// extractChatContent 从 OpenAI chat.completions 响应里取出 choices[0].message.content。
func extractChatContent(body []byte) string {
	var parsed struct {
		Choices []struct {
			Message struct {
				Content interface{} `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil || len(parsed.Choices) == 0 {
		return ""
	}
	switch c := parsed.Choices[0].Message.Content.(type) {
	case string:
		return strings.TrimSpace(c)
	case []interface{}:
		// 多模态返回（content 为分段数组）：拼接其中的 text 片段
		var sb strings.Builder
		for _, part := range c {
			if m, ok := part.(map[string]interface{}); ok {
				if t, ok := m["text"].(string); ok {
					sb.WriteString(t)
				}
			}
		}
		return strings.TrimSpace(sb.String())
	default:
		return ""
	}
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}

// assetObjectKeyFromRuntimeURL 把 /assets-runtime/<escaped objectKey> 还原成 objectKey。
// core 用 url.PathEscape 逐段转义，这里逐段反转义还原。
func assetObjectKeyFromRuntimeURL(raw string) (string, bool) {
	const prefix = "/assets-runtime/"
	// 去掉可能的 query，并定位前缀
	if i := strings.IndexByte(raw, '?'); i >= 0 {
		raw = raw[:i]
	}
	idx := strings.Index(raw, prefix)
	if idx < 0 {
		return "", false
	}
	escaped := raw[idx+len(prefix):]
	if escaped == "" {
		return "", false
	}
	parts := strings.Split(escaped, "/")
	for i, part := range parts {
		decoded, err := url.PathUnescape(part)
		if err != nil {
			return "", false
		}
		parts[i] = decoded
	}
	key := strings.Join(parts, "/")
	if key == "" {
		return "", false
	}
	return key, true
}
