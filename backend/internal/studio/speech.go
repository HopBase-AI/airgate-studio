package studio

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	sdk "github.com/DouDOU-start/airgate-sdk/sdkgo"
)

// 语音合成（MiniMax Speech 2.8，platform=minimax）。
//
// 与生图 / 生视频不同，语音没有 host task，而是一次**流式转发**：经 host gateway.forward
// 的 InvokeStream 打执行插件的原生 POST /v1/t2a_v2（stream=true，SSE，每个 data 事件的
// data.audio 是该分片的 hex 音频），逐帧 hex 解码累积，网关按末帧 extra_info.usage_characters
// 计费并落 usage_logs；这里把累积出的字节经 assets.store 落成持久资产（purpose=generated，
// 按后台 asset_retention_generated_days 保留，0=永久），再在 studio_assets 记一条 kind=audio。
//
// 为什么必须流式（2026-09-16 生产实测）：官方上限 1 万码点的中文（19,616 计费字符）
// 整包回应 63.25MB / 161 秒，同步路径会连撞两道 64MB 硬闸——执行插件的
// maxSpeechResponseBytes 与 core 的 pluginGRPCMaxMessageBytes——而那时上游已经合成完并
// 计费，用户付了钱却拿不到音频；speech-2.8-hd 同样输入直接 502。官方文档也建议超过
// 3000 字符走流式。上游请求体必须带 stream_options.exclude_aggregated_audio=true：
// 否则末帧会把整段音频再发一遍，流式就白走了。
//
// 不走 OpenAI 兼容的 /v1/audio/speech：二进制应答经 Host 的 JSON 载荷要再猜一次
// 编码，原生 JSON 最稳。
//
// 客户可见文案一律英文；本地化由前端按 error_code 完成（web/src/studio/video/failureHints.ts）。
const (
	speechPlatform   = "minimax"
	speechNativePath = "/v1/t2a_v2"

	speechModelHD    = "speech-2.8-hd"
	speechModelTurbo = "speech-2.8-turbo"

	// maxSpeechTextChars 原生入口官方上限（Unicode 码点数），与网关插件同口径。
	maxSpeechTextChars = 10000
	// maxSpeechRequestBytes 请求体上限：1 万字符文本远不到 1MB，更大只可能是误用。
	maxSpeechRequestBytes = 1 << 20

	speechMinSpeed     = 0.5
	speechMaxSpeed     = 2.0
	speechDefaultSpeed = 1.0

	speechDefaultFormat = "mp3"
	speechOutputFormat  = "hex"

	// speechSSEDataPrefix 上游是标准 SSE：`data: {...}\n\n`，无 event 名、无 [DONE] 终止事件。
	speechSSEDataPrefix = "data:"
	// speechFinalChunkStatus 末帧标记：data.status==2 的那一帧带 extra_info（计费与时长）。
	speechFinalChunkStatus = 2
	// maxSpeechStreamEventBytes 单个 SSE 事件（以及 core 判决失败时的错误体）累积上限。
	// 分片音频的 hex 远小于此；超过说明流不是我们认识的形状，早停好过无限累积。
	maxSpeechStreamEventBytes = 32 << 20

	// speechDefaultVoiceID / speechDefaultVoiceIDHan 未指定音色时按文本语言选：含汉字用
	// 普通话音色，否则英文音色——英文音色念中文会整段读成拼音式乱音。ID 与网关插件
	// OpenAI 入口的缺省一致（2026-09-16 对上游实测可用）。
	speechDefaultVoiceID    = "English_expressive_narrator"
	speechDefaultVoiceIDHan = "Chinese (Mandarin)_News_Anchor"
	// cantoneseLanguageBoost 粤语音色必须带 language_boost，否则上游按普通话处理。
	cantoneseLanguageBoost = "Chinese,Yue"

	maxSpeechVoiceIDLen       = 128
	maxSpeechLanguageBoostLen = 64

	// speechAssetPurpose 生成产物走 generated 保留策略；kind / mode 是 studio_assets 里的介质标识。
	speechAssetPurpose = "generated"
	speechAssetKind    = "audio"
	speechAssetMode    = "speech"

	// headerSubmitterID 提交人本人：企业成员发起时 core 会把付费身份改写成企业主，
	// 执行插件按这个头把记录挂回提交人（与视频影子任务同一约定）。
	headerSubmitterID = "X-Airgate-Submitter-ID"
)

// 语音专属的失败分类码。前端 failureHints.ts 把它们映射到五语文案；通用码
// （bad_request / rate_limited / auth_failed / insufficient_balance …）沿用既有映射。
const (
	errCodeSpeechTextRequired     = "speech_text_required"
	errCodeSpeechTextTooLong      = "speech_text_too_long"
	errCodeSpeechUnsupportedModel = "speech_unsupported_model"
	errCodeSpeechInvalidSpeed     = "speech_invalid_speed"
	errCodeSpeechInvalidParameter = "speech_invalid_parameter"
	errCodeSpeechGroupMissing     = "speech_group_missing"
	errCodeSpeechVoiceNotFound    = "speech_voice_not_found"
	errCodeSpeechNoAudio          = "speech_no_audio"
	errCodeSpeechStoreFailed      = "speech_store_failed"
	errCodeSpeechForwardFailed    = "upstream_forward_failed"
	errCodeSpeechProjectNotFound  = "project_not_found"
)

