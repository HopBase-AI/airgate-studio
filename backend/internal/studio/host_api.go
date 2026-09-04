package studio

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync/atomic"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	sdk "github.com/DouDOU-start/airgate-sdk/sdkgo"
)

const (
	hostMethodTasksCreate    = "tasks.create"
	hostMethodTasksGet       = "tasks.get"
	hostMethodTasksList      = "tasks.list"
	hostMethodTasksDelete    = "tasks.delete"
	hostMethodPlatformsList  = "platforms.list"
	hostMethodModelsList     = "models.list"
	hostMethodGroupsList     = "groups.list"
	hostMethodUsersGet       = "users.get"
	hostMethodGatewayForward = "gateway.forward"
	hostMethodAssetsGetBytes = "assets.get_bytes"
	hostMethodBillingBudget  = "billing.budget"
)

func hostInvoke(ctx context.Context, host sdk.Host, method string, payload map[string]interface{}) (map[string]interface{}, error) {
	if host == nil {
		return nil, fmt.Errorf("host 未启用")
	}
	resp, err := host.Invoke(ctx, sdk.HostInvokeRequest{
		Method:  method,
		Payload: payload,
	})
	if err != nil {
		return nil, err
	}
	if resp == nil {
		return map[string]interface{}{}, nil
	}
	if strings.EqualFold(resp.Status, "error") {
		if msg, _ := resp.Payload["message"].(string); msg != "" {
			return nil, fmt.Errorf("%s", msg)
		}
		return nil, fmt.Errorf("host method %s 返回错误", method)
	}
	return resp.Payload, nil
}

type hostTask struct {
	ID           int64                  `json:"id"`
	PluginID     string                 `json:"plugin_id"`
	TaskType     string                 `json:"task_type"`
	Status       string                 `json:"status"`
	Progress     int                    `json:"progress"`
	Input        map[string]interface{} `json:"input"`
	Output       map[string]interface{} `json:"output"`
	Attributes   map[string]interface{} `json:"attributes"`
	ErrorMessage string                 `json:"error_message"`
	// ErrorType / ErrorCode 执行器写入的失败分类（如 content_policy / output_audio_copyright），
	// 前端据此给出可执行的提示，而不是只回放上游原文。
	ErrorType   string `json:"error_type"`
	ErrorCode   string `json:"error_code"`
	CreatedAt   string `json:"created_at"`
	UpdatedAt   string `json:"updated_at"`
	CompletedAt string `json:"completed_at,omitempty"`
}

func hostCreateTask(ctx context.Context, host sdk.Host, pluginID, taskType string, userID int64, input map[string]interface{}, attributes map[string]interface{}) (*hostTask, error) {
	maxAttempts := 3
	// 视频生成远长于图片：单次 attempt 上限 10 分钟（core taskProcessTimeout），
	// 插件段内轮询到点会主动让位重排队，放宽 attempts 让长任务能续跑完。
	if strings.HasPrefix(taskType, "video.") {
		maxAttempts = 8
	}
	payload := map[string]interface{}{
		"plugin_id":    pluginID,
		"task_type":    taskType,
		"user_id":      userID,
		"input":        input,
		"priority":     0,
		"max_attempts": maxAttempts,
	}
	if len(attributes) > 0 {
		payload["attributes"] = attributes
	}
	resp, err := hostInvoke(ctx, host, hostMethodTasksCreate, payload)
	if err != nil {
		return nil, err
	}
	return hostTaskFromPayload(firstValue(resp, "task", "data", "result", ""))
}

func hostGetTask(ctx context.Context, host sdk.Host, pluginID string, userID, taskID int64) (*hostTask, error) {
	payload := map[string]interface{}{
		"task_id": taskID,
		"user_id": userID,
	}
	if pluginID != "" {
		payload["plugin_id"] = pluginID
	}
	resp, err := hostInvoke(ctx, host, hostMethodTasksGet, payload)
	if err != nil {
		return nil, err
	}
	return hostTaskFromPayload(firstValue(resp, "task", "data", "result", ""))
}

func hostGetTaskIn(ctx context.Context, host sdk.Host, pluginIDs []string, userID, taskID int64) (*hostTask, error) {
	payload := map[string]interface{}{
		"task_id":    taskID,
		"user_id":    userID,
		"plugin_ids": pluginIDs,
	}
	resp, err := hostInvoke(ctx, host, hostMethodTasksGet, payload)
	if err != nil {
		return nil, err
	}
	return hostTaskFromPayload(firstValue(resp, "task", "data", "result", ""))
}

// tasksGetPluginIDsSupported 记录 core 是否认得 tasks.get 的 plugin_ids(2026-09-04 起支持)。
// 一旦按集合查询命中过一次就置 true,之后集合查询的 NotFound 就是真的不存在,不再逐插件试探。
var tasksGetPluginIDsSupported atomic.Bool

