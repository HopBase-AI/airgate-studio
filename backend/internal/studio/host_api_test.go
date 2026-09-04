package studio

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	sdk "github.com/DouDOU-start/airgate-sdk/sdkgo"
)

type taskHostCall struct {
	Method    string
	PluginID  string
	PluginIDs []string
	TaskID    int64
	UserID    int64
}

type taskTestHost struct {
	calls []taskHostCall
	// supportsPluginIDs 模拟 2026-09-04 起认得 tasks.get plugin_ids 的 core:
	// 集合内含 gateway-gemini 即命中;false 则模拟旧 core(忽略该字段 → NotFound)。
	supportsPluginIDs bool
}

func (h *taskTestHost) Invoke(_ context.Context, req sdk.HostInvokeRequest) (*sdk.HostInvokeResponse, error) {
	call := taskHostCall{
		Method: req.Method,
		TaskID: int64FromPayload(req.Payload["task_id"]),
		UserID: int64FromPayload(req.Payload["user_id"]),
	}
	if pluginID, _ := req.Payload["plugin_id"].(string); pluginID != "" {
		call.PluginID = pluginID
	}
	if ids, _ := req.Payload["plugin_ids"].([]string); len(ids) > 0 {
		call.PluginIDs = ids
	}
	h.calls = append(h.calls, call)

	switch req.Method {
	case hostMethodTasksGet:
		hit := call.PluginID == "gateway-gemini"
		if h.supportsPluginIDs && len(call.PluginIDs) > 0 {
			for _, id := range call.PluginIDs {
				if id == "gateway-gemini" {
					hit = true
				}
			}
		}
		if hit {
			return &sdk.HostInvokeResponse{
				Status: "ok",
				Payload: map[string]interface{}{"task": map[string]interface{}{
					"id":        float64(call.TaskID),
					"plugin_id": "gateway-gemini",
					"status":    "failed",
					"progress":  float64(30),
					"input": map[string]interface{}{
						"prompt": "draw",
						"model":  "gemini-3-pro-image",
					},
					"error_message": "model not found",
				}},
			}, nil
		}
		return &sdk.HostInvokeResponse{Status: "error", Payload: map[string]interface{}{"message": "task not found"}}, nil
	case hostMethodTasksDelete:
		if call.PluginID == "gateway-gemini" {
			return &sdk.HostInvokeResponse{Status: "ok", Payload: map[string]interface{}{"status": "deleted"}}, nil
		}
		return &sdk.HostInvokeResponse{Status: "error", Payload: map[string]interface{}{"message": "task not found"}}, nil
	default:
		return nil, errors.New("unexpected host method")
	}
}

func (h *taskTestHost) InvokeStream(context.Context, sdk.HostStreamRequest) (sdk.HostStream, error) {
	return nil, errors.New("not implemented")
}

func int64FromPayload(value interface{}) int64 {
	switch v := value.(type) {
	case int64:
		return v
	case int:
		return int64(v)
	case float64:
		return int64(v)
	default:
		return 0
	}
}

func resetTasksGetPluginIDsSupport(t *testing.T) {
	t.Helper()
	tasksGetPluginIDsSupported.Store(false)
	t.Cleanup(func() { tasksGetPluginIDsSupported.Store(false) })
}

// 新 core:一次 plugin_ids 查询即命中,不再逐插件试探。
func TestHostGetTaskFromPluginsSingleCallWithPluginIDs(t *testing.T) {
	resetTasksGetPluginIDsSupport(t)
	host := &taskTestHost{supportsPluginIDs: true}

	task, err := hostGetTaskFromPlugins(context.Background(), host, generationExecutorPluginIDs(), 7, 42)
	if err != nil {
		t.Fatalf("hostGetTaskFromPlugins returned err: %v", err)
	}
	if task.PluginID != "gateway-gemini" || task.ID != 42 {
		t.Fatalf("task = %+v", task)
	}
	if len(host.calls) != 1 {
		t.Fatalf("calls = %+v, want 1 call", host.calls)
	}
	if host.calls[0].PluginID != "" || len(host.calls[0].PluginIDs) != len(generationExecutorPluginIDs()) || host.calls[0].UserID != 7 {
		t.Fatalf("call = %+v, want plugin_ids 全集且不带 plugin_id", host.calls[0])
	}
	if !tasksGetPluginIDsSupported.Load() {
		t.Fatalf("命中后应记住 core 支持 plugin_ids")
	}
}

// 新 core 且已确认支持 plugin_ids:真的不存在时直接 NotFound,不再退回逐插件试探。
func TestHostGetTaskFromPluginsNotFoundDoesNotFanOutOnceSupported(t *testing.T) {
	resetTasksGetPluginIDsSupport(t)
	tasksGetPluginIDsSupported.Store(true)
	host := &taskTestHost{supportsPluginIDs: true}

	_, err := hostGetTaskFromPlugins(context.Background(), host, []string{"gateway-openai", "gateway-seedance"}, 7, 42)
	if !isHostTaskNotFound(err) {
		t.Fatalf("err = %v, want not found", err)
	}
	if len(host.calls) != 1 {
		t.Fatalf("calls = %+v, want 1 call(不扇出)", host.calls)
	}
}

