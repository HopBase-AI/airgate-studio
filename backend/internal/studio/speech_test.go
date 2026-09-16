package studio

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	sdk "github.com/DouDOU-start/airgate-sdk/sdkgo"
)

func floatPtr(v float64) *float64 { return &v }

func TestPlanSpeechValidation(t *testing.T) {
	longText := strings.Repeat("字", maxSpeechTextChars+1)
	cases := []struct {
		name     string
		req      speechRequest
		wantCode string
	}{
		{name: "empty text", req: speechRequest{Text: "   ", Model: speechModelHD}, wantCode: errCodeSpeechTextRequired},
		{name: "text too long", req: speechRequest{Text: longText, Model: speechModelHD}, wantCode: errCodeSpeechTextTooLong},
		{name: "unknown model", req: speechRequest{Text: "hi", Model: "speech-2.8-HD"}, wantCode: errCodeSpeechUnsupportedModel},
		{name: "speed below range", req: speechRequest{Text: "hi", Model: speechModelHD, Speed: floatPtr(0.4)}, wantCode: errCodeSpeechInvalidSpeed},
		{name: "speed above range", req: speechRequest{Text: "hi", Model: speechModelTurbo, Speed: floatPtr(2.01)}, wantCode: errCodeSpeechInvalidSpeed},
		{name: "bad emotion", req: speechRequest{Text: "hi", Model: speechModelHD, Emotion: "whisper"}, wantCode: errCodeSpeechInvalidParameter},
		{name: "bad format", req: speechRequest{Text: "hi", Model: speechModelHD, Format: "aac"}, wantCode: errCodeSpeechInvalidParameter},
		{name: "control char in voice", req: speechRequest{Text: "hi", Model: speechModelHD, VoiceID: "English\nnarrator"}, wantCode: errCodeSpeechInvalidParameter},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := planSpeech(tc.req)
			var verr *speechValidationError
			if !errors.As(err, &verr) {
				t.Fatalf("err = %v, want speechValidationError", err)
			}
			if verr.code != tc.wantCode {
				t.Fatalf("code = %q, want %q (msg %q)", verr.code, tc.wantCode, verr.msg)
			}
			if containsHan(verr.msg) {
				t.Fatalf("client-facing message must be English: %q", verr.msg)
			}
		})
	}
}

func TestPlanSpeechDefaults(t *testing.T) {
	plan, err := planSpeech(speechRequest{Text: "  Hello, world.  ", Model: speechModelHD})
	if err != nil {
		t.Fatalf("planSpeech: %v", err)
	}
	if plan.Text != "Hello, world." || plan.TextChars != 13 || plan.EstimatedChars != 13 {
		t.Fatalf("plan = %+v, want trimmed text with 13 chars", plan)
	}
	if plan.VoiceID != speechDefaultVoiceID {
		t.Fatalf("voice = %q, want English default", plan.VoiceID)
	}
	if plan.Speed != speechDefaultSpeed || plan.Format != "mp3" || plan.ContentType != "audio/mpeg" || plan.FileExt != ".mp3" {
		t.Fatalf("defaults = %+v", plan)
	}
	if plan.LanguageBoost != "" || plan.Emotion != "" {
		t.Fatalf("unexpected boost/emotion: %+v", plan)
	}

	han, err := planSpeech(speechRequest{Text: "你好，世界", Model: speechModelTurbo, Speed: floatPtr(1.5), Emotion: "Calm", Format: "WAV"})
	if err != nil {
		t.Fatalf("planSpeech(han): %v", err)
	}
	if han.VoiceID != speechDefaultVoiceIDHan {
		t.Fatalf("voice = %q, want Mandarin default", han.VoiceID)
	}
	// 5 码点，其中 4 个汉字各再计 1 → 9。
	if han.TextChars != 5 || han.EstimatedChars != 9 {
		t.Fatalf("chars = %d/%d, want 5/9", han.TextChars, han.EstimatedChars)
	}
	if han.Speed != 1.5 || han.Emotion != "calm" || han.Format != "wav" || han.ContentType != "audio/wav" {
		t.Fatalf("normalized = %+v", han)
	}

	yue, err := planSpeech(speechRequest{Text: "早晨", Model: speechModelHD, VoiceID: " Cantonese_GentleLady "})
	if err != nil {
		t.Fatalf("planSpeech(yue): %v", err)
	}
	if yue.VoiceID != "Cantonese_GentleLady" || yue.LanguageBoost != cantoneseLanguageBoost {
		t.Fatalf("cantonese plan = %+v, want auto language_boost", yue)
	}

	custom, err := planSpeech(speechRequest{Text: "hi", Model: speechModelHD, VoiceID: "Chinese (Mandarin)_News_Anchor", LanguageBoost: "Chinese"})
	if err != nil {
		t.Fatalf("planSpeech(custom): %v", err)
	}
	if custom.VoiceID != "Chinese (Mandarin)_News_Anchor" || custom.LanguageBoost != "Chinese" {
		t.Fatalf("custom voice must be passed through verbatim: %+v", custom)
	}
}

