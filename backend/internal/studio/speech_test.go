package studio

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

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

// officialLanguageBoostEnum 官方 t2a_v2 文档 language_boost 的完整可选值（2026-09-16 抄自
// platform.minimax.io/docs/api-reference/speech-t2a-http）。枚举外的字符串上游回 2013，
// 所以自动推导表里的每个取值都必须能在这里找到。
var officialLanguageBoostEnum = map[string]bool{
	"Chinese": true, "Chinese,Yue": true, "English": true, "Arabic": true, "Russian": true,
	"Spanish": true, "French": true, "Portuguese": true, "German": true, "Turkish": true,
	"Dutch": true, "Ukrainian": true, "Vietnamese": true, "Indonesian": true, "Japanese": true,
	"Italian": true, "Korean": true, "Thai": true, "Polish": true, "Romanian": true,
	"Greek": true, "Czech": true, "Finnish": true, "Hindi": true, "Bulgarian": true,
	"Danish": true, "Hebrew": true, "Malay": true, "Persian": true, "Slovak": true,
	"Swedish": true, "Croatian": true, "Filipino": true, "Hungarian": true, "Norwegian": true,
	"Slovenian": true, "Catalan": true, "Nynorsk": true, "Tamil": true, "Afrikaans": true,
	"auto": true,
}

func TestSpeechVoiceLanguageBoostsStayWithinOfficialEnum(t *testing.T) {
	for prefix, boost := range speechVoiceLanguageBoosts {
		if !officialLanguageBoostEnum[boost] {
			t.Errorf("voice prefix %q maps to %q, which is not an official language_boost value", prefix, boost)
		}
	}
	// 音色 ID 前缀是「第一个下划线之前」那段，键里不能自带下划线，否则永远匹配不上。
	for prefix := range speechVoiceLanguageBoosts {
		if strings.Contains(prefix, "_") {
			t.Errorf("voice prefix %q must not contain an underscore", prefix)
		}
	}
}

func TestSpeechLanguageBoostFor(t *testing.T) {
	cases := map[string]string{
		// 界面精选列表里的五种语言，各取一个真实官方 ID。
		"English_expressive_narrator":            "English",
		"Chinese (Mandarin)_News_Anchor":         "Chinese",
		"Japanese_IntellectualSenior":            "Japanese",
		"Spanish_CaptivatingStoryteller":         "Spanish",
		"Cantonese_GentleLady":                   cantoneseLanguageBoost,
		"Chinese (Mandarin)_HK_Flight_Attendant": "Chinese",
		// 列表外但官方有的语言前缀，走「自定义音色 ID」时同样要补上。
		"Korean_SweetGirl":          "Korean",
		"French_Female_News Anchor": "French",
		"Hindi_Narrator":            "Hindi",
		// 官方列表里少数音色没有语言前缀，认不出就不补。
		"Arrogant_Miss": "",
		"Robot_Armor":   "",
		// 前缀不认识 / 压根没有下划线 / 空串，一律不补。
		"Klingon_WarriorPoet": "",
		"NoUnderscoreAtAll":   "",
		"":                    "",
		// 大小写是 ID 契约的一部分，不做容错匹配。
		"english_expressive_narrator": "",
		"SPANISH_SereneWoman":         "",
	}
	for voice, want := range cases {
		if got := speechLanguageBoostFor(voice); got != want {
			t.Errorf("speechLanguageBoostFor(%q) = %q, want %q", voice, got, want)
		}
	}
}