// speechFormats 工作坊放开的音频格式：v1 界面固定 mp3，接口层多认 wav / flac 以备后用。
// opus 上游要求显式 sample_rate、pcm 是裸流，浏览器 <audio> 不能直接播，都不放开。
var speechFormats = map[string]struct {
	contentType string
	ext         string
}{
	"mp3":  {contentType: "audio/mpeg", ext: ".mp3"},
	"wav":  {contentType: "audio/wav", ext: ".wav"},
	"flac": {contentType: "audio/flac", ext: ".flac"},
}

// speechEmotions Speech 2.8 官方情绪枚举（whisper 明确不支持 2.8，fluent 只在 2.6 系列文档）。
var speechEmotions = map[string]struct{}{
	"happy": {}, "sad": {}, "angry": {}, "fearful": {}, "disgusted": {}, "surprised": {}, "calm": {},
}

var speechModels = map[string]struct{}{
	speechModelHD:    {},
	speechModelTurbo: {},
}

func speechModelIDs() []string {
	return []string{speechModelHD, speechModelTurbo}
}

// speechRequest POST /speech 入参。
type speechRequest struct {
	Text    string   `json:"text"`
	Model   string   `json:"model"`
	VoiceID string   `json:"voice_id,omitempty"`
	Speed   *float64 `json:"speed,omitempty"`
	Emotion string   `json:"emotion,omitempty"`
	Format  string   `json:"format,omitempty"`
	// LanguageBoost 上游的语种增强（粤语音色须为 "Chinese,Yue"）；缺省按音色自动补。
	LanguageBoost string `json:"language_boost,omitempty"`
	GroupID       int64  `json:"group_id,omitempty"`
	ProjectID     int64  `json:"project_id,omitempty"`
}

// speechPlan 校验后的合成计划：所有字段已归一，可直接拼上游请求体。
type speechPlan struct {
	Text          string
	Model         string
	VoiceID       string
	Speed         float64
	Emotion       string
	Format        string
	ContentType   string
	FileExt       string
	LanguageBoost string
	// TextChars 码点数（官方上限口径）；EstimatedChars 计费字符预估（码点 + 汉字数）。
	TextChars      int
	EstimatedChars int64
}

// speechValidationError 请求校验失败：code 给前端按码本地化，msg 是英文原文。
type speechValidationError struct {
	code string
	msg  string
}

func (e *speechValidationError) Error() string { return e.msg }

func speechInvalid(code, format string, args ...any) error {
	return &speechValidationError{code: code, msg: fmt.Sprintf(format, args...)}
}

// speechBillableCharacters 官方计费口径：每个 Unicode 字符计 1，汉字再加 1（实测与
// extra_info.usage_characters 精确相等）。只用于提交前预估，权威基数以上游回报为准。
func speechBillableCharacters(text string) int64 {
	var count int64
	for _, r := range text {
		count++
		if unicode.Is(unicode.Han, r) {
			count++
		}
	}
	return count
}

// speechVoiceLanguageBoosts 音色 ID 的语言前缀（第一个下划线之前的那段）→ 官方
// language_boost 取值。官方系统音色列表里共 24 个语言前缀，除两个中文变体外前缀名与
// language_boost 枚举值同形：
//
//	普通话音色前缀是 "Chinese (Mandarin)_"，枚举值却是 "Chinese"；
//	粤语前缀 "Cantonese_" 对应 "Chinese,Yue"。
//
// 取值必须落在官方枚举内（见 speech_test.go 的 officialLanguageBoostEnum 守卫）——
// 传枚举外的字符串上游直接 2013 invalid params，宁可不补也不能臆造。
var speechVoiceLanguageBoosts = map[string]string{
	"Chinese (Mandarin)": "Chinese",
	"Cantonese":          cantoneseLanguageBoost,
	"English":            "English",
	"Japanese":           "Japanese",
	"Korean":             "Korean",
	"Spanish":            "Spanish",
	"Portuguese":         "Portuguese",
	"French":             "French",
	"Indonesian":         "Indonesian",
	"German":             "German",
	"Russian":            "Russian",
	"Italian":            "Italian",
	"Dutch":              "Dutch",
	"Vietnamese":         "Vietnamese",
	"Arabic":             "Arabic",
	"Turkish":            "Turkish",
	"Ukrainian":          "Ukrainian",
	"Thai":               "Thai",
	"Polish":             "Polish",
	"Romanian":           "Romanian",
	"Greek":              "Greek",
	"Czech":              "Czech",
	"Finnish":            "Finnish",
	"Hindi":              "Hindi",
}

