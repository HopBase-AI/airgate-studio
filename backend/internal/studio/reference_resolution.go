package studio

import (
	"fmt"
	"strings"
)

// referenceImageResolutions 带参考图时允许的分辨率（小写），与前端 videoConfig 的
// imageResolutions 同口径。grok 参考生视频官方最高 720p：「Reference-to-video is capped at 720p」。
var referenceImageResolutions = map[string]map[string]struct{}{
	"grok-imagine-video-1.5": {"480p": {}, "720p": {}},
}

// validateReferenceResolution 带参考图时校验分辨率上限；不带图或模型无此限制时放行。
func validateReferenceResolution(model string, params map[string]interface{}, inputs []generationInput) error {
	allowed, ok := referenceImageResolutions[strings.ToLower(strings.TrimSpace(model))]
	if !ok || len(extractImageInputs(inputs)) == 0 {
		return nil
	}
	resolution, _ := params["resolution"].(string)
	resolution = strings.ToLower(strings.TrimSpace(resolution))
	if resolution == "" {
		return nil
	}
	if _, ok := allowed[resolution]; ok {
		return nil
	}
	return fmt.Errorf("model %s supports up to 720p when reference images are attached", model)
}