func TestPlanSpeechDerivesLanguageBoostFromVoice(t *testing.T) {
	// 本次修复的主场景：西语音色 + 西语文本，前端没传 language_boost，后端补 "Spanish"。
	es, err := planSpeech(speechRequest{Text: "Hola, mundo.", Model: speechModelHD, VoiceID: " Spanish_CaptivatingStoryteller "})
	if err != nil {
		t.Fatalf("planSpeech(es): %v", err)
	}
	if es.LanguageBoost != "Spanish" {
		t.Fatalf("language_boost = %q, want Spanish", es.LanguageBoost)
	}
	// 上游请求体也要真的带上，不能只停在 plan 里。
	body, err := buildSpeechUpstreamBody(es)
	if err != nil {
		t.Fatal(err)
	}
	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		t.Fatal(err)
	}
	if payload["language_boost"] != "Spanish" {
		t.Fatalf("payload language_boost = %v, want Spanish", payload["language_boost"])
	}

	ja, err := planSpeech(speechRequest{Text: "こんにちは", Model: speechModelHD, VoiceID: "Japanese_IntellectualSenior"})
	if err != nil {
		t.Fatalf("planSpeech(ja): %v", err)
	}
	if ja.LanguageBoost != "Japanese" {
		t.Fatalf("language_boost = %q, want Japanese", ja.LanguageBoost)
	}

	en, err := planSpeech(speechRequest{Text: "Hello there", Model: speechModelHD, VoiceID: "English_Aussie_Bloke"})
	if err != nil {
		t.Fatalf("planSpeech(en): %v", err)
	}
	if en.LanguageBoost != "English" {
		t.Fatalf("language_boost = %q, want English", en.LanguageBoost)
	}

	// 前端显式传了就以前端为准，不被推导覆盖。
	explicit, err := planSpeech(speechRequest{Text: "Hola", Model: speechModelHD, VoiceID: "Spanish_SereneWoman", LanguageBoost: " auto "})
	if err != nil {
		t.Fatalf("planSpeech(explicit): %v", err)
	}
	if explicit.LanguageBoost != "auto" {
		t.Fatalf("language_boost = %q, want the caller's auto", explicit.LanguageBoost)
	}

	// 无语言前缀的官方音色：认不出就不补，交给上游自己识别。
	unknown, err := planSpeech(speechRequest{Text: "你好", Model: speechModelHD, VoiceID: "Arrogant_Miss"})
	if err != nil {
		t.Fatalf("planSpeech(unknown): %v", err)
	}
	if unknown.LanguageBoost != "" {
		t.Fatalf("language_boost = %q, want empty for a prefix-less voice", unknown.LanguageBoost)
	}

	// 「自动（按文本语言）」不推导：默认音色只是含汉字→普通话的粗猜，假名文本会落到
	// 英文音色，拿它钉死语种会压掉上游更准的自动识别。
	for _, text := range []string{"Hello there", "你好，世界", "こんにちは"} {
		auto, err := planSpeech(speechRequest{Text: text, Model: speechModelHD})
		if err != nil {
			t.Fatalf("planSpeech(auto, %q): %v", text, err)
		}
		if auto.LanguageBoost != "" {
			t.Errorf("auto voice for %q got language_boost %q, want empty", text, auto.LanguageBoost)
		}
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
	if payload["model"] != speechModelHD || payload["text"] != "早晨" || payload["stream"] != true || payload["output_format"] != "hex" {
		t.Fatalf("payload = %v", payload)
	}
	// 没有 exclude_aggregated_audio，末帧会重发整段聚合音频，流式就白走了。
	options, _ := payload["stream_options"].(map[string]any)
	if options["exclude_aggregated_audio"] != true {
		t.Fatalf("stream_options = %v", payload["stream_options"])
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

func TestParseSpeechEvent(t *testing.T) {
	audio := []byte{0xFF, 0xFB, 0x90, 0x00, 0x01, 0x02}
	ok := []byte(`{"data":{"audio":"` + hex.EncodeToString(audio) + `","status":2},"extra_info":{"audio_length":1234,"audio_size":6,"usage_characters":13,"audio_format":"mp3"},"base_resp":{"status_code":0,"status_msg":"success"}}`)
	event, failure := parseSpeechEvent(ok)
	if failure != nil {
		t.Fatalf("unexpected failure: %+v", failure)
	}
	if !bytes.Equal(event.Audio, audio) || !event.Final || !event.HasExtra {
		t.Fatalf("event = %+v", event)
	}
	if event.UsageCharacters != 13 || event.AudioLengthMs != 1234 || event.AudioSizeBytes != 6 || event.AudioFormat != "mp3" {
		t.Fatalf("extra_info = %+v", event)
	}

	// 中间帧：有音频、无 extra_info、不是末帧。
	mid, failure := parseSpeechEvent([]byte(`{"data":{"audio":"fffb","status":1},"base_resp":{"status_code":0}}`))
	if failure != nil || mid.Final || mid.HasExtra || len(mid.Audio) != 2 {
		t.Fatalf("mid event = %+v failure = %+v", mid, failure)
	}

	// exclude_aggregated_audio 生效后的末帧：没有音频不是错误。
	last, failure := parseSpeechEvent([]byte(`{"data":{"audio":"","status":2},"extra_info":{"usage_characters":9},"base_resp":{"status_code":0}}`))
	if failure != nil || !last.Final || len(last.Audio) != 0 || last.UsageCharacters != 9 {
		t.Fatalf("final event = %+v failure = %+v", last, failure)
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
		{name: "bad hex", body: `{"data":{"audio":"zz"},"base_resp":{"status_code":0}}`, wantCode: errCodeSpeechNoAudio, wantStatus: http.StatusBadGateway},
		{name: "not json", body: `<html>`, wantCode: errCodeSpeechForwardFailed, wantStatus: http.StatusBadGateway},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, failure := parseSpeechEvent([]byte(tc.body))
			if failure == nil {
				t.Fatal("expected failure")
			}
			if failure.code != tc.wantCode || failure.status != tc.wantStatus {
				t.Fatalf("failure = %+v, want %s/%d", failure, tc.wantCode, tc.wantStatus)
			}
		})
	}
}

