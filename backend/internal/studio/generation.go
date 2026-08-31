package studio

import (
	"encoding/json"
	"fmt"
	"math"
	"strconv"
	"strings"
)

const (
	defaultExecutorPluginID = "gateway-openai"

	videoModelSeedanceStandardOverseas = "dreamina-seedance-2-0-hc"
	videoModelSeedance25               = "dreamina-seedance-2-5-260628"
	videoModelSeedance25LegacyEP       = "dreamina-seedance-2-5-ep"
	// Deprecated source-compatible name. Runtime task values use the native ID.
	videoModelSeedance25EP             = videoModelSeedance25
	videoModelSeedanceStandardDomestic = "doubao-seedance-2-0-260128-a"
	videoModelSeedanceFastOverseas     = "dreamina-seedance-2-0-fast-hc"
	videoModelSeedanceMiniOverseas     = "dreamina-seedance-2-0-mini-hc"
)

func canonicalSeedanceVideoModel(model string) string {
	model = strings.TrimSpace(model)
	if strings.EqualFold(model, videoModelSeedance25LegacyEP) {
		return videoModelSeedance25
	}
	return model
}

func isSeedance25VideoModel(model string) bool {
	return canonicalSeedanceVideoModel(model) == videoModelSeedance25
}

func generationExecutorPluginID(platform string) string {
	switch strings.ToLower(strings.TrimSpace(platform)) {
	case "gemini":
		return "gateway-gemini"
	case "seedance":
		return "gateway-seedance"
	case "minimax":
		return "gateway-minimax"
	case "bailian":
		return "gateway-bailian"
	case "kling":
		return "gateway-kling"
	default:
		return defaultExecutorPluginID
	}
}

// generationExecutorPluginIDs 是 studio 会创建/消费任务的全部执行插件。
// 任务的 list/get/delete 都必须限定在这个集合内——tasks.* host 方法允许
// 跨插件查询，不加限定会把同用户其他插件的任务泄漏进创作中心历史。
func generationExecutorPluginIDs() []string {
	return []string{defaultExecutorPluginID, "gateway-gemini", "gateway-seedance", "gateway-minimax", "gateway-bailian", "gateway-kling"}
}