// hostGetTaskFromPlugins 在执行插件集合内查任务。
//
// 先带 plugin_ids 一次命中:旧实现逐插件试探,命中前每次未命中都在 core 与 SDK 两侧
// 落 ERROR(Seedance 任务每次轮询固定撞 openai/gemini 两次,可灵撞五次;2026-09-03 生产
// 单日 1.7 万条),把真实错误淹掉。旧 core 不认 plugin_ids 时会按调用方插件过滤而 NotFound,
// 此时退回逐插件试探,发布窗口两侧任意版本组合都能工作。
func hostGetTaskFromPlugins(ctx context.Context, host sdk.Host, pluginIDs []string, userID, taskID int64) (*hostTask, error) {
	if len(pluginIDs) > 1 {
		task, err := hostGetTaskIn(ctx, host, pluginIDs, userID, taskID)
		if err == nil {
			tasksGetPluginIDsSupported.Store(true)
			return task, nil
		}
		if !isHostTaskNotFound(err) {
			return nil, err
		}
		if tasksGetPluginIDsSupported.Load() {
			return nil, err
		}
	}
	var notFoundErr error
	for _, pluginID := range pluginIDs {
		task, err := hostGetTask(ctx, host, pluginID, userID, taskID)
		if err == nil {
			return task, nil
		}
		if isHostTaskNotFound(err) {
			notFoundErr = err
			continue
		}
		return nil, err
	}
	if notFoundErr != nil {
		return nil, notFoundErr
	}
	return nil, fmt.Errorf("task not found")
}

func isHostTaskNotFound(err error) bool {
	if err == nil {
		return false
	}
	if status.Code(err) == codes.NotFound {
		return true
	}
	msg := err.Error()
	return strings.Contains(strings.ToLower(msg), "task not found") || strings.Contains(strings.ToLower(msg), "notfound")
}

type hostTaskListResponse struct {
	Tasks []*hostTask
	Total int
}

func hostListTasks(ctx context.Context, host sdk.Host, pluginIDs []string, userID int64, taskType, status string, limit, offset int) (*hostTaskListResponse, error) {
	payload := map[string]interface{}{
		"user_id":   userID,
		"task_type": taskType,
		"status":    status,
		"limit":     limit,
		"offset":    offset,
	}
	if len(pluginIDs) > 0 {
		payload["plugin_ids"] = pluginIDs
	}
	resp, err := hostInvoke(ctx, host, hostMethodTasksList, payload)
	if err != nil {
		return nil, err
	}
	out := &hostTaskListResponse{Total: intFromAny(firstValue(resp, "total", "count"))}
	if tasks, ok := firstValue(resp, "tasks", "items", "data").([]interface{}); ok {
		for _, item := range tasks {
			task, err := hostTaskFromPayload(item)
			if err != nil {
				return nil, err
			}
			out.Tasks = append(out.Tasks, task)
		}
	}
	if out.Total == 0 {
		out.Total = len(out.Tasks)
	}
	return out, nil
}

func hostDeleteTask(ctx context.Context, host sdk.Host, pluginID string, userID, taskID int64) error {
	payload := map[string]interface{}{
		"task_id": taskID,
		"user_id": userID,
	}
	if pluginID != "" {
		payload["plugin_id"] = pluginID
	}
	_, err := hostInvoke(ctx, host, hostMethodTasksDelete, payload)
	return err
}

func hostDeleteTaskFromPlugins(ctx context.Context, host sdk.Host, pluginIDs []string, userID, taskID int64) error {
	for _, pluginID := range pluginIDs {
		err := hostDeleteTask(ctx, host, pluginID, userID, taskID)
		if err == nil {
			return nil
		}
		if isHostTaskNotFound(err) {
			continue
		}
		return err
	}
	return nil
}

func hostListPlatforms(ctx context.Context, host sdk.Host) ([]interface{}, error) {
	resp, err := hostInvoke(ctx, host, hostMethodPlatformsList, map[string]interface{}{})
	if err != nil {
		return nil, err
	}
	if items, ok := firstValue(resp, "platforms", "items", "data").([]interface{}); ok {
		return items, nil
	}
	return nil, nil
}

func hostListModels(ctx context.Context, host sdk.Host, platform, capability string) ([]interface{}, error) {
	payload := map[string]interface{}{}
	if platform != "" {
		payload["platform"] = platform
	}
	if capability != "" {
		payload["capability"] = capability
	}
	resp, err := hostInvoke(ctx, host, hostMethodModelsList, payload)
	if err != nil {
		return nil, err
	}
	if items, ok := firstValue(resp, "models", "items", "data").([]interface{}); ok {
		return items, nil
	}
	return nil, nil
}

