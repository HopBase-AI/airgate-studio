package studio

import (
	"fmt"
	"strings"
)

const defaultExecutorPluginID = "gateway-openai"

func generationExecutorPluginID(platform string) string {
	switch strings.ToLower(strings.TrimSpace(platform)) {
	case "gemini":
		return "gateway-gemini"
	default:
		return defaultExecutorPluginID
	}
}

// generationExecutorPluginIDs 是 studio 会创建/消费任务的全部执行插件。
// 任务的 list/get/delete 都必须限定在这个集合内——tasks.* host 方法允许
// 跨插件查询，不加限定会把同用户其他插件的任务泄漏进创作中心历史。
func generationExecutorPluginIDs() []string {
	return []string{defaultExecutorPluginID, "gateway-gemini"}
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
// 在创建入口就拦下，给前端明确报错而不是排队后失败。
func executorSupportsTaskType(executorID, taskType string) bool {
	if executorID == "gateway-gemini" {
		return taskType == "image.generate"
	}
	return true
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