// feedStream 把预置分片喂给 collector，模拟 core 的 chunk 帧（分片不按 SSE 行对齐）。
func feedStream(t *testing.T, c *speechStreamCollector, statusCode int, parts ...string) {
	t.Helper()
	if statusCode > 0 {
		if err := c.consume(hostForwardChunk{StatusCode: statusCode}); err != nil {
			t.Fatalf("consume headers: %v", err)
		}
	}
	for _, part := range parts {
		if err := c.consume(hostForwardChunk{Data: []byte(part)}); err != nil {
			t.Fatalf("consume chunk: %v", err)
		}
	}
	if err := c.consume(hostForwardChunk{Done: true}); err != nil {
		t.Fatalf("consume done: %v", err)
	}
}

func sseEvent(payload string) string { return "data: " + payload + "\n\n" }

func TestSpeechStreamCollectorAccumulatesChunks(t *testing.T) {
	c := &speechStreamCollector{}
	// 故意在事件中间切开分片：core 的 chunk 帧不保证按行对齐。
	first := sseEvent(`{"data":{"audio":"fffb","status":1},"base_resp":{"status_code":0}}`)
	second := sseEvent(`{"data":{"audio":"9064","status":1},"base_resp":{"status_code":0}}`)
	final := sseEvent(`{"data":{"audio":"","status":2},"extra_info":{"audio_length":2100,"audio_size":4,"usage_characters":19616,"audio_format":"mp3"},"base_resp":{"status_code":0}}`)
	joined := first + second + final
	feedStream(t, c, http.StatusOK, joined[:10], joined[10:len(first)+5], joined[len(first)+5:])

	result, failure := c.result()
	if failure != nil {
		t.Fatalf("unexpected failure: %+v", failure)
	}
	if !bytes.Equal(result.Audio, []byte{0xFF, 0xFB, 0x90, 0x64}) {
		t.Fatalf("audio = %x", result.Audio)
	}
	if result.UsageCharacters != 19616 || result.AudioLengthMs != 2100 || result.AudioSizeBytes != 4 || result.AudioFormat != "mp3" {
		t.Fatalf("usage = %+v", result)
	}
}

func TestSpeechStreamCollectorDropsAggregatedFinalAudio(t *testing.T) {
	// 上游忽略 exclude_aggregated_audio（或老版本）时末帧会重发整段：不能再累加一次。
	c := &speechStreamCollector{}
	feedStream(t, c, http.StatusOK,
		sseEvent(`{"data":{"audio":"fffb","status":1},"base_resp":{"status_code":0}}`),
		sseEvent(`{"data":{"audio":"9064","status":1},"base_resp":{"status_code":0}}`),
		sseEvent(`{"data":{"audio":"fffb9064","status":2},"extra_info":{"usage_characters":9},"base_resp":{"status_code":0}}`),
	)
	result, failure := c.result()
	if failure != nil {
		t.Fatalf("unexpected failure: %+v", failure)
	}
	if !bytes.Equal(result.Audio, []byte{0xFF, 0xFB, 0x90, 0x64}) {
		t.Fatalf("audio = %x, want the stream to be kept once", result.Audio)
	}
}

