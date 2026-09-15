package studio

import (
	"fmt"
	"io"
	"net/http"
	"strings"
)

// 视频模式的参考素材：图片 / 视频 / 音频三类。条数上限按模型登记，与前端
// web/src/studio/video/videoConfig.ts 的 references、各执行插件的请求校验同一口径
// （官方文档核对于 2026-09-15）。单个文件的格式、大小、时长由前端预检、执行插件探测兜底；
// 这里只管类型、条数、搭配关系与地址形态，在建任务前给出明确错误。

const (
	referenceKindImage = "image"
	referenceKindVideo = "video"
	referenceKindAudio = "audio"

	// 上传经 assets.store 进 core：Host.Invoke 载荷走 JSON，字节按 base64 膨胀 4/3，
	// 整条消息受 64MB gRPC 上限约束，单个视频取 45MB 留出余量。
	maxReferenceVideoBytes = 45 << 20
	maxReferenceAudioBytes = 15 << 20

	referenceAssetPurpose = "task-input"
)

type videoReferenceLimits struct {
	images int
	videos int
	audios int
	// total 三类合计上限，0 表示不限。
	total int
	// audioRequiresVisual 参考音频必须至少搭配一张参考图或一段参考视频。
	audioRequiresVisual bool
}

var (
	seedance25ReferenceLimits = videoReferenceLimits{images: 30, videos: 10, audios: 10}
	seedance20ReferenceLimits = videoReferenceLimits{images: 9, videos: 3, audios: 3, audioRequiresVisual: true}
)

// videoReferenceLimitsByModel key=小写模型 ID。未登记的模型只放行参考图（张数交给执行插件）。
var videoReferenceLimitsByModel = map[string]videoReferenceLimits{
	videoModelSeedance25:               seedance25ReferenceLimits,
	videoModelSeedance25Domestic:       seedance25ReferenceLimits,
	videoModelSeedanceStandardOverseas: seedance20ReferenceLimits,
	videoModelSeedanceStandardDomestic: seedance20ReferenceLimits,
	videoModelSeedanceFastOverseas:     seedance20ReferenceLimits,
	videoModelSeedanceFastDomestic:     seedance20ReferenceLimits,
	videoModelSeedanceMiniOverseas:     seedance20ReferenceLimits,
	videoModelSeedanceMiniDomestic:     seedance20ReferenceLimits,
	// grok 只收参考图；xAI 未公开张数上限，按 7 张保守。
	"grok-imagine-video-1.5": {images: 7},
	"minimax-h3":             {images: 9, videos: 3, audios: 3, total: 12, audioRequiresVisual: true},
	// H3-Max 只有首帧 + 尾帧两张图。
	"minimax-h3-max":     {images: 2},
	"wan3.0-video":       {images: 10, videos: 5, audios: 5},
	"happyhorse-1.1-t2v": {},
	"happyhorse-1.1-i2v": {images: 1},
	"kling-v3":           {images: 6},
	"kling-v2-6":         {images: 4},
}

func lookupVideoReferenceLimits(model string) (videoReferenceLimits, bool) {
	limits, ok := videoReferenceLimitsByModel[strings.ToLower(canonicalSeedanceVideoModel(model))]
	return limits, ok
}

// referenceInputKind 归一素材类型；历史请求只传图片且可能不带 type，缺省按图片。
func referenceInputKind(input generationInput) string {
	switch strings.ToLower(strings.TrimSpace(input.Type)) {
	case "", referenceKindImage:
		return referenceKindImage
	case referenceKindVideo:
		return referenceKindVideo
	case referenceKindAudio:
		return referenceKindAudio
	default:
		return ""
	}
}

// extractReferenceMedia 取参考视频或参考音频的地址（图片走 extractImageInputs，含 mask 过滤）。
func extractReferenceMedia(inputs []generationInput, kind string) []string {
	var urls []string
	for _, input := range inputs {
		url := strings.TrimSpace(input.URL)
		if url == "" || referenceInputKind(input) != kind {
			continue
		}
		urls = append(urls, url)
	}
	return urls
}

// isUploadedReferenceURL 参考视频 / 音频只收已上传的资产地址：本地存储的站内相对地址，
// 或对象存储的 http(s) 地址。data URL 不收——core 只把 data:image 转存成资产。
func isUploadedReferenceURL(raw string) bool {
	url := strings.TrimSpace(raw)
	lower := strings.ToLower(url)
	return strings.HasPrefix(url, "/assets-runtime/") ||
		strings.HasPrefix(lower, "https://") ||
		strings.HasPrefix(lower, "http://")
}