// studioTaskTypes 创作中心自己创建的任务类型。执行插件还会有别的任务
// （ToB API 影子任务 video.api / minimax-api、审计任务等），历史列表必须
// 排除，否则同一用户的 API 任务会以残缺卡片混进工作台画廊。
func isStudioTaskType(taskType string) bool {
	switch taskType {
	case "image.generate", "image.edit", "video.generate":
		return true
	default:
		return false
	}
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
// gateway-gemini 支持文生图和参考图编辑，但不支持 mask 局部重绘；Studio 的
// capability registry 负责不在 inpaint UI 暴露 Gemini。gateway-seedance 首期
// 不支持编辑/参考图，在创建入口拦下。
func executorSupportsTaskType(executorID, taskType string) bool {
	switch executorID {
	case "gateway-gemini":
		return taskType == "image.generate" || taskType == "image.edit"
	case "gateway-seedance":
		return taskType == "video.generate" || taskType == "image.generate"
	case "gateway-minimax", "gateway-bailian", "gateway-kling":
		return taskType == "video.generate"
	default:
		return true
	}
}

func executorSupportsOperation(executorID, operation string) bool {
	return executorID != "gateway-gemini" || operation != "inpaint"
}

// videoModelResolutions Seedance 各版本允许的分辨率（与 gateway-seedance
// registry 对齐）。国内标准版不支持 4K；海外 fast / mini 只有 480p/720p。
func videoModelResolutions(model string) map[string]struct{} {
	m := strings.ToLower(canonicalSeedanceVideoModel(model))
	if m == videoModelSeedanceStandardDomestic {
		return map[string]struct{}{"480p": {}, "720p": {}, "1080p": {}}
	}
	if m == videoModelSeedance25 {
		return map[string]struct{}{"480p": {}, "720p": {}}
	}
	if strings.Contains(m, "-fast-") || strings.Contains(m, "-mini-") {
		return map[string]struct{}{"480p": {}, "720p": {}}
	}
	return map[string]struct{}{"480p": {}, "720p": {}, "1080p": {}, "4k": {}}
}

var seedance25VideoRatios = map[string]struct{}{
	"16:9": {}, "4:3": {}, "1:1": {}, "3:4": {},
	"9:16": {}, "21:9": {}, "adaptive": {},
}

// minimaxVideoSpecs 与 gateway-minimax registry 对齐的参数域：
// H3 支持 768P/2K、4~15 秒；H3-Max 支持 480P/768P、5~15 秒（无 2K，无 -1 自动）。
var minimaxVideoSpecs = map[string]struct {
	resolutions map[string]struct{}
	minDuration int
	maxDuration int
}{
	"minimax-h3": {
		resolutions: map[string]struct{}{"768p": {}, "2k": {}},
		minDuration: 4,
		maxDuration: 15,
	},
	"minimax-h3-max": {
		resolutions: map[string]struct{}{"480p": {}, "768p": {}},
		minDuration: 5,
		maxDuration: 15,
	},
}

var minimaxVideoRatios = map[string]struct{}{
	"adaptive": {}, "21:9": {}, "16:9": {}, "4:3": {},
	"1:1": {}, "3:4": {}, "9:16": {},
}

func validateMiniMaxVideoParams(model string, params map[string]interface{}) error {
	spec, ok := minimaxVideoSpecs[strings.ToLower(strings.TrimSpace(model))]
	if !ok {
		return fmt.Errorf("模型 %s 不在 MiniMax 视频目录内", model)
	}
	if res, ok := params["resolution"].(string); ok && strings.TrimSpace(res) != "" {
		normalized := strings.ToLower(strings.TrimSpace(res))
		if _, allowed := spec.resolutions[normalized]; !allowed {
			return fmt.Errorf("模型 %s 不支持分辨率 %s", model, res)
		}
	}
	if v, ok := params["duration"]; ok {
		d, ok := toInt(v)
		if !ok {
			return fmt.Errorf("duration 必须是整数")
		}
		if d < spec.minDuration || d > spec.maxDuration {
			return fmt.Errorf("模型 %s 的 duration 需在 %d-%d 秒之间", model, spec.minDuration, spec.maxDuration)
		}
	}
	if ratio, ok := params["ratio"].(string); ok && strings.TrimSpace(ratio) != "" {
		normalized := strings.ToLower(strings.TrimSpace(ratio))
		if _, allowed := minimaxVideoRatios[normalized]; !allowed {
			return fmt.Errorf("模型 %s 不支持画幅 %s", model, ratio)
		}
	}
	return nil
}

// fleetVideoSpecs grok/百炼/可灵各视频模型的参数域（与各插件 registry 对齐）。
// key=小写模型 ID；ratios 为 nil 表示该模型不做画幅预校验（如快乐马 i2v
// 比例随首帧图，画幅键在提交层被丢弃）。
var fleetVideoSpecs = map[string]struct {
	resolutions map[string]struct{}
	minDuration int
	maxDuration int
	allowAuto   bool
	ratios      map[string]struct{}
}{
	// grok（platform=seedance 按秒计费档）：分辨率必填 480p/720p/1080p、
	// 时长 1~15 整数（无 -1 自动）、画幅白名单多 3:2/2:3、无 21:9/adaptive。
	"grok-imagine-video-1.5": {
		resolutions: map[string]struct{}{"480p": {}, "720p": {}, "1080p": {}},
		minDuration: 1, maxDuration: 15,
		ratios: map[string]struct{}{"1:1": {}, "16:9": {}, "9:16": {}, "4:3": {}, "3:4": {}, "3:2": {}, "2:3": {}},
	},
	// 万相 3.0：2~30 秒且支持 -1 自动；ratio 含 adaptive。
	"wan3.0-video": {
		resolutions: map[string]struct{}{"480p": {}, "720p": {}, "1080p": {}},
		minDuration: 2, maxDuration: 30, allowAuto: true,
		ratios: map[string]struct{}{"adaptive": {}, "16:9": {}, "4:3": {}, "1:1": {}, "3:4": {}, "9:16": {}},
	},
	"happyhorse-1.1-t2v": {
		resolutions: map[string]struct{}{"480p": {}, "720p": {}, "1080p": {}},
		minDuration: 3, maxDuration: 15,
		ratios: map[string]struct{}{"16:9": {}, "9:16": {}, "1:1": {}, "4:3": {}, "3:4": {}, "4:5": {}, "5:4": {}, "9:21": {}, "21:9": {}},
	},
	"happyhorse-1.1-i2v": {
		resolutions: map[string]struct{}{"480p": {}, "720p": {}, "1080p": {}},
		minDuration: 3, maxDuration: 15,
	},
	"happyhorse-1.1-r2v": {
		resolutions: map[string]struct{}{"480p": {}, "720p": {}, "1080p": {}},
		minDuration: 3, maxDuration: 15,
		ratios: map[string]struct{}{"16:9": {}, "9:16": {}, "1:1": {}, "4:3": {}, "3:4": {}, "4:5": {}, "5:4": {}, "9:21": {}, "21:9": {}},
	},
	// 可灵：分辨率合法集合由插件价格表 fail-closed，这里对齐已定价的桶。
	"kling-v3": {
		resolutions: map[string]struct{}{"720p": {}, "1080p": {}, "2k": {}, "4k": {}},
		minDuration: 3, maxDuration: 15,
		ratios: map[string]struct{}{"16:9": {}, "9:16": {}, "1:1": {}},
	},
	"kling-v2-6": {
		resolutions: map[string]struct{}{"720p": {}, "1080p": {}, "2k": {}, "4k": {}},
		minDuration: 5, maxDuration: 10,
		ratios: map[string]struct{}{"16:9": {}, "9:16": {}, "1:1": {}},
	},
}

func validateFleetVideoParams(model string, params map[string]interface{}) error {
	spec := fleetVideoSpecs[strings.ToLower(strings.TrimSpace(model))]
	if res, ok := params["resolution"].(string); ok && strings.TrimSpace(res) != "" {
		normalized := strings.ToLower(strings.TrimSpace(res))
		if _, allowed := spec.resolutions[normalized]; !allowed {
			return fmt.Errorf("模型 %s 不支持分辨率 %s", model, res)
		}
	}
	if v, ok := params["duration"]; ok {
		d, ok := toInt(v)
		if !ok {
			return fmt.Errorf("duration 必须是整数")
		}
		if d == -1 && spec.allowAuto {
			// -1 = 自动时长
		} else if d < spec.minDuration || d > spec.maxDuration {
			return fmt.Errorf("模型 %s 的 duration 需在 %d-%d 秒之间", model, spec.minDuration, spec.maxDuration)
		}
	}
	if spec.ratios != nil {
		if ratio, ok := params["ratio"].(string); ok && strings.TrimSpace(ratio) != "" {
			normalized := strings.ToLower(strings.TrimSpace(ratio))
			if _, allowed := spec.ratios[normalized]; !allowed {
				return fmt.Errorf("模型 %s 不支持画幅 %s", model, ratio)
			}
		}
	}
	return nil
}

// validateVideoModelParams 视频任务的参数预校验：分辨率按档位、时长限幅，
// 在创建入口给前端明确错误，避免排队后才在上游失败。
func validateVideoModelParams(model string, params map[string]interface{}) error {
	if _, isMiniMax := minimaxVideoSpecs[strings.ToLower(strings.TrimSpace(model))]; isMiniMax {
		return validateMiniMaxVideoParams(model, params)
	}
	if _, isFleet := fleetVideoSpecs[strings.ToLower(strings.TrimSpace(model))]; isFleet {
		return validateFleetVideoParams(model, params)
	}
	model = canonicalSeedanceVideoModel(model)
	if res, ok := params["resolution"].(string); ok && strings.TrimSpace(res) != "" {
		normalized := strings.ToLower(strings.TrimSpace(res))
		if _, allowed := videoModelResolutions(model)[normalized]; !allowed {
			return fmt.Errorf("模型 %s 不支持分辨率 %s", model, res)
		}
	}
	if v, ok := params["duration"]; ok {
		d, ok := toInt(v)
		if !ok {
			return fmt.Errorf("duration 必须是整数")
		}
		maxDuration := 15
		if isSeedance25VideoModel(model) {
			maxDuration = 30
		}
		if d != -1 && (d < 4 || d > maxDuration) {
			return fmt.Errorf("模型 %s 的 duration 需在 4-%d 秒之间，或使用 -1 自动选择", model, maxDuration)
		}
	}
	if isSeedance25VideoModel(model) {
		if ratio, ok := params["ratio"].(string); ok && strings.TrimSpace(ratio) != "" {
			normalized := strings.ToLower(strings.TrimSpace(ratio))
			if _, allowed := seedance25VideoRatios[normalized]; !allowed {
				return fmt.Errorf("模型 %s 不支持画幅 %s", model, ratio)
			}
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
		intLimit := float64(uint64(1) << (strconv.IntSize - 1))
		if math.IsNaN(n) || math.IsInf(n, 0) || math.Trunc(n) != n || n < -intLimit || n >= intLimit {
			return 0, false
		}
		return int(n), true
	case json.Number:
		i, err := n.Int64()
		return int(i), err == nil
	default:
		return 0, false
	}
}

func toPositiveInt64(v interface{}) (int64, bool) {
	switch n := v.(type) {
	case int:
		return int64(n), n > 0
	case int64:
		return n, n > 0
	case float64:
		if n <= 0 || math.Trunc(n) != n || n >= float64(uint64(1)<<63) {
			return 0, false
		}
		return int64(n), true
	case json.Number:
		i, err := n.Int64()
		return i, err == nil && i > 0
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
	ProjectID  int64                  `json:"project_id,omitempty"`
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
	// seedream-5-0-pro 仅支持 1K/2K，默认 2K；与 gateway-seedance 和前端契约一致。
	"seedream-5-0-pro": {
		"1024x1024": {}, "2048x2048": {},
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
	if strings.EqualFold(req.Platform, "seedance") {
		req.Model = canonicalSeedanceVideoModel(req.Model)
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
		"route_key": generationRouteKey(req.Platform, req.Model),
	}
	if req.ProjectID > 0 {
		attrs["project_id"] = req.ProjectID
	}
	for _, key := range []string{"size", "quality"} {
		if value, ok := req.Parameters[key]; ok && value != nil && fmt.Sprint(value) != "" {
			attrs[key] = fmt.Sprint(value)
		}
	}
	return attrs
}

func generationRouteKey(platform, model string) string {
	platform = strings.TrimSpace(platform)
	model = strings.TrimSpace(model)
	if platform == "" || model == "" {
		return ""
	}
	return platform + ":" + model
}

func taskString(value interface{}) string {
	if value == nil {
		return ""
	}
	if text, ok := value.(string); ok {
		return strings.TrimSpace(text)
	}
	return strings.TrimSpace(fmt.Sprint(value))
}

func generationTaskPlatform(task *hostTask) string {
	if v, ok := task.Attributes["platform"]; ok {
		if platform := taskString(v); platform != "" {
			return platform
		}
	}
	switch strings.ToLower(strings.TrimSpace(task.PluginID)) {
	case "gateway-gemini":
		return "gemini"
	case "gateway-seedance":
		return "seedance"
	case "gateway-minimax":
		return "minimax"
	case "gateway-bailian":
		return "bailian"
	case "gateway-kling":
		return "kling"
	case "gateway-openai":
		return "openai"
	default:
		return ""
	}
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
		if groupID, ok := toInt(task.Input["group_id"]); ok && groupID > 0 {
			resp["group_id"] = groupID
		}
	}
	if task.Output != nil {
		if content, ok := task.Output["content"].(string); ok && content != "" {
			resp["result_content"] = content
		}
		if urls := stringSliceFromAny(task.Output["video_urls"]); len(urls) > 0 {
			resp["video_urls"] = urls
		}
		if url, ok := task.Output["last_frame_url"].(string); ok && strings.TrimSpace(url) != "" {
			resp["last_frame_url"] = url
		}
		// 官方上游直链（seedance 插件在完结时写入,与视频同为 24h 有效),
		// 前端用来提供「官方源链接」溯源入口。
		if urls := stringSliceFromAny(task.Output["source_outputs"]); len(urls) > 0 {
			resp["source_outputs"] = urls
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
	// 路由身份必须使用请求模型；上游 output.model 可能是内部档位别名，不能
	// 覆盖重试/计费所需的原始模型。
	if v, ok := task.Attributes["model"]; ok && taskString(v) != "" {
		resp["model"] = taskString(v)
	} else if v, ok := task.Input["model"]; ok && taskString(v) != "" {
		resp["model"] = taskString(v)
	}
	platform := generationTaskPlatform(task)
	if platform != "" {
		resp["platform"] = platform
	}
	model := taskString(resp["model"])
	routeKey := generationRouteKey(platform, model)
	if routeKey == "" {
		if v, ok := task.Attributes["route_key"]; ok {
			routeKey = taskString(v)
		}
	}
	if routeKey != "" {
		resp["route_key"] = routeKey
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
	if v, ok := task.Attributes["kind"]; ok && fmt.Sprint(v) != "" {
		resp["kind"] = v
	}
	if projectID, ok := toPositiveInt64(task.Attributes["project_id"]); ok {
		resp["project_id"] = projectID
	}
	if v, ok := task.Input["duration"]; ok {
		if d, ok2 := toInt(v); ok2 && (d > 0 || d == -1) {
			resp["duration"] = d
		}
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
