package studio

import (
	"encoding/json"
	"math"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
)

func TestBuildTaskInputKeepsEditImagesAndMask(t *testing.T) {
	req := createGenerationTaskRequest{
		Kind:      "image",
		Operation: "edit",
		Model:     "gpt-image-2",
		Prompt:    "change the jacket color",
		Parameters: map[string]interface{}{
			"size": "1024x1024",
		},
		Inputs: []generationInput{
			{Type: "image", Role: "source", URL: "data:image/png;base64,source"},
			{Type: "image", Role: "mask", URL: "data:image/png;base64,input-mask-is-ignored-here"},
		},
		Mask: &generationInput{Type: "image", Role: "mask", URL: "data:image/png;base64,mask"},
	}

	input := buildTaskInput(req)
	images, ok := input["images"].([]string)
	if !ok {
		t.Fatalf("images type = %T, want []string", input["images"])
	}
	if len(images) != 1 || images[0] != "data:image/png;base64,source" {
		t.Fatalf("images = %#v", images)
	}
	if got := input["mask"]; got != "data:image/png;base64,mask" {
		t.Fatalf("mask = %v", got)
	}
	if got := input["size"]; got != "1024x1024" {
		t.Fatalf("size = %v", got)
	}
	if got := input["preserve_reference"]; got != true {
		t.Fatalf("preserve_reference = %v, want true", got)
	}
	if got := input["prompt"]; got != "change the jacket color" {
		t.Fatalf("prompt = %v, want original prompt", got)
	}
}

func TestBuildTaskAttributesKeepsPositiveProjectID(t *testing.T) {
	attrs := buildTaskAttributes(createGenerationTaskRequest{
		Kind:      "video",
		Operation: "generate",
		Platform:  "seedance",
		Model:     "dreamina-seedance-2-0-mini-hc",
		ProjectID: 42,
	})
	if got := attrs["project_id"]; got != int64(42) {
		t.Fatalf("project_id = %v (%T), want int64(42)", got, got)
	}

	legacy := buildTaskAttributes(createGenerationTaskRequest{
		Kind:      "image",
		Operation: "generate",
		Platform:  "openai",
		Model:     "gpt-image-2",
	})
	if _, ok := legacy["project_id"]; ok {
		t.Fatalf("zero project_id should be omitted, got %v", legacy["project_id"])
	}
}

