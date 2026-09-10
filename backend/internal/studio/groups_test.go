package studio

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"testing"

	sdk "github.com/DouDOU-start/airgate-sdk/sdkgo"
)

type groupTestHost struct {
	groups        []interface{}
	groupsByModel map[string][]interface{}
	lastRequest   sdk.HostInvokeRequest
	requests      []sdk.HostInvokeRequest
}

func (h *groupTestHost) Invoke(_ context.Context, req sdk.HostInvokeRequest) (*sdk.HostInvokeResponse, error) {
	h.lastRequest = req
	h.requests = append(h.requests, req)
	if req.Method != hostMethodGroupsList {
		return nil, errors.New("unexpected host method")
	}
	groups := h.groups
	if h.groupsByModel != nil {
		groups = h.groupsByModel[fmt.Sprint(req.Payload["model"])]
	}
	return &sdk.HostInvokeResponse{
		Status:  "ok",
		Payload: map[string]interface{}{"groups": groups},
	}, nil
}

func (h *groupTestHost) InvokeStream(context.Context, sdk.HostStreamRequest) (sdk.HostStream, error) {
	return nil, errors.New("not implemented")
}

func TestHostListImageGroups(t *testing.T) {
	zero := 0.0
	oneK := 0.08
	host := &groupTestHost{groups: []interface{}{
		map[string]interface{}{"id": 3, "name": "标准", "platform": "gemini", "rate_multiplier": 1.0, "effective_rate": 1.0},
		map[string]interface{}{
			"id": 5, "name": "高清", "platform": "gemini", "rate_multiplier": 2.0, "effective_rate": 1.8, "note": "nano-banana",
			"fixed_image_prices": map[string]interface{}{"1k": oneK, "2k": zero, "currency": "CNY"},
		},
	}}

	groups, err := hostListImageGroups(context.Background(), host, 7, "gemini", "gemini-3-pro-image")
	if err != nil {
		t.Fatalf("hostListImageGroups: %v", err)
	}
	if len(groups) != 2 || groups[0].ID != 3 || groups[1].ID != 5 {
		t.Fatalf("groups = %+v", groups)
	}
	if groups[1].EffectiveRate != 1.8 || groups[1].Note != "nano-banana" {
		t.Fatalf("group fields = %+v", groups[1])
	}
	if groups[1].FixedImagePrices == nil || groups[1].FixedImagePrices.OneK == nil || *groups[1].FixedImagePrices.OneK != oneK {
		t.Fatalf("fixed prices = %+v", groups[1].FixedImagePrices)
	}
	if groups[1].FixedImagePrices.TwoK == nil || *groups[1].FixedImagePrices.TwoK != zero || groups[1].FixedImagePrices.Currency != "CNY" {
		t.Fatalf("fixed zero price/currency lost: %+v", groups[1].FixedImagePrices)
	}

	// 请求应带 eligible_only / needs_image / user_id / platform，让资格判定留在 core
	payload := host.lastRequest.Payload
	if payload["eligible_only"] != true || payload["needs_image"] != true {
		t.Fatalf("payload = %v", payload)
	}
	if payload["user_id"] != int64(7) || payload["platform"] != "gemini" || payload["model"] != "gemini-3-pro-image" {
		t.Fatalf("payload = %v", payload)
	}

	if _, err := hostListImageGroups(context.Background(), host, 7, "  ", "gemini-3-pro-image"); err == nil {
		t.Fatal("expected error for empty platform")
	}
}

func TestHostListEligibleGroupsMergesBothSeedance25RoutingIDs(t *testing.T) {
	host := &groupTestHost{groupsByModel: map[string][]interface{}{
		videoModelSeedance25: {
			map[string]interface{}{"id": 3, "name": "official", "platform": "seedance", "effective_rate": 1.5},
			map[string]interface{}{"id": 5, "name": "shared", "platform": "seedance", "effective_rate": 1.8},
		},
		videoModelSeedance25LegacyEP: {
			map[string]interface{}{"id": 5, "name": "shared legacy", "platform": "seedance", "effective_rate": 1.8},
			map[string]interface{}{"id": 4, "name": "legacy", "platform": "seedance", "effective_rate": 1.1},
		},
	}}

	groups, err := hostListEligibleGroups(context.Background(), host, 7, "seedance", videoModelSeedance25, false)
	if err != nil {
		t.Fatalf("hostListEligibleGroups: %v", err)
	}
	if len(groups) != 3 || groups[0].ID != 4 || groups[1].ID != 3 || groups[2].ID != 5 {
		t.Fatalf("groups = %+v", groups)
	}
	if len(host.requests) != 2 {
		t.Fatalf("groups.list calls = %d, want 2", len(host.requests))
	}
	gotModels := []interface{}{host.requests[0].Payload["model"], host.requests[1].Payload["model"]}
	wantModels := []interface{}{videoModelSeedance25, videoModelSeedance25LegacyEP}
	if !reflect.DeepEqual(gotModels, wantModels) {
		t.Fatalf("models = %#v, want %#v", gotModels, wantModels)
	}
	for _, req := range host.requests {
		if req.Payload["needs_image"] != false {
			t.Fatalf("payload = %v", req.Payload)
		}
	}

	host.requests = nil
	legacyGroups, err := hostListEligibleGroups(context.Background(), host, 7, "seedance", videoModelSeedance25LegacyEP, false)
	if err != nil {
		t.Fatalf("hostListEligibleGroups legacy input: %v", err)
	}
	if !reflect.DeepEqual(legacyGroups, groups) {
		t.Fatalf("legacy-input groups = %+v, want %+v", legacyGroups, groups)
	}
	if len(host.requests) != 2 || host.requests[0].Payload["model"] != videoModelSeedance25 || host.requests[1].Payload["model"] != videoModelSeedance25LegacyEP {
		t.Fatalf("legacy-input requests = %+v", host.requests)
	}
}