func TestSpeechStreamCollectorAcceptsSingleAggregatedEvent(t *testing.T) {
	// 上游没按事件流回时执行插件会把整个 JSON 包成一个 data 事件：此时末帧就是整包。
	c := &speechStreamCollector{}
	feedStream(t, c, http.StatusOK,
		sseEvent(`{"data":{"audio":"fffb9064","status":2},"extra_info":{"usage_characters":9,"audio_length":700},"base_resp":{"status_code":0}}`),
	)
	result, failure := c.result()
	if failure != nil {
		t.Fatalf("unexpected failure: %+v", failure)
	}
	if !bytes.Equal(result.Audio, []byte{0xFF, 0xFB, 0x90, 0x64}) || result.AudioLengthMs != 700 {
		t.Fatalf("result = %+v", result)
	}
}

func TestSpeechStreamCollectorFailures(t *testing.T) {
	cases := []struct {
		name       string
		statusCode int
		parts      []string
		wantCode   string
		wantStatus int
	}{
		{
			name:       "error event mid stream",
			statusCode: http.StatusOK,
			parts: []string{
				sseEvent(`{"data":{"audio":"fffb","status":1},"base_resp":{"status_code":0}}`),
				sseEvent(`{"data":null,"base_resp":{"status_code":1002,"status_msg":"rate limit"}}`),
			},
			wantCode:   "rate_limited",
			wantStatus: http.StatusTooManyRequests,
		},
		{
			name:       "missing final chunk",
			statusCode: http.StatusOK,
			parts: []string{
				sseEvent(`{"data":{"audio":"fffb","status":1},"base_resp":{"status_code":0}}`),
				sseEvent(`{"data":{"audio":"9064","status":1},"base_resp":{"status_code":0}}`),
			},
			wantCode:   errCodeSpeechNoAudio,
			wantStatus: http.StatusBadGateway,
		},
		{
			name:       "no audio at all",
			statusCode: http.StatusOK,
			parts:      []string{sseEvent(`{"data":{"audio":"","status":2},"extra_info":{"usage_characters":9},"base_resp":{"status_code":0}}`)},
			wantCode:   errCodeSpeechNoAudio,
			wantStatus: http.StatusBadGateway,
		},
		{
			name:       "empty stream",
			statusCode: http.StatusOK,
			parts:      []string{": keep-alive\n\n"},
			wantCode:   errCodeSpeechForwardFailed,
			wantStatus: http.StatusBadGateway,
		},
		{
			name:       "core rejected before streaming",
			statusCode: http.StatusServiceUnavailable,
			parts:      []string{`{"error":{"message":"all routes failed","code":"no_available_account"}}`},
			wantCode:   "server_error",
			wantStatus: http.StatusBadGateway,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c := &speechStreamCollector{}
			feedStream(t, c, tc.statusCode, tc.parts...)
			_, failure := c.result()
			if failure == nil {
				t.Fatal("expected failure")
			}
			if failure.code != tc.wantCode || failure.status != tc.wantStatus {
				t.Fatalf("failure = %+v, want %s/%d", failure, tc.wantCode, tc.wantStatus)
			}
			if failure.message == "" || containsHan(failure.message) {
				t.Fatalf("client-facing message must be English: %q", failure.message)
			}
		})
	}
}

// TestSpeechStreamCollectorReadsUsageID 流式 done 帧今天不带 usage_id（core 只回 usage），
// 真带上时要能取到——这条守住契约，core 补齐后不必再改插件。
func TestSpeechStreamCollectorReadsUsageID(t *testing.T) {
	c := &speechStreamCollector{}
	if err := c.consume(hostForwardChunk{UsageID: 9001, Done: true}); err != nil {
		t.Fatal(err)
	}
	if c.usageID != 9001 {
		t.Fatalf("usageID = %d", c.usageID)
	}
}

