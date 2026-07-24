package studio

import "testing"

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

func TestBuildGenerationTaskResponseReturnsInputImages(t *testing.T) {
	task := &hostTask{
		ID:       12,
		Status:   "completed",
		Progress: 100,
		Input: map[string]interface{}{
			"prompt": "turn it into anime",
			"model":  "gpt-image-2",
			"images": []interface{}{
				"data:image/png;base64,source",
			},
			"mask": "data:image/png;base64,mask",
		},
		Attributes: map[string]interface{}{
			"operation": "edit",
			"size":      "1024x1024",
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
			"kind":      "video",
			"operation": "generate",
			"size":      "720p",
		},
	}
	resp := buildGenerationTaskResponse(video)
	if got := resp["kind"]; got != "video" {
		t.Fatalf("kind = %v, want video", got)
	}
	if got := resp["duration"]; got != 5 {
		t.Fatalf("duration = %v (%T), want 5", got, got)
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
		{"gateway-gemini", "image.edit", false},
		{"gateway-seedance", "video.generate", true},
		{"gateway-seedance", "image.generate", true},
		{"gateway-seedance", "image.edit", false},
		{"gateway-openai", "image.generate", true},
		{"gateway-openai", "image.edit", true},
	}
	for _, c := range cases {
		if got := executorSupportsTaskType(c.executor, c.taskType); got != c.want {
			t.Errorf("executorSupportsTaskType(%q, %q) = %v, want %v", c.executor, c.taskType, got, c.want)
		}
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
		{name: "seedream 2k", model: "seedream-5-0-pro", size: "2048x2048"},
		{name: "seedream 4k", model: "seedream-5-0-pro", size: "4096x4096"},
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
