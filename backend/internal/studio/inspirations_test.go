package studio

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func contextWithTestTimeout(t *testing.T) context.Context {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	t.Cleanup(cancel)
	return ctx
}

func TestBuiltInInspirationCatalogIncludesEcommercePromptRecipes(t *testing.T) {
	catalog := builtInInspirationCatalog()
	if catalog.Version == "" {
		t.Fatal("catalog version is empty")
	}
	if len(catalog.Items) < 25 {
		t.Fatalf("catalog has %d items, want expanded built-in catalog", len(catalog.Items))
	}

	var hasPromptRecipe bool
	var hasImageCase bool
	for _, item := range catalog.Items {
		if item.Category == "电商" && item.Kind == "prompt" && item.Scenario == "A+详情" {
			hasPromptRecipe = true
		}
		if item.Category == "电商" && item.Kind == "image" && item.Image != "" {
			hasImageCase = true
		}
		if item.ID == "" || item.Category == "" || item.Title == "" || item.Prompt == "" {
			t.Fatalf("catalog item missing required field: %+v", item)
		}
	}
	if !hasPromptRecipe {
		t.Fatal("catalog does not include ecommerce prompt recipes")
	}
	if !hasImageCase {
		t.Fatal("catalog does not include ecommerce image cases")
	}
}

func TestMergeInspirationCatalogsKeepsBuiltInItemsAndAppendsRemote(t *testing.T) {
	base := InspirationCatalog{
		Version: "base",
		Items: []InspirationItem{
			{ID: "same", Category: "电商", Title: "内置", Kind: "prompt", Prompt: "base"},
		},
	}
	remote := InspirationCatalog{
		Version: "remote",
		Items: []InspirationItem{
			{ID: "same", Category: "广告", Title: "远程重复", Kind: "prompt", Prompt: "remote duplicate"},
			{ID: "new", Category: "行业", Title: "远程新增", Kind: "prompt", Prompt: "remote new"},
		},
	}

	merged := mergeInspirationCatalogs(base, remote)
	if merged.Version != "base" {
		t.Fatalf("merged version = %q, want base", merged.Version)
	}
	if len(merged.Items) != 2 {
		t.Fatalf("merged items = %d, want 2", len(merged.Items))
	}
	if merged.Items[0].Prompt != "base" {
		t.Fatalf("duplicate item should keep built-in prompt, got %q", merged.Items[0].Prompt)
	}
	if merged.Items[1].ID != "new" {
		t.Fatalf("second item id = %q, want new", merged.Items[1].ID)
	}
}

func TestNormalizeInspirationCatalogDropsInvalidItemsAndFillsKind(t *testing.T) {
	catalog := InspirationCatalog{
		Items: []InspirationItem{
			{ID: "valid-image", Category: "电商", Title: "图", Image: "/x.jpg", Prompt: "p"},
			{ID: "valid-prompt", Category: "电商", Title: "词", Prompt: "p"},
			{ID: "", Category: "电商", Title: "bad", Prompt: "p"},
		},
	}
	normalizeInspirationCatalog(&catalog, "test-source")

	if len(catalog.Items) != 2 {
		t.Fatalf("normalized items = %d, want 2", len(catalog.Items))
	}
	if catalog.Items[0].Kind != "image" {
		t.Fatalf("image item kind = %q, want image", catalog.Items[0].Kind)
	}
	if catalog.Items[1].Kind != "prompt" {
		t.Fatalf("prompt item kind = %q, want prompt", catalog.Items[1].Kind)
	}
	for _, item := range catalog.Items {
		if item.Source != "test-source" {
			t.Fatalf("item source = %q, want test-source", item.Source)
		}
	}
}

func TestHandleListInspirationsReturnsBuiltInCatalog(t *testing.T) {
	p := &StudioPlugin{}
	req := httptest.NewRequest(http.MethodGet, "/inspirations", nil)
	rec := httptest.NewRecorder()

	p.handleListInspirations(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var catalog InspirationCatalog
	if err := json.NewDecoder(rec.Body).Decode(&catalog); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if catalog.Version == "" || len(catalog.Items) < 25 {
		t.Fatalf("unexpected catalog response: version=%q items=%d", catalog.Version, len(catalog.Items))
	}
}

func TestHandleListInspirationsMergesAndCachesRemoteCatalog(t *testing.T) {
	requests := 0
	remote := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		requests++
		writeJSON(w, http.StatusOK, InspirationCatalog{
			Version: "remote",
			Items: []InspirationItem{
				{ID: "remote-recipe", Category: "行业", Title: "远程行业提示词", Kind: "prompt", Prompt: "remote prompt"},
			},
		})
	}))
	defer remote.Close()

	p := &StudioPlugin{inspirationCatalogURL: remote.URL}
	for i := 0; i < 2; i++ {
		req := httptest.NewRequest(http.MethodGet, "/inspirations", nil)
		rec := httptest.NewRecorder()
		p.handleListInspirations(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200", rec.Code)
		}
		var catalog InspirationCatalog
		if err := json.NewDecoder(rec.Body).Decode(&catalog); err != nil {
			t.Fatalf("decode response: %v", err)
		}
		var found bool
		for _, item := range catalog.Items {
			if item.ID == "remote-recipe" {
				found = true
				break
			}
		}
		if !found {
			t.Fatal("merged catalog did not include remote item")
		}
	}
	if requests != 1 {
		t.Fatalf("remote requests = %d, want 1 cached request", requests)
	}
}

func TestLoadRemoteInspirationCatalogRefreshesAfterTTL(t *testing.T) {
	requests := 0
	remote := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		requests++
		writeJSON(w, http.StatusOK, InspirationCatalog{
			Version: "remote",
			Items: []InspirationItem{
				{ID: "remote-recipe", Category: "行业", Title: "远程行业提示词", Kind: "prompt", Prompt: "remote prompt"},
			},
		})
	}))
	defer remote.Close()

	p := &StudioPlugin{}
	if _, err := p.loadRemoteInspirationCatalog(contextWithTestTimeout(t), remote.URL); err != nil {
		t.Fatalf("first load: %v", err)
	}
	p.inspirationCacheMu.Lock()
	p.inspirationCacheUntil = time.Now().Add(-time.Second)
	p.inspirationCacheMu.Unlock()
	if _, err := p.loadRemoteInspirationCatalog(contextWithTestTimeout(t), remote.URL); err != nil {
		t.Fatalf("second load: %v", err)
	}
	if requests != 2 {
		t.Fatalf("remote requests = %d, want refresh after ttl", requests)
	}
}
