package studio

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	sdk "github.com/DouDOU-start/airgate-sdk/sdkgo"
)

func referenceInputs(images, videos, audios int) []generationInput {
	var inputs []generationInput
	for i := 0; i < images; i++ {
		inputs = append(inputs, generationInput{Type: "image", Role: "reference_image", URL: "data:image/png;base64,img"})
	}
	for i := 0; i < videos; i++ {
		inputs = append(inputs, generationInput{Type: "video", Role: "reference_video", URL: "/assets-runtime/task-input/7/202609/v.mp4"})
	}
	for i := 0; i < audios; i++ {
		inputs = append(inputs, generationInput{Type: "audio", Role: "reference_audio", URL: "https://cdn.example.com/a.mp3"})
	}
	return inputs
}

func TestValidateReferenceInputsPerModelLimits(t *testing.T) {
	cases := []struct {
		name    string
		model   string
		images  int
		videos  int
		audios  int
		wantErr string
	}{
		{name: "sd25 max mix", model: videoModelSeedance25, images: 30, videos: 10, audios: 10},
		{name: "sd25 audio only", model: videoModelSeedance25Domestic, audios: 1},
		{name: "sd25 too many videos", model: videoModelSeedance25, videos: 11, wantErr: "at most 10 reference videos"},
		{name: "sd20 max mix", model: videoModelSeedanceMiniOverseas, images: 9, videos: 3, audios: 3},
		{name: "sd20 too many images", model: videoModelSeedanceFastDomestic, images: 10, wantErr: "at most 9 reference images"},
		{name: "sd20 audio needs visual", model: videoModelSeedanceStandardOverseas, audios: 2, wantErr: "requires at least one reference image or video"},
		{name: "sd20 audio with video", model: videoModelSeedanceStandardDomestic, videos: 1, audios: 3},
		{name: "legacy sd25 id", model: videoModelSeedance25LegacyEP, audios: 10},
		{name: "grok images only", model: "grok-imagine-video-1.5", images: 7},
		{name: "grok rejects video", model: "grok-imagine-video-1.5", videos: 1, wantErr: "does not accept reference videos"},
		{name: "grok image cap", model: "grok-imagine-video-1.5", images: 8, wantErr: "at most 7 reference images"},
		{name: "h3 total cap", model: "MiniMax-H3", images: 9, videos: 3, audios: 1, wantErr: "at most 12 reference files in total"},
		{name: "h3 within total", model: "MiniMax-H3", images: 6, videos: 3, audios: 3},
		{name: "h3 audio needs visual", model: "MiniMax-H3", audios: 1, wantErr: "requires at least one reference image or video"},
		{name: "h3 max rejects audio", model: "MiniMax-H3-Max", images: 1, audios: 1, wantErr: "does not accept reference audio clips"},
		{name: "wan video only", model: "wan3.0-video", videos: 5},
		{name: "wan too many audios", model: "wan3.0-video", audios: 6, wantErr: "at most 5 reference audio clips"},
		{name: "happyhorse t2v rejects images", model: "happyhorse-1.1-t2v", images: 1, wantErr: "does not accept reference images"},
		{name: "happyhorse i2v one image", model: "happyhorse-1.1-i2v", images: 1},
		{name: "kling v2.6 image cap", model: "kling-v2-6", images: 5, wantErr: "at most 4 reference images"},
		{name: "kling rejects audio", model: "kling-v3", audios: 1, wantErr: "does not accept reference audio clips"},
		{name: "unknown model rejects video", model: "happyhorse-1.1-r2v", videos: 1, wantErr: "does not support reference videos or audio"},
		{name: "unknown model keeps images", model: "happyhorse-1.1-r2v", images: 3},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := validateReferenceInputs("video", tc.model, referenceInputs(tc.images, tc.videos, tc.audios))
			if tc.wantErr == "" {
				if err != nil {
					t.Fatalf("unexpected error: %v", err)
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), tc.wantErr) {
				t.Fatalf("error = %v, want contains %q", err, tc.wantErr)
			}
		})
	}
}