func hostTaskFromPayload(value interface{}) (*hostTask, error) {
	if value == nil {
		return nil, fmt.Errorf("task payload is nil")
	}
	body, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	var task hostTask
	if err := json.Unmarshal(body, &task); err != nil {
		return nil, err
	}
	return &task, nil
}

func firstValue(payload map[string]interface{}, keys ...string) interface{} {
	if payload == nil {
		return nil
	}
	for _, key := range keys {
		if key == "" {
			return payload
		}
		if value, ok := payload[key]; ok {
			return value
		}
	}
	return nil
}

func intFromAny(value interface{}) int {
	switch v := value.(type) {
	case int:
		return v
	case int64:
		return int(v)
	case float64:
		return int(v)
	case json.Number:
		n, _ := v.Int64()
		return int(n)
	default:
		return 0
	}
}

// ── Video cost estimate（提交前问执行插件这条大概多少钱）──────────────────────

// videoEstimatePath 各视频网关插件统一的预估路由（metadata_only：不调度账号、
// 不打上游、不计费）。它是 gateway 路由不是 ext-user 路由——core 的
// /api/v1/ext-user/gateway-* 代理对网关插件是空路由表，只能经 gateway.forward 打。
const videoEstimatePath = "/v1/video/estimate"

// estimateReferencePlaceholder 估价只看参考图**张数**（首帧/参考图会切价格档），
// 不看内容：用占位符保留张数，免得把几 MB 的 data URL 再多传一遍。
const estimateReferencePlaceholder = "reference-image"

// buildVideoEstimateBody 拼预估请求体。插件侧宽松解析：parameters 平铺或嵌套都认，
// 参考图从 images 数组取长度。
func buildVideoEstimateBody(model string, parameters map[string]interface{}, referenceImages int) ([]byte, error) {
	payload := map[string]interface{}{"model": strings.TrimSpace(model)}
	if len(parameters) > 0 {
		payload["parameters"] = parameters
	}
	if referenceImages > 0 {
		images := make([]string, 0, referenceImages)
		for i := 0; i < referenceImages; i++ {
			images = append(images, estimateReferencePlaceholder)
		}
		payload["images"] = images
	}
	return json.Marshal(payload)
}

// hostEstimateVideoOfficialCost 经 gateway.forward 问执行插件本条视频的官方成本
// （USD、分组倍率前）。插件不认这个模型/分辨率时回 400，调用方按「拿不到预估」处理。
func hostEstimateVideoOfficialCost(ctx context.Context, host sdk.Host, userID, groupID int64, platform, model string, body []byte) (float64, error) {
	headers := http.Header{}
	headers.Set("Content-Type", "application/json")
	headers.Set("X-Airgate-Platform", strings.TrimSpace(platform))

	resp, err := hostForward(ctx, host, hostForwardRequest{
		UserID:  userID,
		GroupID: groupID,
		Model:   strings.TrimSpace(model),
		Method:  http.MethodPost,
		Path:    videoEstimatePath,
		Headers: headers,
		Body:    body,
	})
	if err != nil {
		return 0, err
	}
	if resp.StatusCode != http.StatusOK {
		return 0, fmt.Errorf("预估端点返回 %d: %s", resp.StatusCode, truncate(string(resp.Body), 200))
	}
	var payload struct {
		EstimatedOfficialCost float64 `json:"estimated_official_cost"`
	}
	if err := json.Unmarshal(resp.Body, &payload); err != nil {
		return 0, fmt.Errorf("预估响应解析失败: %w", err)
	}
	if payload.EstimatedOfficialCost <= 0 {
		return 0, fmt.Errorf("预估结果非正数")
	}
	return payload.EstimatedOfficialCost, nil
}

// ── Billing budget（视频后付费的提交前预算预检）────────────────────────────────

// budgetInfo 是 core billing.budget 的应答。
// available = min(余额, 受限时的剩余额度) − 在途预留；estimate 是按路由分组倍率
// 折算后的「用户侧」预估花费（插件回的 estimated_official_cost 是官方成本）。
// sufficient=false 时 message 是 core 拼好的用户可读文案（含三个金额），
// 必须原样透给用户——数字才是他要的信息。
type budgetInfo struct {
	Balance        float64 `json:"balance"`
	Reserved       float64 `json:"reserved"`
	Available      float64 `json:"available"`
	Currency       string  `json:"currency"`
	Limited        bool    `json:"limited"`
	QuotaRemaining float64 `json:"quota_remaining"`
	Estimate       float64 `json:"estimate"`
	Sufficient     bool    `json:"sufficient"`
	Message        string  `json:"message"`
}

