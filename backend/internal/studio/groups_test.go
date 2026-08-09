package studio

import (
	"context"
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
	if got, want := err.Error(), "当前没有可用的 Gemini 图片分组"; !strings.Contains(got, want) {
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