// validateReferenceInputs 建任务前的参考素材校验：图片任务只收图片；视频任务按模型登记的
// 条数与搭配规则校验。
func validateReferenceInputs(kind, model string, inputs []generationInput) error {
	isVideo := kind == "video"
	for _, input := range inputs {
		if strings.TrimSpace(input.URL) == "" {
			continue
		}
		switch mediaKind := referenceInputKind(input); mediaKind {
		case referenceKindImage:
		case referenceKindVideo, referenceKindAudio:
			if !isVideo {
				return fmt.Errorf("reference videos and audio are only supported for video generation")
			}
			if !isUploadedReferenceURL(input.URL) {
				return fmt.Errorf("reference %s must be uploaded before submitting; inline data is not accepted", mediaKind)
			}
		default:
			return fmt.Errorf("unsupported reference type %q", input.Type)
		}
	}
	if !isVideo {
		return nil
	}

	images := len(extractImageInputs(inputs))
	videos := len(extractReferenceMedia(inputs, referenceKindVideo))
	audios := len(extractReferenceMedia(inputs, referenceKindAudio))
	limits, known := lookupVideoReferenceLimits(model)
	if !known {
		if videos > 0 || audios > 0 {
			return fmt.Errorf("model %s does not support reference videos or audio", model)
		}
		return nil
	}
	if err := checkReferenceCount(model, "images", images, limits.images); err != nil {
		return err
	}
	if err := checkReferenceCount(model, "videos", videos, limits.videos); err != nil {
		return err
	}
	if err := checkReferenceCount(model, "audio clips", audios, limits.audios); err != nil {
		return err
	}
	if total := images + videos + audios; limits.total > 0 && total > limits.total {
		return fmt.Errorf("model %s accepts at most %d reference files in total, got %d", model, limits.total, total)
	}
	if limits.audioRequiresVisual && audios > 0 && images == 0 && videos == 0 {
		return fmt.Errorf("model %s requires at least one reference image or video alongside reference audio", model)
	}
	return nil
}

func checkReferenceCount(model, noun string, got, max int) error {
	if got == 0 {
		return nil
	}
	if max == 0 {
		return fmt.Errorf("model %s does not accept reference %s", model, noun)
	}
	if got > max {
		return fmt.Errorf("model %s accepts at most %d reference %s, got %d", model, max, noun, got)
	}
	return nil
}

// handleUploadReference 视频模式参考视频 / 音频的上传入口：请求体是文件原始字节，
// ?kind=video|audio；经 assets.store 落成 task-input 资产，回资产地址供建任务时引用。
// 视频不能像参考图那样读成 data URL 塞进 JSON：执行插件不收 data:video，体积也装不下。
func (p *StudioPlugin) handleUploadReference(w http.ResponseWriter, r *http.Request) {
	kind := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("kind")))
	var limit int64
	switch kind {
	case referenceKindVideo:
		limit = maxReferenceVideoBytes
	case referenceKindAudio:
		limit = maxReferenceAudioBytes
	default:
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "kind must be video or audio"})
		return
	}
	data, err := io.ReadAll(io.LimitReader(r.Body, limit+1))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "failed to read the uploaded file"})
		return
	}
	if len(data) == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "the uploaded file is empty"})
		return
	}
	if int64(len(data)) > limit {
		writeJSON(w, http.StatusRequestEntityTooLarge, map[string]interface{}{
			"error": fmt.Sprintf("reference %s exceeds the %d MB upload limit", kind, limit>>20),
			"code":  "reference_too_large",
		})
		return
	}
	contentType, ext, ok := sniffReferenceMedia(kind, data)
	if !ok {
		message := "unsupported reference video format; upload an MP4 or MOV file"
		if kind == referenceKindAudio {
			message = "unsupported reference audio format; upload an MP3 or WAV file"
		}
		writeJSON(w, http.StatusUnsupportedMediaType, map[string]interface{}{
			"error": message,
			"code":  "reference_unsupported_format",
		})
		return
	}

	userID := parseUserIDInt64(r)
	stored, err := hostStoreReferenceAsset(r.Context(), p.host, userID, contentType, ext, data)
	if err != nil {
		if p.logger != nil {
			p.logger.Error("reference_upload_store_failed", "user_id", userID, "kind", kind, "size_bytes", len(data), "error", err)
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to store the reference file"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"kind":         kind,
		"url":          stored.PublicURL,
		"object_key":   stored.ObjectKey,
		"content_type": contentType,
		"size_bytes":   len(data),
	})
}

// sniffReferenceMedia 按文件头识别格式，不采信浏览器给的 MIME（.mov 在部分系统上报成空串
// 或 octet-stream）。MP3 帧同步排除 layer 位为 00 的 ADTS AAC。
func sniffReferenceMedia(kind string, data []byte) (contentType, ext string, ok bool) {
	switch kind {
	case referenceKindVideo:
		if len(data) < 12 {
			return "", "", false
		}
		switch string(data[4:8]) {
		case "ftyp":
			if string(data[8:12]) == "qt  " {
				return "video/quicktime", ".mov", true
			}
			return "video/mp4", ".mp4", true
		case "moov", "mdat", "wide", "free", "skip":
			// 老式 QuickTime 文件没有 ftyp 盒。
			return "video/quicktime", ".mov", true
		}
	case referenceKindAudio:
		if len(data) >= 12 && string(data[0:4]) == "RIFF" && string(data[8:12]) == "WAVE" {
			return "audio/wav", ".wav", true
		}
		if len(data) >= 3 && string(data[0:3]) == "ID3" {
			return "audio/mpeg", ".mp3", true
		}
		if len(data) >= 2 && data[0] == 0xFF && data[1]&0xE0 == 0xE0 && data[1]&0x06 != 0 {
			return "audio/mpeg", ".mp3", true
		}
	}
	return "", "", false
}
