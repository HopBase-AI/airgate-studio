package studio

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
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

// ── billing.budget（视频提交前预算预检）──────────────────────────────────────

// budgetTestHost 覆盖创建视频任务这一整条链路要用到的 host 方法：
// groups.list（分组资格）→ gateway.forward（问执行插件 /v1/video/estimate 估价）
// → billing.budget（预算判定）→ tasks.create（建任务）。
type budgetTestHost struct {
	methods    []string
	sufficient bool
	message    string
	// estimateStatus / estimateCost 模拟执行插件的预估应答；0 状态码＝转发本身失败
	// （老插件没有这条路由 / core 不给过）。
	estimateStatus int
	estimateCost   float64
	budgetErr      error
	// estimateBody / budget 记下两跳收到的入参，用于断言 studio 传对了东西。
	estimateBody  map[string]interface{}
	estimatePath  string
	estimateModel string
	budget        map[string]interface{}
}

func (h *budgetTestHost) Invoke(_ context.Context, req sdk.HostInvokeRequest) (*sdk.HostInvokeResponse, error) {
	h.methods = append(h.methods, req.Method)
	switch req.Method {
	case hostMethodGroupsList:
		return &sdk.HostInvokeResponse{Status: "ok", Payload: map[string]interface{}{"groups": []interface{}{
			map[string]interface{}{"id": 21, "name": "视频标准", "platform": "seedance", "rate_multiplier": 6.8, "effective_rate": 6.8},
		}}}, nil
	case hostMethodGatewayForward:
		h.estimatePath, _ = req.Payload["path"].(string)
		h.estimateModel, _ = req.Payload["model"].(string)
		raw, _ := req.Payload["body"].(string)
		_ = json.Unmarshal([]byte(raw), &h.estimateBody)
		if h.estimateStatus == 0 {
			return nil, errors.New("no available account")
		}
		body, _ := json.Marshal(map[string]interface{}{"estimated_official_cost": h.estimateCost, "detail": map[string]interface{}{}})
		return &sdk.HostInvokeResponse{Status: "ok", Payload: map[string]interface{}{
			"status_code": float64(h.estimateStatus),
			"body":        string(body),
		}}, nil
	case hostMethodBillingBudget:
		h.budget = req.Payload
		if h.budgetErr != nil {
			return nil, h.budgetErr
		}
		return &sdk.HostInvokeResponse{Status: "ok", Payload: map[string]interface{}{
			"balance":         12.0,
			"reserved":        35.0,
			"available":       float64(-23),
			"currency":        "USD",
			"limited":         false,
			"quota_remaining": 0.0,
			"estimate":        21.0,
			"sufficient":      h.sufficient,
			"message":         h.message,
		}}, nil
	case hostMethodTasksCreate:
		return &sdk.HostInvokeResponse{Status: "ok", Payload: map[string]interface{}{"task": map[string]interface{}{
			"id":        float64(9001),
			"plugin_id": "gateway-seedance",
			"status":    "pending",
		}}}, nil
	default:
		return nil, errors.New("unexpected host method " + req.Method)
	}
}

func (h *budgetTestHost) InvokeStream(context.Context, sdk.HostStreamRequest) (sdk.HostStream, error) {
	return nil, errors.New("not implemented")
}

func (h *budgetTestHost) called(method string) bool {
	for _, m := range h.methods {
		if m == method {
			return true
		}
	}
	return false
}

func videoCreateRequest() *http.Request {
	body := `{
		"kind":"video",
		"operation":"generate",
		"platform":"seedance",
		"model":"` + videoModelSeedanceStandardOverseas + `",
		"prompt":"a lighthouse in a storm",
		"group_id":21,
		"parameters":{"duration":5,"resolution":"720p","ratio":"16:9"},
		"inputs":[{"type":"image","role":"reference_image","url":"https://example.test/ref.png"}]
	}`
	req := httptest.NewRequest(http.MethodPost, "/generation-tasks", strings.NewReader(body))
	req.Header.Set(headerUserID, "77")
	return req
}

