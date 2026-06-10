package studio

import (
	"context"
	"errors"
	"testing"

	sdk "github.com/DouDOU-start/airgate-sdk/sdkgo"
)

type skillTestHost struct {
	models      []interface{}
	lastRequest sdk.HostInvokeRequest
}

func (h *skillTestHost) Invoke(_ context.Context, req sdk.HostInvokeRequest) (*sdk.HostInvokeResponse, error) {
	h.lastRequest = req
	if req.Method != hostMethodModelsList {
		return nil, errors.New("unexpected host method")
	}
	return &sdk.HostInvokeResponse{
		Status:  "ok",
		Payload: map[string]interface{}{"models": h.models},
	}, nil
}

func (h *skillTestHost) InvokeStream(context.Context, sdk.HostStreamRequest) (sdk.HostStream, error) {
	return nil, errors.New("not implemented")
}

func TestAssetObjectKeyFromRuntimeURL(t *testing.T) {
	cases := []struct {
		raw     string
		wantKey string
		wantOK  bool
	}{
		{"/assets-runtime/generated/7/202606/abc.png", "generated/7/202606/abc.png", true},
		{"/assets-runtime/generated/7/202606/abc.png?w=512", "generated/7/202606/abc.png", true},
		{"/assets-runtime/with%20space/x.png", "with space/x.png", true},
		{"https://cdn.example.com/foo.png", "", false},
		{"data:image/png;base64,AAAA", "", false},
		{"/assets-runtime/", "", false},
	}
	for _, c := range cases {
		key, ok := assetObjectKeyFromRuntimeURL(c.raw)
		if key != c.wantKey || ok != c.wantOK {
			t.Errorf("assetObjectKeyFromRuntimeURL(%q) = (%q, %v), want (%q, %v)", c.raw, key, ok, c.wantKey, c.wantOK)
		}
	}
}

func TestExtractChatContent(t *testing.T) {
	// 普通字符串 content
	s := extractChatContent([]byte(`{"choices":[{"message":{"content":"  hello world  "}}]}`))
	if s != "hello world" {
		t.Errorf("string content = %q, want %q", s, "hello world")
	}
	// 分段数组 content（多模态返回）
	s = extractChatContent([]byte(`{"choices":[{"message":{"content":[{"type":"text","text":"part1 "},{"type":"text","text":"part2"}]}}]}`))
	if s != "part1 part2" {
		t.Errorf("array content = %q, want %q", s, "part1 part2")
	}
	// 空 choices
	if got := extractChatContent([]byte(`{"choices":[]}`)); got != "" {
		t.Errorf("empty choices = %q, want empty", got)
	}
	// 非法 JSON
	if got := extractChatContent([]byte(`not json`)); got != "" {
		t.Errorf("invalid json = %q, want empty", got)
	}
}

func TestResolveSkillModelFallbackSkipsImageOnly(t *testing.T) {
	host := &skillTestHost{models: []interface{}{
		map[string]interface{}{
			"id":           "gpt-image-2",
			"capabilities": []interface{}{skillModelCapImageGeneration},
		},
		map[string]interface{}{
			"id":           "gpt-5.4",
			"capabilities": []interface{}{skillModelCapChat, "reasoning"},
		},
	}}
	p := &StudioPlugin{host: host, skillPlatform: "openai"}

	platform, model := p.resolveSkillModel(context.Background(), "", "", false)
	if platform != "openai" || model != "gpt-5.4" {
		t.Fatalf("resolveSkillModel() = (%q, %q), want (%q, %q)", platform, model, "openai", "gpt-5.4")
	}
	if got := host.lastRequest.Payload["capability"]; got != skillModelCapChat {
		t.Fatalf("models.list capability = %v, want %q", got, skillModelCapChat)
	}
}

func TestResolveSkillModelVisionFallbackSkipsImageOnly(t *testing.T) {
	host := &skillTestHost{models: []interface{}{
		map[string]interface{}{
			"id":           "gpt-image-1.5",
			"capabilities": []interface{}{skillModelCapImageGeneration},
		},
		map[string]interface{}{
			"id":           "gpt-5.3-codex-spark",
			"capabilities": []interface{}{skillModelCapChat, "reasoning"},
		},
		map[string]interface{}{
			"id":           "gpt-5.5",
			"capabilities": []interface{}{skillModelCapChat, "reasoning"},
		},
	}}
	p := &StudioPlugin{host: host, skillPlatform: "openai"}

	_, model := p.resolveSkillModel(context.Background(), "", "", true)
	if model != "gpt-5.5" {
		t.Fatalf("vision resolveSkillModel() model = %q, want %q", model, "gpt-5.5")
	}
}

func TestResolveSkillModelNoUsableChatModel(t *testing.T) {
	host := &skillTestHost{models: []interface{}{
		map[string]interface{}{
			"id":           "gpt-image-2",
			"capabilities": []interface{}{skillModelCapImageGeneration},
		},
	}}
	p := &StudioPlugin{host: host, skillPlatform: "openai"}

	_, model := p.resolveSkillModel(context.Background(), "", "", false)
	if model != "" {
		t.Fatalf("resolveSkillModel() model = %q, want empty", model)
	}
}

func TestResolveSkillModelRejectsConfiguredImageModel(t *testing.T) {
	p := &StudioPlugin{skillPlatform: "openai", skillTextModel: "gpt-image-2"}

	_, model := p.resolveSkillModel(context.Background(), "", "", false)
	if model != "" {
		t.Fatalf("resolveSkillModel() configured image model = %q, want empty", model)
	}
}

func TestSelectSkillModelAllowsLegacyModelWithoutCapabilities(t *testing.T) {
	model := selectSkillModel([]interface{}{
		map[string]interface{}{"id": "custom-chat-model"},
	}, false)
	if model != "custom-chat-model" {
		t.Fatalf("selectSkillModel() = %q, want %q", model, "custom-chat-model")
	}
}

func TestSelectSkillModelVisionRequiresLikelyVisionModel(t *testing.T) {
	model := selectSkillModel([]interface{}{
		map[string]interface{}{"id": "custom-chat-model"},
		map[string]interface{}{"id": "gpt-5.4"},
	}, true)
	if model != "gpt-5.4" {
		t.Fatalf("vision selectSkillModel() = %q, want %q", model, "gpt-5.4")
	}
}

func TestSelectSkillModelVisionRejectsPlainChatFallback(t *testing.T) {
	model := selectSkillModel([]interface{}{
		map[string]interface{}{"id": "custom-chat-model"},
	}, true)
	if model != "" {
		t.Fatalf("vision selectSkillModel() = %q, want empty", model)
	}
}