func TestMapSpeechStreamError(t *testing.T) {
	cases := []struct {
		name       string
		err        error
		wantCode   string
		wantStatus int
	}{
		{name: "client error", err: status.Error(codes.InvalidArgument, "invalid request"), wantCode: "bad_request", wantStatus: http.StatusBadRequest},
		{name: "voice client error", err: status.Error(codes.InvalidArgument, "voice id not exist"), wantCode: errCodeSpeechVoiceNotFound, wantStatus: http.StatusBadRequest},
		{name: "quota", err: status.Error(codes.ResourceExhausted, "insufficient quota"), wantCode: "insufficient_balance", wantStatus: http.StatusPaymentRequired},
		{name: "denied", err: status.Error(codes.PermissionDenied, "capability missing"), wantCode: "auth_failed", wantStatus: http.StatusBadGateway},
		{name: "all routes failed", err: status.Error(codes.Unavailable, "all routes failed"), wantCode: "server_error", wantStatus: http.StatusBadGateway},
		{name: "plain error", err: errors.New("host is not enabled"), wantCode: errCodeSpeechForwardFailed, wantStatus: http.StatusBadGateway},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			failure := mapSpeechStreamError(tc.err)
			if failure.code != tc.wantCode || failure.status != tc.wantStatus {
				t.Fatalf("failure = %+v, want %s/%d", failure, tc.wantCode, tc.wantStatus)
			}
			if failure.message == "" || containsHan(failure.message) {
				t.Fatalf("client-facing message must be English: %q", failure.message)
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

// speechTestHost 模拟 core：groups.list 回一个可用分组，gateway.forward 的流式调用回
// 预置帧，assets.store 记下收到的字节并回 public_url。
//
// 缺省帧序列按 core 的真实形状拼：headers(forwardStatus) → chunk → done；forwardStatus
// 为 200 时 forwardBody 被包成一个 SSE data 事件，非 200 时原样当错误体。
// streamFrames 非空则完全接管（多帧流、中途错误帧、末帧缺失等形状）。
type speechTestHost struct {
	forwardStatus int
	forwardBody   string
	forwardErr    error
	streamFrames  []sdk.HostStreamFrame
	storeErr      error

	forwardPayload map[string]interface{}
	storePayload   map[string]interface{}
	groupCalls     int
}

// fakeHostStream 回放预置帧的 sdk.HostStream。
type fakeHostStream struct {
	frames []sdk.HostStreamFrame
	idx    int
}

func (s *fakeHostStream) Send(sdk.HostStreamFrame) error { return nil }
func (s *fakeHostStream) CloseSend() error               { return nil }

func (s *fakeHostStream) Recv() (*sdk.HostStreamFrame, error) {
	if s.idx >= len(s.frames) {
		return nil, io.EOF
	}
	frame := s.frames[s.idx]
	s.idx++
	return &frame, nil
}

// speechHeaderFrame / speechChunkFrame / speechDoneFrame 与 core host_service.go 的
// hostStreamWriter 一致：载荷是 JSON 解码后的 map，数字一律 float64。
func speechHeaderFrame(statusCode int) sdk.HostStreamFrame {
	return sdk.HostStreamFrame{Event: "headers", Status: "ok", Payload: map[string]interface{}{
		"status_code": float64(statusCode),
		"headers":     map[string]interface{}{},
	}}
}

func speechChunkFrame(data string) sdk.HostStreamFrame {
	return sdk.HostStreamFrame{Event: "chunk", Payload: map[string]interface{}{"data": data}}
}

// speechDoneFrame 末帧只有 usage：core 的流式路径不回 usage_id。
func speechDoneFrame() sdk.HostStreamFrame {
	return sdk.HostStreamFrame{Event: "done", Status: "ok", Done: true, Payload: map[string]interface{}{
		"usage": map[string]interface{}{"model": ""},
	}}
}

func speechDefaultFrames(statusCode int, body string) []sdk.HostStreamFrame {
	data := body
	if statusCode == http.StatusOK {
		data = sseEvent(body)
	}
	return []sdk.HostStreamFrame{speechHeaderFrame(statusCode), speechChunkFrame(data), speechDoneFrame()}
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
		// 语音必须走流式：同步整包会撞 core 的 64MB gRPC 上限（1 万字符实测回包 63MB）。
		return nil, errors.New("speech must not use unary gateway.forward")
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

func (h *speechTestHost) InvokeStream(_ context.Context, req sdk.HostStreamRequest) (sdk.HostStream, error) {
	if req.Method != hostMethodGatewayForward {
		return nil, errors.New("unexpected host stream method " + req.Method)
	}
	h.forwardPayload = req.Payload
	if h.forwardErr != nil {
		return nil, h.forwardErr
	}
	frames := h.streamFrames
	if frames == nil {
		frames = speechDefaultFrames(h.forwardStatus, h.forwardBody)
	}
	return &fakeHostStream{frames: frames}, nil
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
	// 三帧流：两片音频 + 带 extra_info 的末帧（exclude_aggregated_audio 生效，末帧无音频）。
	audio := []byte{0xFF, 0xFB, 0x90, 0x64, 0x00, 0x00, 0x01}
	host := &speechTestHost{streamFrames: []sdk.HostStreamFrame{
		speechHeaderFrame(http.StatusOK),
		speechChunkFrame(sseEvent(`{"data":{"audio":"` + hex.EncodeToString(audio[:4]) + `","status":1},"base_resp":{"status_code":0}}`)),
		speechChunkFrame(sseEvent(`{"data":{"audio":"` + hex.EncodeToString(audio[4:]) + `","status":1},"base_resp":{"status_code":0}}`)),
		speechChunkFrame(sseEvent(`{"data":{"audio":"","status":2},"extra_info":{"audio_length":2100,"audio_size":7,"usage_characters":9,"audio_format":"mp3"},"base_resp":{"status_code":0,"status_msg":"success"}}`)),
		speechDoneFrame(),
	}}
	p := newSpeechTestPlugin(host)

	rec := postSpeech(t, p, `{"text":"你好，世界","model":"speech-2.8-hd","group_id":56,"speed":1.2}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
	}
	out := decodeJSON(t, rec)
	if out["url"] != "/assets-runtime/generated/7/abc.mp3" || out["content_type"] != "audio/mpeg" || out["format"] != "mp3" {
		t.Fatalf("response = %v", out)
	}
	if out["usage_characters"] != float64(9) || out["audio_length_ms"] != float64(2100) || out["audio_size_bytes"] != float64(7) {
		t.Fatalf("usage fields = %v", out)
	}
	// core 的流式 done 帧只回 usage、不回 usage_id：字段缺席是当前契约，不是回归。
	if _, hasUsageID := out["usage_id"]; hasUsageID {
		t.Fatalf("usage_id must be omitted until core streams it: %v", out["usage_id"])
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
	if upstream["output_format"] != "hex" || upstream["stream"] != true || upstream["text"] != "你好，世界" {
		t.Fatalf("upstream body = %v", upstream)
	}
	options, _ := upstream["stream_options"].(map[string]interface{})
	if options["exclude_aggregated_audio"] != true {
		t.Fatalf("stream_options = %v", upstream["stream_options"])
	}
	if host.forwardPayload["stream"] != true {
		t.Fatalf("gateway.forward must be called with stream=true: %v", host.forwardPayload["stream"])
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
			host:       &speechTestHost{forwardStatus: http.StatusOK, forwardBody: `{"data":{"audio":"fffb","status":2},"extra_info":{"usage_characters":2},"base_resp":{"status_code":0}}`, storeErr: errors.New("disk full")},
			wantStatus: http.StatusInternalServerError,
			wantCode:   errCodeSpeechStoreFailed,
		},
		{
			// 流式下 4xx 不再以 status_code + body 回来，而是 gRPC InvalidArgument。
			name:       "client error surfaces as grpc status",
			host:       &speechTestHost{forwardErr: status.Error(codes.InvalidArgument, "voice id not exist")},
			wantStatus: http.StatusBadRequest,
			wantCode:   errCodeSpeechVoiceNotFound,
		},
		{
			name:       "truncated stream",
			host:       &speechTestHost{streamFrames: []sdk.HostStreamFrame{speechHeaderFrame(http.StatusOK), speechChunkFrame(sseEvent(`{"data":{"audio":"fffb","status":1},"base_resp":{"status_code":0}}`)), speechDoneFrame()}},
			wantStatus: http.StatusBadGateway,
			wantCode:   errCodeSpeechNoAudio,
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