func newBudgetPlugin(host sdk.Host) *StudioPlugin {
	return &StudioPlugin{host: host, logger: slog.New(slog.NewTextHandler(io.Discard, nil))}
}

// 余额够：预检放行，任务照常创建。顺带盯住估价那一跳传对了路径、模型与参考图张数
// （参考图只传张数占位，不把几 MB 的 data URL 再传一遍）。
func TestHandleCreateGenerationTaskCreatesWhenBudgetSufficient(t *testing.T) {
	host := &budgetTestHost{sufficient: true, estimateStatus: http.StatusOK, estimateCost: 3.5}
	recorder := httptest.NewRecorder()

	newBudgetPlugin(host).handleCreateGenerationTask(recorder, videoCreateRequest())

	if recorder.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want %d (body=%s)", recorder.Code, http.StatusAccepted, recorder.Body.String())
	}
	if !host.called(hostMethodGatewayForward) || !host.called(hostMethodBillingBudget) || !host.called(hostMethodTasksCreate) {
		t.Fatalf("methods = %v, want 估价、预检与建任务都发生", host.methods)
	}
	if host.estimatePath != videoEstimatePath || host.estimateModel != videoModelSeedanceStandardOverseas {
		t.Fatalf("estimate path/model = %q/%q", host.estimatePath, host.estimateModel)
	}
	if images, _ := host.estimateBody["images"].([]interface{}); len(images) != 1 {
		t.Fatalf("estimate images = %#v, want 1 张占位", host.estimateBody["images"])
	}
	if params, _ := host.estimateBody["parameters"].(map[string]interface{}); params["resolution"] != "720p" {
		t.Fatalf("estimate parameters = %#v", host.estimateBody["parameters"])
	}
	if got := host.budget["estimated_official_cost"]; got != 3.5 {
		t.Fatalf("estimated_official_cost = %v, want 服务端自估的 3.5", got)
	}
	if got := host.budget["group_id"]; got != int64(21) {
		t.Fatalf("group_id = %#v, want 21", got)
	}
	if got := host.budget["user_id"]; got != int64(77) {
		t.Fatalf("user_id = %#v, want 77", got)
	}
}

// 余额不够：402 + core 原文（含三个金额），且不建任务——后付费任务一旦创建就可能出片却结不了账。
func TestHandleCreateGenerationTaskRejectsInsufficientBudget(t *testing.T) {
	const message = "余额不足：可用 $12.00，在途预留 $35.00，本条预估 $21.00"
	host := &budgetTestHost{sufficient: false, message: message, estimateStatus: http.StatusOK, estimateCost: 21}
	recorder := httptest.NewRecorder()

	newBudgetPlugin(host).handleCreateGenerationTask(recorder, videoCreateRequest())

	if recorder.Code != http.StatusPaymentRequired {
		t.Fatalf("status = %d, want %d (body=%s)", recorder.Code, http.StatusPaymentRequired, recorder.Body.String())
	}
	var body map[string]string
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if body["error"] != message {
		t.Fatalf("error = %q, want core 原文 %q", body["error"], message)
	}
	if body["code"] != "insufficient_balance" {
		t.Fatalf("code = %q, want insufficient_balance", body["code"])
	}
	if host.called(hostMethodTasksCreate) {
		t.Fatalf("methods = %v, 预算不足时不应创建任务", host.methods)
	}
}

// 预检自身故障（core 不可达 / 老版本没有该 host 方法）不能挡提交：core 转发侧仍会拦。
func TestHandleCreateGenerationTaskProceedsWhenBudgetHostFails(t *testing.T) {
	host := &budgetTestHost{budgetErr: errors.New("host method billing.budget 未实现"), estimateStatus: http.StatusOK, estimateCost: 21}
	recorder := httptest.NewRecorder()

	newBudgetPlugin(host).handleCreateGenerationTask(recorder, videoCreateRequest())

	if recorder.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want %d (body=%s)", recorder.Code, http.StatusAccepted, recorder.Body.String())
	}
	if !host.called(hostMethodTasksCreate) {
		t.Fatalf("methods = %v, want 仍然创建任务", host.methods)
	}
}