func TestSpeechBillableCharacters(t *testing.T) {
	cases := map[string]int64{
		"Hello, world.": 13,
		"你好":            4,
		"你好, world":     11,
		"":              0,
	}
	for text, want := range cases {
		if got := speechBillableCharacters(text); got != want {
			t.Errorf("speechBillableCharacters(%q) = %d, want %d", text, got, want)
		}
	}
}

func TestBuildSpeechUpstreamBody(t *testing.T) {
	plan, err := planSpeech(speechRequest{Text: "早晨", Model: speechModelHD, VoiceID: "Cantonese_GentleLady", Speed: floatPtr(0.8), Emotion: "happy"})
	if err != nil {
		t.Fatal(err)
	}
	body, err := buildSpeechUpstreamBody(plan)
	if err != nil {
		t.Fatal(err)
	}
	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		t.Fatal(err)
	}
	if payload["model"] != speechModelHD || payload["text"] != "早晨" || payload["stream"] != false || payload["output_format"] != "hex" {
		t.Fatalf("payload = %v", payload)
	}
	if payload["language_boost"] != cantoneseLanguageBoost {
		t.Fatalf("language_boost = %v", payload["language_boost"])
	}
	voice, _ := payload["voice_setting"].(map[string]any)
	if voice["voice_id"] != "Cantonese_GentleLady" || voice["speed"] != 0.8 || voice["emotion"] != "happy" {
		t.Fatalf("voice_setting = %v", voice)
	}
	audio, _ := payload["audio_setting"].(map[string]any)
	if audio["format"] != "mp3" {
		t.Fatalf("audio_setting = %v", audio)
	}
}

func TestParseSpeechUpstreamBody(t *testing.T) {
	audio := []byte{0xFF, 0xFB, 0x90, 0x00, 0x01, 0x02}
	ok := []byte(`{"data":{"audio":"` + hex.EncodeToString(audio) + `","status":2},"extra_info":{"audio_length":1234,"audio_size":6,"usage_characters":13,"audio_format":"mp3"},"base_resp":{"status_code":0,"status_msg":"success"}}`)
	result, failure := parseSpeechUpstreamBody(ok)
	if failure != nil {
		t.Fatalf("unexpected failure: %+v", failure)
	}
	if !bytes.Equal(result.Audio, audio) || result.UsageCharacters != 13 || result.AudioLengthMs != 1234 || result.AudioSizeBytes != 6 || result.AudioFormat != "mp3" {
		t.Fatalf("result = %+v", result)
	}

	cases := []struct {
		name       string
		body       string
		wantCode   string
		wantStatus int
	}{
		{name: "voice not found", body: `{"data":null,"base_resp":{"status_code":2054,"status_msg":"voice id not exist"}}`, wantCode: errCodeSpeechVoiceNotFound, wantStatus: http.StatusBadRequest},
		{name: "rate limited", body: `{"base_resp":{"status_code":1002,"status_msg":"rate limit"}}`, wantCode: "rate_limited", wantStatus: http.StatusTooManyRequests},
		{name: "invalid params", body: `{"base_resp":{"status_code":2013,"status_msg":"invalid params"}}`, wantCode: "bad_request", wantStatus: http.StatusBadRequest},
		{name: "no audio", body: `{"data":{"audio":""},"base_resp":{"status_code":0}}`, wantCode: errCodeSpeechNoAudio, wantStatus: http.StatusBadGateway},
		{name: "bad hex", body: `{"data":{"audio":"zz"},"base_resp":{"status_code":0}}`, wantCode: errCodeSpeechNoAudio, wantStatus: http.StatusBadGateway},
		{name: "not json", body: `<html>`, wantCode: errCodeSpeechForwardFailed, wantStatus: http.StatusBadGateway},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, failure := parseSpeechUpstreamBody([]byte(tc.body))
			if failure == nil {
				t.Fatal("expected failure")
			}
			if failure.code != tc.wantCode || failure.status != tc.wantStatus {
				t.Fatalf("failure = %+v, want %s/%d", failure, tc.wantCode, tc.wantStatus)
			}
		})
	}
}