func TestValidateVideoModelParamsKeepsDomesticAndOverseasResolutionBoundaries(t *testing.T) {
	tests := []struct {
		name       string
		model      string
		resolution string
		wantErr    bool
	}{
		{name: "overseas standard supports 4k", model: videoModelSeedanceStandardOverseas, resolution: "4k"},
		{name: "domestic standard supports 1080p", model: videoModelSeedanceStandardDomestic, resolution: "1080p"},
		{name: "domestic standard rejects 4k", model: videoModelSeedanceStandardDomestic, resolution: "4k", wantErr: true},
		{name: "overseas fast supports 720p", model: videoModelSeedanceFastOverseas, resolution: "720p"},
		{name: "overseas fast rejects 1080p", model: videoModelSeedanceFastOverseas, resolution: "1080p", wantErr: true},
		{name: "overseas mini rejects 4k", model: videoModelSeedanceMiniOverseas, resolution: "4k", wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateVideoModelParams(tt.model, map[string]interface{}{"resolution": tt.resolution})
			if (err != nil) != tt.wantErr {
				t.Fatalf("validateVideoModelParams() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func TestValidateVideoModelParamsEnforcesSD25Specs(t *testing.T) {
	if canonicalSeedanceVideoModel(videoModelSeedance25LegacyEP) != videoModelSeedance25 {
		t.Fatal("legacy SD2.5 model must canonicalize to native ID")
	}
	for _, duration := range []int{4, 30, -1} {
		for _, resolution := range []string{"480p", "720p"} {
			for _, ratio := range []string{"16:9", "4:3", "1:1", "3:4", "9:16", "21:9", "adaptive"} {
				params := map[string]interface{}{"duration": duration, "resolution": resolution, "ratio": ratio}
				if err := validateVideoModelParams(videoModelSeedance25, params); err != nil {
					t.Fatalf("valid SD2.5 parameters rejected: duration=%d resolution=%s ratio=%s: %v", duration, resolution, ratio, err)
				}
			}
		}
	}
	for name, params := range map[string]map[string]interface{}{
		"duration_below_min": {"duration": 3, "resolution": "480p", "ratio": "16:9"},
		"duration_above_max": {"duration": 31, "resolution": "480p", "ratio": "16:9"},
		"resolution_1080p":   {"duration": 4, "resolution": "1080p", "ratio": "16:9"},
		"resolution_4k":      {"duration": 4, "resolution": "4k", "ratio": "16:9"},
		"ratio":              {"duration": 4, "resolution": "480p", "ratio": "2:1"},
	} {
		t.Run(name, func(t *testing.T) {
			if err := validateVideoModelParams(videoModelSeedance25, params); err == nil {
				t.Fatalf("invalid SD2.5 parameters accepted: %v", params)
			}
		})
	}
}

func TestValidateVideoModelParamsKeepsSeedance20DurationBoundary(t *testing.T) {
	for _, duration := range []int{4, 5, 10, 15, -1} {
		if err := validateVideoModelParams(videoModelSeedanceStandardOverseas, map[string]interface{}{"duration": duration}); err != nil {
			t.Fatalf("valid Seedance 2.0 duration %d rejected: %v", duration, err)
		}
	}
	for _, duration := range []int{3, 16, 30} {
		if err := validateVideoModelParams(videoModelSeedanceStandardOverseas, map[string]interface{}{"duration": duration}); err == nil {
			t.Fatalf("invalid Seedance 2.0 duration %d accepted", duration)
		}
	}
}

func TestValidateVideoModelParamsRejectsFractionalDuration(t *testing.T) {
	for _, duration := range []interface{}{float64(4.5), json.Number("4.5")} {
		err := validateVideoModelParams(videoModelSeedance25, map[string]interface{}{"duration": duration})
		if err == nil || !strings.Contains(err.Error(), "duration 必须是整数") {
			t.Fatalf("fractional duration %v error = %v, want integer validation error", duration, err)
		}
	}
	if err := validateVideoModelParams(videoModelSeedance25, map[string]interface{}{"duration": float64(4)}); err != nil {
		t.Fatalf("integral JSON duration rejected: %v", err)
	}
}

func TestToIntAcceptsOnlyIntegralFloat64(t *testing.T) {
	for _, value := range []float64{4, -1} {
		if got, ok := toInt(value); !ok || got != int(value) {
			t.Fatalf("toInt(%v) = (%d, %t), want (%d, true)", value, got, ok, int(value))
		}
	}
	for _, value := range []float64{4.5, math.Inf(1), math.NaN(), float64(uint64(1) << (strconv.IntSize - 1))} {
		if got, ok := toInt(value); ok {
			t.Fatalf("toInt(%v) = (%d, true), want conversion failure", value, got)
		}
	}
}

func TestBuildGenerationTaskResponseReturnsInputImages(t *testing.T) {
	task := &hostTask{
		ID:       12,
		Status:   "completed",
		Progress: 100,
		Input: map[string]interface{}{
			"prompt":   "turn it into anime",
			"model":    "gpt-image-2",
			"group_id": float64(42),
			"images": []interface{}{
				"data:image/png;base64,source",
			},
			"mask": "data:image/png;base64,mask",
		},
		Attributes: map[string]interface{}{
			"operation": "edit",
			"platform":  "openai",
			"model":     "gpt-image-2",
			"size":      "1024x1024",
		},
		Output: map[string]interface{}{
			"model": "gpt-image-2-1k",
		},
	}

	resp := buildGenerationTaskResponse(task)
	images, ok := resp["input_images"].([]string)
	if !ok {
		t.Fatalf("input_images type = %T, want []string", resp["input_images"])
	}
	if len(images) != 1 || images[0] != "data:image/png;base64,source" {
		t.Fatalf("input_images = %#v", images)
	}
	if got := resp["input_mask"]; got != "data:image/png;base64,mask" {
		t.Fatalf("input_mask = %v", got)
	}
	if got := resp["platform"]; got != "openai" {
		t.Fatalf("platform = %v, want openai", got)
	}
	if got := resp["group_id"]; got != 42 {
		t.Fatalf("group_id = %v (%T), want 42", got, got)
	}
	if got := resp["route_key"]; got != "openai:gpt-image-2" {
		t.Fatalf("route_key = %v, want openai:gpt-image-2", got)
	}
	if got := resp["model"]; got != "gpt-image-2" {
		t.Fatalf("model = %v, want requested public model", got)
	}
}

func TestBuildGenerationTaskResponseDoesNotInventMissingGroup(t *testing.T) {
	task := &hostTask{
		ID:       13,
		PluginID: "gateway-openai",
		Status:   "completed",
		Input: map[string]interface{}{
			"model": "gpt-image-2",
		},
		Attributes: map[string]interface{}{},
	}

	resp := buildGenerationTaskResponse(task)
	if _, ok := resp["group_id"]; ok {
		t.Fatalf("legacy task must not receive an invented group_id: %v", resp["group_id"])
	}
	if got := resp["route_key"]; got != "openai:gpt-image-2" {
		t.Fatalf("route_key = %v, want derived legacy route key", got)
	}
	if got := resp["platform"]; got != "openai" {
		t.Fatalf("platform = %v, want plugin fallback", got)
	}
}

func TestBuildTaskAttributesPersistsCanonicalRouteKey(t *testing.T) {
	attrs := buildTaskAttributes(createGenerationTaskRequest{
		Kind:     "image",
		Platform: "openai",
		Model:    "gpt-image-2",
	})
	if got := attrs["route_key"]; got != "openai:gpt-image-2" {
		t.Fatalf("route_key = %v", got)
	}
}

func TestBuildGenerationTaskResponseDoesNotCreateNilRoute(t *testing.T) {
	resp := buildGenerationTaskResponse(&hostTask{
		ID:         14,
		PluginID:   "gateway-openai",
		Status:     "processing",
		Input:      map[string]interface{}{},
		Attributes: map[string]interface{}{},
	})
	if _, ok := resp["route_key"]; ok {
		t.Fatalf("task without model must not expose a synthetic route: %v", resp["route_key"])
	}
}

func TestBuildGenerationTaskResponseReturnsKindAndDuration(t *testing.T) {
	video := &hostTask{
		ID:       21,
		Status:   "processing",
		Progress: 35,
		Input: map[string]interface{}{
			"prompt":   "a cat surfing",
			"model":    "dreamina-seedance-2-0-mini-hc",
			"duration": float64(5), // JSON 反序列化后的数值形态
		},
		Attributes: map[string]interface{}{
			"kind":       "video",
			"operation":  "generate",
			"size":       "720p",
			"project_id": float64(42),
		},
	}
	resp := buildGenerationTaskResponse(video)
	if got := resp["kind"]; got != "video" {
		t.Fatalf("kind = %v, want video", got)
	}
	if got := resp["duration"]; got != 5 {
		t.Fatalf("duration = %v (%T), want 5", got, got)
	}
	if got := resp["project_id"]; got != int64(42) {
		t.Fatalf("project_id = %v (%T), want 42", got, got)
	}
	autoDuration := buildGenerationTaskResponse(&hostTask{
		Input: map[string]interface{}{"duration": float64(-1)},
	})
	if got := autoDuration["duration"]; got != -1 {
		t.Fatalf("automatic duration = %v (%T), want -1", got, got)
	}

	image := &hostTask{
		ID:     22,
		Status: "completed",
		Input: map[string]interface{}{
			"prompt": "a cat",
			"model":  "gpt-image-2",
		},
		Attributes: map[string]interface{}{
			"kind":      "image",
			"operation": "generate",
		},
	}
	imgResp := buildGenerationTaskResponse(image)
	if got := imgResp["kind"]; got != "image" {
		t.Fatalf("image kind = %v", got)
	}
	if _, ok := imgResp["duration"]; ok {
		t.Fatalf("image task should not return duration, got %v", imgResp["duration"])
	}
	if _, ok := imgResp["project_id"]; ok {
		t.Fatalf("legacy task should not return project_id, got %v", imgResp["project_id"])
	}

	fractional := &hostTask{Attributes: map[string]interface{}{"project_id": float64(1.5)}}
	if _, ok := buildGenerationTaskResponse(fractional)["project_id"]; ok {
		t.Fatalf("fractional project_id must be omitted")
	}
}

func TestBuildGenerationTaskResponseReturnsSourceOutputs(t *testing.T) {
	video := &hostTask{
		ID:     23,
		Status: "completed",
		Input: map[string]interface{}{
			"prompt": "a cat surfing",
			"model":  "dreamina-seedance-2-0-mini-hc",
		},
		Output: map[string]interface{}{
			"video_urls":     []interface{}{"https://api.example.com/relay/v0.mp4"},
			"source_outputs": []interface{}{"https://tos.example.com/official/v0.mp4?sig=x"},
		},
		Attributes: map[string]interface{}{"kind": "video", "operation": "generate"},
	}
	resp := buildGenerationTaskResponse(video)
	urls, ok := resp["source_outputs"].([]string)
	if !ok || len(urls) != 1 || urls[0] != "https://tos.example.com/official/v0.mp4?sig=x" {
		t.Fatalf("source_outputs = %#v", resp["source_outputs"])
	}

	// 无 source_outputs 时不应出现该键(老任务兼容)。
	noSource := &hostTask{
		ID:     24,
		Status: "completed",
		Output: map[string]interface{}{
			"video_urls": []interface{}{"https://api.example.com/relay/v1.mp4"},
		},
	}
	if _, ok := buildGenerationTaskResponse(noSource)["source_outputs"]; ok {
		t.Fatal("task without source_outputs should not return the key")
	}
}

func TestGenerationExecutorPluginID(t *testing.T) {
	if got := generationExecutorPluginID("gemini"); got != "gateway-gemini" {
		t.Fatalf("gemini executor = %q", got)
	}
	if got := generationExecutorPluginID(" openai "); got != defaultExecutorPluginID {
		t.Fatalf("openai executor = %q", got)
	}
}

func TestIsGenerationExecutor(t *testing.T) {
	for _, id := range generationExecutorPluginIDs() {
		if !isGenerationExecutor(id) {
			t.Fatalf("%q should be a generation executor", id)
		}
	}
	if isGenerationExecutor("airgate-playground") {
		t.Fatal("other plugin should not be a generation executor")
	}
}

func TestExecutorSupportsTaskType(t *testing.T) {
	cases := []struct {
		executor string
		taskType string
		want     bool
	}{
		{"gateway-gemini", "image.generate", true},
		{"gateway-gemini", "image.edit", true},
		{"gateway-seedance", "video.generate", true},
		{"gateway-seedance", "image.generate", true},
		{"gateway-seedance", "image.edit", true},
		{"gateway-openai", "image.generate", true},
		{"gateway-openai", "image.edit", true},
	}
	for _, c := range cases {
		if got := executorSupportsTaskType(c.executor, c.taskType); got != c.want {
			t.Errorf("executorSupportsTaskType(%q, %q) = %v, want %v", c.executor, c.taskType, got, c.want)
		}
	}
}

func TestExecutorSupportsOperation(t *testing.T) {
	if !executorSupportsOperation("gateway-gemini", "edit") {
		t.Fatal("gateway-gemini should support image-to-image edits")
	}
	if executorSupportsOperation("gateway-gemini", "inpaint") {
		t.Fatal("gateway-gemini must not accept mask-based inpainting")
	}
	if !executorSupportsOperation("gateway-seedance", "edit") {
		t.Fatal("gateway-seedance should support image-to-image edits")
	}
	// Seedream 不吃传统 mask，局部编辑走标注 + <bbox> 坐标，见 gateway-seedance
	// images.go 的拒绝口径。
	if executorSupportsOperation("gateway-seedance", "inpaint") {
		t.Fatal("gateway-seedance must not accept mask-based inpainting")
	}
	if !executorSupportsOperation("gateway-openai", "inpaint") {
		t.Fatal("gateway-openai should retain inpainting support")
	}
}

func TestValidateImageModelSize(t *testing.T) {
	tests := []struct {
		name    string
		model   string
		size    string
		wantErr bool
	}{
		{name: "gpt image 4k", model: "gpt-image-2", size: "3840x2160"},
		{name: "banana lite 1k", model: "gemini-3.1-flash-lite-image", size: "1024x1536"},
		{name: "banana lite rejects 2k", model: "gemini-3.1-flash-lite-image", size: "2048x2048", wantErr: true},
		{name: "banana 2 rejects 4k", model: "gemini-3.1-flash-image", size: "3840x2160", wantErr: true},
		{name: "banana 2 chat variant rejects 4k", model: "gemini-3.1-flash-image-c", size: "3840x2160", wantErr: true},
		{name: "seedream 1k", model: "seedream-5-0-pro", size: "1024x1024"},
		{name: "seedream 2k", model: "seedream-5-0-pro", size: "2048x2048"},
		{name: "seedream rejects 4k", model: "seedream-5-0-pro", size: "4096x4096", wantErr: true},
		{name: "seedream rejects non-tier size", model: "seedream-5-0-pro", size: "1536x1024", wantErr: true},
		{name: "unknown model passes through", model: "custom-image-model", size: "2048x2048"},
		{name: "empty size passes through", model: "gemini-3.1-flash-lite-image", size: ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateImageModelSize(tt.model, map[string]interface{}{"size": tt.size})
			if tt.wantErr && err == nil {
				t.Fatal("expected error")
			}
			if !tt.wantErr && err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
		})
	}
}

func TestHandleCreateGenerationTaskRejectsSeedream4K(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/generation-tasks", strings.NewReader(`{
		"kind":"image",
		"platform":"seedance",
		"model":"seedream-5-0-pro",
		"prompt":"a lighthouse in a storm",
		"parameters":{"size":"4096x4096"}
	}`))
	recorder := httptest.NewRecorder()

	(&StudioPlugin{}).handleCreateGenerationTask(recorder, req)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusBadRequest)
	}
	if body := recorder.Body.String(); !strings.Contains(body, "不支持尺寸 4096x4096") {
		t.Fatalf("body = %q, want unsupported-size error", body)
	}
}

// gateway-seedance 把参考图地址原样交给上游拉取，而 core 会把 ≥16KB 的
// data:image/* 换成 /assets-runtime/... 相对地址。没有对外基地址，生图编辑任务
// 会以「参考图是相对地址但任务未携带 public_base」失败——这是图生图必须依赖的一环。
func TestPublicBaseFromRequest(t *testing.T) {
	cases := []struct {
		name  string
		proto string
		host  string
		want  string
	}{
		{name: "forwarded https", proto: "https", host: "api.hop-base.com", want: "https://api.hop-base.com"},
		{name: "defaults to https", host: "api.hop-base.com", want: "https://api.hop-base.com"},
		{name: "keeps explicit http", proto: "http", host: "127.0.0.1:9517", want: "http://127.0.0.1:9517"},
		{name: "no forwarded host", want: ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/generation-tasks", nil)
			if c.host != "" {
				req.Header.Set("X-Forwarded-Host", c.host)
			}
			if c.proto != "" {
				req.Header.Set("X-Forwarded-Proto", c.proto)
			}
			if got := publicBaseFromRequest(req); got != c.want {
				t.Fatalf("publicBaseFromRequest() = %q, want %q", got, c.want)
			}
		})
	}
}

// 视频任务的 error_message 只在失败终态下发：core 重排队（retrying）时写入的
// 「视频仍在生成中，等待下一轮继续」是续跑提示，续跑期间与完成后都不能被前端当失败。
func TestBuildGenerationTaskResponseHidesVideoRetryNote(t *testing.T) {
	const note = "视频仍在生成中，等待下一轮继续"
	video := func(status string) *hostTask {
		return &hostTask{
			ID:           31,
			TaskType:     "video.generate",
			Status:       status,
			ErrorMessage: note,
			Input:        map[string]interface{}{"model": "dreamina-seedance-2-5-260628"},
			Attributes:   map[string]interface{}{"kind": "video"},
		}
	}
	for _, status := range []string{"retrying", "processing", "pending", "completed"} {
		if _, ok := buildGenerationTaskResponse(video(status))["error_message"]; ok {
			t.Fatalf("视频任务 %s 态不应下发 error_message", status)
		}
	}
	for _, status := range []string{"failed", "cancelled"} {
		if got := buildGenerationTaskResponse(video(status))["error_message"]; got != note {
			t.Fatalf("视频任务 %s 态应下发 error_message，got %v", status, got)
		}
	}
	// 只有 attributes.kind 没有 task_type 前缀也按视频处理。
	kindOnly := video("retrying")
	kindOnly.TaskType = ""
	if _, ok := buildGenerationTaskResponse(kindOnly)["error_message"]; ok {
		t.Fatal("attributes.kind=video 的重试任务不应下发 error_message")
	}

	// 图片任务保持快失败：进行中带 error_message 照常下发；已完成的残留提示不下发。
	image := &hostTask{
		ID:           32,
		TaskType:     "image.generate",
		Status:       "processing",
		ErrorMessage: "model not found",
		Attributes:   map[string]interface{}{"kind": "image"},
	}
	if got := buildGenerationTaskResponse(image)["error_message"]; got != "model not found" {
		t.Fatalf("图片任务进行中的 error_message 应下发，got %v", got)
	}
	image.Status = "completed"
	if _, ok := buildGenerationTaskResponse(image)["error_message"]; ok {
		t.Fatal("已完成任务不应下发残留 error_message")
	}
}

// 失败终态随 error_message 一并下发执行器的分类码，前端据此给可执行提示；非终态一律不下发。
func TestBuildGenerationTaskResponseExposesErrorCodeOnlyWithError(t *testing.T) {
	task := &hostTask{
		ID:           41,
		TaskType:     "video.generate",
		Status:       "failed",
		ErrorMessage: "The request failed because the output audio may be related to copyright restrictions",
		ErrorType:    "content_policy",
		ErrorCode:    "output_audio_copyright",
		Attributes:   map[string]interface{}{"kind": "video"},
	}
	resp := buildGenerationTaskResponse(task)
	if resp["error_code"] != "output_audio_copyright" || resp["error_type"] != "content_policy" {
		t.Fatalf("失败终态应下发 error_code / error_type: %v", resp)
	}
	task.Status = "retrying"
	task.ErrorMessage = "视频仍在生成中，等待下一轮继续"
	resp = buildGenerationTaskResponse(task)
	if _, ok := resp["error_code"]; ok {
		t.Fatalf("非终态不应下发 error_code: %v", resp)
	}
}