// 创作中心的语音作品点「引用」后直接把自己的资产地址当参考音频提交，不再下载 + 重传。
// 语音资产是 assets.store 里 purpose=generated 的持久资产（speech.go），参考上传落的是
// purpose=task-input（references.go）——这里钉住「校验只看地址形态、不看 purpose」这条契约，
// 免得日后加 purpose 白名单把「引用」链路悄悄打死。保留期也同源：core 的
// asset_retention_generated_days 一个设置同时喂给 generated 与 task-input 两个 purpose。
func TestValidateReferenceInputsAcceptsGeneratedSpeechAssets(t *testing.T) {
	// assets.store 对本地存储回 /assets-runtime/<purpose>/<user>/<yyyymm>/<key>，对象存储回绝对地址。
	for _, url := range []string{
		"/assets-runtime/generated/7035/202609/6f1c2ab4.mp3",
		"https://cdn.example.com/generated/7035/202609/6f1c2ab4.wav",
	} {
		if !isUploadedReferenceURL(url) {
			t.Fatalf("generated speech asset %q must pass the reference address check", url)
		}
		audioOnly := []generationInput{{Type: "audio", Role: "reference_audio", URL: url}}
		// SD2.5 收音频单飞。
		if err := validateReferenceInputs("video", videoModelSeedance25, audioOnly); err != nil {
			t.Fatalf("seedance 2.5 rejected generated speech asset %q: %v", url, err)
		}
		// SD2.0 / H3 要求音频配图或配视频——「引用」链路同样受这条约束。
		if err := validateReferenceInputs("video", videoModelSeedanceStandardOverseas, audioOnly); err == nil ||
			!strings.Contains(err.Error(), "requires at least one reference image or video") {
			t.Fatalf("seedance 2.0 audio-only error = %v", err)
		}
		withImage := append([]generationInput{{Type: "image", Role: "reference_image", URL: "https://cdn.example.com/i.png"}}, audioOnly...)
		if err := validateReferenceInputs("video", "MiniMax-H3", withImage); err != nil {
			t.Fatalf("h3 rejected generated speech asset with an image: %v", err)
		}
		// 不收音频的模型照样拦住，「引用」不是绕过能力矩阵的后门。
		if err := validateReferenceInputs("video", "kling-v3", audioOnly); err == nil ||
			!strings.Contains(err.Error(), "does not accept reference audio clips") {
			t.Fatalf("kling audio error = %v", err)
		}
	}

	// 引用的地址原样进任务输入的 audios 数组，执行插件据此组装上游请求。
	input := buildTaskInput(createGenerationTaskRequest{
		Kind:  "video",
		Model: videoModelSeedance25,
		Inputs: []generationInput{
			{Type: "audio", Role: "reference_audio", URL: "/assets-runtime/generated/7035/202609/6f1c2ab4.mp3"},
		},
	})
	if got, _ := input["audios"].([]string); len(got) != 1 || got[0] != "/assets-runtime/generated/7035/202609/6f1c2ab4.mp3" {
		t.Fatalf("audios = %#v", input["audios"])
	}
}

func TestValidateReferenceInputsRejectsInlineMediaAndImageTasks(t *testing.T) {
	inline := []generationInput{{Type: "video", Role: "reference_video", URL: "data:video/mp4;base64,AAAA"}}
	if err := validateReferenceInputs("video", videoModelSeedance25, inline); err == nil || !strings.Contains(err.Error(), "must be uploaded") {
		t.Fatalf("inline video error = %v", err)
	}
	audio := []generationInput{{Type: "audio", Role: "reference_audio", URL: "/assets-runtime/a.wav"}}
	if err := validateReferenceInputs("image", "gpt-image-2", audio); err == nil || !strings.Contains(err.Error(), "only supported for video generation") {
		t.Fatalf("image task audio error = %v", err)
	}
	unknown := []generationInput{{Type: "document", URL: "https://example.com/a.pdf"}}
	if err := validateReferenceInputs("video", videoModelSeedance25, unknown); err == nil || !strings.Contains(err.Error(), "unsupported reference type") {
		t.Fatalf("unknown type error = %v", err)
	}
	// 图片任务的 source / mask 维持原样放行。
	edit := []generationInput{
		{Type: "image", Role: "source", URL: "data:image/png;base64,src"},
		{Type: "image", Role: "mask", URL: "data:image/png;base64,mask"},
	}
	if err := validateReferenceInputs("image", "gpt-image-2", edit); err != nil {
		t.Fatalf("image edit inputs rejected: %v", err)
	}
}

func TestBuildTaskInputSplitsReferenceMediaByType(t *testing.T) {
	req := createGenerationTaskRequest{
		Kind:   "video",
		Model:  videoModelSeedance25,
		Prompt: "dance to the beat",
		Inputs: []generationInput{
			{Type: "image", Role: "reference_image", URL: "/assets-runtime/i.png"},
			{Type: "video", Role: "reference_video", URL: "/assets-runtime/v1.mp4"},
			{Type: "audio", Role: "reference_audio", URL: "/assets-runtime/a1.wav"},
			{Type: "video", Role: "reference_video", URL: "/assets-runtime/v2.mov"},
		},
	}
	input := buildTaskInput(req)
	if got, _ := input["images"].([]string); len(got) != 1 || got[0] != "/assets-runtime/i.png" {
		t.Fatalf("images = %#v", input["images"])
	}
	if got, _ := input["videos"].([]string); len(got) != 2 || got[0] != "/assets-runtime/v1.mp4" || got[1] != "/assets-runtime/v2.mov" {
		t.Fatalf("videos = %#v", input["videos"])
	}
	if got, _ := input["audios"].([]string); len(got) != 1 || got[0] != "/assets-runtime/a1.wav" {
		t.Fatalf("audios = %#v", input["audios"])
	}
	if _, ok := input["inputs"]; ok {
		t.Fatalf("inputs must not be forwarded to executors: %#v", input["inputs"])
	}

	imageOnly := buildTaskInput(createGenerationTaskRequest{Kind: "video", Model: videoModelSeedance25, Prompt: "p", Inputs: referenceInputs(1, 0, 0)})
	if _, ok := imageOnly["videos"]; ok {
		t.Fatalf("videos key must be absent without reference videos")
	}
	if _, ok := imageOnly["audios"]; ok {
		t.Fatalf("audios key must be absent without reference audio")
	}
}

