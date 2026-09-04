package studio

import sdk "github.com/DouDOU-start/airgate-sdk/sdkgo"

const (
	PluginID   = "airgate-studio"
	PluginName = "创作中心"
)

// PluginVersion 插件版本号；release workflow 会通过 git tag 注入正式版本。
var PluginVersion = "0.1.0"

func buildPluginInfo() sdk.PluginInfo {
	return sdk.PluginInfo{
		ID:          PluginID,
		Name:        PluginName,
		Version:     PluginVersion,
		SDKVersion:  sdk.SDKVersion,
		Description: "面向图片、视频、音频等多模态内容生成的统一创作中心",
		Author:      "HopBase",
		Type:        sdk.PluginTypeExtension,
		ConfigSchema: []sdk.ConfigField{
			{
				Key:         "inspiration_catalog_url",
				Label:       "远程灵感库 JSON URL",
				Type:        "text",
				Description: "可选。填写后会在内置灵感库基础上叠加远程 JSON catalog，用于接入品牌/行业/运营素材库。",
				Placeholder: "https://example.com/hopbase-studio-inspirations.json",
			},
		},
		Capabilities: []sdk.Capability{
			sdk.CapabilityHostInvoke,
			sdk.CapabilityForHostMethod(hostMethodTasksCreate),
			sdk.CapabilityForHostMethod(hostMethodTasksGet),
			sdk.CapabilityForHostMethod(hostMethodTasksList),
			sdk.CapabilityForHostMethod(hostMethodTasksDelete),
			sdk.CapabilityForHostMethod(hostMethodPlatformsList),
			sdk.CapabilityForHostMethod(hostMethodModelsList),
			sdk.CapabilityForHostMethod(hostMethodGroupsList),
			sdk.CapabilityForHostMethod(hostMethodUsersGet),
			// 视频后付费的提交前预算预检（可用余额 − 在途预留 − 本条预估）。
			sdk.CapabilityForHostMethod(hostMethodBillingBudget),
			// gateway.forward 用于打执行插件的 /v1/video/estimate（metadata_only 路由：
			// 不调度账号、不打上游、不计费）。Skills 的同步 LLM 调用仍未放开——那是路由
			// 未注册决定的，不靠不声明这条能力来兜底。
			sdk.CapabilityForHostMethod(hostMethodGatewayForward),
			// 暂停发布：增强 / 反推的图片反显需要 assets.get_bytes，先不声明。
		},
		FrontendPages: []sdk.FrontendPage{
			{
				Path:     "/studio",
				Title:    "playground.workflow_title",
				Icon:     "palette",
				Audience: "all",
			},
		},
	}
}