// 估价拿不到（老插件没有 /v1/video/estimate、模型未定价）时不问预算，直接提交。
func TestHandleCreateGenerationTaskSkipsBudgetWithoutEstimate(t *testing.T) {
	host := &budgetTestHost{sufficient: true, estimateStatus: http.StatusBadRequest}
	recorder := httptest.NewRecorder()

	newBudgetPlugin(host).handleCreateGenerationTask(recorder, videoCreateRequest())

	if recorder.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want %d (body=%s)", recorder.Code, http.StatusAccepted, recorder.Body.String())
	}
	if host.called(hostMethodBillingBudget) {
		t.Fatalf("methods = %v, 无预估时不应发起预检", host.methods)
	}
	if !host.called(hostMethodTasksCreate) {
		t.Fatalf("methods = %v, want 仍然创建任务", host.methods)
	}
}

// /budget 路由自己走完「估价 → 预算」两跳，把 core 载荷原样透传并补上官方成本预估。
func TestHandleBudgetEstimatesThenPassesCorePayloadThrough(t *testing.T) {
	host := &budgetTestHost{sufficient: true, estimateStatus: http.StatusOK, estimateCost: 2.5}
	req := httptest.NewRequest(http.MethodPost, "/budget", strings.NewReader(`{
		"platform":"seedance",
		"group_id":21,
		"model":"`+videoModelSeedanceStandardOverseas+`",
		"parameters":{"duration":5,"resolution":"720p"},
		"reference_images":2
	}`))
	req.Header.Set(headerUserID, "77")
	recorder := httptest.NewRecorder()

	newBudgetPlugin(host).handleBudget(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", recorder.Code, recorder.Body.String())
	}
	var body map[string]interface{}
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	for _, key := range []string{"balance", "reserved", "available", "currency", "limited", "quota_remaining", "estimate", "sufficient", "message", "estimated_official_cost"} {
		if _, ok := body[key]; !ok {
			t.Fatalf("body 缺少 %s：%v", key, body)
		}
	}
	if body["estimate"] != 21.0 || body["sufficient"] != true || body["estimated_official_cost"] != 2.5 {
		t.Fatalf("body = %v", body)
	}
	if images, _ := host.estimateBody["images"].([]interface{}); len(images) != 2 {
		t.Fatalf("estimate images = %#v, want 2 张占位", host.estimateBody["images"])
	}
	if got := host.budget["estimated_official_cost"]; got != 2.5 {
		t.Fatalf("budget estimated_official_cost = %v, want 2.5", got)
	}
}

// 只问余额（不带 model）时跳过估价那一跳，直接回余额与在途预留。
func TestHandleBudgetWithoutModelSkipsEstimate(t *testing.T) {
	host := &budgetTestHost{sufficient: true}
	req := httptest.NewRequest(http.MethodPost, "/budget", strings.NewReader(`{"platform":"seedance","group_id":21}`))
	req.Header.Set(headerUserID, "77")
	recorder := httptest.NewRecorder()

	newBudgetPlugin(host).handleBudget(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", recorder.Code, recorder.Body.String())
	}
	if host.called(hostMethodGatewayForward) {
		t.Fatalf("methods = %v, 无 model 时不应估价", host.methods)
	}
	if _, ok := host.budget["estimated_official_cost"]; ok {
		t.Fatalf("budget payload 不应带预估：%v", host.budget)
	}
}

func TestHandleBudgetRequiresPlatform(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/budget", strings.NewReader(`{"model":"x"}`))
	req.Header.Set(headerUserID, "77")
	recorder := httptest.NewRecorder()

	newBudgetPlugin(&budgetTestHost{}).handleBudget(recorder, req)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", recorder.Code)
	}
}