func TestBuildGenerationTaskResponseReturnsReferenceMedia(t *testing.T) {
	resp := buildGenerationTaskResponse(&hostTask{
		ID:       9,
		TaskType: "video.generate",
		Status:   "completed",
		Input: map[string]interface{}{
			"prompt": "p",
			"images": []interface{}{"/assets-runtime/i.png"},
			"videos": []interface{}{"/assets-runtime/v.mp4"},
			"audios": []interface{}{"/assets-runtime/a.mp3"},
		},
	})
	if got, _ := resp["input_videos"].([]string); len(got) != 1 || got[0] != "/assets-runtime/v.mp4" {
		t.Fatalf("input_videos = %#v", resp["input_videos"])
	}
	if got, _ := resp["input_audios"].([]string); len(got) != 1 || got[0] != "/assets-runtime/a.mp3" {
		t.Fatalf("input_audios = %#v", resp["input_audios"])
	}
}

func TestBuildVideoEstimateBodyCarriesReferenceCounts(t *testing.T) {
	body, err := buildVideoEstimateBody("MiniMax-H3", map[string]interface{}{"duration": 5}, videoEstimateReferences{
		Images: 2, Videos: 2, Audios: 1, VideoSeconds: 9.5,
	})
	if err != nil {
		t.Fatal(err)
	}
	var payload map[string]interface{}
	if err := json.Unmarshal(body, &payload); err != nil {
		t.Fatal(err)
	}
	if images, _ := payload["images"].([]interface{}); len(images) != 2 {
		t.Fatalf("images = %#v", payload["images"])
	}
	if payload["reference_videos"] != float64(2) || payload["reference_audios"] != float64(1) || payload["input_video_seconds"] != 9.5 {
		t.Fatalf("payload = %#v", payload)
	}

	body, err = buildVideoEstimateBody("MiniMax-H3", nil, videoEstimateReferences{VideoSeconds: 9.5})
	if err != nil {
		t.Fatal(err)
	}
	payload = map[string]interface{}{}
	_ = json.Unmarshal(body, &payload)
	for _, key := range []string{"images", "reference_videos", "reference_audios", "input_video_seconds"} {
		if _, ok := payload[key]; ok {
			t.Fatalf("%s must be omitted without reference media: %#v", key, payload)
		}
	}
}

func TestSniffReferenceMedia(t *testing.T) {
	cases := []struct {
		name     string
		kind     string
		data     []byte
		wantType string
		wantExt  string
	}{
		{name: "mp4", kind: "video", data: []byte("\x00\x00\x00\x18ftypisom\x00\x00\x02\x00"), wantType: "video/mp4", wantExt: ".mp4"},
		{name: "mov ftyp", kind: "video", data: []byte("\x00\x00\x00\x14ftypqt  \x00\x00\x00\x00"), wantType: "video/quicktime", wantExt: ".mov"},
		{name: "legacy mov", kind: "video", data: []byte("\x00\x00\x00\x08wide\x00\x00\x00\x00"), wantType: "video/quicktime", wantExt: ".mov"},
		{name: "wav", kind: "audio", data: []byte("RIFF\x24\x00\x00\x00WAVEfmt "), wantType: "audio/wav", wantExt: ".wav"},
		{name: "mp3 id3", kind: "audio", data: []byte("ID3\x04\x00\x00\x00\x00"), wantType: "audio/mpeg", wantExt: ".mp3"},
		{name: "mp3 frame", kind: "audio", data: []byte{0xFF, 0xFB, 0x90, 0x64}, wantType: "audio/mpeg", wantExt: ".mp3"},
		{name: "adts aac rejected", kind: "audio", data: []byte{0xFF, 0xF1, 0x50, 0x80}},
		{name: "png as video rejected", kind: "video", data: []byte("\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR")},
		{name: "wav as video rejected", kind: "video", data: []byte("RIFF\x24\x00\x00\x00WAVEfmt ")},
		{name: "mp4 as audio rejected", kind: "audio", data: []byte("\x00\x00\x00\x18ftypisom\x00\x00\x02\x00")},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			contentType, ext, ok := sniffReferenceMedia(tc.kind, tc.data)
			if tc.wantType == "" {
				if ok {
					t.Fatalf("expected rejection, got %s %s", contentType, ext)
				}
				return
			}
			if !ok || contentType != tc.wantType || ext != tc.wantExt {
				t.Fatalf("got (%q, %q, %v), want (%q, %q)", contentType, ext, ok, tc.wantType, tc.wantExt)
			}
		})
	}
}