// 旧 core:不认 plugin_ids 的集合查询 NotFound 后退回逐插件试探,行为与改前一致。
func TestHostGetTaskFromPluginsFallsBackAcrossExecutors(t *testing.T) {
	resetTasksGetPluginIDsSupport(t)
	host := &taskTestHost{}

	task, err := hostGetTaskFromPlugins(context.Background(), host, generationExecutorPluginIDs(), 7, 42)
	if err != nil {
		t.Fatalf("hostGetTaskFromPlugins returned err: %v", err)
	}
	if task.PluginID != "gateway-gemini" || task.ID != 42 || task.ErrorMessage != "model not found" {
		t.Fatalf("task = %+v", task)
	}
	if len(host.calls) != 3 {
		t.Fatalf("calls = %+v, want 3 calls(集合查询 + openai + gemini)", host.calls)
	}
	if len(host.calls[0].PluginIDs) == 0 || host.calls[1].PluginID != "gateway-openai" || host.calls[2].PluginID != "gateway-gemini" {
		t.Fatalf("calls = %+v", host.calls)
	}
	if tasksGetPluginIDsSupported.Load() {
		t.Fatalf("集合查询未命中而试探命中,不应记为支持 plugin_ids")
	}
}

func TestHostDeleteTaskFromPluginsTreatsExecutorNotFoundAsFallback(t *testing.T) {
	host := &taskTestHost{}

	if err := hostDeleteTaskFromPlugins(context.Background(), host, generationExecutorPluginIDs(), 7, 42); err != nil {
		t.Fatalf("hostDeleteTaskFromPlugins returned err: %v", err)
	}
	if len(host.calls) != 2 {
		t.Fatalf("calls = %+v, want 2 calls", host.calls)
	}
	if host.calls[0].Method != hostMethodTasksDelete || host.calls[0].PluginID != "gateway-openai" {
		t.Fatalf("first call = %+v", host.calls[0])
	}
	if host.calls[1].Method != hostMethodTasksDelete || host.calls[1].PluginID != "gateway-gemini" {
		t.Fatalf("second call = %+v", host.calls[1])
	}
}

func TestHostDeleteTaskFromPluginsTreatsAllNotFoundAsDeleted(t *testing.T) {
	host := &taskTestHost{}

	if err := hostDeleteTaskFromPlugins(context.Background(), host, []string{"gateway-openai"}, 7, 99); err != nil {
		t.Fatalf("hostDeleteTaskFromPlugins returned err: %v", err)
	}
	if len(host.calls) != 1 {
		t.Fatalf("calls = %+v, want 1 call", host.calls)
	}
	if host.calls[0].Method != hostMethodTasksDelete || host.calls[0].PluginID != "gateway-openai" {
		t.Fatalf("call = %+v", host.calls[0])
	}
}

// assetBytesTestHost 复刻 assets.get_bytes 的真实编组：core 把 []byte 放进 payload，
// 经 JSON 编组到达插件侧时 data 必然是 base64 字符串。直接手填 map 会掩盖双重编码 bug。
type assetBytesTestHost struct {
	data        []byte
	contentType string
}

func (h *assetBytesTestHost) Invoke(_ context.Context, req sdk.HostInvokeRequest) (*sdk.HostInvokeResponse, error) {
	if req.Method != hostMethodAssetsGetBytes {
		return nil, errors.New("unexpected method " + req.Method)
	}
	encoded, err := json.Marshal(map[string]interface{}{
		"data":         h.data,
		"content_type": h.contentType,
	})
	if err != nil {
		return nil, err
	}
	var payload map[string]interface{}
	if err := json.Unmarshal(encoded, &payload); err != nil {
		return nil, err
	}
	return &sdk.HostInvokeResponse{Status: "ok", Payload: payload}, nil
}

func (h *assetBytesTestHost) InvokeStream(context.Context, sdk.HostStreamRequest) (sdk.HostStream, error) {
	return nil, errors.New("not supported")
}

// 回归（对齐 playground 2026-07-10 线上事故）：data URL 载荷必须解回与 core 侧一致的原始字节。
func TestHostGetAssetDataURLDecodesWireBase64(t *testing.T) {
	t.Parallel()

	original := []byte{0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x01, 0x02, 0x03}
	host := &assetBytesTestHost{data: original, contentType: "image/png"}

	dataURL, err := hostGetAssetDataURL(context.Background(), host, "generated/1/demo.png")
	if err != nil {
		t.Fatalf("hostGetAssetDataURL() error = %v", err)
	}
	const prefix = "data:image/png;base64,"
	if !strings.HasPrefix(dataURL, prefix) {
		t.Fatalf("data URL 前缀 = %.40s", dataURL)
	}
	decoded, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(dataURL, prefix))
	if err != nil {
		t.Fatalf("base64 解码失败: %v", err)
	}
	if !bytes.Equal(decoded, original) {
		t.Fatalf("data URL 载荷与原始字节不一致：len=%d want %d（若变长说明双重 base64 编码）", len(decoded), len(original))
	}
}