// speechLanguageBoostFor 按音色 ID 前缀推导 language_boost；认不出前缀就返回空串
// （官方列表里 "Arrogant_Miss" / "Robot_Armor" 这类无语言前缀的音色即走这条路），
// 让上游自己识别语种，不乱补。
func speechLanguageBoostFor(voiceID string) string {
	prefix, _, ok := strings.Cut(voiceID, "_")
	if !ok {
		return ""
	}
	return speechVoiceLanguageBoosts[prefix]
}

// speechDefaultVoiceFor 按文本内容挑默认音色：含汉字用普通话音色，否则英文音色。
func speechDefaultVoiceFor(text string) string {
	for _, r := range text {
		if unicode.Is(unicode.Han, r) {
			return speechDefaultVoiceIDHan
		}
	}
	return speechDefaultVoiceID
}

func hasControlRune(s string) bool {
	for _, r := range s {
		if unicode.IsControl(r) {
			return true
		}
	}
	return false
}

// planSpeech 校验并归一请求。只把关网关也会把关的部分（文本、模型、语速、格式、枚举），
// 音色 ID 不做白名单：官方 332 个系统音色都可用，不存在的 ID 由上游 2054 回给客户。
func planSpeech(req speechRequest) (speechPlan, error) {
	var plan speechPlan

	plan.Text = strings.TrimSpace(req.Text)
	if plan.Text == "" {
		return plan, speechInvalid(errCodeSpeechTextRequired, "text must not be empty")
	}
	plan.TextChars = utf8.RuneCountInString(plan.Text)
	if plan.TextChars > maxSpeechTextChars {
		return plan, speechInvalid(errCodeSpeechTextTooLong, "text exceeds the %d character limit (got %d characters)", maxSpeechTextChars, plan.TextChars)
	}
	plan.EstimatedChars = speechBillableCharacters(plan.Text)

	plan.Model = strings.TrimSpace(req.Model)
	if _, ok := speechModels[plan.Model]; !ok {
		return plan, speechInvalid(errCodeSpeechUnsupportedModel, "model %q is not a supported speech model; use one of %s", req.Model, strings.Join(speechModelIDs(), ", "))
	}

	plan.Speed = speechDefaultSpeed
	if req.Speed != nil {
		speed := *req.Speed
		if math.IsNaN(speed) || math.IsInf(speed, 0) || speed < speechMinSpeed || speed > speechMaxSpeed {
			return plan, speechInvalid(errCodeSpeechInvalidSpeed, "speed must be within [%g, %g] (got %g)", speechMinSpeed, speechMaxSpeed, speed)
		}
		plan.Speed = speed
	}

	emotion := strings.ToLower(strings.TrimSpace(req.Emotion))
	if emotion != "" && emotion != "auto" {
		if _, ok := speechEmotions[emotion]; !ok {
			return plan, speechInvalid(errCodeSpeechInvalidParameter, "emotion %q is not supported; use one of happy, sad, angry, fearful, disgusted, surprised, calm", req.Emotion)
		}
		plan.Emotion = emotion
	}

	format := strings.ToLower(strings.TrimSpace(req.Format))
	if format == "" {
		format = speechDefaultFormat
	}
	spec, ok := speechFormats[format]
	if !ok {
		return plan, speechInvalid(errCodeSpeechInvalidParameter, "format %q is not supported; use one of mp3, wav, flac", req.Format)
	}
	plan.Format = format
	plan.ContentType = spec.contentType
	plan.FileExt = spec.ext

	requestedVoice := strings.TrimSpace(req.VoiceID)
	voice := requestedVoice
	if voice == "" {
		voice = speechDefaultVoiceFor(plan.Text)
	}
	if utf8.RuneCountInString(voice) > maxSpeechVoiceIDLen || hasControlRune(voice) {
		return plan, speechInvalid(errCodeSpeechInvalidParameter, "voice_id must be at most %d printable characters", maxSpeechVoiceIDLen)
	}
	plan.VoiceID = voice

	boost := strings.TrimSpace(req.LanguageBoost)
	if boost == "" {
		// language_boost 官方语义是「文本是哪门语言」的提示。界面已经讲明音色只决定
		// 口音、不做翻译，挑了某语言的母语音色就意味着文本也是那门语言——据此自动补，
		// 否则上游语种判定会飘、发音不准（粤语一直如此，这里推广到全部语言前缀）。
		//
		// 只对**显式选定**的音色推导：voice_id 留空走的是「按文本语言自动选音色」，
		// 那只是含汉字→普通话、否则英文的粗猜（日文假名文本就会落到英文音色），
		// 拿这个猜测去钉死语种反而会压掉上游本来更准的自动识别。
		boost = speechLanguageBoostFor(requestedVoice)
	}
	if utf8.RuneCountInString(boost) > maxSpeechLanguageBoostLen || hasControlRune(boost) {
		return plan, speechInvalid(errCodeSpeechInvalidParameter, "language_boost must be at most %d printable characters", maxSpeechLanguageBoostLen)
	}
	plan.LanguageBoost = boost
	return plan, nil
}