func TestValidateGenerationGroup(t *testing.T) {
	host := &groupTestHost{groups: []interface{}{
		map[string]interface{}{"id": 3, "name": "标准", "platform": "gemini"},
	}}

	if err := validateGenerationGroup(context.Background(), host, 7, 3, "gemini"); err != nil {
		t.Fatalf("expected group 3 to be allowed, got %v", err)
	}
	if err := validateGenerationGroup(context.Background(), host, 7, 99, "gemini"); err == nil {
		t.Fatal("expected group 99 to be rejected")
	}
}

func TestValidateGenerationAccessRequiresAvailablePlatformGroup(t *testing.T) {
	host := &groupTestHost{groups: []interface{}{}}

	err := validateGenerationAccess(context.Background(), host, 7, 0, "gemini", "gemini-3-pro-image")
	if err == nil {
		t.Fatal("expected no available gemini group to be rejected")
	}
	if got, want := err.Error(), "No Gemini image group is available"; !strings.Contains(got, want) {
		t.Fatalf("error = %q, want contains %q", got, want)
	}
}

func TestValidateGenerationAccessRequiresExplicitGroup(t *testing.T) {
	host := &groupTestHost{groups: []interface{}{
		map[string]interface{}{"id": 3, "name": "标准", "platform": "openai"},
	}}

	if err := validateGenerationAccess(context.Background(), host, 7, 0, "openai", "gpt-image-2"); err == nil {
		t.Fatal("missing image group_id must fail closed")
	}
	if err := validateVideoGenerationAccess(context.Background(), host, 7, 0, "seedance", "seedance-model"); err == nil {
		t.Fatal("missing video group_id must fail closed")
	}
}

// TestImageGroupChannelPassthrough 覆盖数据契约 §4 的 channel / users_30d：
// core 直接给 channel 或透传 plugin_settings.studio.channel 都能落到 channel 字段，
// 值归一到封闭词表；plugin_settings 本身绝不带给前端。
func TestImageGroupChannelPassthrough(t *testing.T) {
	users := int64(42)
	host := &groupTestHost{groups: []interface{}{
		map[string]interface{}{"id": 23, "name": "Gemini 官方直连", "platform": "gemini", "rate_multiplier": 5.1, "effective_rate": 5.1, "channel": "Official"},
		map[string]interface{}{
			"id": 34, "name": "Gemini 生图(Banana 系)", "platform": "gemini", "rate_multiplier": 4.76, "effective_rate": 4.76,
			"plugin_settings": map[string]interface{}{"studio": map[string]interface{}{"channel": "official", "secret": "x"}},
			"users_30d":       users,
		},
		map[string]interface{}{"id": 18, "name": "Gemini 全系(含生图)", "platform": "openai", "rate_multiplier": 5.1, "effective_rate": 5.1, "channel": "vip"},
		map[string]interface{}{"id": 15, "name": "GPT Image 全系", "platform": "openai", "rate_multiplier": 5.1, "effective_rate": 5.1},
	}}

	groups, err := hostListImageGroups(context.Background(), host, 7, "gemini", "gemini-3-pro-image")
	if err != nil {
		t.Fatalf("hostListImageGroups: %v", err)
	}
	if len(groups) != 4 {
		t.Fatalf("groups = %+v", groups)
	}
	if groups[0].Channel != "official" {
		t.Fatalf("top-level channel should normalise to official, got %q", groups[0].Channel)
	}
	if groups[1].Channel != "official" {
		t.Fatalf("plugin_settings.studio.channel should surface as channel, got %q", groups[1].Channel)
	}
	if groups[1].Users30d == nil || *groups[1].Users30d != users {
		t.Fatalf("users_30d lost: %+v", groups[1].Users30d)
	}
	if groups[2].Channel != "" || groups[3].Channel != "" {
		t.Fatalf("unknown/missing channel must be dropped: %q %q", groups[2].Channel, groups[3].Channel)
	}
	if groups[0].Users30d != nil {
		t.Fatalf("users_30d should be absent when core does not report it: %v", *groups[0].Users30d)
	}

	raw, err := json.Marshal(groups)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if strings.Contains(string(raw), "plugin_settings") || strings.Contains(string(raw), "secret") {
		t.Fatalf("plugin_settings must not leak to the frontend: %s", raw)
	}
	if !strings.Contains(string(raw), `"channel":"official"`) || !strings.Contains(string(raw), `"users_30d":42`) {
		t.Fatalf("channel/users_30d missing from payload: %s", raw)
	}
	if strings.Contains(string(raw), `"channel":""`) {
		t.Fatalf("empty channel should be omitted: %s", raw)
	}
}
