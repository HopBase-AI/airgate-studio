package studio

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	sdk "github.com/DouDOU-start/airgate-sdk/sdkgo"
)

// imageGroup 是创作中心分组选择器的候选项，来自 host groups.list 的
// eligible_only 过滤（资格判定与排序都在 core，与自动选组行为一致，
// 已按 effective_rate 最便宜优先排序）。
type imageGroup struct {
	ID               int64             `json:"id"`
	Name             string            `json:"name"`
	Platform         string            `json:"platform"`
	RateMultiplier   float64           `json:"rate_multiplier"`
	EffectiveRate    float64           `json:"effective_rate"`
	Note             string            `json:"note,omitempty"`
	FixedImagePrices *fixedImagePrices `json:"fixed_image_prices,omitempty"`
}

type fixedImagePrices struct {
	OneK     *float64 `json:"1k,omitempty"`
	TwoK     *float64 `json:"2k,omitempty"`
	FourK    *float64 `json:"4k,omitempty"`
	Currency string   `json:"currency,omitempty"`
}

// hostListImageGroups 列出用户在指定平台/模型下可用于图像生成的分组。
func hostListImageGroups(ctx context.Context, host sdk.Host, userID int64, platform, model string) ([]imageGroup, error) {
	return hostListEligibleGroups(ctx, host, userID, platform, model, true)
}

// hostListEligibleGroups 按转发资格列分组；needsImage 决定是否要求图片能力
// （视频平台如 seedance 传 false，避免被 image_enabled 类门禁误伤）。
func hostListEligibleGroups(ctx context.Context, host sdk.Host, userID int64, platform, model string, needsImage bool) ([]imageGroup, error) {
	platform = strings.TrimSpace(platform)
	if platform == "" {
		return nil, fmt.Errorf("platform 不能为空")
	}
	payload := map[string]interface{}{
		"eligible_only": true,
		"user_id":       userID,
		"platform":      platform,
		"needs_image":   needsImage,
	}
	if strings.TrimSpace(model) != "" {
		payload["model"] = strings.TrimSpace(model)
	}
	resp, err := hostInvoke(ctx, host, hostMethodGroupsList, payload)
	if err != nil {
		return nil, err
	}
	raw, err := json.Marshal(firstValue(resp, "groups", "items", "data"))
	if err != nil {
		return nil, err
	}
	var groups []imageGroup
	if err := json.Unmarshal(raw, &groups); err != nil {
		return nil, err
	}
	return groups, nil
}

// validateGenerationGroup 校验用户显式指定的 group_id 是否在其可用分组内。
// core 的 gateway.forward 侧另有专属分组授权兜底，这里做前置校验只为给
// 前端返回明确的错误信息。
func validateGenerationGroup(ctx context.Context, host sdk.Host, userID, groupID int64, platform string) error {
	return validateGenerationAccess(ctx, host, userID, groupID, platform, "")
}

// validateVideoGenerationAccess 视频平台的分组资格校验（不要求图片能力）。
func validateVideoGenerationAccess(ctx context.Context, host sdk.Host, userID, groupID int64, platform, model string) error {
	groups, err := hostListEligibleGroups(ctx, host, userID, platform, model, false)
	if err != nil {
		return fmt.Errorf("查询可用分组失败: %w", err)
	}
	if len(groups) == 0 {
		return fmt.Errorf("当前没有可用的视频生成分组，请先在后台创建 %s 分组并绑定可用账号", displayPlatformName(platform))
	}
	if groupID <= 0 {
		return fmt.Errorf("请选择一个可用的视频生成分组")
	}
	for _, g := range groups {
		if g.ID == groupID {
			return nil
		}
	}
	return fmt.Errorf("分组不可用或无权访问")
}

// validateGenerationAccess 校验显式 group_id 属于当前用户在指定平台和模型下
// 可用的图片分组。缺少 group_id 时失败关闭，避免回落到 Core 自动选组。
func validateGenerationAccess(ctx context.Context, host sdk.Host, userID, groupID int64, platform, model string) error {
	groups, err := hostListImageGroups(ctx, host, userID, platform, model)
	if err != nil {
		return fmt.Errorf("查询可用分组失败: %w", err)
	}
	if len(groups) == 0 {
		return fmt.Errorf("当前没有可用的 %s 图片分组，请先在后台创建分组并绑定可用账号", displayPlatformName(platform))
	}
	if groupID <= 0 {
		return fmt.Errorf("请选择一个可用的图片生成分组")
	}
	for _, g := range groups {
		if g.ID == groupID {
			return nil
		}
	}
	return fmt.Errorf("分组不可用或无权访问")
}

func displayPlatformName(platform string) string {
	switch strings.ToLower(strings.TrimSpace(platform)) {
	case "gemini":
		return "Gemini"
	case "openai":
		return "OpenAI"
	default:
		return strings.TrimSpace(platform)
	}
}