// buildSpeechUpstreamBody 拼原生 t2a_v2 请求体（stream=true、output_format=hex）。
//
// stream_options.exclude_aggregated_audio=true 是关键：MiniMax 默认在末帧重发**完整聚合
// 音频**，不关掉的话最后一帧照样是整包（1 万字符 ≈ 31MB），流式等于没走。
func buildSpeechUpstreamBody(plan speechPlan) ([]byte, error) {
	voice := map[string]any{
		"voice_id": plan.VoiceID,
		"speed":    plan.Speed,
	}
	if plan.Emotion != "" {
		voice["emotion"] = plan.Emotion
	}
	payload := map[string]any{
		"model":          plan.Model,
		"text":           plan.Text,
		"stream":         true,
		"stream_options": map[string]any{"exclude_aggregated_audio": true},
		"output_format":  speechOutputFormat,
		"voice_setting":  voice,
		"audio_setting":  map[string]any{"format": plan.Format},
	}
	if plan.LanguageBoost != "" {
		payload["language_boost"] = plan.LanguageBoost
	}
	return json.Marshal(payload)
}

// speechFailure 上游 / 网关侧失败：status 回给前端的 HTTP 状态，code 分类码，message 英文原文。
type speechFailure struct {
	status  int
	code    string
	message string
	// upstreamCode 上游 / 网关错误体里的 code 原样带回（排查用），可能为空。
	upstreamCode string
}

func (f *speechFailure) payload() map[string]any {
	out := map[string]any{
		"error":      f.message,
		"code":       f.code,
		"error_code": f.code,
	}
	if f.upstreamCode != "" {
		out["upstream_code"] = f.upstreamCode
	}
	return out
}

// speechStreamEvent 单个 SSE data 事件的解析结果。
type speechStreamEvent struct {
	// Audio 该事件携带的音频分片（已 hex 解码）；中间帧可能为空，末帧在
	// exclude_aggregated_audio 生效时必为空。
	Audio []byte
	// Final 末帧标记：data.status==2 或带 extra_info。
	Final bool
	// HasExtra 该事件带 extra_info（计费字符 / 时长 / 体积的权威来源）。
	HasExtra        bool
	UsageCharacters int64
	AudioLengthMs   int64
	AudioSizeBytes  int64
	AudioFormat     string
}

