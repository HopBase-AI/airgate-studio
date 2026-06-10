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
		Author:      "AirGate",
		Type:        sdk.PluginTypeExtension,
		Capabilities: []sdk.Capability{
			sdk.CapabilityHostInvoke,
			sdk.CapabilityForHostMethod(hostMethodTasksCreate),
			sdk.CapabilityForHostMethod(hostMethodTasksGet),
			sdk.CapabilityForHostMethod(hostMethodTasksList),
			sdk.CapabilityForHostMethod(hostMethodTasksDelete),
			sdk.CapabilityForHostMethod(hostMethodPlatformsList),
			sdk.CapabilityForHostMethod(hostMethodModelsList),
			sdk.CapabilityForHostMethod(hostMethodUsersGet),
			// 暂停发布：增强 / 反推会触发额外同步 LLM 调用，先不声明 gateway.forward / assets.get_bytes。
		},
		FrontendPages: []sdk.FrontendPage{
			{
				Path:     "/studio",
				Title:    "创作中心",
				Icon:     "palette",
				Audience: "all",
			},
		},
	}
}