type referenceStoreHost struct {
	payload map[string]interface{}
	err     error
}

func (h *referenceStoreHost) InvokeStream(context.Context, sdk.HostStreamRequest) (sdk.HostStream, error) {
	return nil, errors.New("not supported")
}

func (h *referenceStoreHost) Invoke(_ context.Context, req sdk.HostInvokeRequest) (*sdk.HostInvokeResponse, error) {
	if req.Method != hostMethodAssetsStore {
		return nil, errors.New("unexpected host method " + req.Method)
	}
	h.payload = req.Payload
	if h.err != nil {
		return nil, h.err
	}
	return &sdk.HostInvokeResponse{Status: "ok", Payload: map[string]interface{}{
		"object_key": "task-input/42/202609/abc.mp4",
		"public_url": "/assets-runtime/task-input/42/202609/abc.mp4",
	}}, nil
}

func uploadReferenceRequest(kind string, body []byte) *http.Request {
	req := httptest.NewRequest(http.MethodPost, "/reference-uploads?kind="+kind, bytes.NewReader(body))
	req.Header.Set(headerUserID, "42")
	req.Header.Set("Content-Type", "application/octet-stream")
	return req
}

func TestHandleUploadReferenceStoresTaskInputAsset(t *testing.T) {
	host := &referenceStoreHost{}
	plugin := &StudioPlugin{host: host}
	recorder := httptest.NewRecorder()
	plugin.handleUploadReference(recorder, uploadReferenceRequest("video", []byte("\x00\x00\x00\x18ftypisom\x00\x00\x02\x00moov")))

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	var resp map[string]interface{}
	if err := json.Unmarshal(recorder.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp["url"] != "/assets-runtime/task-input/42/202609/abc.mp4" || resp["content_type"] != "video/mp4" || resp["kind"] != "video" {
		t.Fatalf("response = %#v", resp)
	}
	if host.payload["purpose"] != "task-input" || host.payload["file_extension"] != ".mp4" || host.payload["content_type"] != "video/mp4" {
		t.Fatalf("store payload = %#v", host.payload)
	}
	if uid, _ := host.payload["user_id"].(int64); uid != 42 {
		t.Fatalf("user_id = %#v", host.payload["user_id"])
	}
}

func TestHandleUploadReferenceRejectsBadUploads(t *testing.T) {
	plugin := &StudioPlugin{host: &referenceStoreHost{}}

	cases := []struct {
		name       string
		kind       string
		body       []byte
		wantStatus int
		wantCode   string
	}{
		{name: "bad kind", kind: "image", body: []byte("x"), wantStatus: http.StatusBadRequest},
		{name: "empty", kind: "audio", body: nil, wantStatus: http.StatusBadRequest},
		{name: "wrong format", kind: "audio", body: []byte("\x00\x00\x00\x18ftypisom"), wantStatus: http.StatusUnsupportedMediaType, wantCode: "reference_unsupported_format"},
		{name: "too large", kind: "audio", body: append([]byte("ID3"), make([]byte, maxReferenceAudioBytes)...), wantStatus: http.StatusRequestEntityTooLarge, wantCode: "reference_too_large"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			plugin.handleUploadReference(recorder, uploadReferenceRequest(tc.kind, tc.body))
			if recorder.Code != tc.wantStatus {
				t.Fatalf("status = %d, want %d; body = %s", recorder.Code, tc.wantStatus, recorder.Body.String())
			}
			if tc.wantCode != "" && !strings.Contains(recorder.Body.String(), tc.wantCode) {
				t.Fatalf("body = %s, want code %s", recorder.Body.String(), tc.wantCode)
			}
		})
	}
}

func TestReferenceUploadRouteRequiresUser(t *testing.T) {
	registrar := newRecordingRouteRegistrar()
	registerRoutes(&StudioPlugin{}, registrar)
	handler := registrar.handlers[http.MethodPost+" /reference-uploads"]
	if handler == nil {
		t.Fatal("reference upload route was not registered")
	}
	recorder := httptest.NewRecorder()
	handler(recorder, httptest.NewRequest(http.MethodPost, "/reference-uploads?kind=video", nil))
	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", recorder.Code)
	}
}