// parseSpeechEvent 解析一个 SSE data 事件（同步整包应答也是同一形状，故复用）：
// base_resp.status_code≠0 是失败（网关插件通常已把首帧失败转成非 200，这里再兜一层），
// 否则 hex 解码 data.audio。空 audio 不是错误——流中间帧和末帧都可以没有音频。
func parseSpeechEvent(body []byte) (*speechStreamEvent, *speechFailure) {
	var payload struct {
		Data *struct {
			Audio  string `json:"audio"`
			Status int    `json:"status"`
		} `json:"data"`
		ExtraInfo *struct {
			AudioLength     int64  `json:"audio_length"`
			AudioSize       int64  `json:"audio_size"`
			UsageCharacters int64  `json:"usage_characters"`
			AudioFormat     string `json:"audio_format"`
		} `json:"extra_info"`
		BaseResp *struct {
			StatusCode int64  `json:"status_code"`
			StatusMsg  string `json:"status_msg"`
		} `json:"base_resp"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, &speechFailure{
			status:  http.StatusBadGateway,
			code:    errCodeSpeechForwardFailed,
			message: "speech service returned a non-JSON response",
		}
	}
	if payload.BaseResp != nil && payload.BaseResp.StatusCode != 0 {
		return nil, speechFailureFromBaseResp(payload.BaseResp.StatusCode, payload.BaseResp.StatusMsg)
	}
	out := &speechStreamEvent{}
	if payload.Data != nil {
		if hexAudio := strings.TrimSpace(payload.Data.Audio); hexAudio != "" {
			audio, err := hex.DecodeString(hexAudio)
			if err != nil || len(audio) == 0 {
				return nil, &speechFailure{
					status:  http.StatusBadGateway,
					code:    errCodeSpeechNoAudio,
					message: "speech service returned audio data that could not be decoded",
				}
			}
			out.Audio = audio
		}
		out.Final = payload.Data.Status == speechFinalChunkStatus
	}
	if payload.ExtraInfo != nil {
		out.Final = true
		out.HasExtra = true
		out.UsageCharacters = payload.ExtraInfo.UsageCharacters
		out.AudioLengthMs = payload.ExtraInfo.AudioLength
		out.AudioSizeBytes = payload.ExtraInfo.AudioSize
		out.AudioFormat = payload.ExtraInfo.AudioFormat
	}
	return out, nil
}

// speechUpstreamResult 整条流累积出的合成结果。
type speechUpstreamResult struct {
	Audio           []byte
	UsageCharacters int64
	AudioLengthMs   int64
	AudioSizeBytes  int64
	AudioFormat     string
}

// speechStreamCollector 逐帧累积 gateway.forward 的流式应答（帧协议见 hostForwardChunk）。
//
// 两条互斥的路：headers 帧报 <400 就按 SSE 累积音频；报 ≥400 说明 core 侧已判决失败，
// 后续分片是错误体原文，交给 mapSpeechForwardFailure 分类。
// 分片不保证按行对齐，所以行缓冲要跨帧拼。
type speechStreamCollector struct {
	statusCode int
	errBody    []byte

	pending []byte
	audio   []byte

	sawEvent bool
	sawFinal bool
	extra    speechStreamEvent
	failure  *speechFailure
	usageID  int64
}

// consume 消费一帧。故意不在失败时提前返回 error 掐断流：让 core 把自己的判决和
// 记账走完，插件侧只记住第一个失败。
func (c *speechStreamCollector) consume(chunk hostForwardChunk) error {
	if chunk.UsageID > 0 {
		c.usageID = chunk.UsageID
	}
	if chunk.StatusCode > 0 {
		c.statusCode = chunk.StatusCode
	}
	if len(chunk.Data) == 0 {
		return nil
	}
	if c.statusCode >= http.StatusBadRequest {
		if len(c.errBody) < maxSpeechStreamEventBytes {
			c.errBody = append(c.errBody, chunk.Data...)
		}
		return nil
	}
	if c.failure != nil {
		return nil
	}
	c.pending = append(c.pending, chunk.Data...)
	for {
		idx := bytes.IndexByte(c.pending, '\n')
		if idx < 0 {
			break
		}
		line := c.pending[:idx]
		c.pending = c.pending[idx+1:]
		c.consumeLine(line)
		if c.failure != nil {
			return nil
		}
	}
	if len(c.pending) > maxSpeechStreamEventBytes {
		c.pending = nil
		c.failure = &speechFailure{
			status:  http.StatusBadGateway,
			code:    errCodeSpeechForwardFailed,
			message: "speech service returned an oversized stream event",
		}
	}
	return nil
}

// consumeLine 处理一整行。非 data 行（注释、event:、空行）直接忽略，不该中断累积。
func (c *speechStreamCollector) consumeLine(line []byte) {
	trimmed := bytes.TrimRight(line, "\r")
	if !bytes.HasPrefix(trimmed, []byte(speechSSEDataPrefix)) {
		return
	}
	body := bytes.TrimSpace(trimmed[len(speechSSEDataPrefix):])
	if len(body) == 0 || body[0] != '{' {
		return
	}
	event, failure := parseSpeechEvent(body)
	if failure != nil {
		c.failure = failure
		return
	}
	c.sawEvent = true
	// 末帧原本会重发整段聚合音频（已用 exclude_aggregated_audio 关掉）。真收到时只在
	// 之前一片都没拿到的情况下当整包用（上游没按事件流回、插件把整个 JSON 包成一个
	// data 事件时就是这条路），否则丢弃——否则音频翻倍。
	if len(event.Audio) > 0 && (!event.Final || len(c.audio) == 0) {
		c.audio = append(c.audio, event.Audio...)
	}
	if event.Final {
		c.sawFinal = true
	}
	if event.HasExtra {
		c.extra = *event
	}
}

// result 收流：先把最后一个可能没带换行的事件处理掉，再给出结果或失败。
func (c *speechStreamCollector) result() (*speechUpstreamResult, *speechFailure) {
	if c.statusCode < http.StatusBadRequest && c.failure == nil && len(c.pending) > 0 {
		line := c.pending
		c.pending = nil
		c.consumeLine(line)
	}
	if c.statusCode >= http.StatusBadRequest {
		return nil, mapSpeechForwardFailure(c.statusCode, c.errBody)
	}
	if c.failure != nil {
		return nil, c.failure
	}
	if !c.sawEvent {
		return nil, &speechFailure{
			status:  http.StatusBadGateway,
			code:    errCodeSpeechForwardFailed,
			message: "speech service returned an empty stream",
		}
	}
	if len(c.audio) == 0 {
		return nil, &speechFailure{
			status:  http.StatusBadGateway,
			code:    errCodeSpeechNoAudio,
			message: "speech service returned no audio data",
		}
	}
	if !c.sawFinal {
		// 末帧缺失 = 流被截断：音频不完整，上游此时也不计费（执行插件同口径），
		// 不能把半截音频当成品交给用户。
		return nil, &speechFailure{
			status:  http.StatusBadGateway,
			code:    errCodeSpeechNoAudio,
			message: "speech stream ended before the final audio chunk",
		}
	}
	out := &speechUpstreamResult{
		Audio:           c.audio,
		AudioSizeBytes:  int64(len(c.audio)),
		UsageCharacters: c.extra.UsageCharacters,
		AudioLengthMs:   c.extra.AudioLengthMs,
		AudioFormat:     c.extra.AudioFormat,
	}
	if c.extra.AudioSizeBytes > 0 {
		out.AudioSizeBytes = c.extra.AudioSizeBytes
	}
	return out, nil
}

// mapSpeechStreamError 流式转发的传输级错误 → 失败卡可消费的分类码。
//
// 与同步转发的差异（core host_service.go）：流式路径下 4xx 不再以 status_code + body
// 回到插件，而是 gRPC status——客户端错误 InvalidArgument、余额不足 ResourceExhausted、
// 线路全失败 Unavailable、调用方断开 Canceled。
func mapSpeechStreamError(err error) *speechFailure {
	message := strings.TrimSpace(err.Error())
	st, ok := status.FromError(err)
	if ok {
		if msg := strings.TrimSpace(st.Message()); msg != "" {
			message = msg
		}
	}
	if message == "" {
		message = "speech service is unavailable"
	}
	failure := &speechFailure{status: http.StatusBadGateway, code: errCodeSpeechForwardFailed, message: message}
	if !ok {
		return failure
	}
	switch st.Code() {
	case codes.InvalidArgument:
		failure.status = http.StatusBadRequest
		if strings.Contains(strings.ToLower(message), "voice") {
			failure.code = errCodeSpeechVoiceNotFound
		} else {
			failure.code = "bad_request"
		}
	case codes.ResourceExhausted:
		failure.status, failure.code = http.StatusPaymentRequired, "insufficient_balance"
	case codes.PermissionDenied, codes.Unauthenticated:
		failure.status, failure.code = http.StatusBadGateway, "auth_failed"
	case codes.Unavailable, codes.Internal, codes.NotFound, codes.DeadlineExceeded:
		failure.status, failure.code = http.StatusBadGateway, "server_error"
	}
	return failure
}

// speechFailureFromBaseResp 旧协议「HTTP 200 + base_resp 非 0」的错误码分类
// （与网关插件 classifyMiniMaxError 同口径）：1002/1039 限流、1004/1008 鉴权 / 欠费、
// 2054 音色不存在、2013/1042 参数错误，其余按服务侧故障。
func speechFailureFromBaseResp(code int64, msg string) *speechFailure {
	message := strings.TrimSpace(msg)
	if message == "" {
		message = fmt.Sprintf("speech service rejected the request (code %d)", code)
	}
	failure := &speechFailure{message: message, upstreamCode: strconv.FormatInt(code, 10)}
	switch code {
	case 1002, 1039:
		failure.status, failure.code = http.StatusTooManyRequests, "rate_limited"
	case 1004:
		failure.status, failure.code = http.StatusBadGateway, "auth_failed"
	case 1008:
		failure.status, failure.code = http.StatusBadGateway, "upstream_unavailable"
	case 2054:
		failure.status, failure.code = http.StatusBadRequest, errCodeSpeechVoiceNotFound
	case 2013, 1042:
		failure.status, failure.code = http.StatusBadRequest, "bad_request"
	default:
		failure.status, failure.code = http.StatusBadGateway, "server_error"
	}
	return failure
}

// mapSpeechForwardFailure 网关 / 上游非 200 应答 → 前端可消费的失败：错误体是 OpenAI 形态
// {"error":{"message","type","code"}}。回给浏览器的状态码不透传 401/403——控制台前端有
// 401 全局拦截会把用户登出，鉴权类失败一律按 502 交给失败卡。
func mapSpeechForwardFailure(statusCode int, body []byte) *speechFailure {
	var payload struct {
		Error *struct {
			Message string `json:"message"`
			Type    string `json:"type"`
			Code    string `json:"code"`
		} `json:"error"`
	}
	message := ""
	upstreamCode := ""
	if err := json.Unmarshal(body, &payload); err == nil && payload.Error != nil {
		message = strings.TrimSpace(payload.Error.Message)
		upstreamCode = strings.TrimSpace(payload.Error.Code)
	}
	if message == "" {
		message = strings.TrimSpace(truncate(string(body), 300))
	}
	if message == "" {
		message = fmt.Sprintf("speech service returned HTTP %d", statusCode)
	}
	failure := &speechFailure{message: message, upstreamCode: upstreamCode}
	switch {
	case statusCode == http.StatusBadRequest || statusCode == http.StatusUnprocessableEntity || statusCode == http.StatusRequestEntityTooLarge:
		failure.status = http.StatusBadRequest
		if strings.Contains(strings.ToLower(message), "voice") {
			failure.code = errCodeSpeechVoiceNotFound
		} else {
			failure.code = "bad_request"
		}
	case statusCode == http.StatusUnauthorized || statusCode == http.StatusForbidden:
		failure.status, failure.code = http.StatusBadGateway, "auth_failed"
	case statusCode == http.StatusPaymentRequired:
		failure.status, failure.code = http.StatusPaymentRequired, "insufficient_balance"
	case statusCode == http.StatusNotFound:
		failure.status, failure.code = http.StatusNotFound, "model_not_in_catalog"
	case statusCode == http.StatusTooManyRequests:
		failure.status, failure.code = http.StatusTooManyRequests, "rate_limited"
	case statusCode >= 500:
		failure.status, failure.code = http.StatusBadGateway, "server_error"
	default:
		failure.status, failure.code = http.StatusBadGateway, errCodeSpeechForwardFailed
	}
	return failure
}

// hostStoreSpeechAsset 把解码后的音频字节经 assets.store 落成持久资产（purpose=generated）。
func hostStoreSpeechAsset(ctx context.Context, host sdk.Host, userID int64, contentType, ext string, data []byte) (*storedReferenceAsset, error) {
	resp, err := hostInvoke(ctx, host, hostMethodAssetsStore, map[string]interface{}{
		"user_id":        userID,
		"purpose":        speechAssetPurpose,
		"content_type":   contentType,
		"file_extension": ext,
		"data":           data,
	})
	if err != nil {
		return nil, err
	}
	stored := &storedReferenceAsset{
		PublicURL: stringFromAny(firstValue(resp, "public_url")),
		ObjectKey: stringFromAny(firstValue(resp, "object_key")),
	}
	if strings.TrimSpace(stored.PublicURL) == "" {
		return nil, fmt.Errorf("assets.store returned no public_url")
	}
	return stored, nil
}

// speechResponse POST /speech 成功应答。asset 只在项目存储可用时有值。
type speechResponse struct {
	Asset           *AssetRecord `json:"asset,omitempty"`
	ProjectID       int64        `json:"project_id"`
	URL             string       `json:"url"`
	ContentType     string       `json:"content_type"`
	Format          string       `json:"format"`
	Platform        string       `json:"platform"`
	Model           string       `json:"model"`
	GroupID         int64        `json:"group_id"`
	RouteKey        string       `json:"route_key"`
	VoiceID         string       `json:"voice_id"`
	Speed           float64      `json:"speed"`
	Emotion         string       `json:"emotion,omitempty"`
	LanguageBoost   string       `json:"language_boost,omitempty"`
	Text            string       `json:"text"`
	TextChars       int          `json:"text_chars"`
	UsageCharacters int64        `json:"usage_characters"`
	AudioLengthMs   int64        `json:"audio_length_ms"`
	AudioSizeBytes  int64        `json:"audio_size_bytes"`
	UsageID         int64        `json:"usage_id,omitempty"`
	CreatedAt       string       `json:"created_at"`
}

// handleSpeech 文本 → 音频。校验 → 分组资格 → gateway.forward（同步）→ hex 解码 →
// assets.store → studio_assets（kind=audio）。校验类错误在打上游之前给回，不占计费。
func (p *StudioPlugin) handleSpeech(w http.ResponseWriter, r *http.Request) {
	var req speechRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxSpeechRequestBytes)).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	plan, err := planSpeech(req)
	if err != nil {
		var verr *speechValidationError
		code := errCodeSpeechInvalidParameter
		if errors.As(err, &verr) {
			code = verr.code
		}
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error(), "code": code, "error_code": code})
		return
	}
	userID := parseUserIDInt64(r)

	// 分组显式必填并校验资格（与图片一致：缺 group_id 失败关闭，不落到 core 自动选组）。
	if req.GroupID <= 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{
			"error":      "select an available speech group",
			"code":       errCodeSpeechGroupMissing,
			"error_code": errCodeSpeechGroupMissing,
		})
		return
	}
	groups, err := hostListEligibleGroups(r.Context(), p.host, userID, speechPlatform, plan.Model, false)
	if err != nil {
		p.logger.Error("speech_list_groups_failed", "user_id", userID, "model", plan.Model, "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to query available groups"})
		return
	}
	if !speechGroupEligible(groups, req.GroupID) {
		writeJSON(w, http.StatusForbidden, map[string]string{
			"error":      "group is unavailable or not accessible",
			"code":       errCodeSpeechGroupMissing,
			"error_code": errCodeSpeechGroupMissing,
		})
		return
	}

	// 项目归属在打上游之前核对：合成已计费、项目却不存在的话音频就没处落。
	projectID := req.ProjectID
	if p.svc != nil && projectID > 0 {
		exists, err := p.svc.projectExists(r.Context(), int(userID), projectID)
		if err != nil {
			p.logger.Error("speech_project_lookup_failed", "user_id", userID, "project_id", projectID, "error", err)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to verify the project"})
			return
		}
		if !exists {
			writeJSON(w, http.StatusNotFound, map[string]string{
				"error":      "project not found",
				"code":       errCodeSpeechProjectNotFound,
				"error_code": errCodeSpeechProjectNotFound,
			})
			return
		}
	}

	body, err := buildSpeechUpstreamBody(plan)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to encode the speech request"})
		return
	}
	headers := http.Header{}
	headers.Set("Content-Type", "application/json")
	headers.Set("X-Airgate-Platform", speechPlatform)
	headers.Set(headerSubmitterID, strconv.FormatInt(userID, 10))
	collector := &speechStreamCollector{}
	if err := hostForwardStream(r.Context(), p.host, hostForwardRequest{
		UserID:  userID,
		GroupID: req.GroupID,
		Model:   plan.Model,
		Method:  http.MethodPost,
		Path:    speechNativePath,
		Headers: headers,
		Body:    body,
	}, collector.consume); err != nil {
		failure := mapSpeechStreamError(err)
		p.logger.Error("speech_forward_failed", "user_id", userID, "model", plan.Model, "group_id", req.GroupID, "code", failure.code, "error", err)
		writeJSON(w, failure.status, failure.payload())
		return
	}
	result, failure := collector.result()
	if failure != nil {
		p.logger.Warn("speech_upstream_rejected", "user_id", userID, "model", plan.Model, "status", collector.statusCode, "code", failure.code, "message", failure.message)
		writeJSON(w, failure.status, failure.payload())
		return
	}

	stored, err := hostStoreSpeechAsset(r.Context(), p.host, userID, plan.ContentType, plan.FileExt, result.Audio)
	if err != nil {
		// 上游已合成并计费，只是本地没存下来：记 ERROR 便于人工补救。
		// 流式的 done 帧只回 usage、不回 usage_id（core 侧缺口），对账要靠
		// user_id + model + usage_characters + 时间窗去 usage_logs 里找。
		p.logger.Error("speech_store_failed", "user_id", userID, "model", plan.Model, "group_id", req.GroupID, "usage_id", collector.usageID, "usage_characters", result.UsageCharacters, "size_bytes", len(result.Audio), "error", err)
		failure := &speechFailure{status: http.StatusInternalServerError, code: errCodeSpeechStoreFailed, message: "failed to store the synthesized audio"}
		writeJSON(w, failure.status, failure.payload())
		return
	}

	routeKey := generationRouteKey(speechPlatform, plan.Model)
	out := speechResponse{
		ProjectID:       projectID,
		URL:             stored.PublicURL,
		ContentType:     plan.ContentType,
		Format:          plan.Format,
		Platform:        speechPlatform,
		Model:           plan.Model,
		GroupID:         req.GroupID,
		RouteKey:        routeKey,
		VoiceID:         plan.VoiceID,
		Speed:           plan.Speed,
		Emotion:         plan.Emotion,
		LanguageBoost:   plan.LanguageBoost,
		Text:            plan.Text,
		TextChars:       plan.TextChars,
		UsageCharacters: result.UsageCharacters,
		AudioLengthMs:   result.AudioLengthMs,
		AudioSizeBytes:  result.AudioSizeBytes,
		UsageID:         collector.usageID,
		CreatedAt:       time.Now().UTC().Format(time.RFC3339Nano),
	}
	if p.svc != nil {
		if projectID <= 0 {
			// 「全部作品」视图下发起：语音没有 host task 可回放，落进默认项目才不会丢。
			def, err := p.svc.EnsureDefaultProject(r.Context(), int(userID))
			if err != nil {
				p.logger.Error("speech_default_project_failed", "user_id", userID, "error", err)
			} else {
				projectID = def.ID
			}
		}
		if projectID > 0 {
			asset, err := p.svc.AddAsset(r.Context(), int(userID), projectID, AssetRecord{
				URL:             stored.PublicURL,
				Prompt:          plan.Text,
				Platform:        speechPlatform,
				Model:           plan.Model,
				GroupID:         req.GroupID,
				RouteKey:        routeKey,
				Mode:            speechAssetMode,
				Size:            plan.Format,
				Kind:            speechAssetKind,
				VoiceID:         plan.VoiceID,
				UsageCharacters: result.UsageCharacters,
				AudioLengthMs:   result.AudioLengthMs,
			})
			if err != nil {
				// 资产已在 core 持久化、音频照样回给前端，只是项目里少一条记录：记日志不阻塞。
				p.logger.Error("speech_asset_record_failed", "user_id", userID, "project_id", projectID, "url", stored.PublicURL, "error", err)
			} else {
				out.Asset = asset
				out.ProjectID = projectID
				out.CreatedAt = asset.CreatedAt.UTC().Format(time.RFC3339Nano)
			}
		}
	}
	writeJSON(w, http.StatusOK, out)
}

func speechGroupEligible(groups []imageGroup, groupID int64) bool {
	for _, g := range groups {
		if g.ID == groupID {
			return true
		}
	}
	return false
}

// handleListSpeechAssets GET /speech?limit&offset：跨项目分页列用户的语音资产，
// 供「全部作品」视图把没有 host task 的语音并进历史。
func (p *StudioPlugin) handleListSpeechAssets(w http.ResponseWriter, r *http.Request) {
	userID := parseUserID(r)
	limit := 20
	if v, err := strconv.Atoi(r.URL.Query().Get("limit")); err == nil && v > 0 && v <= 100 {
		limit = v
	}
	offset := 0
	if v, err := strconv.Atoi(r.URL.Query().Get("offset")); err == nil && v >= 0 {
		offset = v
	}
	assets, total, err := p.svc.ListAssetsByKind(r.Context(), userID, speechAssetKind, limit, offset)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			assets, total = nil, 0
		} else {
			p.logger.Error("speech_list_assets_failed", "user_id", userID, "error", err)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to list speech assets"})
			return
		}
	}
	if assets == nil {
		assets = []AssetRecord{}
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"assets": assets, "total": total})
}
