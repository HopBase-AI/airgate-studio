package studio

import (
	"encoding/json"
	"fmt"
	"strings"
)

const defaultExecutorPluginID = "gateway-openai"

func generationExecutorPluginID(platform string) string {
	switch strings.ToLower(strings.TrimSpace(platform)) {
	case "gemini":
		return "gateway-gemini"
	case "seedance":
		return "gateway-seedance"
	default:
		return defaultExecutorPluginID
	}
}

// generationExecutorPluginIDs 是 studio 会创建/消费任务的全部执行插件。
// 任务的 list/get/delete 都必须限定在这个集合内——tasks.* host 方法允许
// 跨插件查询，不加限定会把同用户其他插件的任务泄漏进创作中心历史。
func generationExecutorPluginIDs() []string {
	return []string{defaultExecutorPluginID, "gateway-gemini", "gateway-seedance"}
}

func isGenerationExecutor(pluginID string) bool {
	for _, id := range generationExecutorPluginIDs() {
		if id == pluginID {
			return true
		}
	}
	return false
}

// executorSupportsTaskType 校验执行插件是否支持该任务类型。
// gateway-gemini 当前只实现了文生图（image.edit 会被插件直接 fail），
// gateway-seedance 只做视频生成；在创建入口就拦下，给前端明确报错而不是排队后失败。
func executorSupportsTaskType(executorID, taskType string) bool {
	switch executorID {
	case "gateway-gemini":
		return taskType == "image.generate"
	case "gateway-seedance":
		return taskType == "video.generate"
	default:
		return true
	}
}

// videoModelResolutions Seedance 各档位允许的分辨率（与插件 registry 桶表一致）。
// fast / mini 档只有 480p/720p。
func videoModelResolutions(model string) map[string]struct{} {
	m := strings.ToLower(strings.TrimSpace(model))
	if strings.Contains(m, "-fast-") || strings.Contains(m, "-mini-") {
		return map[string]struct{}{"480p": {}, "720p": {}}
	}
	return map[string]struct{}{"480p": {}, "720p": {}, "1080p": {}, "4k": {}}
}

// validateVideoModelParams 视频任务的参数预校验：分辨率按档位、时长限幅，
// 在创建入口给前端明确错误，避免排队后才在上游失败。
func validateVideoModelParams(model string, params map[string]interface{}) error {
	if res, ok := params["resolution"].(string); ok && strings.TrimSpace(res) != "" {
		normalized := strings.ToLower(strings.TrimSpace(res))
		if _, allowed := videoModelResolutions(model)[normalized]; !allowed {
			return fmt.Errorf("模型 %s 不支持分辨率 %s", model, res)
		}
	}
	if v, ok := params["duration"]; ok {
		if d, ok := toInt(v); ok && (d < 1 || d > 30) {
			return fmt.Errorf("duration 需在 1-30 秒之间")
		}
	}
	return nil
}

func toInt(v interface{}) (int, bool) {
	switch n := v.(type) {
	case int:
		return n, true
	case int64:
		return int(n), true
	case float64:
		return int(n), true
	case json.Number:
		i, err := n.Int64()
		return int(i), err == nil
	default:
		return 0, false
	}
}

type createGenerationTaskRequest struct {
	Kind       string                 `json:"kind"`
	Operation  string                 `json:"operation"`
	Platform   string                 `json:"platform"`
	Model      string                 `json:"model"`
	Prompt     string                 `json:"prompt"`
	GroupID    int64                  `json:"group_id,omitempty"`
	Parameters map[string]interface{} `json:"parameters,omitempty"`
	Inputs     []generationInput      `json:"inputs,omitempty"`
	Mask       *generationInput       `json:"mask,omitempty"`
}

type generationInput struct {
	Type string `json:"type"`
	Role string `json:"role"`
	URL  string `json:"url"`
}