func TestMapSpeechForwardFailure(t *testing.T) {
	cases := []struct {
		name       string
		status     int
		body       string
		wantCode   string
		wantStatus int
		wantMsg    string
	}{
		{name: "voice 400", status: 400, body: `{"error":{"message":"voice id not exist","type":"invalid_request_error","code":"2054"}}`, wantCode: errCodeSpeechVoiceNotFound, wantStatus: 400, wantMsg: "voice id not exist"},
		{name: "generic 400", status: 400, body: `{"error":{"message":"text exceeds the 10000 character limit","type":"invalid_request_error"}}`, wantCode: "bad_request", wantStatus: 400, wantMsg: "text exceeds the 10000 character limit"},
		{name: "auth never surfaces as 401", status: 401, body: `{"error":{"message":"invalid api key"}}`, wantCode: "auth_failed", wantStatus: http.StatusBadGateway, wantMsg: "invalid api key"},
		{name: "balance", status: 402, body: `{"error":{"message":"Insufficient balance","code":"insufficient_balance"}}`, wantCode: "insufficient_balance", wantStatus: 402, wantMsg: "Insufficient balance"},
		{name: "rate limit", status: 429, body: `{"error":{"message":"too many requests"}}`, wantCode: "rate_limited", wantStatus: 429, wantMsg: "too many requests"},
		{name: "server error non-json", status: 503, body: `upstream down`, wantCode: "server_error", wantStatus: http.StatusBadGateway, wantMsg: "upstream down"},
		{name: "empty body", status: 418, body: ``, wantCode: errCodeSpeechForwardFailed, wantStatus: http.StatusBadGateway, wantMsg: "speech service returned HTTP 418"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			failure := mapSpeechForwardFailure(tc.status, []byte(tc.body))
			if failure.code != tc.wantCode || failure.status != tc.wantStatus || failure.message != tc.wantMsg {
				t.Fatalf("failure = %+v", failure)
			}
		})
	}
}

// speechTestHost 模拟 core：groups.list 回一个可用分组，gateway.forward 回预置应答，
// assets.store 记下收到的字节并回 public_url。
type speechTestHost struct {
	forwardStatus int
	forwardBody   string
	forwardErr    error
	storeErr      error

	forwardPayload map[string]interface{}
	storePayload   map[string]interface{}
	groupCalls     int
}

func (h *speechTestHost) Invoke(_ context.Context, req sdk.HostInvokeRequest) (*sdk.HostInvokeResponse, error) {
	switch req.Method {
	case hostMethodGroupsList:
		h.groupCalls++
		if req.Payload["platform"] != speechPlatform || req.Payload["needs_image"] != false {
			return nil, errors.New("groups.list must query the minimax platform without image requirement")
		}
		return &sdk.HostInvokeResponse{Status: "ok", Payload: map[string]interface{}{
			"groups": []interface{}{map[string]interface{}{"id": float64(56), "name": "MiniMax 语音 官方直连", "platform": speechPlatform, "rate_multiplier": 4.76, "effective_rate": 4.76}},
		}}, nil
	case hostMethodGatewayForward:
		h.forwardPayload = req.Payload
		if h.forwardErr != nil {
			return nil, h.forwardErr
		}
		return &sdk.HostInvokeResponse{Status: "ok", Payload: map[string]interface{}{
			"status_code": float64(h.forwardStatus),
			"body":        h.forwardBody,
			"usage_id":    float64(9001),
		}}, nil
	case hostMethodAssetsStore:
		h.storePayload = req.Payload
		if h.storeErr != nil {
			return nil, h.storeErr
		}
		return &sdk.HostInvokeResponse{Status: "ok", Payload: map[string]interface{}{
			"asset_id":   float64(77),
			"object_key": "generated/7/abc.mp3",
			"public_url": "/assets-runtime/generated/7/abc.mp3",
		}}, nil
	default:
		return nil, errors.New("unexpected host method " + req.Method)
	}
}

