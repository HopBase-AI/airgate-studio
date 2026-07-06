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
	ID             int64   `json:"id"`
	Name           string  `json:"name"`
	Platform       string  `json:"platform"`
	RateMultiplier float64 `json:"rate_multiplier"`
	EffectiveRate  float64 `json:"effective_rate"`
	Note           string  `json:"note,omitempty"`
}

// hostListImageGroups 列出用户在指定平台下可用于图像生成的分组。
func hostListImageGroups(ctx context.Context, host sdk.Host, userID int64, platform string) ([]imageGroup, error) {
	platform = strings.TrimSpace(platform)
	if platform == "" {
		return nil, fmt.Errorf("platform 不能为空")
	}
	resp, err := hostInvoke(ctx, host, hostMethodGroupsList, map[string]interface{}{
		"eligible_only": true,
		"user_id":       userID,
		"platform":      platform,
		"needs_image":   true,
	})
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
	return validateGenerationAccess(ctx, host, userID, groupID, platform)
}

// validateGenerationAccess 校验指定平台至少有一个当前用户可用的图片分组；
// 如传了 group_id，则进一步确认该分组在可用列表内。
func validateGenerationAccess(ctx context.Context, host sdk.Host, userID, groupID int64, platform string) error {
	groups, err := hostListImageGroups(ctx, host, userID, platform)
	if err != nil {
		return fmt.Errorf("查询可用分组失败: %w", err)
	}
	if len(groups) == 0 {
		return fmt.Errorf("当前没有可用的 %s 图片分组，请先在后台创建分组并绑定可用账号", displayPlatformName(platform))
	}
	if groupID <= 0 {
		return nil
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