var imageModelSupportedSizes = map[string]map[string]struct{}{
	"gpt-image-2": {
		"auto": {}, "1024x1024": {}, "1536x1024": {}, "1024x1536": {},
		"1536x864": {}, "864x1536": {}, "1536x1152": {}, "1152x1536": {},
		"2048x2048": {}, "2048x1152": {}, "1152x2048": {}, "2048x1536": {},
		"1536x2048": {}, "2000x1600": {}, "1600x2000": {}, "3840x2160": {},
		"2160x3840": {}, "3360x1440": {}, "1440x3360": {},
	},
	"gemini-2.5-flash-image": {
		"1024x1024": {}, "1536x1024": {}, "1024x1536": {},
	},
	"gemini-3-pro-image": {
		"1024x1024": {}, "1536x1024": {}, "1024x1536": {},
		"2048x2048": {}, "2048x1152": {}, "1152x2048": {},
		"3840x2160": {}, "2160x3840": {},
	},
	"gemini-3-pro-image-c": {
		"1024x1024": {}, "1536x1024": {}, "1024x1536": {},
		"2048x2048": {}, "2048x1152": {}, "1152x2048": {},
		"3840x2160": {}, "2160x3840": {},
	},
	"gemini-3-pro-image-preview": {
		"1024x1024": {}, "1536x1024": {}, "1024x1536": {},
		"2048x2048": {}, "2048x1152": {}, "1152x2048": {},
		"3840x2160": {}, "2160x3840": {},
	},
	"gemini-3-pro-image-preview-c": {
		"1024x1024": {}, "1536x1024": {}, "1024x1536": {},
		"2048x2048": {}, "2048x1152": {}, "1152x2048": {},
		"3840x2160": {}, "2160x3840": {},
	},
	"gemini-3.1-flash-image": {
		"1024x1024": {}, "1536x1024": {}, "1024x1536": {},
		"2048x2048": {}, "2048x1152": {}, "1152x2048": {},
	},
	"gemini-3.1-flash-image-c": {
		"1024x1024": {}, "1536x1024": {}, "1024x1536": {},
		"2048x2048": {}, "2048x1152": {}, "1152x2048": {},
	},
	"gemini-3.1-flash-image-preview": {
		"1024x1024": {}, "1536x1024": {}, "1024x1536": {},
		"2048x2048": {}, "2048x1152": {}, "1152x2048": {},
	},
	"gemini-3.1-flash-image-preview-c": {
		"1024x1024": {}, "1536x1024": {}, "1024x1536": {},
		"2048x2048": {}, "2048x1152": {}, "1152x2048": {},
	},
	"gemini-3.1-flash-lite-image": {
		"1024x1024": {}, "1536x1024": {}, "1024x1536": {},
	},
}

func validateImageModelSize(model string, params map[string]interface{}) error {
	model = strings.ToLower(strings.TrimSpace(model))
	if model == "" {
		return nil
	}
	allowed, ok := imageModelSupportedSizes[model]
	if !ok {
		return nil
	}
	size := strings.ToLower(strings.TrimSpace(fmt.Sprint(params["size"])))
	if size == "" || size == "<nil>" {
		return nil
	}
	if _, ok := allowed[size]; ok {
		return nil
	}
	return fmt.Errorf("模型 %s 不支持尺寸 %s", model, size)
}

func normalizeGenerationRequest(req *createGenerationTaskRequest) {
	req.Kind = strings.TrimSpace(req.Kind)
	if req.Kind == "" {
		req.Kind = "image"
	}
	req.Platform = strings.TrimSpace(req.Platform)
	if req.Platform == "" {
		req.Platform = "openai"
	}
	req.Operation = strings.TrimSpace(req.Operation)
	if req.Operation == "" {
		req.Operation = "generate"
	}
}

func resolveTaskType(kind, operation string) string {
	switch kind {
	case "image":
		switch operation {
		case "edit", "inpaint":
			return "image.edit"
		default:
			return "image.generate"
		}
	default:
		return kind + "." + operation
	}
}

