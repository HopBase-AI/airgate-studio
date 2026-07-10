package studio

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	sdk "github.com/DouDOU-start/airgate-sdk/sdkgo"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
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
	CreatedAt    string                 `json:"created_at"`
	UpdatedAt    string                 `json:"updated_at"`
	CompletedAt  string                 `json:"completed_at,omitempty"`
}

func hostCreateTask(ctx context.Context, host sdk.Host, pluginID, taskType string, userID int64, input map[string]interface{}, attributes map[string]interface{}) (*hostTask, error) {
	payload := map[string]interface{}{
		"plugin_id":    pluginID,
		"task_type":    taskType,
		"user_id":      userID,
		"input":        input,
		"priority":     0,
		"max_attempts": 3,
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

func hostGetTaskFromPlugins(ctx context.Context, host sdk.Host, pluginIDs []string, userID, taskID int64) (*hostTask, error) {
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

// ── Gateway forward（skills 同步 LLM 调用）────────────────────────────────────

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