func (h *speechTestHost) InvokeStream(context.Context, sdk.HostStreamRequest) (sdk.HostStream, error) {
	return nil, errors.New("not implemented")
}

func newSpeechTestPlugin(host sdk.Host) *StudioPlugin {
	return &StudioPlugin{logger: slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil)), host: host}
}

func postSpeech(t *testing.T, p *StudioPlugin, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/speech", strings.NewReader(body))
	req.Header.Set(headerUserID, "7")
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	p.requireUser(p.handleSpeech)(rec, req)
	return rec
}

func decodeJSON(t *testing.T, rec *httptest.ResponseRecorder) map[string]interface{} {
	t.Helper()
	var out map[string]interface{}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("response is not JSON: %v (%s)", err, rec.Body.String())
	}
	return out
}

func TestHandleSpeechSuccessStoresDecodedAudio(t *testing.T) {
	audio := []byte{0xFF, 0xFB, 0x90, 0x64, 0x00, 0x00, 0x01}
	host := &speechTestHost{
		forwardStatus: http.StatusOK,
		forwardBody:   `{"data":{"audio":"` + hex.EncodeToString(audio) + `","status":2},"extra_info":{"audio_length":2100,"audio_size":7,"usage_characters":9,"audio_format":"mp3"},"base_resp":{"status_code":0,"status_msg":"success"},"trace_id":"x"}`,
	}
	p := newSpeechTestPlugin(host)

	rec := postSpeech(t, p, `{"text":"你好，世界","model":"speech-2.8-hd","group_id":56,"speed":1.2}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
	}
	out := decodeJSON(t, rec)
	if out["url"] != "/assets-runtime/generated/7/abc.mp3" || out["content_type"] != "audio/mpeg" || out["format"] != "mp3" {
		t.Fatalf("response = %v", out)
	}
	if out["usage_characters"] != float64(9) || out["audio_length_ms"] != float64(2100) || out["audio_size_bytes"] != float64(7) || out["usage_id"] != float64(9001) {
		t.Fatalf("usage fields = %v", out)
	}
	if out["voice_id"] != speechDefaultVoiceIDHan || out["speed"] != 1.2 || out["route_key"] != "minimax:speech-2.8-hd" || out["group_id"] != float64(56) {
		t.Fatalf("route fields = %v", out)
	}
	if _, hasAsset := out["asset"]; hasAsset {
		t.Fatalf("asset must be omitted when project storage is not configured: %v", out["asset"])
	}

	// 转发载荷：身份、分组、路径、平台头与提交人头。
	if host.forwardPayload["user_id"] != int64(7) || host.forwardPayload["group_id"] != int64(56) || host.forwardPayload["model"] != speechModelHD || host.forwardPayload["path"] != speechNativePath || host.forwardPayload["method"] != http.MethodPost {
		t.Fatalf("forward payload = %v", host.forwardPayload)
	}
	headers, _ := host.forwardPayload["headers"].(map[string]interface{})
	if got := headers["X-Airgate-Platform"]; !stringSliceEquals(got, speechPlatform) {
		t.Fatalf("platform header = %v", got)
	}
	if got := headers[http.CanonicalHeaderKey(headerSubmitterID)]; !stringSliceEquals(got, "7") {
		t.Fatalf("submitter header = %v", got)
	}
	var upstream map[string]interface{}
	if err := json.Unmarshal([]byte(host.forwardPayload["body"].(string)), &upstream); err != nil {
		t.Fatalf("forward body is not JSON: %v", err)
	}
	if upstream["output_format"] != "hex" || upstream["stream"] != false || upstream["text"] != "你好，世界" {
		t.Fatalf("upstream body = %v", upstream)
	}

	// 资产落库：解码后的原始字节、generated 保留策略、正确的 MIME 与扩展名。
	if host.storePayload["purpose"] != speechAssetPurpose || host.storePayload["content_type"] != "audio/mpeg" || host.storePayload["file_extension"] != ".mp3" || host.storePayload["user_id"] != int64(7) {
		t.Fatalf("store payload = %v", host.storePayload)
	}
	stored, _ := host.storePayload["data"].([]byte)
	if !bytes.Equal(stored, audio) {
		t.Fatalf("stored bytes = %x, want %x", stored, audio)
	}
}

func stringSliceEquals(value interface{}, want string) bool {
	values, ok := value.([]string)
	return ok && len(values) == 1 && values[0] == want
}

func TestHandleSpeechRejectsBeforeForwarding(t *testing.T) {
	cases := []struct {
		name       string
		body       string
		wantStatus int
		wantCode   string
	}{
		{name: "validation", body: `{"text":"","model":"speech-2.8-hd","group_id":56}`, wantStatus: http.StatusBadRequest, wantCode: errCodeSpeechTextRequired},
		{name: "unknown model", body: `{"text":"hi","model":"tts-1","group_id":56}`, wantStatus: http.StatusBadRequest, wantCode: errCodeSpeechUnsupportedModel},
		{name: "missing group", body: `{"text":"hi","model":"speech-2.8-hd"}`, wantStatus: http.StatusBadRequest, wantCode: errCodeSpeechGroupMissing},
		{name: "foreign group", body: `{"text":"hi","model":"speech-2.8-hd","group_id":99}`, wantStatus: http.StatusForbidden, wantCode: errCodeSpeechGroupMissing},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			host := &speechTestHost{forwardStatus: http.StatusOK, forwardBody: `{}`}
			rec := postSpeech(t, newSpeechTestPlugin(host), tc.body)
			if rec.Code != tc.wantStatus {
				t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
			}
			out := decodeJSON(t, rec)
			if out["code"] != tc.wantCode || out["error_code"] != tc.wantCode {
				t.Fatalf("codes = %v/%v, want %s", out["code"], out["error_code"], tc.wantCode)
			}
			if host.forwardPayload != nil {
				t.Fatal("request must be rejected before gateway.forward")
			}
		})
	}
}

func TestHandleSpeechMapsUpstreamFailures(t *testing.T) {
	cases := []struct {
		name       string
		host       *speechTestHost
		wantStatus int
		wantCode   string
	}{
		{
			name:       "voice rejected by gateway",
			host:       &speechTestHost{forwardStatus: http.StatusBadRequest, forwardBody: `{"error":{"message":"voice id not exist","type":"invalid_request_error","code":"invalid_request"}}`},
			wantStatus: http.StatusBadRequest,
			wantCode:   errCodeSpeechVoiceNotFound,
		},
		{
			name:       "no route",
			host:       &speechTestHost{forwardErr: errors.New("no eligible route")},
			wantStatus: http.StatusBadGateway,
			wantCode:   errCodeSpeechForwardFailed,
		},
		{
			name:       "base_resp error on 200",
			host:       &speechTestHost{forwardStatus: http.StatusOK, forwardBody: `{"base_resp":{"status_code":1002,"status_msg":"rate limit"}}`},
			wantStatus: http.StatusTooManyRequests,
			wantCode:   "rate_limited",
		},
		{
			name:       "store failure after billing",
			host:       &speechTestHost{forwardStatus: http.StatusOK, forwardBody: `{"data":{"audio":"fffb"},"base_resp":{"status_code":0}}`, storeErr: errors.New("disk full")},
			wantStatus: http.StatusInternalServerError,
			wantCode:   errCodeSpeechStoreFailed,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := postSpeech(t, newSpeechTestPlugin(tc.host), `{"text":"hi","model":"speech-2.8-turbo","group_id":56}`)
			if rec.Code != tc.wantStatus {
				t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
			}
			out := decodeJSON(t, rec)
			if out["error_code"] != tc.wantCode {
				t.Fatalf("error_code = %v, want %s (body %s)", out["error_code"], tc.wantCode, rec.Body.String())
			}
			if msg, _ := out["error"].(string); msg == "" || containsHan(msg) {
				t.Fatalf("error message must be non-empty English: %q", msg)
			}
		})
	}
}