func buildTaskInput(req createGenerationTaskRequest) map[string]interface{} {
	input := map[string]interface{}{
		"prompt": req.Prompt,
		"model":  req.Model,
	}
	if req.GroupID > 0 {
		input["group_id"] = req.GroupID
	}
	for key, value := range req.Parameters {
		if key == "" || value == nil {
			continue
		}
		if key == "model" || key == "prompt" {
			continue
		}
		if s, ok := value.(string); ok && strings.TrimSpace(s) == "" {
			continue
		}
		input[key] = value
	}
	images := extractImageInputs(req.Inputs)
	if len(images) > 0 {
		input["images"] = images
		if req.Operation == "edit" || req.Operation == "inpaint" {
			input["preserve_reference"] = true
		}
	}
	if req.Mask != nil && req.Mask.URL != "" {
		input["mask"] = req.Mask.URL
	}
	return input
}

func buildTaskAttributes(req createGenerationTaskRequest) map[string]interface{} {
	attrs := map[string]interface{}{
		"kind":      req.Kind,
		"operation": req.Operation,
		"platform":  req.Platform,
		"model":     req.Model,
	}
	for _, key := range []string{"size", "quality"} {
		if value, ok := req.Parameters[key]; ok && value != nil && fmt.Sprint(value) != "" {
			attrs[key] = fmt.Sprint(value)
		}
	}
	return attrs
}

func buildGenerationTaskResponse(task *hostTask) map[string]interface{} {
	resp := map[string]interface{}{
		"id":         task.ID,
		"task_id":    task.ID,
		"status":     task.Status,
		"progress":   task.Progress,
		"created_at": task.CreatedAt,
	}
	if task.CompletedAt != "" {
		resp["completed_at"] = task.CompletedAt
	}
	if task.Input != nil {
		if v, ok := task.Input["prompt"]; ok {
			resp["prompt"] = v
		}
		if images := stringSliceFromAny(task.Input["images"]); len(images) > 0 {
			resp["input_images"] = images
		}
		if mask, ok := task.Input["mask"].(string); ok && mask != "" {
			resp["input_mask"] = mask
		}
	}
	if task.Output != nil {
		if content, ok := task.Output["content"].(string); ok && content != "" {
			resp["result_content"] = content
		}
		if urls := stringSliceFromAny(task.Output["video_urls"]); len(urls) > 0 {
			resp["video_urls"] = urls
		}
		if model, ok := task.Output["model"]; ok {
			resp["model"] = model
		}
		for _, key := range []string{"input_tokens", "output_tokens", "cost", "usage_id"} {
			if v, ok := task.Output[key]; ok {
				resp[key] = v
			}
		}
	}
	if task.ErrorMessage != "" {
		resp["error_message"] = task.ErrorMessage
	}
	// 从 input 或 attributes 补充展示字段
	if _, ok := resp["model"]; !ok {
		if v, ok := task.Input["model"]; ok {
			resp["model"] = v
		}
	}
	for _, key := range []string{"size", "quality"} {
		if v, ok := task.Attributes[key]; ok && fmt.Sprint(v) != "" {
			resp[key] = v
		} else if v, ok := task.Input[key]; ok && fmt.Sprint(v) != "" {
			resp[key] = v
		}
	}
	if v, ok := task.Attributes["operation"]; ok && fmt.Sprint(v) != "" {
		resp["operation"] = v
	}
	return resp
}

func extractImageInputs(inputs []generationInput) []string {
	var images []string
	for _, input := range inputs {
		if input.URL == "" {
			continue
		}
		if input.Type != "" && input.Type != "image" {
			continue
		}
		if input.Role == "mask" {
			continue
		}
		images = append(images, input.URL)
	}
	return images
}

func stringSliceFromAny(value interface{}) []string {
	var out []string
	switch v := value.(type) {
	case []string:
		out = append(out, v...)
	case []interface{}:
		for _, item := range v {
			if s, ok := item.(string); ok && strings.TrimSpace(s) != "" {
				out = append(out, s)
			}
		}
	case string:
		if strings.TrimSpace(v) != "" {
			out = append(out, v)
		}
	}
	return out
}
