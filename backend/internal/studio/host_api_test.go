package studio

import (
	"context"
	"errors"
	"testing"

	sdk "github.com/DouDOU-start/airgate-sdk/sdkgo"
)

type taskHostCall struct {
	Method   string
	PluginID string
	TaskID   int64
	UserID   int64
}

type taskTestHost struct {
	calls []taskHostCall
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
	h.calls = append(h.calls, call)

	switch req.Method {
	case hostMethodTasksGet:
		if call.PluginID == "gateway-gemini" {
			return &sdk.HostInvokeResponse{
				Status: "ok",
				Payload: map[string]interface{}{"task": map[string]interface{}{
					"id":        float64(call.TaskID),
					"plugin_id": call.PluginID,
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

func TestHostGetTaskFromPluginsFallsBackAcrossExecutors(t *testing.T) {
	host := &taskTestHost{}

	task, err := hostGetTaskFromPlugins(context.Background(), host, generationExecutorPluginIDs(), 7, 42)
	if err != nil {
		t.Fatalf("hostGetTaskFromPlugins returned err: %v", err)
	}
	if task.PluginID != "gateway-gemini" || task.ID != 42 || task.ErrorMessage != "model not found" {
		t.Fatalf("task = %+v", task)
	}
	if len(host.calls) != 2 {
		t.Fatalf("calls = %+v, want 2 calls", host.calls)
	}
	if host.calls[0].PluginID != "gateway-openai" || host.calls[1].PluginID != "gateway-gemini" {
		t.Fatalf("calls = %+v", host.calls)
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