// hostBudgetPayload 原样取回 core billing.budget 的载荷（/budget 路由透传用）。
func hostBudgetPayload(ctx context.Context, host sdk.Host, userID int64, platform string, groupID int64, estimatedOfficialCost float64) (map[string]interface{}, error) {
	payload := map[string]interface{}{
		"user_id":  userID,
		"platform": strings.TrimSpace(platform),
	}
	if groupID > 0 {
		payload["group_id"] = groupID
	}
	if estimatedOfficialCost > 0 {
		payload["estimated_official_cost"] = estimatedOfficialCost
	}
	return hostInvoke(ctx, host, hostMethodBillingBudget, payload)
}

// hostBudget 取类型化的预算判定。
func hostBudget(ctx context.Context, host sdk.Host, userID int64, platform string, groupID int64, estimatedOfficialCost float64) (*budgetInfo, error) {
	resp, err := hostBudgetPayload(ctx, host, userID, platform, groupID, estimatedOfficialCost)
	if err != nil {
		return nil, err
	}
	raw, err := json.Marshal(resp)
	if err != nil {
		return nil, err
	}
	var info budgetInfo
	if err := json.Unmarshal(raw, &info); err != nil {
		return nil, err
	}
	return &info, nil
}

// ── Gateway forward（视频估价的 metadata_only 路由；skills 同步 LLM 调用同走这条）──

type hostForwardRequest struct {
	UserID  int64
	GroupID int64
	Model   string
	Method  string
	Path    string
	Headers http.Header
	Body    []byte
}

type hostForwardResponse struct {
	StatusCode int
	Body       []byte
}

// hostForward 通过 host gateway.forward 同步调用上游 LLM（非流式）。
func hostForward(ctx context.Context, host sdk.Host, req hostForwardRequest) (*hostForwardResponse, error) {
	payload := map[string]interface{}{
		"user_id":  req.UserID,
		"group_id": req.GroupID,
		"model":    req.Model,
		"method":   req.Method,
		"path":     req.Path,
		"headers":  headerPayload(req.Headers),
		"body":     string(req.Body),
		"stream":   false,
	}
	resp, err := hostInvoke(ctx, host, hostMethodGatewayForward, payload)
	if err != nil {
		return nil, err
	}
	return &hostForwardResponse{
		StatusCode: intFromAny(firstValue(resp, "status_code", "status")),
		Body:       bytesFromPayload(firstValue(resp, "body")),
	}, nil
}

func headerPayload(headers http.Header) map[string]interface{} {
	out := make(map[string]interface{}, len(headers))
	for key, values := range headers {
		out[key] = append([]string(nil), values...)
	}
	return out
}

// hostGetAssetDataURL 通过 assets.get_bytes 取回对象字节，拼成 data URL（供 vision 模型消费）。
func hostGetAssetDataURL(ctx context.Context, host sdk.Host, objectKey string) (string, error) {
	resp, err := hostInvoke(ctx, host, hostMethodAssetsGetBytes, map[string]interface{}{"object_key": objectKey})
	if err != nil {
		return "", err
	}
	data := binaryFromPayload(firstValue(resp, "data"))
	if len(data) == 0 {
		return "", fmt.Errorf("asset 字节为空")
	}
	contentType := stringFromAny(firstValue(resp, "content_type"))
	if contentType == "" {
		contentType = "image/png"
	}
	return "data:" + contentType + ";base64," + base64.StdEncoding.EncodeToString(data), nil
}

func bytesFromPayload(value interface{}) []byte {
	switch v := value.(type) {
	case nil:
		return nil
	case []byte:
		return v
	case string:
		if decoded, err := base64.StdEncoding.DecodeString(v); err == nil && looksLikeJSON(decoded) {
			return decoded
		}
		return []byte(v)
	default:
		body, _ := json.Marshal(v)
		return body
	}
}

// binaryFromPayload 解码按契约必为二进制的载荷字段（如 assets.get_bytes 的 data）。
// core 把 []byte 写进 payload 后经 JSON 编组，到达插件侧必然是 base64 字符串，须无条件解码。
// 不能复用 bytesFromPayload：其 looksLikeJSON 门槛会把图片等二进制的 base64 文本原样返回，
// 再编码进 data URL 即双重编码（playground 同缺陷曾致线上会话永久失败，2026-07-10）。
func binaryFromPayload(value interface{}) []byte {
	switch v := value.(type) {
	case nil:
		return nil
	case []byte:
		return v
	case string:
		if decoded, err := base64.StdEncoding.DecodeString(v); err == nil {
			return decoded
		}
		return []byte(v)
	default:
		body, _ := json.Marshal(v)
		return body
	}
}

func looksLikeJSON(body []byte) bool {
	trimmed := strings.TrimSpace(string(body))
	return strings.HasPrefix(trimmed, "{") || strings.HasPrefix(trimmed, "[")
}

func stringFromAny(value interface{}) string {
	switch v := value.(type) {
	case string:
		return v
	case nil:
		return ""
	default:
		return fmt.Sprint(v)
	}
}
